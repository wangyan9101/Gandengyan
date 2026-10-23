# 架构与工程检查

状态更新：2026-10-23。下述标记为“规划”的模块尚未创建或集成。

## 1. 工程检查结果

- 根 `package.json` 标识 Gandengyan，Creator 版本 **3.8.5**，UUID `3741e139-bc64-4ca5-8464-bde93f802feb`。
- 存在 `assets/`、`.creator/default-meta.json`、`settings/v2/packages/`；现有 `assets/scene.scene` 包含 Canvas、Camera 和 LocalGameApp 入口，脚本及必要 `.meta` 已存在；UI 运行时创建，未发现 Prefab 或牌面图片资源。
- 存在本地生成的 `library/`、`profiles/`、`temp/`；根 `tsconfig.json` 继承 `temp/tsconfig.cocos.json`，当前根配置 `strict: false`。
- 初始化前 Git 中上述工程文件均未跟踪；不重建工程、不替换 UUID、不修改设置或 `.meta`。根 tsconfig 保留原继承和编译选项，仅追加测试工具与生成目录排除项，避免 Vitest 进入 Creator 的模块解析范围。
- 原 `.gitignore` 已忽略 `library/`、`temp/`、`profiles/`、`build/` 和 `node_modules/`。测试配置独立，不依赖生成的 temp 文件。

## 2. 模块边界

| 层 | 目录 | 职责及限制 | 状态 |
| --- | --- | --- | --- |
| Cocos 表现 | `assets/scripts/presentation/` | LocalGameApp、UI 工具、复用手牌节点；不持有全量状态 | 已实现；场景已挂载，用户确认 Creator 运行成功 |
| 本地应用 | `packages/local/src/` | AI 候选规划、LocalSession、命令提交与本人/公开投影 | 已实现并测试 |
| 平台适配 | `assets/scripts/platform/` | 微信登录/分享、网络、生命周期；实现接口 | 规划 |
| 规则引擎 | `packages/rules/src/` | 牌数据、冻结配置、洗牌发牌、牌型/癞子、接牌、确定性状态转换、结算与投影 | 已实现本阶段 |
| 公共协议 | `packages/protocol/` | 命令与公开/本人私有 DTO、协议版本；不导出全量状态 | 规划 |
| 通用会话 | `packages/session/` | 本地/远程会话接口 | 规划 |
| 远程客户端 | `packages/remote/` | 联机客户端适配器 | 规划 |
| 权威服务 | `server/` | Node.js + TypeScript + WebSocket；认证、授权、完整状态、随机、幂等、结算与投影 | 规划；后续预留 CloudBase 适配 |
| 测试 | `tests/rules/` | 无 Creator 环境的规则单元测试、动作序列守恒与投影验证 | 已实现本阶段 |

依赖方向：表现 → 应用 → 会话接口；本地适配器 → 规则引擎；远程适配器 → 协议/传输；权威服务 → 规则引擎、协议与持久化接口。规则引擎不反向依赖任何一层，也不导入 `cc`、`cc/env`、`db://`、`wx`、云 SDK、文件系统或网络。

规则包以 TS 源码和独立 tsconfig 存在，不建立 npm workspace 或发布流程。当前 `tools/sync-client.mjs` 把 rules/local 源码同步到 `assets/scripts/generated/{rules,local}/`，仅替换 local 对 rules 的相对导入路径。UI 只导入 assets 内模块，避免 Creator 外部源码解析差异；生成文件禁止手改，并纳入 check 的逐文件一致性校验。同步保留 .meta，不修改旧场景或元文件。微信构建仍留待后续阶段。

## 3. 单机与联机复用

当前 LocalSession 包含 play/pass/hint/stepAi/snapshot 和只读回合状态；内部保存完整状态，Cocos 只接收真人手牌与公开投影。AI 输入只有自身持牌、版本、规则和公开桌面；枚举候选后通过 resolvePlay 验证，执行时再由 applyCommand 裁决。候选排序优先出完、避免留下纯王、搭出王和多出牌，不引入新规则，也不是最优策略。换局新建会话；AI 节奏由组件 update 控制，无跨局延迟回调。

未来远程会话再接入网络命令、重连/订阅与认证，不在客户端决定最终状态。本地运行只能用于练习，不能证明在线安全。UI 将单机“返回主界面”作为放弃且不记分，不将该操作定义成联机退出规则。

当前引擎采用纯函数 `state + command -> CommandResult`，冻结规则随 state 保存；`createGame(options, random)` 单独注入随机源，`applyCommand` 内部不读取时间或随机。未来服务端必须注入安全随机源，不接受客户端提交的牌堆、倍率、胜者或分数。测试用 LCG 仅用于复现，不用于在线公平发牌。

入口与职责：

