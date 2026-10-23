import { describe, expect, it } from 'vitest';
import { chooseAiCommand, findLegalPlays, LocalSession, HUMAN_ID } from '../../packages/local/src';
import { applyCommand, assertStateIntegrity, createRules, resolvePlay } from '../../packages/rules/src';
import { ownedIds, scenario, seededRandom } from './helpers';

describe('local AI legality and information boundary', () => {
  it('plans using only the actor hand and public table, including wildcard/bomb responses', () => {
    const state = scenario([['3', '3', 'small-joker', '9'], ['4', '4', 'big-joker', '10']]);
    const actor = state.players[0];
    if (!actor) throw new Error('Missing actor');
    const context = { playerId: actor.playerId, version: state.version,
      hand: actor.hand, rules: state.rules, previous: null };
    const choices = findLegalPlays(context);
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) {
      const cards = actor.hand.filter((card) => choice.cardIds.includes(card.cardId));
      expect(resolvePlay(cards, state.rules, null, choice.declaration)).toEqual(choice.hand);
      const result = applyCommand(state, { type: 'play', playerId: actor.playerId, expectedVersion: state.version,
        cardIds: choice.cardIds, declaration: choice.declaration });
      expect(result.ok).toBe(true);
      assertStateIntegrity(result.state);
    }
  });
  it('passes legally when no response exists, never passes on free lead, and never singles a joker', () => {
    const state = scenario([['3', '9'], ['5', 'big-joker']]);
    const played = applyCommand(state, { type: 'play', playerId: 'p0', expectedVersion: 0,
      cardIds: ownedIds(state, 'p0', ['3']) });
    const actor = played.state.players[1];
    if (!actor) throw new Error('Missing actor');
    const context = { playerId: 'p1', version: 1, hand: actor.hand, rules: state.rules, previous: played.state.table?.hand || null };
    expect(chooseAiCommand(context)?.type).toBe('pass');
    expect(chooseAiCommand({ ...context, previous: null })?.type).toBe('play');
    expect(chooseAiCommand({ ...context, previous: null, hand: actor.hand.filter((card) => card.kind === 'joker') })).toBeNull();
  });
  it('spends jokers with natural cards instead of knowingly stranding a lone joker', () => {
    const state = scenario([['3', 'big-joker'], ['4']]);
    const actor = state.players[0];
    if (!actor) throw new Error('Missing actor');
    const command = chooseAiCommand({ playerId: actor.playerId, hand: actor.hand,
      rules: state.rules, previous: null, version: 0 });
    expect(command?.type).toBe('play');
    if (command?.type === 'play') expect(command.cardIds).toHaveLength(2);
  });
});

describe('one human local session', () => {
  it('accepts a manual dealer opening using the full hand interpretation returned to the UI', () => {
    const session = new LocalSession({ playerCount: 3, deckCount: 1, pointCap: 20 }, seededRandom(2026));
    const card = session.snapshot().view.hand.find((held) => held.kind === 'standard');
    if (!card) throw new Error('Missing ordinary opening card');
    const ids = [card.cardId];
    const interpretation = session.selectedInterpretations(ids)[0];
    if (!interpretation) throw new Error('Missing legal opening interpretation');
    expect(interpretation).toHaveProperty('cardCount', 1);
    expect(interpretation).toHaveProperty('wildAssignments');
    expect(session.play(ids, interpretation)).toBe(true);
    const result = session.snapshot();
    expect(result.view.public.version).toBe(1);
    expect(result.view.hand).toHaveLength(5);
    expect(result.view.public.table?.hand.kind).toBe('single');
    expect(session.stepAi()).toBe(true);
  });

  it('only reveals the human hand and keeps failed selection unchanged', () => {
    const session = new LocalSession({ playerCount: 8, deckCount: 2, pointCap: 5 }, seededRandom(42));
    const snapshot = session.snapshot();
    expect(snapshot.view.hand).toHaveLength(6);
    expect(snapshot.view.public.players).toHaveLength(8);
    expect(snapshot.view.public.rules.roundPointCap).toBe(5);
    expect(Object.keys(snapshot)).toEqual(['view', 'lastPlay', 'message']);
    expect(JSON.stringify(snapshot)).not.toContain('discardPile');
    expect(session.stepAi()).toBe(false);
    expect(session.play(['not-owned'])).toBe(false);
    expect(session.snapshot().view.public.version).toBe(0);
    expect(session.snapshot().view.hand).toEqual(snapshot.view.hand);
    expect(session.pass()).toBe(false);
    expect(session.snapshot().view.public.version).toBe(0);
  });
  it('does not auto-play the human and preserves the latest public play after a round', () => {
    const session = new LocalSession({ playerCount: 2, deckCount: 1, pointCap: 20 }, seededRandom(7));
    const hint = session.hint();
    if (!hint) throw new Error('Missing hint');
    expect(session.selectedInterpretations(hint.cardIds).length).toBeGreaterThan(0);
    expect(session.play(hint.cardIds, hint.declaration)).toBe(true);
    expect(session.snapshot().lastPlay?.playerId).toBe(HUMAN_ID);
    expect(session.hint()).toBeNull();
    expect(session.stepAi()).toBe(true);
  });
  it('validates settings and isolates repeated starts', () => {
    expect(() => new LocalSession({ playerCount: 1, deckCount: 1, pointCap: 20 }, seededRandom(1))).toThrow();
    expect(() => new LocalSession({ playerCount: 2, deckCount: 1, pointCap: 51 }, seededRandom(1))).toThrow();
    const options = { playerCount: 2, deckCount: 1 as const, pointCap: 50 };
    const first = new LocalSession(options, seededRandom(1));
    const hint = first.hint();
    if (!hint) throw new Error('Missing hint');
    first.play(hint.cardIds, hint.declaration);
    const second = new LocalSession(options, seededRandom(1));
    expect(second.snapshot().view.public.version).toBe(0);
    expect(second.snapshot().view.public.bombCount).toBe(0);
    expect(second.snapshot().lastPlay).toBeNull();
    expect(second.snapshot().view.public.settlement).toBeNull();
  });
  for (const deckCount of [1, 2] as const) {
    for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
      it(`plays a complete deterministic game: ${playerCount} players / ${deckCount} decks`, () => {
        const session = new LocalSession({ playerCount, deckCount, pointCap: 20 }, seededRandom(2026));
        let steps = 0;
        while (session.snapshot().view.public.status === 'playing' && steps < 1600) {
          const before = session.snapshot().view.public.version;
          if (session.isHumanTurn) {
            const hint = session.hint();
            expect(hint ? session.play(hint.cardIds, hint.declaration) : session.pass()).toBe(true);
          } else expect(session.stepAi()).toBe(true);
          expect(session.snapshot().view.public.version).toBe(before + 1);
          steps += 1;
        }
        const final = session.snapshot().view.public;
        expect(steps).toBeLessThan(1600);
        expect(final.status).toBe('finished');
        expect(final.settlement).not.toBeNull();
        expect(final.settlement?.scores.reduce((sum, score) => sum + score.delta, 0)).toBe(0);
        expect(final.settlement?.scores.filter((score) => score.remainingCards === 0)).toHaveLength(1);
        expect(session.stepAi()).toBe(false);
      });
    }
  }
});
