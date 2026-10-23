# Gandengyan（干瞪眼）

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
