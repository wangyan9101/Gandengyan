# 阶段4.1：会话与协议 v1

日期：2026-10-23。本节记录阶段4.1的历史协议骨架；阶段4.2～4.4已增加WebSocket、房间、实时对局与恢复，扩展见本文后续章节，当前验收见RELIABILITY.md。持久化与微信身份仍未实现。

## 模块与调用

- packages/rules：原规则引擎未修改；后续服务端直接导入源码，不使用客户端镜像。
- packages/session：GameSession、SessionSnapshot、本人提示及牌型解释。原候选生成算法从 local 移入此处，local 保留兼容导出，未增加第二套规则。
- LocalSession implements GameSession；play/pass 保留同步 boolean，兼容现有单机与测试。通用接口允许 boolean 或 Promise<boolean>，调用方可统一 await；RemoteSession 返回 Promise<boolean>。
- UI 对即时结果立即刷新，对 Promise 显示等待并禁用重复操作，失败保留选择，旧会话完成不能覆盖新局。stepAi 只由本地适配器推进。
- RemoteSession 只适配已经认证并入座的一局；通过注入 RequestTransport 和请求ID生成器测试，不创建 socket。request 接收编码后的字符串，返回 unknown；所有响应都经校验。
- 远程会话不乐观修改规则状态；快照必须匹配本人、房间、局和递增游戏版本。允许请求响应前先收到相同广播快照；不接受跨局切换，下一局需新建会话。
- acceptMessage 为后续受认证传输预留快照入口，本期没有订阅或自动推送接线。dispose 后拒绝快照与迟到响应。

## 请求信封

每个客户端请求必含 protocolVersion=1、requestId、roomId、roundId、expectedVersion。客户端不能提交 playerId、完整牌堆、赢家、倍率或积分结果；身份来自后续服务端认证。

| type | 上下文及附加字段 |
| --- | --- |
| create-room | roomId=null、roundId=null、expectedVersion=0；capacity=2～8、完整 rules |
| join-room | roomId；roundId=null；加入者未知房间版本时填0，实际并发抢座由后续服务端处理 |
| ready | roomId；roundId=null；ready:boolean |
| start | roomId；roundId=null |
| play | roomId、roundId；cardIds=1～24个唯一ID；declaration 为 null 或 {kind,primaryRank} |
| pass | roomId、roundId |
| sync | roomId；roundId 为已知局ID或null |

准备/开局等房间操作的 expectedVersion 指房间版本；出牌/过牌指规则引擎游戏版本；sync 携带客户端最后已知版本，服务端应返回当前授权快照而非按旧缓存恢复。join-room 的版本0不构成更新其他房间状态的权限。

requestId 最多128字符；房间ID、局ID也最多128字符。请求幂等键、同ID不同载荷拒绝、身份授权、频控、并发事务与结算去重均为后续服务端责任，本期不声称已完成。远程适配器在一次会话内拒绝复用已发送请求ID，不自动重试。

## 响应与隐私

- PublicRoomView：房间ID、房间版本、当前局ID、状态、容量、房主、规则摘要、成员的显示名/席位/准备/连接状态；没有私人手牌。
- PublicGameView：直接采用现有 createPublicView 返回类型，含余牌数、公开出牌、当前行动者、倍率与结算；没有所有玩家的手牌或底牌顺序。
- SelfGameView：selfPlayerId、public、仅本人的 hand。
- sync 响应：protocolVersion、type、requestId（主动快照为null）、room、self。等待房间的 self 必为 null；对局快照必须与房间成员、规则及状态一致。
- error 响应：protocolVersion、type、requestId、roomId、roundId、枚举 code；禁止附加堆栈、自由文本、令牌或私人快照。
- projectGameSync 在可信宿主边界复用现有投影函数。未认证或非成员只生成 unauthorized 错误，不生成本人快照。room 和 authenticatedMemberId 必须来自权威成员记录与认证上下文，不能取自请求。知道玩家ID、持有一个合法DTO或通过校验都不等于已获授权。
- 后续服务端对每个已授权连接单独调用投影并编码；禁止广播含全部私有投影的集合。对外发送只能经过 encodeServerMessage；不能直接 JSON.stringify(GameState)。

parseClientMessage/parseServerMessage 接收 unknown 对象或JSON字符串；校验协议版本、必填与额外字段、嵌套对象白名单、长度、整数边界、唯一性和视图一致性，返回冻结的独立副本。encode 方法执行相同校验，拒绝私有字段注入，不静默保留或转发额外字段。

JSON字符串限制65536个UTF-16代码单元；后续传输层还需设置字节大小、连接速率及超时限制。此处只做协议校验，不能替代服务端认证和权威规则校验。所有玩法合法性继续由 rules 裁决。

