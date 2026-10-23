# Gandengyan（干瞪眼）

当前阶段4.3已接入本地多人实时对局、私有发牌、统一结算与同房续局；运行步骤见 [多人对局指南](docs/MULTIPLAYER.md)。下文阶段3/4.1/4.2说明保留历史阶段边界。

Cocos Creator **3.8.5** 微信多人棋牌游戏工程。当前已提供独立规则引擎、本地真人 + AI 会话和简洁横屏 UI 脚本。仅使用不可兑现娱乐积分。

已实现洗牌发牌、牌型/癞子解释、接牌、轮转过牌、补牌、胜负和积分结算，原规则逻辑保持不变。现有 `assets/scene.scene` 已挂载 LocalGameApp，用户已确认在 Creator 中成功运行；打开该场景即可预览，**不需重复建场景或绑定按钮/手牌节点**，详见 [本地启动与整局验收](docs/LOCAL_PLAY.md)。不接入微信或 CloudBase。仅剩王且需自由领出时按未决规则暂停，不会擅自判胜。

## 环境与安装

- Cocos Creator 3.8.5：通过 Dashboard 导入本目录，保留现有项目 UUID 和 `.meta`。
- 建议 Node.js 22.12+ 或 24 LTS、npm；本次验证环境为 Node 24.13.0 / npm 11.6.2。
- 根开发依赖固定 TypeScript 5.9.3、Vitest 4.1.12；无运行时依赖。引擎脚本兼容性仍需在客户端接入阶段验证。

```powershell
npm ci
npm run client:sync
npm run check
```

`npm ci` 使用已提交的 `package-lock.json`。受限机器若 npm 默认缓存无写权限，可用：

```powershell
npm ci --cache "$env:TEMP/gandengyan-npm-cache"
```

## 运行与测试

```powershell
npm test             # 一次性执行 Vitest
npm run test:watch   # 监听规则测试
npm run typecheck    # 严格检查规则源码
npm run check        # 规则/local 类型检查 + 测试 + 镜像一致性
npm run client:sync  # 同步源码到 Creator 资源目录，不碰 .meta
npm run typecheck:client # 编辑器导入后，基于真实 cc 声明检查 UI
npm run check:all    # 统一运行 check 和客户端类型检查（需 Creator 导入）
```

`npm run check` 使用 `tsconfig.rules.json`、`tsconfig.local.json`，不需要 Creator 的 temp 或云账号；测试由 Vitest 转译执行。`typecheck:client` 另使用编辑器生成的 cc 声明，严格检查项目脚本并跳过引擎 .d.ts 内部错误。根 tsconfig 保持原配置。提交前在已导入工程的机器上执行 `npm run check:all`；全新检出先用 Creator 3.8.5 打开工程生成 temp 声明，再执行统一检查。

额外执行 `npm exec -- tsc --project tsconfig.json --pretty false` 时，本机 Creator 引擎声明仍报告 WebGPU 类型和内部模块缺失，详见架构文档。这不是规则模块的检查入口；Cocos 预览和目标构建仍需编辑器验证。

编辑器：用 Creator 3.8.5 打开本目录，等待导入，打开已有 `assets/scene.scene` 后浏览器预览；场景已包含 Canvas/UI Camera 和 LocalGameApp。默认主界面可选 2～8 人、1/2 副牌和 5～50 分损失封顶。不要用 npm start 启动 Cocos；新 .meta 交给编辑器生成，保留已有资源引用。

## 目录

