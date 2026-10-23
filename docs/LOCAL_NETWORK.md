# 阶段4.2：Windows本地联机房间验收（历史）

阶段4.2用户已确认测试通过。当前阶段4.3开始会真实发牌与进入对局，本页“仅锁定/不发牌”等内容仅保留历史记录；请使用 [MULTIPLAYER.md](MULTIPLAYER.md) 执行当前完整对局与续局验收。

日期：2026-10-23。沿用现有 Cocos Creator 3.8.5 工程，未新建工程。保留单机真人+AI；联机仅实现房间大厅，不发牌、不出牌、不结算。

## 已实现与依赖

- server/src/room-service.ts：服务端权威房间、六位唯一房间号、2～8席分配、准备/取消、满员/房主开始校验、成员广播和请求去重。
- server/src/ws-server.ts、main.ts：本地WebSocket入口、可配置PORT/HOST、文本/大小/速率/连接数限制和心跳清理。
- packages/remote/src/network-client.ts：NetworkClient抽象及平台无关的连接、握手、消息校验、请求关联与超时管理。
- packages/remote/src/lobby-client.ts：房间操作与只读快照消费；版本冲突后同步最新状态，操作需要玩家重试。
- assets/scripts/platform/browser-network-client.ts：浏览器原生WebSocket适配；替换平台/CloudBase时实现NetworkClient即可，本轮无云SDK。
- assets/scripts/presentation/network-lobby.ts：运行时创建服务器地址、建房配置、房间号输入、成员席位、准备和错误提示；由已有LocalGameApp增加入口，无场景/Prefab改动。
- packages/protocol：在v1上增加welcome（服务端分配selfPlayerId）和locked（大厅锁定，roundId=null，self=null）及房间错误码，全部经过运行时白名单校验。
- 新增固定运行时依赖ws 8.22.0，仅服务端使用；开发类型依赖@types/ws 8.18.2、@types/node 24.13.0，lockfile已更新。浏览器不用ws包，镜像不包含server或Node依赖。用法参见[ws官方文档](https://github.com/websockets/ws)。

## 第一步：启动服务端

打开PowerShell窗口，执行：

```powershell
Set-Location 'E:\Dev\Cocos\Gandengyan'
npm ci --cache "$env:TEMP/gandengyan-npm-cache"
$env:PORT = '8787'
$env:HOST = '127.0.0.1'
npm run server:dev
```

保持此窗口运行，看到：

```text
Room server: ws://127.0.0.1:8787/rooms (stage4.2 lobby only)
```

server:dev先编译TypeScript到忽略的build/server，再启动。后续只启动已编译版本可用npm run server:start；修改服务端后需重新编译。更换端口时更改PORT并同步更改客户端地址。端口占用会明确报错，不会自动占用另一个端口。

默认仅监听本机；本轮指南只验收同一Windows机器上的浏览器窗口。Origin允许本机HTTP/HTTPS页面，未放开任意网站。无需配置微信AppID、腾讯云或云数据库。Ctrl+C用于停止服务；如Windows npm批处理询问终止，则输入Y。

## 第二步：启动现有Cocos客户端

另开PowerShell窗口执行：

```powershell
Set-Location 'E:\Dev\Cocos\Gandengyan'
npm run client:sync
```

1. 用Creator Dashboard打开**现有**E:\Dev\Cocos\Gandengyan，版本3.8.5。
2. 等待新增脚本导入；新增.meta由Creator生成，保留全部已有.meta和UUID。
3. 打开assets/scene.scene，不新建场景。现有Canvas应继续挂载LocalGameApp。
4. 点击Creator的浏览器预览，作为窗口A。使用Creator实际生成的HTTP预览地址；不要打开文件路径，也不要使用旧的build/wechatgame输出。
5. 复制窗口A的**完整预览URL**，在另一个浏览器窗口打开，作为窗口B。两个窗口加载的是同一工程，但分别建立不同的WebSocket连接和服务端玩家身份。无需无痕窗口或不同账号。

## 第三步：两个窗口验证

1. A、B都点击主界面的“本地联机模式”。
2. 两边服务器地址填ws://127.0.0.1:8787/rooms，点击“连接服务器”。等待显示“已连接 · 身份由服务器分配”。
3. A保持人数2，按需选择1/2副、损失封顶5～50、最小炸弹张数3～8，再点“创建联机房间”。配置创建后冻结，本轮不支持房间内改规则。
4. A应显示六位房间号、1号位玩家1（你）房主、未准备，以及完整配置摘要。
5. B输入A的六位房间号，点击“加入房间”。A、B应同时显示两名成员，各自标注“你”，席位无重复，配置相同。
6. A点“准备”，两边应显示A已准备；再点“取消准备”，两边应显示A未准备。B同样验证。
7. 双方都准备后，A点“房主开始”。两边应显示大厅锁定、开始校验通过，准备/开始按钮禁用。**没有发牌或联机牌桌，这是本阶段完成边界。**
8. 若几乎同时准备遇到“房间已更新”，客户端会同步最新快照；重新点击原操作即可，不能覆盖别人的状态。

## 第四步：人数与权限验证

- 满员：A新建2人房，B加入后，窗口C连接并尝试加入，看到“房间已满”。
- 未满开始：新建2人房，只有A时点“房主开始”，看到“尚未满员”。
- 未准备开始：B加入后任一人未准备，房主开始得到“仍有玩家未准备或已离线”。
- 非房主：B的开始按钮禁用；服务端也会拒绝伪造的start请求，并非仅靠按钮限制。
- 8人：所有旧窗口点“断开连接”，A重新连接并新建8人房；再打开7个同一预览URL的窗口，分别连接、加入。第9个客户端加入失败；自动化已验证8人广播与开局锁定。
- 断线：关闭B或点断开连接，A应实时看到B离线且未准备；不能开始。仅剩离线席位不会被新身份顶替。
- 单机回归：点顶部“主界面”，点击“单机：真人＋AI”，验证配置、提示、出牌、AI推进、结算和重开；单机不需要服务器。

## 当前房间策略与限制

- 身份是本地调试用的服务端临时访客ID，绑定单条连接；客户端消息不包含可指定的playerId。此机制隔离玩家操作，不等于微信真实账号登录，也不用于公网生产环境。
- 一条连接最多加入一个房间。知道房号可以申请加入空席；无成员资格不能读取快照、准备或开始。
- 房主创建时冻结规则。允许配置已有规则支持的炸弹张数子集（界面选择最小张数至8张）；计倍方式仍是已确认的全局每次×2，不提供未经确认的其他倍率或禁用计倍选项。
- 全员准备（含房主）、满员、全部在线才允许房主锁定。locked无roundId和私人视图，不创建GameState；play/pass始终拒绝。
- 离线成员保留原席，准备清除；不转让房主、不托管、不判负、不恢复身份。有人断开后需要全员断开并重新建房才能重新凑齐。所有成员离线后删除房间；服务重启丢失全部内存房间。
- 单连接最多256个不同请求ID，重复请求返回第一次结果，同ID不同载荷拒绝；达到上限后需断开重连。最大100房、128连接，单连接10秒最多60条消息，消息最大65536字节。限制用于本地测试，不承诺生产性能。
- 没有持久化、自动重连、账号凭证、微信群分享、云部署、数据库、真实联机出牌、结算或支付。

## 自动化与实际验证

```powershell
npm run check:all
npm run check:network
npm run server:build
```

- check:all：375项离线测试通过，含原有322项、阶段4.1测试、房间和网络生命周期测试；规则/共享包/服务端/客户端严格类型检查及镜像一致性通过。
- check:network：2项真实回环WebSocket测试通过，覆盖9连接/8席、广播、权限、锁定、并发抢座、版本冲突和断开。
- 命令行入口另在PORT=18787成功启动，通过两个实际WebSocket连接完成建房、入房、准备、锁定，再停止测试服务。
- 本轮没有可用的已打开Creator预览，未声称完成Cocos渲染、双浏览器人工操作或微信真机验收；按本文步骤执行这些检查。
