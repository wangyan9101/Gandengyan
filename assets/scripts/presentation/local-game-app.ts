import {
  _decorator, BlockInputEvents, Canvas, Component, Label, Mask, Node, ResolutionPolicy,
  ScrollView, UITransform, view,
} from 'cc';
import { LocalSession, HUMAN_ID, playerName, type LocalOptions } from '../generated/local/index';
import { isCard, RANK_ORDER, type Card, type Hand, type HandKind } from '../generated/rules/index';
import { CardTile } from './card-tile';
import { paint, PALETTE, text, uiNode, UiButton } from './ui-kit';

const { ccclass, property } = _decorator;
const HAND_NAMES: Record<HandKind, string> = {
  single: '单张', pair: '对子', straight: '顺子', 'consecutive-pairs': '连对', bomb: '炸弹',
};

function handName(hand: Hand): string {
  return `${HAND_NAMES[hand.kind]} · ${hand.primaryRank}起 · ${hand.cardCount}张` +
    (hand.wildAssignments.length ? ` · ${hand.wildAssignments.length}张王` : '');
}

function sortCards(a: Card, b: Card): number {
  const rank = (card: Card): number => card.kind === 'standard' ? RANK_ORDER.indexOf(card.rank) : 13;
  return rank(a) - rank(b) || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);
}

/** Attach once to a Canvas. No scene-node, prefab or click-event bindings are required. */
@ccclass('LocalGameApp')
export class LocalGameApp extends Component {
  @property({ tooltip: '电脑每步间隔（秒）' })
  public aiDelay = 0.55;

  @property({ tooltip: '0 为随机；非零为可复现的本地测试种子（非安全随机）' })
  public testSeed = 0;

  private session: LocalSession | null = null;
  private options: LocalOptions = { playerCount: 3, deckCount: 1, pointCap: 20 };
  private elapsed = 0;
  private selected = new Set<string>();
  private interpretationIndex = 0;
  private root: Node | null = null;
  private menu: Node | null = null;
  private table: Node | null = null;
  private overlay: Node | null = null;
  private handContent: Node | null = null;
  private handScroll: ScrollView | null = null;
  private countLabel: Label | null = null;
  private decksLabel: Label | null = null;
  private capLabel: Label | null = null;
  private statusLabel: Label | null = null;
  private tableLabel: Label | null = null;
  private messageLabel: Label | null = null;
  private turnLabel: Label | null = null;
  private selectionLabel: Label | null = null;
  private playButton: UiButton | null = null;
  private passButton: UiButton | null = null;
  private hintButton: UiButton | null = null;
  private clearButton: UiButton | null = null;
  private interpretationButton: UiButton | null = null;
  private readonly seats: Label[] = [];
  private readonly cards: CardTile[] = [];
  private readonly scoreRows: Label[] = [];
  private overlayTitle: Label | null = null;
  private overlayDetail: Label | null = null;

  protected start(): void {
    if (!this.node.getComponent(Canvas)) {
      text(this.node, 'SetupError', '请将 LocalGameApp 挂在带 Canvas 的节点上。', 900, 120, 0, 0);
      return;
    }
    view.setDesignResolutionSize(1280, 720, ResolutionPolicy.SHOW_ALL);
    view.resizeWithBrowserSize(true);
    this.root = uiNode(this.node, 'LocalGameUI', 1280, 720);
    paint(this.root, PALETTE.background, 0);
    text(this.root, 'Title', '干 瞪 眼', 300, 60, -445, 313, 35, PALETTE.accent);
    text(this.root, 'Mode', '本地练习 · 1 位真人 + 电脑', 600, 42, 150, 313, 19, PALETTE.muted);
    this.buildMenu(this.root);
    this.buildTable(this.root);
    this.buildOverlay(this.root);
    this.showMenu();
  }

  protected update(delta: number): void {
    if (!this.session || this.session.isHumanTurn || !this.session.isPlaying) {
      this.elapsed = 0;
      return;
    }
    this.elapsed += delta;
    if (this.elapsed < Math.max(0.1, this.aiDelay)) return;
    this.elapsed = 0;
    this.session.stepAi();
    this.render();
  }

