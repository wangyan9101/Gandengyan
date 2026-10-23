import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { LocalSession } from '../../packages/local/src';
import * as rules from '../../packages/rules/src';
import { seededRandom } from './helpers';

interface AppHarness {
  session: LocalSession;
  selected: Set<string>;
  interpretationIndex: number;
  render: () => void;
  hint: () => void;
  play: () => void;
}

/** Reproduce the array-only spread lowering observed in the actual WeChat build.
 * This tests presenter actions, not engine rendering or physical touch handling. */
function createCompiledPresenter(): AppHarness {
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
  const Constructor = exports.LocalGameApp as new () => AppHarness;
  const app = new Constructor();
  app.session = new LocalSession({ playerCount: 3, deckCount: 1, pointCap: 20 }, seededRandom(2026));
  app.render = () => {}; // Action boundary only; no mock claim about visual rendering.
  return app;
}

describe('selection after WeChat-style array-only spread compilation', () => {
  it('submits manually selected card IDs and accepts the dealer opening', () => {
    const app = createCompiledPresenter();
    const card = app.session.snapshot().view.hand.find((entry) => entry.kind === 'standard');
    if (!card) throw new Error('Missing opening card');
    app.selected.add(card.cardId);
    app.play();
    const snapshot = app.session.snapshot();
    expect(snapshot.view.public.version).toBe(1);
    expect(snapshot.view.public.table?.cardIds).toEqual([card.cardId]);
    expect(app.selected.size).toBe(0);
  });

  it('resolves a hinted selection and submits its exact legal interpretation', () => {
    const app = createCompiledPresenter();
    app.hint();
    expect(app.selected.size).toBeGreaterThan(0);
    expect(app.session.selectedInterpretations(Array.from(app.selected)).length).toBeGreaterThan(0);
    app.play();
    expect(app.session.snapshot().view.public.version).toBe(1);
    expect(app.session.stepAi()).toBe(true);
  });
});
