import {
  applyCommand, isCard, createGame, createPlayerView, createRules,
  type CommandError, type DeckCount, type GameCommand, type GameState,
  type Hand, type HandDeclaration, type RandomSource, type TablePlay,
} from '../../rules/src';
import { chooseAiCommand, type AiContext, type LegalPlay } from './ai';
import type { SelfGameView } from '../../protocol/src';
import { selfHint, selectedInterpretations, type GameSession } from '../../session/src';

export const HUMAN_ID = 'human';
export interface LocalOptions {
  readonly playerCount: number;
  readonly deckCount: DeckCount;
  readonly pointCap: number;
}

export type HumanView = SelfGameView;
export interface LocalSnapshot {
  readonly view: HumanView;
  readonly lastPlay: TablePlay | null;
  readonly message: string;
}

export function playerName(playerId: string): string {
  return playerId === HUMAN_ID ? '你' : `电脑 ${playerId.slice(3)}`;
}

const ERROR_MESSAGES: Record<CommandError, string> = {
  'invalid-command': '操作参数无效，请重新选牌。', 'game-finished': '本局已结束。',
  'awaiting-rule': '仅剩王的领出规则尚未确定，本局已暂停。', 'stale-version': '牌局已更新，请重新操作。',
  'unknown-player': '玩家不存在。', 'not-your-turn': '请等待你的回合。',
  'cannot-pass': '现在由你自由领出，不能过牌。', 'not-owned': '选择中含有不属于你的手牌。',
  'invalid-play': '该组合不能出：请检查牌型、接牌点数与王的搭配。',
};

/** In-process trusted host. The UI only receives human/public projections, never GameState. */
export class LocalSession implements GameSession {
  public readonly selfPlayerId = HUMAN_ID;
  private state: GameState;
  private lastPlay: TablePlay | null = null;
  private message = '你是庄家，请选牌后出牌。';

  public constructor(public readonly options: LocalOptions, random: RandomSource) {
    if (!Number.isInteger(options.playerCount) || options.playerCount < 2 || options.playerCount > 8) {
      throw new RangeError('玩家数量应为 2～8 人');
    }
    this.options = Object.freeze({ ...options });
    this.state = createGame({
      playerIds: Array.from({ length: options.playerCount }, (_, index) => index === 0 ? HUMAN_ID : `ai-${index}`),
      dealerIndex: 0, rules: createRules({ deckCount: options.deckCount, roundPointCap: options.pointCap }),
    }, random);
  }

  public snapshot(): LocalSnapshot {
    const view = createPlayerView(this.state, HUMAN_ID);
    return Object.freeze({ view: Object.freeze({ public: view.public,
      hand: Object.freeze(view.hand.filter(isCard)), selfPlayerId: HUMAN_ID }), lastPlay: this.lastPlay, message: this.message });
  }

  public get isHumanTurn(): boolean {
    return this.state.status === 'playing' && this.state.players[this.state.turnIndex]?.playerId === HUMAN_ID;
  }

  public get isPlaying(): boolean {
    return this.state.status === 'playing';
  }

  public selectedInterpretations(cardIds: readonly string[]): readonly Hand[] {
    return selectedInterpretations(this.snapshot().view, cardIds);
  }

  public play(cardIds: readonly string[], declaration?: HandDeclaration): boolean {
    // UI interpretations are Hand objects; serialize only command declaration fields.
    return this.submit({ type: 'play', playerId: HUMAN_ID, expectedVersion: this.state.version,
      cardIds, ...(declaration ? { declaration: { kind: declaration.kind, primaryRank: declaration.primaryRank } } : {}) });
  }

  public pass(): boolean {
    return this.submit({ type: 'pass', playerId: HUMAN_ID, expectedVersion: this.state.version });
  }

  public hint(): LegalPlay | null {
    return selfHint(this.snapshot().view);
  }

  /** One action per call, so rendering owns pacing and restart cancels all outstanding turns. */
  public stepAi(): boolean {
    const actor = this.state.players[this.state.turnIndex];
    if (this.state.status !== 'playing' || !actor || actor.playerId === HUMAN_ID) return false;
    const command = chooseAiCommand(this.context(actor.playerId));
    if (!command) {
      this.message = '电脑没有合法领出动作；请返回主界面，本局不结算。';
      return false;
    }
    return this.submit(command);
  }

  private context(playerId: string): AiContext {
    return { playerId, version: this.state.version,
      hand: this.state.players.find((player) => player.playerId === playerId)?.hand || [],
      rules: this.state.rules, previous: this.state.table?.hand || null };
  }

  private submit(command: GameCommand): boolean {
    const previousPileSize = this.state.drawPile.length;
    const result = applyCommand(this.state, command);
    if (!result.ok) { this.message = ERROR_MESSAGES[result.error]; return false; }
    this.state = result.state;
    if (command.type === 'play') {
      this.lastPlay = this.state.table;
      this.message = `${playerName(command.playerId)}出牌成功。`;
    } else this.message = `${playerName(command.playerId)}过牌。`;
    const drawn = previousPileSize - this.state.drawPile.length;
    if (drawn > 0) this.message += ` 本轮结束，已补 ${drawn} 张牌。`;
    if (this.state.status === 'awaiting-rule') this.message = '仅剩王且需领出：规则未定，本局暂停且不结算。';
    if (this.state.status === 'finished') this.message = `${playerName(this.state.settlement?.winnerId || '')}获胜！`;
    return true;
  }
}
