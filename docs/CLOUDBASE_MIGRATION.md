# CloudBase迁移设计（阶段4.4，仅方案）

日期：2026-10-23。没有创建环境、安装云SDK、开通服务、连接数据库或部署。下面的接口、集合和执行器均是待授权实现的设计；本地WebSocket继续保留。

## 1. 现有业务边界与迁移接口

| 当前入口/模块 | 业务职责 | 云端准备与拟议接口 |
| --- | --- | --- |
| RoomService.connect/resume/disconnect | 临时身份、凭证恢复、连接替换、离线状态 | IdentityProvider：逐请求取得可信身份；PresenceService：连接租约与恢复授权 |
| RoomService.receive/apply | 校验、成员/席位、建房入房、准备、开局、动作、离开 | RoomApplication.handle(authenticatedContext, unknown)：返回命令结果和待发布事件 |
| createGame/applyCommand/settleRound | 发牌、唯一规则、状态推进、结算 | 原packages/rules直接复用；不依赖云SDK，不增加第二套规则 |
| RoomService.snapshot/projectGameSync | 成员授权、公开及本人投影 | ProjectionService.snapshot(actor, roomId)：只返回白名单Sync |
| rooms/peers/receipts/settlements内存Map | 单进程权威状态、幂等与结算账本 | RoomRepository.transact(roomId, expectedVersion, operation)；ReceiptStore；SettlementStore |
| tick + now/random注入 | 离线回收、操作超时提示、可信随机 | Clock/RandomSource/DeadlineWorker；规则函数中仍不读时间、不生成随机 |
| ws-server.ts | Origin、大小/速率限额、心跳、收发 | 本地WsGateway保留；云端FunctionGateway与SnapshotSubscription各自实现 |
| NetworkClient/LobbyClient/RemoteSession | 生命周期、请求关联、房间/牌局消费 | CloudBaseNetworkClient实现相同NetworkClient；GameSession/Cocos牌桌继续复用 |

当前RoomService已与ws包分离，但仍把内存存储、身份及业务写入集中在一个类，并使用Node crypto。迁移时先抽取上述应用/仓储/身份接口，再实现云适配；不能把当前类的全局Map直接搬进云函数充当数据库。CloudBase身份解析、随机及时间只在可信应用边界注入。Node依赖继续排除在客户端镜像之外。

## 2. 云函数职责

建议先用一个受控command入口分派建房、入房、准备、开始/下一局、play/pass、leave，避免多条路径实现重复权限逻辑。另设sync入口恢复快照，presence入口更新在线租约，deadline/sweep任务处理提示与过期，outbox发布任务补发通知。也可按容量拆分函数，但共享同一RoomApplication与规则版本。

