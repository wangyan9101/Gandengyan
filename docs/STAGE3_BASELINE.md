# 阶段3基线与阶段4.0交付

日期：2026-10-23。

## 已实现

- 保留 Cocos Creator 3.8.5 工程身份、UUID、assets/scene.scene 和现有 .meta。
- 规则引擎支持 54/108 张实体牌、2～8 人、洗牌发牌、牌型与癞子解释、接牌、过牌补牌、炸弹计倍、胜负及零和结算。
- 本地会话为一名真人与其余 AI；界面提供配置、选牌、提示、出牌、过牌、结算和重新开局。
- 场景已挂载 LocalGameApp，用户确认在 Creator 中运行成功。本轮没有重新执行编辑器、微信构建或真机验收。
- 仅剩王自由领出仍按既有规则暂停、不结算；本轮不改变任何规则。

## 阶段4.0整理

- .gitignore 中 local/ 收窄为 /local/，保留根目录本地缓存忽略，同时允许跟踪 packages/local/ 与 assets/scripts/generated/local/ 及其已有元文件。
- 缓存、构建、依赖仍被忽略，补充环境凭证、私钥和微信开发者个人配置忽略规则。不统一忽略 .meta。
- 提交前检查全部候选文件、凭证模式及配置。未发现密钥、Token 或个人凭证；微信 AppID 为公开应用标识，保留现有构建模板。
- 新增 npm run check:all，顺序执行 npm run check 与 npm run typecheck:client。check 继续支持无需 Creator 的规则验证。
- 新机器先 npm ci，再用 Creator 3.8.5 打开现有工程生成 temp 类型声明，随后执行 check:all；不提交 temp。
- 本机统一检查通过：8 个测试文件、322 项测试，规则/local/client 类型检查及生成源码一致性检查通过。未添加或修改业务测试。
- 基线提交信息：chore: establish stage3 baseline。后续开发使用 feature/multiplayer；本轮不配置远程仓库、不推送。

## 后续目录约定（规划，尚未实现）

| 目录 | 职责 |
| --- | --- |
| assets/ | 现有 Cocos 界面、场景、脚本与元文件 |
| packages/rules/ | 现有纯规则，后续客户端与服务端共用 |
| packages/local/ | 现有单机与 AI 会话，继续保留 |
| packages/protocol/ | 后续通信协议 |
| packages/session/ | 后续本地/远程通用会话接口 |
| packages/remote/ | 后续联机客户端适配器 |
| server/ | 后续 Node.js + TypeScript + WebSocket 服务端 |
| tests/ | 现有规则及本地测试；后续扩展网络和服务端测试 |
| docs/ | 开发文档及后续接口文档 |
| package.json | 统一脚本和固定依赖 |

阶段4.1可在本基线上开始通用会话与协议工作，需另行授权。未决规则、断线/退出/换庄策略应在实现对应行为前记录决定，不影响本轮基线整理。
