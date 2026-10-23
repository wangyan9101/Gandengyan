import { Label, Node, UITransform } from 'cc';
import type { Card } from '../generated/rules/index';
import { paint, PALETTE, text, UiButton } from './ui-kit';

const SUIT_NAMES: Record<Card['suit'], string> = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠', joker: '王' };

/** Reused card node. The click callback reads the current binding, not a stale card closure. */
export class CardTile {
  public readonly control: UiButton;
  public cardId = '';
  private readonly detail: Label;

  public constructor(parent: Node, onClick: (cardId: string) => void) {
    this.control = new UiButton(parent, 'HandCard', '', 76, 108, 0, 0, () => onClick(this.cardId));
    this.control.label.node.setPosition(0, 10);
    this.control.label.node.getComponent(UITransform)?.setContentSize(70, 72);
    this.control.label.fontSize = 29;
    this.control.label.lineHeight = 32;
    this.detail = text(this.control.node, 'Deck', '', 70, 24, 0, -33, 14, PALETTE.ink);
  }

  public bind(card: Card, selected: boolean, x: number, enabled: boolean): void {
    this.cardId = card.cardId;
    this.control.node.active = true;
    this.control.node.setPosition(x, selected ? 14 : 0);
    paint(this.control.node, selected ? PALETTE.accent : PALETTE.card, 8);
    const rank = card.kind === 'joker' ? card.rank === 'big-joker' ? '大王' : '小王' : `${SUIT_NAMES[card.suit]}\n${card.rank}`;
    this.control.label.string = rank;
    this.control.label.color = card.suit === 'diamonds' || card.suit === 'hearts' || card.rank === 'big-joker'
      ? PALETTE.red : PALETTE.ink;
    this.detail.string = `${card.deckIndex + 1} 副${selected ? ' · 已选' : ''}`;
    this.control.setEnabled(enabled, false);
  }
}