  private buildMenu(parent: Node): void {
    this.menu = uiNode(parent, 'MainMenu', 920, 486, 0, -8);
    paint(this.menu, PALETTE.panel);
    text(this.menu, 'Heading', '创建游戏', 600, 56, 0, 178, 31);
    const stepper = (name: string, y: number, minus: () => void, plus: () => void): Label => {
      if (!this.menu) throw new Error('Missing menu');
      text(this.menu, `${name}Name`, name, 250, 52, -260, y);
      new UiButton(this.menu, `${name}Minus`, '−', 66, 52, -62, y, minus);
      const label = text(this.menu, `${name}Value`, '', 220, 52, 100, y, 27, PALETTE.accent);
      new UiButton(this.menu, `${name}Plus`, '+', 66, 52, 262, y, plus);
      return label;
    };
    this.countLabel = stepper('玩家人数', 88,
      () => this.configure('playerCount', -1), () => this.configure('playerCount', 1));
    this.decksLabel = stepper('扑克牌', 14,
      () => this.configure('deckCount', -1), () => this.configure('deckCount', 1));
    this.capLabel = stepper('每位输家损失封顶', -60,
      () => this.configure('pointCap', -1), () => this.configure('pointCap', 1));
    new UiButton(this.menu, 'CreateGame', '创建游戏', 320, 58, 0, -150, () => this.startGame(), true);
    text(this.menu, 'Info', '你坐 1 号位并担任庄家 · 积分仅供娱乐，不可兑现', 850, 36, 0, -211, 17, PALETTE.muted);
  }

  private buildTable(parent: Node): void {
    this.table = uiNode(parent, 'GameTable', 1240, 570, 0, -15);
    for (let index = 0; index < 7; index += 1) {
      const seat = uiNode(this.table, `Opponent${index + 1}`, 145, 78, 0, 255);
      paint(seat, PALETTE.panel);
      this.seats.push(text(seat, 'SeatText', '', 137, 68, 0, 0, 21));
    }
    this.statusLabel = text(this.table, 'Stats', '', 1180, 40, 0, 180, 22, PALETTE.accent);
    this.turnLabel = text(this.table, 'CurrentTurn', '', 900, 46, 0, 122, 29);
    this.tableLabel = text(this.table, 'LastPlay', '', 1120, 76, 0, 49, 24, PALETTE.muted);
    this.messageLabel = text(this.table, 'Message', '', 1140, 48, 0, -15, 20);
    this.selectionLabel = text(this.table, 'Selection', '', 1140, 42, 0, -69, 19, PALETTE.accent);

    const scrollNode = uiNode(this.table, 'HandScroll', 1170, 152, 0, -169);
    this.handScroll = scrollNode.addComponent(ScrollView);
    this.handScroll.horizontal = true;
    this.handScroll.vertical = false;
    this.handScroll.inertia = true;
    this.handScroll.cancelInnerEvents = true;
    const viewport = uiNode(scrollNode, 'View', 1170, 152);
    viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
    this.handContent = uiNode(viewport, 'Content', 1170, 152);
    this.handContent.getComponent(UITransform)?.setAnchorPoint(0, 0.5);
    this.handContent.setPosition(-585, 0);
    this.handScroll.content = this.handContent;

    this.hintButton = new UiButton(this.table, 'Hint', '提示', 115, 52, -505, -286, () => this.hint());
    this.clearButton = new UiButton(this.table, 'Clear', '取消选择', 150, 52, -352, -286, () => {
      this.selected.clear(); this.interpretationIndex = 0; this.render();
    });
    this.interpretationButton = new UiButton(this.table, 'Interpretation', '切换牌型', 345, 52, -50, -286, () => {
      this.interpretationIndex += 1; this.render();
    });
    this.playButton = new UiButton(this.table, 'Play', '出牌', 150, 52, 290, -286, () => this.play(), true);
    this.passButton = new UiButton(this.table, 'Pass', '过牌', 150, 52, 490, -286, () => {
      if (this.session?.pass()) this.selected.clear(); this.render();
    });
    text(this.table, 'Footer', '点击牌面选择 / 再次点击取消 · 手牌较多时左右滑动 · 王只能搭普通牌', 1120, 24, 0, -322, 15, PALETTE.muted);
    new UiButton(parent, 'Home', '主界面', 125, 42, 540, 313, () => this.showMenu());
  }