```text
Gandengyan/
├─ .creator/                 # 原工程配置
├─ assets/scene.scene        # 已有本地牌桌入口场景及其 .meta
├─ assets/scripts/
│  ├─ presentation/          # 启动组件、UI 工具和复用手牌节点
│  └─ generated/             # 从 packages 生成，禁止手改
│     ├─ rules/
│     └─ local/
├─ settings/                 # 原工程配置
├─ docs/
│  ├─ PRD.md
│  ├─ RULES.md
│  ├─ ARCHITECTURE.md
│  ├─ RULE_COVERAGE.md
│  └─ LOCAL_PLAY.md          # 一次绑定、整局和横屏验收
├─ packages/rules/src/
│  ├─ card.ts                # cardId/deckIndex/suit/rank，含王
│  ├─ config.ts              # 已确定边界和带版本冻结配置
│  ├─ deck.ts                # Fisher–Yates 与发牌
│  ├─ hand.ts                # 癞子解释、牌型、接牌
│  ├─ game.ts                # 状态机、非法命令拒绝、守恒检查
│  ├─ score.ts               # 全局计倍、输家封顶、零和结算
│  ├─ view.ts                # 公开/本人白名单投影
│  └─ index.ts               # 公共入口
├─ packages/local/src/       # AI 候选规划、本地会话与投影
├─ tools/sync-client.mjs     # 可复现同步，只写受控生成目录
├─ tests/rules/
│  ├─ card.test.ts
│  ├─ config.test.ts
│  ├─ deck.test.ts
│  ├─ hand.test.ts
│  ├─ game.test.ts
│  ├─ score.test.ts
│  ├─ local-session.test.ts
│  └─ helpers.ts             # 测试夹具与可复现随机源
├─ AGENTS.md
├─ README.md
├─ package.json
├─ package-lock.json
├─ tsconfig.json             # 保留 Creator 配置，追加测试工具排除项
├─ tsconfig.rules.json
├─ tsconfig.local.json
├─ tsconfig.client.json
└─ vitest.config.mts
```

`node_modules/`、`library/`、`temp/`、`profiles/`、`build/` 为依赖或生成目录，不提交。assets/scripts/generated 是供 Creator 导入的受控镜像，随工程保存，由校验保证与单一源码一致；其 .meta 由 Creator 维护。本地会话保存完整状态，UI 仅接收本人及公开投影；未来联机改由服务端唯一裁决。

## 纯规则调用示例

```ts
import { createGame, createRules, applyCommand, createPlayerView } from './packages/rules/src';

// 固定随机值仅演示注入接口；在线服务必须提供受信安全随机源。
const state = createGame({
  playerIds: ['alice', 'bob'],
  dealerIndex: 0,
  rules: createRules({ deckCount: 2, roundPointCap: 20 }),
}, () => 0.5);

const first = state.players[0]?.hand.find((card) => card.kind === 'standard');
if (first) {
  const result = applyCommand(state, {
    type: 'play', playerId: 'alice', expectedVersion: state.version,
    cardIds: [first.cardId],
  });
  if (result.ok) {
    const aliceView = createPlayerView(result.state, 'alice');
    // 仅在认证/授权为 alice 后提供该投影；不要传输 result.state。
  }
}
```

自由领出时不可过牌；过牌命令为 `{type: 'pass', playerId, expectedVersion}`。王不能单出。包含王的牌组若有多种解释，可附加 `declaration: {kind: 'bomb', primaryRank: '3'}` 显式指定。非法动作返回 `ok: false`、错误码和原状态引用。成功状态深冻结，每次动作版本 +1；不能从外部修改手牌或倍率。

积分按每个输家 `min(剩余手牌数 × 2^B, cap)` 扣分，赢家收取全部损失，收入允许超过 cap；如剩余 3/7 张、B=2、cap=20，则结果为 +32/−12/−20。

## 文档与后续步骤

- [产品需求](docs/PRD.md)：范围、流程、分期和验收。
- [规则清单](docs/RULES.md)：已定规则和 R01～R18 待决问题。
- [模块架构](docs/ARCHITECTURE.md)：现有工程检查、模块边界与 CloudBase 规划。
- [开发规范](AGENTS.md)：编码、测试、安全与阶段要求。
- [规则覆盖](docs/RULE_COVERAGE.md)：测试对应的行为和未定分支。
- [本地启动](docs/LOCAL_PLAY.md)：Canvas 绑定、AI 节奏、固定种子整局验收和手机尺寸检查。

