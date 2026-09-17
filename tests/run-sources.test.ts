import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { describeDeck, makeCtx, purchaseCoverage, traineeCoverage, wishlistCandidates } from '../src/model/deck.ts';
import { prepareRunSources } from '../src/model/run-sources.ts';
import { cardSourcesForTarget, resolveTarget } from '../src/model/sparks.ts';
import { must } from './helpers.ts';

const data = loadData();
const context = () => makeCtx({ data, settings: structuredClone(DEFAULT_SETTINGS), races: 20,
  totalTurns: data.model.races.totalTurns, trainee: must(data.charByCardId.get(100101), 'Special Week') });
const entry = (id: number, lb: number) => ({ card: must(data.cardById.get(id), `card ${id}`), lb });

test('prepared sources preserve deck effects, limit breaks, priorities and exclusions across candidates', () => {
  const base = context(), sources = prepareRunSources(base);
  const targets = [200352, 200432, 201601].map((id) => must(sources.target(id), `target ${id}`));
  const decks = [
    [entry(30028, 0), entry(30010, 4)],
    [entry(30028, 4), entry(30010, 4)],
    [entry(30107, 4), entry(30078, 4)],
  ];
  for (const deck of decks) for (const priority of [[], [200432, 200352], [200352, 200432]]) for (const excluded of [[], [200432]]) {
    const plain = { ...base, priority, excluded, fansBefore: () => 200_000 };
    const prepared = { ...plain, sources };
    assert.deepEqual(purchaseCoverage(deck, targets, prepared), purchaseCoverage(deck, targets, plain));
    assert.deepEqual(wishlistCandidates(deck, targets, prepared), wishlistCandidates(deck, targets, plain));
    assert.deepEqual(describeDeck(deck, targets, prepared), describeDeck(deck, targets, plain));
  }
});

test('readers leave the shared per-card source arrays untouched', () => {
  const base = context(), sources = prepareRunSources(base);
  const targets = [200352, 200432, 201601].map((id) => must(sources.target(id), `target ${id}`));
  const deck = [entry(30028, 4), entry(30010, 4)];
  const prepared = { ...base, sources, priority: [200432, 200352], excluded: [], fansBefore: () => 200_000 };
  describeDeck(deck, targets, prepared);
  purchaseCoverage(deck, targets, prepared);
  wishlistCandidates(deck, targets, prepared);
  for (const { card, lb } of deck) for (const t of targets) {
    assert.deepEqual(sources.card(card, lb, t), cardSourcesForTarget(card, lb, t, base.races, base.totalTurns, data, base.settings), 'a reader does not change the shared array');
  }
});

test('each preparation reads current settings, agenda and lineage without retaining previous results', () => {
  const ctx = context(), { card } = entry(30028, 4);
  const first = prepareRunSources(ctx), target = must(first.target(200352), 'Corner Recovery');
  const original = first.card(card, 4, target);
  assert.equal(first.card(card, 4, target), original, 'neighboring decks reuse the fixed source calculation');
  ctx.settings.hintScale = 0;
  ctx.settings.chainRatesSSR = [.9, .8, .7];
  ctx.races = 30;
  ctx.lineage.set(target.id, { k1: 1, p1: 3, k2: 0, p2: 0 });
  const second = prepareRunSources(ctx);
  assert.deepEqual(second.card(card, 4, target), cardSourcesForTarget(card, 4, target, ctx.races, ctx.totalTurns, data, ctx.settings));
  assert.notDeepEqual(second.card(card, 4, target), original);
  const prepared = { ...ctx, sources: second };
  const expected = traineeCoverage([target], ctx);
  assert.deepEqual(traineeCoverage([target], prepared), expected);
  traineeCoverage([target], prepared).sources.get(target.id)!.length = 0;
  assert.deepEqual(traineeCoverage([target], prepared), expected, 'a caller owns the returned source arrays');
});

test('prepared family lookups preserve every member resolution, including shared gold upgrades', () => {
  const sources = prepareRunSources(context());
  for (const skill of data.skills) assert.deepEqual(sources.target(skill.id), resolveTarget(skill.id, data));
  assert.equal(sources.target(-1), null);
  assert.equal(sources.target(-1), null);
  assert.notEqual(sources.target(200432)!.id, sources.target(200433)!.id);
});