  private buildOverlay(parent: Node): void {
    this.overlay = uiNode(parent, 'ResultOverlay', 1280, 720);
    paint(this.overlay, PALETTE.background, 0);
    this.overlay.addComponent(BlockInputEvents);
    const panel = uiNode(this.overlay, 'ResultPanel', 1040, 620);
    paint(panel, PALETTE.panel);
    this.overlayTitle = text(panel, 'ResultTitle', '', 940, 52, 0, 251, 32, PALETTE.accent);
    this.overlayDetail = text(panel, 'ResultDetail', '', 950, 68, 0, 184, 20);
    text(panel, 'Columns', '玩家             剩余手牌         炸弹倍数           本局积分          封顶说明',
      970, 36, 0, 126, 20, PALETTE.muted);
    for (let index = 0; index < 8; index += 1) {
      this.scoreRows.push(text(panel, `Score${index}`, '', 990, 33, 0, 85 - index * 34, 21));
    }
    new UiButton(panel, 'Restart', '相同配置再开一局', 310, 56, -180, -232, () => this.startGame(), true);
    new UiButton(panel, 'BackToMenu', '返回主界面', 240, 56, 170, -232, () => this.showMenu());
    text(panel, 'ScoreNotice', '每位输家损失封顶；赢家收取实际扣分总和，收入可以超过封顶。', 970, 38, 0, -281, 17, PALETTE.muted);
  }

  private configure(key: keyof LocalOptions, delta: number): void {
    if (key === 'playerCount') this.options = { ...this.options, playerCount: Math.max(2, Math.min(8, this.options.playerCount + delta)) };
    if (key === 'deckCount') this.options = { ...this.options, deckCount: delta > 0 ? 2 : 1 };
    if (key === 'pointCap') this.options = { ...this.options, pointCap: Math.max(5, Math.min(50, this.options.pointCap + delta)) };
    this.renderMenu();
  }

  private renderMenu(): void {
    if (this.countLabel) this.countLabel.string = `${this.options.playerCount} 人`;
    if (this.decksLabel) this.decksLabel.string = `${this.options.deckCount} 副 · ${this.options.deckCount * 54} 张`;
    if (this.capLabel) this.capLabel.string = `${this.options.pointCap} 分`;
  }

  private showMenu(): void {
    this.session = null;
    this.elapsed = 0;
    this.selected.clear();
    if (this.menu) this.menu.active = true;
    if (this.table) this.table.active = false;
    if (this.overlay) this.overlay.active = false;
    this.renderMenu();
  }

  private startGame(): void {
    let seed = this.testSeed >>> 0;
    const random = seed === 0 ? Math.random : () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    this.session = new LocalSession(this.options, random);
    this.elapsed = 0;
    this.selected.clear();
    this.interpretationIndex = 0;
    if (this.menu) this.menu.active = false;
    if (this.table) this.table.active = true;
    if (this.overlay) this.overlay.active = false;
    this.handScroll?.scrollToLeft(0);
    this.render();
  }

  private toggle(cardId: string): void {
    if (!this.session?.isHumanTurn) return;
    if (this.selected.has(cardId)) this.selected.delete(cardId); else this.selected.add(cardId);
    this.interpretationIndex = 0;
    this.render();
  }

  private hint(): void {
    const hint = this.session?.hint();
    this.selected = new Set(hint?.cardIds || []);
    const interpretations = this.session?.selectedInterpretations(Array.from(this.selected)) || [];
    const index = interpretations.findIndex((hand) => hand.kind === hint?.declaration.kind && hand.primaryRank === hint?.declaration.primaryRank);
    this.interpretationIndex = Math.max(0, index);
    this.render();
  }

  private play(): void {
    // Creator's loose spread transform assumes arrays; selected is a Set.
    const cardIds = Array.from(this.selected);
    const interpretations = this.session?.selectedInterpretations(cardIds) || [];
    const interpretation = interpretations[this.interpretationIndex % Math.max(1, interpretations.length)];
    if (this.session?.play(cardIds, interpretation)) {
      this.selected.clear(); this.interpretationIndex = 0;
    }
    this.render();
  }

