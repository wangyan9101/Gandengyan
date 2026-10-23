import { EditBox, Label, Node } from 'cc';
import { LobbyClient } from '../generated/remote/index';
import type { GameSession } from '../generated/session/index';
import { createRules } from '../generated/rules/index';
import { createBrowserNetworkClient } from '../platform/browser-network-client';
import { paint, PALETTE, text, uiNode, UiButton } from './ui-kit';

const ERRORS: Readonly<Record<string, string>> = {
  'connection-lost': '连接已断开，正在恢复身份与本人牌局，请等待同步。',
  'connection-failed': '连接失败：确认服务器已启动、地址和端口正确。',
  'request-failed': '请求失败或超时；请检查网络，必要时断开后重新连接。',
  'room-full': '房间已满。', 'room-not-found': '房间不存在，请核对房间号。',
  forbidden: '只有房主可以开始，且只能操作自己的房间。',
  'wrong-phase': '当前房间已锁定，或你已加入其他房间。',
  'not-full': '尚未满员。', 'not-ready': '仍有玩家未准备或已离线。',
  'stale-version': '房间已更新，已同步最新状态，请重试。',
  'limit-exceeded': '本次会话操作次数达到上限；重连不会清空服务端防重记录。',
};
export class NetworkLobby {
  public readonly node: Node;
  private readonly client = new LobbyClient(createBrowserNetworkClient());
  private readonly address: EditBox;
  private readonly roomInput: EditBox;
  private readonly connection: Label;
  private readonly details: Label;
  private readonly seats: Label;
  private readonly notice: Label;
  private readonly capacityLabel: Label;
  private readonly decksLabel: Label;
  private readonly capLabel: Label;
  private readonly bombsLabel: Label;
  private readonly connectButton: UiButton;
  private readonly createButton: UiButton;
  private readonly joinButton: UiButton;
  private readonly readyButton: UiButton;
  private readonly startButton: UiButton;
  private readonly tableButton: UiButton;
  private readonly configButtons: UiButton[] = [];
  private readonly unsubscribe: () => void;
  private capacity = 2;
  private deckCount: 1 | 2 = 1;
  private pointCap = 20;
  private bombMinimum = 3;

