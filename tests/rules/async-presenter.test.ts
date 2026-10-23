import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { LocalSession } from '../../packages/local/src';
import * as rules from '../../packages/rules/src';
import { seededRandom } from './helpers';

import type { GameSession } from '../../packages/session/src';
interface AsyncHarness {
  session: GameSession;
  selected: Set<string>;
  interpretationIndex: number;
  pending: boolean;
  operationError: string;
  render: () => void;
  play: () => void;
  pass: () => void;
  toggle: (id: string) => void;
  syncNetworkGame: (game: GameSession | null) => void;
  returnToRoom: () => void;
  localSession: LocalSession | null;
  table: { active: boolean };
  overlay: { active: boolean };
  networkLobby: { node: { active: boolean }; show: () => void };
  update: (delta: number) => void;
}

function createCompiledPresenter(): AsyncHarness {
  const source = readFileSync(new URL('../../assets/scripts/presentation/local-game-app.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS,
    experimentalDecorators: true, downlevelIteration: false,
  } }).outputText;
  const exports: Record<string, unknown> = {};
  const modules: Record<string, unknown> = {
    cc: {
      Component: function Component() {},
      _decorator: { ccclass: () => (constructor: unknown) => constructor, property: () => () => undefined },
    },
    '../generated/local/index': { LocalSession },
    '../generated/rules/index': rules,
    './card-tile': {}, './ui-kit': {}, './network-lobby': {},
  };
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected presenter dependency: ${name}`);
    return modules[name];
  } });
  const Constructor = exports.LocalGameApp as new () => AsyncHarness;
  const app = new Constructor();
  app.session = new LocalSession({ playerCount: 3, deckCount: 1, pointCap: 20 }, seededRandom(2026));
  app.render = () => {}; // Action boundary only; no mock claim about visual rendering.
  return app;
}

describe('asynchronous presenter operations', () => {
  function deferredApp() {
    const app = createCompiledPresenter();
    const local = app.session;
    const hint = local.hint();
    if (!hint) throw new Error('fixture');
    app.selected = new Set(hint.cardIds);
    let finish: (ok: boolean) => void = () => { throw new Error('not pending'); };
    let fail: (error: Error) => void = () => { throw new Error('not pending'); };
    let calls = 0;
    const pending = () => {
      calls += 1;
      return new Promise<boolean>((resolve, reject) => { finish = resolve; fail = reject; });
    };
    app.session = { selfPlayerId: local.selfPlayerId, isHumanTurn: true, isPlaying: true,
      snapshot: () => local.snapshot(), hint: () => local.hint(),
      selectedInterpretations: (ids) => local.selectedInterpretations(ids), play: pending, pass: pending };
    return { app, finish: (ok: boolean) => finish(ok), fail: () => fail(new Error('network')), calls: () => calls };
  }
  it('waits for play confirmation, blocks repeat clicks, then clears selection', async () => {
    const { app, finish, calls } = deferredApp();
    const size = app.selected.size;
    app.play(); app.play(); app.pass(); app.toggle('other-card');
    expect(calls()).toBe(1);
    expect(app.pending).toBe(true);
    expect(app.selected.size).toBe(size);
    finish(true); await Promise.resolve();
    expect(app.pending).toBe(false);
    expect(app.selected.size).toBe(0);
  });
  it('supports delayed pass and retains selection on rejection', async () => {
    const { app, finish } = deferredApp();
    const selected = Array.from(app.selected);
    app.pass(); finish(false); await Promise.resolve();
    expect(Array.from(app.selected)).toEqual(selected);
    expect(app.pending).toBe(false);
  });
  it('handles transport rejection without an unhandled promise', async () => {
    const { app, fail } = deferredApp();
    app.play(); fail(); await Promise.resolve();
    expect(app.pending).toBe(false);
    expect(app.operationError).not.toBe('');
    expect(app.selected.size).toBeGreaterThan(0);
  });
  it('ignores old completions after switching to a new game', async () => {
    const { app, finish } = deferredApp();
    app.play();
    app.session = new LocalSession({ playerCount: 2, deckCount: 1, pointCap: 20 }, seededRandom(2026));
    app.selected = new Set(['new-selection']);
    finish(true); await Promise.resolve();
    expect(Array.from(app.selected)).toEqual(['new-selection']);
    expect(app.session.snapshot().view.public.version).toBe(0);
  });
  it('switches the real presenter to a new network round and clears old selection/overlay/AI', () => {
    const app = createCompiledPresenter();
    const local = app.session;
    const next = new LocalSession({ playerCount: 2, deckCount: 1, pointCap: 20 }, seededRandom(2026));
    app.localSession = local instanceof LocalSession ? local : null;
    app.selected = new Set(['old-card']); app.pending = true;
    app.table = { active: false }; app.overlay = { active: true };
    app.networkLobby = { node: { active: true }, show: () => { app.networkLobby.node.active = true; } };
    app.syncNetworkGame(next);
    expect(app.session).toBe(next); expect(app.localSession).toBeNull();
    expect(app.pending).toBe(false); expect(app.selected.size).toBe(0);
    expect(app.table.active).toBe(true); expect(app.overlay.active).toBe(false);
    expect(app.networkLobby.node.active).toBe(false);
    const version = next.snapshot().view.public.version;
    app.update(10);
    expect(next.snapshot().view.public.version).toBe(version);
    app.returnToRoom();
    expect(app.networkLobby.node.active).toBe(true);
    expect(app.table.active).toBe(false);
  });
  it('returns to the lobby on a lost network session and ignores old completions', async () => {
    const { app, finish } = deferredApp();
    app.table = { active: true }; app.overlay = { active: true };
    app.networkLobby = { node: { active: false }, show: () => { app.networkLobby.node.active = true; } };
    app.play(); app.syncNetworkGame(null);
    finish(true); await Promise.resolve();
    expect(app.table.active).toBe(false); expect(app.overlay.active).toBe(false);
    expect(app.networkLobby.node.active).toBe(true);
    expect(app.selected.size).toBe(0);
  });
  it('keeps the ongoing game while visiting the room and restores the same table on return', () => {
    const app = createCompiledPresenter();
    const game = app.session;
    app.localSession = null;
    app.table = { active: true }; app.overlay = { active: false };
    app.networkLobby = { node: { active: false }, show: () => { app.networkLobby.node.active = true; } };
    const before = game.snapshot();
    app.returnToRoom();
    expect(app.session).toBe(game);
    expect(app.table.active).toBe(false);
    expect(app.networkLobby.node.active).toBe(true);
    app.syncNetworkGame(game); // A room broadcast must not pull someone out of the lobby.
    expect(app.table.active).toBe(false);
    app.networkLobby.node.active = false; // ReturnToTable hides the lobby before notifying the presenter.
    app.syncNetworkGame(game);
    expect(app.table.active).toBe(true);
    expect(app.session).toBe(game);
    expect(game.snapshot()).toEqual(before);
  });

});