身份适配器从**本次调用的可信平台context**提取身份，并映射到内部playerId；不接受客户端playerId/openid，也不读取可能残留的进程环境来认人。微信与Web来源必须分别验证。官方文档提示云函数实例复用可能保留动态身份信息，因此应按调用context解析，而非依赖进程状态。[云函数调用与身份说明](https://docs.cloudbase.net/api-reference/webv3-next/functions)

洗牌、发牌、出牌校验、回合/补牌、倍率、结算、席位与房主权限均在云函数内完成。客户端只能发送现有意图协议。当前访客resumeToken仅用于本地实验，不作为云账号或长期登录凭证。普通短生命周期云函数不承担本地服务器的长连接循环；实时分发另走经过验证的监听适配器。

## 3. 数据模型与访问规划

默认采用文档型数据库候选方案；尚未选择套餐、区域或SDK版本。优先每房一份权威聚合，包含成员、配置、局号、gameVersion、roomVersion和当前完整牌局，减少跨文档竞争；历史结算与命令回执独立存储。

| 集合（拟议） | 主要字段/键 | 客户端读取 | 客户端写入 |
| --- | --- | --- | --- |
| authoritativeRooms | roomId；全部成员、完整GameState、版本、规则版本、截止时间 | 全拒绝 | 全拒绝 |
| memberships | roomId + internalPlayerId；主体映射、席位、有效状态 | 默认全拒绝；应用函数检查 | 全拒绝 |
| commandReceipts | 稳定主体 + requestId；规范化载荷哈希、room/round、结果版本/结果引用 | 全拒绝 | 全拒绝 |
| settlements | roomId + roundId确定性唯一键；赢家、整数增减、规则版本、创建时间 | 全拒绝；通过授权投影展示 | 全拒绝 |
| outbox | 房间 + 提交版本 + 事件ID；发布/重试状态 | 全拒绝 | 全拒绝 |
| playerViews | roomId + ownerId；**该用户的完整Sync投影**、owner、成员授权版本 | 仅当前有效成员本人 | 全拒绝 |
| roomViews（可选） | 仅公开成员/余牌数/公开落牌，绝不含私人手牌 | 有效房间成员；不是公开互联网读 | 全拒绝 |

playerViews把公开与本人视图放在同一文档/同一提交版本，避免客户端把不同版本的公共与私人数据拼成一局。主方案可只监听本人playerViews，不必开放roomViews给客户端。可读快照中不放真实openid、凭证、其他玩家手牌、隐藏牌序或内部审计细节；owner身份字段用于权限检查，界面仍使用内部playerId。

所有集合默认拒绝；服务端私有集合禁止客户端读写，不能只选“仅创建者可读写”。客户端可读集合只放投影，create/update/delete同样拒绝。未来实施时用精确owner过滤和有效成员检查，验证列表查询、直接doc读取、watch、退出后旧监听、跨房间访问均不可绕过。服务端凭证具有更高权限，云函数必须自行验证成员，不依赖数据库客户端规则替代业务鉴权。

官方文档说明安全规则按文档控制，客户端查询条件需符合权限规则；微信与Web的身份字段不同，必须选定身份适配后验证，本文不提供可直接上线的通用规则。[数据库安全规则](https://docs.cloudbase.net/database/security-rules)

## 4. 状态一致性、幂等和结算

每次命令使用以下事务流程：

1. 校验unknown输入和大小/频率，读取本次可信身份；对requestId做全主体范围去重，拒绝同ID不同规范化载荷。请求保留roomId、roundId、expectedVersion。
2. 在事务里读取权威房间、成员授权、命令回执，核验席位、阶段、roundId。play/pass比较gameVersion；ready/start/leave比较roomVersion。
3. 调用原规则引擎得到候选新状态；非法动作不写牌局。开始命令需对同一次尝试固定可信随机输入，使事务重试不会在已提交后重新发牌。随机值、完整牌序及其他玩家的手牌不进入回执/日志的公开部分。
4. 原子写入权威状态、命令回执与outbox；首次结束才插入唯一settlement键，事务中更新娱乐积分账本（若后续授权累计积分）。发现已存在结算时核对一致性并返回已有结果，禁止再次加分。
5. 提交后逐成员生成/更新本人投影，发布器按版本幂等写入；通知失败由outbox重试。禁止在事务提交前发送成功或产生不可回滚的外部副作用。
6. 事务冲突时有限重试，若业务版本已变化返回stale-version及授权同步指引。未收到响应的客户端用相同requestId查询/重试或只同步；绝不改ID盲目重打。

可以把最多8份playerViews放入同事务提交，也可以通过outbox最终发布；选型前测量事务文档数、大小、耗时及重试限制。即使用outbox，单个playerView也必须是同一次权威提交的完整投影，禁止旧发布任务覆盖新版本。官方支持服务端数据库事务；实际隔离级别、冲突检测、唯一键与容量上限需要在目标环境做POC，不能仅靠进程锁保证跨实例一致性。[数据库事务](https://docs.cloudbase.net/database/transaction)

回执保留期须覆盖客户端最大重试窗口；删除完整回执后仍保留拒绝旧requestId的轻量墓碑/序列约束，不能为了节省空间允许旧动作重做。下一局roundId变化不清空尚可能重试的上局结算去重记录。规则版本随局冻结，服务发布不得热改进行中的玩法。

## 5. 实时监听与恢复

候选主通道为本人playerViews的文档监听；网络适配器将监听结果转换为现有ServerMessage.sync，通过同一运行时校验，再交给LobbyClient。官方文档型数据库提供watch/onChange/onError与关闭监听；这不等于已经验证微信小游戏、Cocos、具体SDK版本与后台恢复兼容。[实时推送](https://docs.cloudbase.net/database/realtime)

订阅与初始sync采用“建立监听→取得授权快照→按(roomId, roundId, roomVersion, gameVersion)合并”的恢复屏障，处理订阅期间的竞争。重复/旧通知忽略；发现缺口、监听错误、切前台或重新登录时拉取完整本人快照，不靠客户端缓存补牌。监听回调不是有且仅有一次的业务命令来源，不能触发结算或自动出牌。

用户退出时撤销成员资格、删除/封闭相应投影、关闭订阅；旧订阅在权限撤销后的行为必须实测。进行中的保留席位按阶段4.4策略处理，不因瞬时心跳丢失扣分。presence租约与超时任务使用服务端时间及轮次/版本条件，迟到任务只能提示当前匹配回合，不能影响下一局。

## 6. 分步迁移与验收（尚未执行）

1. **离线抽取**：实现应用/仓储/身份接口，本地内存适配保持现有424项离线、16项网络测试通过，并补充新适配器测试。
2. **SDK与环境POC**：另行授权后确定区域、文档数据库类型、Node/微信SDK及认证来源，验证事务冲突和watch权限；先列成本、配额与回滚条件，不默认采购。
3. **持久化命令**：两个函数实例并发抢同版本只有一个成功；提交后模拟响应丢失，再试不重打牌、不重结算。创建/加入并发不能超8席。
4. **私有投影与实时**：2～8用户隔离；另一人的docID、roomId、owner过滤及旧监听均拿不到私牌；故意乱序/断流后恢复最新局。任何权限不确定时保持客户端禁止直读，退回授权sync拉取。
5. **Cocos/微信适配**：新增CloudBaseNetworkClient，不替换本地WsGateway；严格镜像无Node依赖。真机验证冷启动、前后台、断网、恢复、两整局与单机回归。
6. **上线评审**：持久化恢复、日志脱敏、监控/告警、保留/删除周期、配额费用、微信资格与安全验收通过后，才讨论部署与发布。

需要产品另定：剩王终局办法、长期无人恢复的局如何归档、解散/踢人权限、累计积分历史与保留周期。本期不擅自实现托管、判负、云连接或现金功能。