  public constructor(parent: Node, private readonly onGameChanged: (game: GameSession | null) => void) {
    this.node = uiNode(parent, 'NetworkLobby', 1200, 570, 0, -15);
    paint(this.node, PALETTE.panel);
    text(this.node, 'Title', '本地联机 · 等待大厅', 900, 45, 0, 251, 30);
    this.address = this.input('ServerAddress', 'ws://127.0.0.1:8787/rooms', 680, -150, 196, 200);
    this.connectButton = new UiButton(this.node, 'Connect', '连接服务器', 210, 44, 370, 196,
      () => { void this.client.connect(this.address.string.trim()); });
    this.connection = text(this.node, 'Connection', '', 1120, 36, 0, 148, 19, PALETTE.accent);
    const stepper = (name: string, y: number, change: (delta: number) => void): Label => {
      text(this.node, `${name}Label`, name, 240, 38, -440, y, 20);
      this.configButtons.push(new UiButton(this.node, `${name}Minus`, '−', 48, 38, -280, y, () => { change(-1); this.render(); }));
      const label = text(this.node, `${name}Value`, '', 180, 38, -155, y, 20);
      this.configButtons.push(new UiButton(this.node, `${name}Plus`, '+', 48, 38, -30, y, () => { change(1); this.render(); }));
      return label;
    };
    this.capacityLabel = stepper('玩家人数', 91, (delta) => { this.capacity = Math.max(2, Math.min(8, this.capacity + delta)); });
    this.decksLabel = stepper('扑克牌', 43, (delta) => { this.deckCount = delta > 0 ? 2 : 1; });
    this.capLabel = stepper('输家单局损失封顶', -5, (delta) => { this.pointCap = Math.max(5, Math.min(50, this.pointCap + delta)); });
    this.bombsLabel = stepper('最小炸弹张数', -53, (delta) => { this.bombMinimum = Math.max(3, Math.min(8, this.bombMinimum + delta)); });
    text(this.node, 'BombRule', '炸弹按配置张数启用至8张；每次全局累计 ×2', 560, 32, -260, -97, 16, PALETTE.muted);
    this.createButton = new UiButton(this.node, 'CreateRoom', '创建联机房间', 250, 48, -280, -151, () => {
      const sizes = ([3, 4, 5, 6, 7, 8] as const).filter((size) => size >= this.bombMinimum);
      void this.client.create(this.capacity, createRules({ deckCount: this.deckCount,
        roundPointCap: this.pointCap, allowedBombSizes: sizes }));
    }, true);
    this.roomInput = this.input('RoomId', '', 230, 80, -151, 6);
    this.joinButton = new UiButton(this.node, 'JoinRoom', '加入房间', 180, 48, 330, -151,
      () => { void this.client.join(this.roomInput.string); });
    this.details = text(this.node, 'Details', '输入六位房间号加入；房主左侧配置后创建。', 500, 100, 280, 74, 19);
    this.seats = text(this.node, 'Members', '', 520, 300, 285, -26, 20);
    this.readyButton = new UiButton(this.node, 'Ready', '准备', 180, 48, -50, -211, () => {
      const me = this.client.room?.players.find((player) => player.playerId === this.client.network.selfPlayerId);
      void this.client.ready(!me?.ready);
    });
    this.startButton = new UiButton(this.node, 'Start', '房主开始', 210, 48, 190, -211, () => { void this.client.start(); }, true);
    new UiButton(this.node, 'Disconnect', '退出房间', 180, 48, -300, -211, () => {
      if (this.client.room) void this.client.leave(); else this.client.close();
    });
    this.tableButton = new UiButton(this.node, 'ReturnToTable', '返回牌桌', 180, 48, 430, -211, () => {
      const game = this.client.game;
      if (!game || this.client.network.status !== 'connected') return;
      this.node.active = false; this.onGameChanged(game);
    });
    this.notice = text(this.node, 'Notice', '', 1120, 43, 0, -263, 17, PALETTE.accent);
    this.unsubscribe = this.client.subscribe(() => { this.render(); this.onGameChanged(this.client.game); });
    this.node.active = false; this.render();
  }
  private input(name: string, value: string, width: number, x: number, y: number, maxLength: number): EditBox {
    const node = uiNode(this.node, name, width, 44, x, y); paint(node, PALETTE.card);
    const label = text(node, 'Text', '', width - 18, 40, 0, 0, 19, PALETTE.ink);
    const placeholder = text(node, 'Placeholder', name === 'RoomId' ? '六位房间号' : '服务器地址', width - 18, 40, 0, 0, 18, PALETTE.ink);
    const edit = node.addComponent(EditBox);
    edit.textLabel = label; edit.placeholderLabel = placeholder;
    edit.inputMode = EditBox.InputMode.SINGLE_LINE;
    edit.maxLength = maxLength; edit.placeholder = name === 'RoomId' ? '六位房间号' : '服务器地址';
    edit.string = value;
    return edit;
  }
  public get game(): GameSession | null { return this.client.game; }
  public namePlayer(playerId: string): string {
    if (playerId === this.client.network.selfPlayerId) return '你';
    return this.client.room?.players.find((player) => player.playerId === playerId)?.displayName || '玩家';
  }
  public show(): void { this.node.active = true; this.render(); }
  public hide(): void { this.node.active = false; this.client.close(); }
  public dispose(): void { this.unsubscribe(); this.client.dispose(); }
  private render(): void {
    const network = this.client.network;
    const room = this.client.room;
    const connected = network.status === 'connected';
    const editable = !room && !this.client.busy;
    const statusNames = { disconnected: '未连接', connecting: '连接/恢复中', connected: '已连接', reconnecting: '等待自动重连', error: '连接错误（可手动重试）' };
    this.connection.string = `${statusNames[network.status]}${network.selfPlayerId ? ' · 身份由服务器分配' : ''}`;
    this.capacityLabel.string = `${this.capacity} 人`;
    this.decksLabel.string = `${this.deckCount} 副`;
    this.capLabel.string = `${this.pointCap} 分`;
    this.bombsLabel.string = `${this.bombMinimum}～8 张`;
    this.configButtons.forEach((button) => button.setEnabled(editable));
    this.connectButton.setEnabled(network.status !== 'connecting' && network.status !== 'reconnecting' && !room && !this.client.busy);
    this.address.enabled = !room && !this.client.busy;
    this.roomInput.enabled = editable;
    this.createButton.setEnabled(connected && editable);
    this.joinButton.setEnabled(connected && editable);
    this.seats.string = room ? room.players.map((player) =>
      `${player.seat + 1}号位 ${player.displayName}${player.playerId === network.selfPlayerId ? '（你）' : ''}${player.playerId === room.hostPlayerId ? ' 房主' : ''} · ${!player.connected ? '离线' : player.ready ? '已准备' : '未准备'}`).join('\n') : '';
    if (room) {
      this.details.string = `房间号：${room.roomId}  · ${room.players.length}/${room.capacity}人\n${room.rules.deckCount}副 · 损失封顶${room.rules.roundPointCap}分\n炸弹${room.rules.allowedBombSizes.join('/')}张 · 全局累计×2`;
      this.details.node.setPosition(0, 82);
      this.seats.node.setPosition(0, -70);
      this.configButtons.forEach((button) => { button.node.active = false; });
    } else {
      this.details.string = '输入六位房间号加入；房主左侧配置后创建。';
      this.details.node.setPosition(280, 74); this.seats.node.setPosition(285, -26);
      this.configButtons.forEach((button) => { button.node.active = true; });
    }
    // Hide configuration text after joining so member rows have the full panel width.
    for (const name of ['玩家人数', '扑克牌', '输家单局损失封顶', '最小炸弹张数']) {
      const label = this.node.getChildByName(`${name}Label`); if (label) label.active = !room;
      const value = this.node.getChildByName(`${name}Value`); if (value) value.active = !room;
    }
    const bombRule = this.node.getChildByName('BombRule'); if (bombRule) bombRule.active = !room;
    this.createButton.node.active = !room; this.joinButton.node.active = !room; this.roomInput.node.active = !room;
    const me = room?.players.find((player) => player.playerId === network.selfPlayerId);
    this.readyButton.label.string = me?.ready ? '取消准备' : '准备';
    this.readyButton.setEnabled(connected && !!room && (room.status === 'waiting' || room.status === 'finished') && !this.client.busy);
    this.startButton.label.string = room?.status === 'finished' ? '房主开始下一局' : '房主开始';
    this.startButton.setEnabled(connected && !!room && (room.status === 'waiting' || room.status === 'finished') && room.hostPlayerId === network.selfPlayerId && !this.client.busy);
    this.tableButton.node.active = this.client.game !== null;
    this.tableButton.setEnabled(connected && this.client.game !== null && !this.client.busy);
    this.notice.string = this.client.error ? ERRORS[this.client.error] || `操作失败：${this.client.error}`
      : this.client.busy ? '等待服务器确认…' : room?.status === 'finished'
      ? '本局已结算。全员重新准备后房主开局，上一局赢家任庄。'
      : room?.status === 'awaiting-rule' ? '仅剩王领出规则未决：暂停，不判胜、不结算。'
      : room ? '大厅退出释放席位；对局退出保留牌局。离线后可恢复原身份；准备需重新确认。' : '同一客户端可恢复房间；刷新或关闭窗口会丢失内存凭证。';
  }
}