## 检查与手动验收

npm run check:all：原有322项测试保持不变，加30项协议、授权投影、会话与异步表现层测试，共352项通过；规则、本地及新增模块严格类型检查、源码镜像一致性和客户端类型检查通过。

镜像只包含 rules/protocol/session/local/remote 五个白名单包；同步工具拒绝非允许的导入路径，不包含 Node、WebSocket服务端或云SDK依赖。未增加运行时依赖。

切回 Creator 3.8.5 等待导入新增目录与脚本，由 Creator 生成新 .meta；保留所有现有 .meta 与场景，不手写元文件。打开 assets/scene.scene，人工验证配置、提示、出牌、过牌、AI推进、结算及重开；微信构建与真机需重新单独验收。本轮没有执行这些端上操作。

阶段4.1到此停止；建房/入房/准备/开局仅有协议定义，远程会话仅经假传输测试。后续服务端和真实联网需另行授权；RULES中的剩王、断线/退出及换庄问题保持未定。

## 阶段4.2增量（2026-10-23）

本文上半部分保留阶段4.1历史边界。本阶段新增本地WebSocket服务与房间大厅：ServerMessage新增welcome（protocolVersion=1、requestId=null、selfPlayerId），PublicRoomView新增locked状态（roundId=null、self=null），新增not-ready/not-full/limit-exceeded错误码。真实网络适配NetworkClient与大厅状态见 [LOCAL_NETWORK.md](LOCAL_NETWORK.md)。已有出牌/过牌协议保留但服务端拒绝执行，未进入联机牌局。

## 阶段4.3增量（2026-10-23，当前）

上文阶段4.1/4.2是历史边界。当前start创建真实牌局、playing状态与roundId，逐连接发送带本人手牌的sync；不再产生新的locked状态。public.version即stateVersion，play/pass使用此版本；room.version用于ready/start。ready/start的roundId首局前为null，结束后重新准备/开始必须匹配当前局ID，否则wrong-round。

新增wrong-round、cannot-pass、not-owned、game-finished、awaiting-rule、invalid-command错误码，仍使用运行时白名单校验。仅sync可携带已知局ID用于读取最新授权快照；不能据旧快照恢复权威状态。未结束的游戏不能重新ready/start；结算后所有ready清除，上局赢家作为下一局dealerIndex。每条连接的请求ID与完整载荷用于回执去重，同ID不同上下文/载荷拒绝；1024个不同请求上限替代阶段4.2的256。

RemoteSession可以接受游戏版本相同但房间版本更新、且本人游戏视图完全相同的准备/连接快照。旧响应/广播不能使牌局倒退；版本冲突后同步但不重放旧动作。LobbyClient在新roundId替换会话。内存账本按roundId唯一记录结算，未提供数据库持久化或重启恢复。参见MULTIPLAYER.md。
## 阶段4.4扩展（2026-10-23）

业务协议新增leave（沿用requestId/roomId/roundId/expectedVersion，对比room.version），返回left及retained标记。waiting退出释放席位；其他阶段保留席位与本人牌局。新增notice/turn-timeout，携带roomId、roundId、gameVersion、playerId，无手牌；客户端只显示与当前局/当前回合匹配的提示，不自动产生动作。

连接层另有私有控制帧，和业务ServerMessage/ClientMessage分开校验：服务端在welcome后发送session {protocolVersion:1,selfPlayerId,resumeToken,resumed:false,snapshot:null}；恢复连接先接收临时welcome，再发送resume {protocolVersion:1,resumeToken}。服务端验证64位十六进制随机凭证、撤销旧连接，然后只向该连接发送session {resumed:true,snapshot:本人最新Sync或null}。恢复帧中snapshot同样经过业务运行时白名单和身份匹配校验。未持有凭证不能通过公开playerId认领席位。

控制帧不属于修改游戏的命令，因此不带requestId等业务元数据；重试resume仅重绑连接、重新同步，不发牌、不结算。凭证不得出现在PublicRoomView、公共日志、URL/分享参数或其他玩家响应中。过期凭证关闭码4001，身份被新连接替换为4000，客户端停止自动重试。显式断开停止重试；同一NetworkClient保留内存凭证以便手动恢复。

业务回执跟随逻辑身份保留，跨连接相同ID/载荷仍返回原结果；同ID不同载荷拒绝。客户端在重连期间禁止业务请求，恢复权威快照后才可操作。未收到play/pass回执时只恢复状态，不自动生成新ID重打。断线取消准备；恢复后房间版本增加，gameVersion不因连接变化增加。全部细节和测试结果见RELIABILITY。