当前规则版本为 gdy-default-v1。单机 UI 复用这个版本。Test Seed=2026 可复现整局，0 为随机；固定种子的每次重开牌序相同。仅剩王领出的暂停分支依然保留，需要人工定稿后才能承诺所有可能的牌局均有正常终局。

本期无需配置微信或部署云资源。微信阶段需手动准备 AppID 和开发权限，CloudBase 阶段需准备受控环境、认证与权限规则；SDK 和实时通道待验证后选择。私人手牌不得进入公共数据，联机状态由服务端唯一裁决。

## 阶段4.1：会话与协议

新增 `packages/protocol/`、`packages/session/`、`packages/remote/`，保留原本地真人+AI入口和规则。GameSession支持即时或Promise结果，UI已支持异步等待与旧会话回调隔离。远程适配器仅注入传输，无WebSocket连接或服务端；建房/入房/准备/开局目前只定义协议。详见 [协议与阶段验收](docs/PROTOCOL.md)。

运行 `npm run client:sync` 同步全部五个客户端安全包，再执行 `npm run check:all`。新增目录与脚本的 `.meta` 由 Creator 导入时生成；不修改既有元文件或场景。当前352项测试通过，其中原有322项保持不变；本轮未执行Creator预览或微信真机验收。

## 阶段4.2：本地联机房间

当前已增加本地WebSocket房间大厅，原有单机模式继续保留。在PowerShell设置 `$env:PORT = '8787'` 后执行 `npm run server:dev`，Creator打开现有assets/scene.scene并浏览器预览，主界面进入“本地联机模式”，连接 `ws://127.0.0.1:8787/rooms`。两个窗口分别建房/入房、准备，并实时查看成员状态。完整Windows操作、8人验收与限制见 [本地联机运行指南](docs/LOCAL_NETWORK.md)。

运行 `npm run check:all` 和 `npm run check:network` 验证离线与真实回环网络测试。新增固定运行时依赖ws仅供服务端使用；服务端构建产物忽略，不进入Cocos镜像。此阶段“开始”只锁定大厅，不发牌、不进行联机出牌或结算；没有CloudBase或账号登录。上文阶段4.1“无服务端”属于历史状态。

## 阶段4.3：真实多人对局

启动 `npm run server:dev`，同步客户端后用Creator预览已有assets/scene.scene；2～8个独立窗口连接、建房/加入、准备后由房主开始，服务器统一洗牌发牌，自动进入原牌桌。结束后各自回房准备，由房主开下一局，上一局赢家任庄。原单机真人+AI保持可用。规则源码、场景和既有.meta未改；未决剩王局仍暂停。

`npm run check:all`：396项离线测试及全部类型/镜像检查通过；`npm run check:network`：8项真实WebSocket测试通过，包含2/6/8人单双副牌整局与续局，六人双副额外完成第二整局。阶段4.3人工Cocos/微信/跨设备验收、断线恢复与持久化未完成。完整Windows步骤、安全边界和限制见 [MULTIPLAYER.md](docs/MULTIPLAYER.md)。
## 阶段4.4：恢复与可靠性

已增加同客户端原房间/本人手牌恢复、WebSocket有限自动重连、大厅退出与房主接任、超时只提示及跨连接幂等。424项离线测试（保留原322项，含验收时补充的牌桌/大厅导航回归）和16项真实WebSocket测试通过，类型检查、镜像与服务端构建通过；Creator人工/微信真机仍需验收。恢复凭证仅内存，刷新或服务重启不恢复；全员离线后保留30分钟。

当前Windows启动、退出/断线验收、BUG清单与风险见 [RELIABILITY.md](docs/RELIABILITY.md)。后续云函数、数据库权限、事务与本人监听方案见 [CLOUDBASE_MIGRATION.md](docs/CLOUDBASE_MIGRATION.md)，仅设计，未连接或部署腾讯云。前文各阶段测试数量与限制为历史记录。