  private render(): void {
    if (!this.session) return;
    const snapshot = this.session.snapshot();
    const state = snapshot.view.public;
    const humanTurn = this.session.isHumanTurn;
    const opponents = state.players.filter((player) => player.playerId !== HUMAN_ID);
    for (let index = 0; index < this.seats.length; index += 1) {
      const label = this.seats[index];
      const player = opponents[index];
      if (!label) continue;
      label.node.parent?.setPosition((index - (opponents.length - 1) / 2) * 160, 255);
      if (label.node.parent) label.node.parent.active = Boolean(player);
      if (player) {
        label.string = `${state.turnPlayerId === player.playerId ? '▶ ' : ''}${playerName(player.playerId)}\n剩余 ${player.handCount} 张`;
        label.color = state.turnPlayerId === player.playerId ? PALETTE.accent : PALETTE.text;
      }
    }
    if (this.statusLabel) this.statusLabel.string = `公共牌堆 ${state.drawPileCount} 张    |    炸弹 ${state.bombCount} 次    |    当前 ×${state.multiplier}    |    损失封顶 ${state.rules.roundPointCap} 分`;
    if (this.turnLabel) this.turnLabel.string = humanTurn ? '轮到你了' : `${playerName(state.turnPlayerId)}思考中…`;
    const last = state.table || snapshot.lastPlay;
    if (this.tableLabel) this.tableLabel.string = last
      ? `${state.table ? '桌面' : '上一手（本轮已结束）'} · ${playerName(last.playerId)}\n${handName(last.hand)}` : '尚未出牌 · 庄家自由领出';
    if (this.messageLabel) this.messageLabel.string = snapshot.message;
    const hand = snapshot.view.hand.filter(isCard).sort(sortCards);
    const owned = new Set(hand.map((card) => card.cardId));
    this.selected.forEach((id) => { if (!owned.has(id)) this.selected.delete(id); });
    this.renderHand(hand, humanTurn);
    const interpretations = this.session.selectedInterpretations(Array.from(this.selected));
    const interpretation = interpretations[this.interpretationIndex % Math.max(1, interpretations.length)];
    if (this.selectionLabel) this.selectionLabel.string = this.selected.size
      ? `已选 ${this.selected.size} 张 · ${interpretation ? handName(interpretation) : '当前组合不能出'}`
      : `你的手牌 ${hand.length} 张 · ${state.table ? '可接牌或过牌' : '自由领出，不能过牌'}`;
    if (this.interpretationButton) {
      this.interpretationButton.label.string = interpretation ? `${HAND_NAMES[interpretation.kind]} ${interpretation.primaryRank} · 点击切换` : '牌型解释';
      this.interpretationButton.setEnabled(humanTurn && interpretations.length > 1);
    }
    this.playButton?.setEnabled(humanTurn && Boolean(interpretation));
    this.passButton?.setEnabled(humanTurn && state.table !== null);
    this.hintButton?.setEnabled(humanTurn);
    this.clearButton?.setEnabled(humanTurn && this.selected.size > 0);
    if (state.status !== 'playing') this.renderResult();
  }

  private renderHand(hand: readonly Card[], enabled: boolean): void {
    if (!this.handContent) return;
    while (this.cards.length < hand.length) this.cards.push(new CardTile(this.handContent, (id) => this.toggle(id)));
    const width = Math.max(1170, hand.length * 84 + 12);
    this.handContent.getComponent(UITransform)?.setContentSize(width, 152);
    const start = hand.length * 84 < 1170 ? (1170 - hand.length * 84) / 2 : 6;
    for (let index = 0; index < this.cards.length; index += 1) {
      const tile = this.cards[index];
      const card = hand[index];
      if (!tile) continue;
      tile.control.node.active = Boolean(card);
      if (card) tile.bind(card, this.selected.has(card.cardId), start + index * 84 + 38, enabled);
    }
  }

  private renderResult(): void {
    if (!this.session || !this.overlay) return;
    const state = this.session.snapshot().view.public;
    this.overlay.active = true;
    const settlement = state.settlement;
    if (this.overlayTitle) this.overlayTitle.string = settlement ? `${playerName(settlement.winnerId)}获胜 · 本局结算` : '本局暂停 · 等待规则决定';
    if (this.overlayDetail) this.overlayDetail.string = settlement
      ? `炸弹 ${settlement.bombCount} 次 · 全局 ×${settlement.multiplier} · 每位输家损失封顶 ${settlement.pointCap} 分`
      : '仅剩王且必须自由领出，尚无合法的后续规则。\n本局不判胜、不扣分。你可以重新开局或返回主界面。';
    for (let index = 0; index < this.scoreRows.length; index += 1) {
      const row = this.scoreRows[index];
      const score = settlement?.scores[index];
      const player = state.players[index];
      if (!row) continue;
      row.node.active = Boolean(player);
      if (score) {
        const note = score.delta > 0 ? '收入不封顶' : Math.abs(score.delta) === state.rules.roundPointCap ? '已达封顶' : '未触及封顶';
        row.string = `${playerName(score.playerId)}             ${score.remainingCards} 张             ×${state.multiplier}             ${score.delta > 0 ? '+' : ''}${score.delta}             ${note}`;
        row.color = score.delta > 0 ? PALETTE.accent : PALETTE.text;
      } else if (player) row.string = `${playerName(player.playerId)}             ${player.handCount} 张             ×${state.multiplier}             不结算`;
    }
  }
}