- `card.ts`：cardId/deckIndex/suit/rank 与实体身份校验。旧初始化字段 id 已迁移为 cardId；王也有 suit=joker。
- `deck.ts`：Fisher–Yates、五轮发牌与庄家额外一张；牌堆顶固定为数组下标 0。
- `config.ts`：初始化边界校验和 createRules；每局配置复制、深冻结、版本绑定。
- `hand.ts`：枚举所有可行解释，按目标牌型所需点数填补癞子，避免枚举每张王所有替代值的指数搜索；resolvePlay 根据声明和当前桌面选择解释。
- `game.ts`：createGame、applyCommand、assertStateIntegrity。成功动作返回新的深冻结状态，错误返回原状态引用。完整状态只能来自受信引擎/受信持久化，不是可直接接受的网络输入。
- `score.ts`：整局 B、2^B、输家倍率后损失封顶和赢家汇总。B 限 0～36，由最多 108 张实体牌、炸弹至少 3 张推得，避免数值溢出；并非新增玩法上限。
- `view.ts`：公开与本人视图。认证和房间授权须在未来服务端调用前完成；知道 playerId 并不构成授权。

引擎命令含 playerId、expectedVersion、动作及实体 cardIds，癞子可用 declaration 消歧。核心不信任客户端牌型结果，依据持牌重新识别；仅接受已知字段。版本不符拒绝，可防止同一命令重试再次改变状态；完整 requestId 幂等记录仍由后续服务层负责。

状态为 playing、finished 或 awaiting-rule。最后一个分支用于用户尚未决定的“仅剩王领出”，保留状态和版本，不产生结算，暂停后拒绝继续动作；本期不提供绕过此分支的管理员改牌接口。

## 4. 状态和隐私

| 数据 | 可见范围 | 示例 |
| --- | --- | --- |
| 房间公开投影 | 已授权房间成员（非互联网匿名读取） | 房间状态、席位、准备状态、规则摘要 |
| 对局公开投影 | 已授权参与者 | 出过的牌、余牌数、行动席位、全局倍率、版本 |
| 本人私有投影 | 当前席位本人 | 本人手牌及合法的私有提示 |
| 全量权威状态 | 仅服务端 | 所有手牌、剩余牌序、随机状态、内部去重和结算记录 |

绝不把包含全量手牌的文档写入客户端可读集合后再靠 UI 隐藏。对手手牌和未发牌顺序不能出现在公共 DTO、分享参数、错误、日志或观战数据中。TypeScript 类型不提供运行时保密；投影函数须从白名单字段创建新对象，并测试递归序列化结果。

## 5. CloudBase 方案（规划，未选择具体 SDK）

1. 微信适配器取得登录凭证，服务端验证并建立用户身份；用户 ID、席位和权限由服务端绑定，不能信任请求内的 userId。
2. 云函数/受控服务接收 `requestId`、`roomId`、`roundId`、`expectedVersion`、命令类型及参数；所有输入运行时校验并限制大小、频率。
3. 服务端验证成员、阶段、轮次、牌的归属与出牌合法性；一个房间的写入通过原子版本检查串行裁决，禁止读后无条件覆盖。
4. 在事务中提交新权威状态、版本、幂等结果及待发送投影事件；结算以 roundId 唯一约束防止重复记分。跨资源通知采用事务发件箱与重试，保证最终可补发。
5. 按成员身份发送公开投影与各自私有投影。云数据库监听或受控实时通道的选型需先做鉴权、顺序、延迟和后台恢复验证；本期不承诺某个 CloudBase API 已可直接满足要求。
6. 客户端丢弃旧版本；发现版本空洞、会话重建或重连时拉取授权快照。请求去重键应包含认证用户、房间、局与请求 ID，并拒绝同 ID 不同载荷。

建议集合：`roomViews`（成员可读）、`playerViews`（本人可读）、`authoritativeRounds`（仅服务端）、`commandReceipts`（仅服务端）、`settlements`（仅服务端）、`outbox`（仅服务端）。房间成员也不能客户端直写上述状态；所有游戏写入走权威命令。实际安全规则、索引、事务范围和保留周期需在选型后验证，拒绝“开发期全部放开”。

## 6. 微信与分享（规划）

分享仅携带可过期的房间邀请标识，不含手牌、身份令牌或云密钥；知道房号不等于获授权。加入时检查有效期、容量、阶段和身份；并发加入必须原子占位。登录、微信群分享、前后台恢复均由适配器封装；Cocos 和微信 API 不进入规则层。

## 7. 检查与限制

`tsconfig.rules.json` 对规则源码开启 strict、越界索引和精确可选属性检查，不继承 Cocos 配置；tsconfig.local 对会话/AI 使用相同标准。tsconfig.client 基于本机生成的真实 cc 声明，对项目 UI 严格检查，skipLibCheck 仅跳过引擎 .d.ts 内部错误。Vitest 使用 Node 环境，不证明 Creator/微信构建已成功。当前已有 UI 组件、Creator 创建的场景与元文件，用户确认 Creator 运行成功；本轮未重新执行端上预览或构建，微信触摸与手机尺寸验收仍按 LOCAL_PLAY 执行；没有云服务或联机性能验证。

额外执行根 `tsconfig.json` 检查发现本机 Creator 引擎声明缺少 WebGPU 类型及部分引擎内部模块声明；移除测试工具参与后仍存在。该检查不是规则检查的前提，不通过不等同于 Creator 构建失败；需在编辑器中另行验证，不修改安装目录或生成声明掩盖问题。

参考：[Vitest 官方文档](https://v4.vitest.dev/guide/)、[TypeScript 模块解析说明](https://www.typescriptlang.org/tsconfig/moduleResolution)。本期固定工具版本，安装结果由根 lockfile 锁定；云平台能力须在集成阶段依据官方文档验证。
