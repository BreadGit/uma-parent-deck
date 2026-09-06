import type { Card, Character, Data } from '../types.ts';
import type { Settings } from '../settings.ts';
import { cardContribution, raceScale, type Contribution } from './stats.ts';
import { BORROWED_SLOTS, DECK_SIZE, PRIORITIZED_SKILLS_MAX } from './rules.ts';
import type { RaceWins } from './races.ts';
import { cardSourcesForTarget, combineSources, eventSources, isChoiceSource, lineageSources, lineageCount, pruneConflicts, scenarioOptions, scenarioSources, sparkChance, type Blocker, traineeEventSources, traineeSources, type Conflict, type Lineage, type Ownership, type SkillSource, type Target } from './sparks.ts';

/** Everything a run evaluation needs besides the cards: the data, the settings and the run's fixed choices. */
export interface Ctx {
  data: Data;
  settings: Settings;
  races: number;
  totalTurns: number;
  trainee: Character | null;
  raceWins: RaceWins;            // win chance per agenda race, for the trainee's secret events
  lineage: Map<number, Lineage>; // target.id -> existing lineage sparks
  priority: number[];            // skill ids in prioritized-skill order (every form of a family); decides which option an event's choice goes to
}
/** A Ctx with no agenda, lineage or priority unless given; for tests and scripts. */
export function makeCtx(base: Pick<Ctx, 'data' | 'settings' | 'races' | 'totalTurns' | 'trainee'> & Partial<Ctx>): Ctx {
  return { raceWins: new Map(), lineage: new Map(), priority: [], ...base };
}
/** Everything already in play for the run: non-scenario sources per target, and which characters are present. */
export interface Existing { sources: Map<number, SkillSource[]>; chars: Set<number>; cards: Card[] }
const lineageN = (ctx: Ctx, t: Target) => { const l = ctx.lineage.get(t.id); return l ? lineageCount(l) : 0; };
const cloneExisting = (e: Existing): Existing => ({ sources: new Map([...e.sources].map(([k, v]) => [k, v.slice()])), chars: new Set(e.chars), cards: e.cards.slice() });
function addTo(e: Existing, add: Map<number, SkillSource[]>, card: Card): Existing {
  const out = cloneExisting(e);
  for (const [t, ss] of add) out.sources.set(t, [...(out.sources.get(t) ?? []), ...ss]);
  out.chars.add(card.charId);
  out.cards.push(card);
  return out;
}
/** Non-target choice-gated options in the run (scenario options and card event options) that could outrank a target in the prioritized list. */
function blockersOf(e: Existing, targets: Target[], ctx: Ctx): Blocker[] {
  const families = new Set(targets.flatMap((t) => [...t.familyIds]));
  const out: Blocker[] = [];
  for (const o of scenarioOptions(ctx.data, ctx.settings, e.chars)) if (!families.has(o.skillId)) out.push({ skillId: o.skillId, event: o.event });
  for (const card of e.cards) for (const s of eventSources(card, ctx.settings)) if (isChoiceSource(s) && !families.has(s.skillId)) out.push({ skillId: s.skillId, event: s.event });
  if (ctx.trainee) for (const s of traineeEventSources(ctx.trainee, ctx.raceWins, ctx.settings)) if (isChoiceSource(s) && !families.has(s.skillId)) out.push({ skillId: s.skillId, event: s.event });
  return out;
}

/**
 * Evaluate a run state: add the scenario options implied by the characters present, enforce one option per event
 * (by prioritized order), and give each target's spark chance.
 */
export function evaluate(e: Existing, targets: Target[], ctx: Ctx): { full: Map<number, SkillSource[]>; map: Map<number, SkillSource[]>; sparks: Map<number, number>; conflicts: Conflict[] } {
  const full = new Map<number, SkillSource[]>();
  for (const t of targets) full.set(t.id, [...(e.sources.get(t.id) ?? []), ...scenarioSources(t, ctx.data, ctx.settings, e.chars)]);
  const { map, conflicts } = pruneConflicts(full, ctx.priority, blockersOf(e, targets, ctx));
  const sparks = new Map(targets.map((t) => [t.id, sparkChance(combineSources(map.get(t.id) ?? []), ctx.settings, lineageN(ctx, t))]));
  return { full, map, sparks, conflicts };
}
const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export interface Coverage { target: Target; sources: SkillSource[]; own: Ownership; spark: number; marginal: number }
export interface CardScore {
  card: Card;
  lb: number;
  stats: number[];      // contribution at the chosen race count
  sp: number;
  statPower: number;    // sum of stat contribution
  source: Contribution['source'];
  runs?: number;
  coverage: Coverage[];
  sparkValue: number;   // Σ spark chance over targets (card alone)
  marginalValue: number; // Σ spark gain over what is already covered
  score: number;
  borrowed?: boolean;    // this slot is the friend's card, assumed at LB4
  mine: Map<number, SkillSource[]>; // the card's own non-scenario sources per target
}

export function traineeCoverage(targets: Target[], ctx: Ctx): Existing {
  const sources = new Map<number, SkillSource[]>();
  for (const t of targets) sources.set(t.id, [
    ...(ctx.trainee ? traineeSources(ctx.trainee, t, ctx.data, ctx.settings, ctx.raceWins) : []),
    ...lineageSources(t, ctx.lineage.get(t.id), ctx.settings),
  ]);
  return { sources, chars: new Set(ctx.trainee ? [ctx.trainee.charId] : []), cards: [] };
}

export function scoreCard(card: Card, lb: number, targets: Target[], existing: Existing, ctx: Ctx): CardScore {
  const contrib = cardContribution(card, lb, ctx.data.model);
  const scale = raceScale(ctx.races, ctx.data.model, ctx.settings);
  const stats = contrib.stats.map((v) => v * scale);
  const mine = new Map<number, SkillSource[]>();
  for (const t of targets) {
    const sources = cardSourcesForTarget(card, lb, t, ctx.races, ctx.totalTurns, ctx.data, ctx.settings);
    if (sources.length) mine.set(t.id, sources);
  }
  const alone = evaluate({ sources: mine, chars: new Set([card.charId]), cards: [card] }, targets, ctx);
  const before = evaluate(existing, targets, ctx);
  const after = evaluate(addTo(existing, mine, card), targets, ctx);
  const coverage: Coverage[] = [];
  let sparkValue = 0, marginalValue = 0;
  for (const t of targets) {
    const sources = alone.map.get(t.id) ?? [];
    if (!sources.length) continue;
    const spark = alone.sparks.get(t.id) ?? 0;
    const marginal = Math.max(0, (after.sparks.get(t.id) ?? 0) - (before.sparks.get(t.id) ?? 0));
    coverage.push({ target: t, sources, own: combineSources(sources), spark, marginal });
    sparkValue += spark;
    marginalValue += marginal;
  }
  const statPower = stats.reduce((a, b) => a + b, 0);
  return { card, lb, stats, sp: contrib.sp * scale, statPower, source: contrib.source, runs: contrib.runs, coverage, sparkValue, marginalValue, score: marginalValue, mine };
}

const cmp = (a: CardScore, b: CardScore) => (b.marginalValue - a.marginalValue) || (b.statPower - a.statPower) || (b.sp - a.sp);

export function rankCards(pool: { card: Card; lb: number }[], targets: Target[], existing: Existing, ctx: Ctx): CardScore[] {
  return pool.map((p) => scoreCard(p.card, p.lb, targets, existing, ctx)).sort(cmp);
}

/** The friend's card: `replaces` is set when it is the LB4 version of a card the deck had at a lower limit break. */
export interface BorrowOption { card: Card; replaces: Card | null; gain: number; statGain: number }
export interface DeckResult { deck: CardScore[]; steps: string[]; coverage: Map<number, SkillSource[]>; sparks: Map<number, number>; conflicts: Conflict[]; borrow: BorrowOption | null; borrowAlternatives: BorrowOption[] }

/** Run state for a set of cards on top of the trainee. */
function stateOf(entries: CardScore[], targets: Target[], ctx: Ctx): Existing {
  let e = traineeCoverage(targets, ctx);
  for (const x of entries) e = addTo(e, x.mine, x.card);
  return e;
}
/** Total expected sparks over the targets for a set of cards, plus their stat power. */
function deckValue(entries: CardScore[], targets: Target[], ctx: Ctx): { sparks: number; stats: number } {
  return { sparks: total(evaluate(stateOf(entries, targets, ctx), targets, ctx).sparks), stats: entries.reduce((a, e) => a + e.statPower, 0) };
}
const why = (cs: CardScore) => (cs.marginalValue > 0
  ? `+${(cs.marginalValue * 100).toFixed(1)}% expected sparks (${cs.coverage.filter((c) => c.marginal > 0).map((c) => c.target.name).join(', ')})`
  : `no uncovered targets left; best stat stick (+${cs.statPower.toFixed(0)} stats)`);

/**
 * Greedy deck. Pinned cards are a shortlist for the owned slots: they are scored against what is already covered
 * and taken best first, one per character, until the owned slots are full; unchosen pins are reported. The
 * friend's slot then takes the best card overall at the borrowed limit break, from every card in `borrowPool`.
 * Remaining owned slots fill from the rest of the pool. Finally, if a deck card's LB4 version would serve
 * better as the borrow than the borrow chosen (freeing that card's slot for the next best owned card), swap.
 */
export function buildDeck(pool: { card: Card; lb: number }[], targets: Target[], ctx: Ctx, pinnedIds: number[], size = DECK_SIZE, borrowPool: { card: Card; lb: number }[] = []): DeckResult {
  const ownedSlots = borrowPool.length ? size - BORROWED_SLOTS : size;
  let existing = traineeCoverage(targets, ctx);
  const deck: CardScore[] = [];
  const steps: string[] = [];
  const usedChars = new Set<number>();
  if (ctx.trainee) usedChars.add(ctx.trainee.charId);
  const ownedCount = () => deck.filter((d) => !d.borrowed).length;
  const add = (cs: CardScore, note: string) => {
    deck.push(cs); usedChars.add(cs.card.charId);
    existing = addTo(existing, cs.mine, cs.card);
    steps.push(`${cs.card.name} (LB${cs.lb})${cs.borrowed ? ', borrowed' : ''}: ${note}`);
  };
  const free = (p: { card: Card }) => !usedChars.has(p.card.charId);
  /** Best candidate by marginal spark gain, then stats, against the current deck. */
  const best = (cands: { card: Card; lb: number }[]) => cands.filter(free).map((p) => scoreCard(p.card, p.lb, targets, existing, ctx)).sort(cmp)[0];

  // 1. pins: the shortlist for the owned slots
  const pins = pinnedIds.map((id) => pool.find((x) => x.card.id === id)).filter((x): x is { card: Card; lb: number } => !!x);
  const chosenPins = new Set<number>();
  while (ownedCount() < ownedSlots) {
    const pick = best(pins.filter((p) => !chosenPins.has(p.card.id)));
    if (!pick) break;
    chosenPins.add(pick.card.id);
    add(pick, `pinned, ${why(pick)}`);
  }
  for (const p of pins) {
    if (chosenPins.has(p.card.id)) continue;
    const same = deck.find((d) => d.card.charId === p.card.charId);
    steps.push(`${p.card.name} (LB${p.lb}): pinned but not chosen, ${same ? `same character as ${same.card.name}` : `lower added spark chance than the ${ownedSlots} chosen`}`);
  }

  // 2. the friend's card: best overall against the pins
  let borrow: BorrowOption | null = null;
  const alternatives: BorrowOption[] = [];
  if (borrowPool.length && deck.length + 1 <= size) {
    const ranked = borrowPool.filter(free).map((p) => scoreCard(p.card, p.lb, targets, existing, ctx)).sort(cmp);
    const top = ranked[0];
    if (top) {
      add({ ...top, borrowed: true }, why(top));
      borrow = { card: top.card, replaces: null, gain: top.marginalValue, statGain: top.statPower };
      for (const r of ranked.slice(1, 6)) alternatives.push({ card: r.card, replaces: null, gain: r.marginalValue, statGain: r.statPower });
    }
  }

  // 3. fill the owned slots left from the rest of the pool
  while (ownedCount() < ownedSlots) {
    const pick = best(pool.filter((p) => !chosenPins.has(p.card.id)));
    if (!pick) break;
    add(pick, why(pick));
  }

  // 4. upgrade: a deck card's higher-LB version as the borrow instead (replacing the borrow, if any), its slot refilled
  if (borrowPool.length) {
    const base = deckValue(deck, targets, ctx);
    let bestSwap: { entries: CardScore[]; opt: BorrowOption; value: { sparks: number; stats: number }; from: CardScore; to: CardScore; refill: CardScore | undefined } | null = null;
    for (const d of deck) {
      if (d.borrowed) continue;
      const up = borrowPool.find((b) => b.card.id === d.card.id && b.lb > d.lb);
      if (!up) continue;
      const without = deck.filter((x) => x !== d && !x.borrowed);
      const used = new Set(without.map((x) => x.card.charId).concat(ctx.trainee ? [ctx.trainee.charId] : []));
      const stateNow = stateOf(without, targets, ctx);
      const upScore = { ...scoreCard(up.card, up.lb, targets, stateNow, ctx), borrowed: true };
      const after = addTo(stateNow, upScore.mine, up.card);
      used.add(up.card.charId);
      const refill = pool.filter((p) => !used.has(p.card.charId)).map((p) => scoreCard(p.card, p.lb, targets, after, ctx)).sort(cmp)[0];
      const entries = [...without, upScore, ...(refill ? [refill] : [])];
      const value = deckValue(entries, targets, ctx);
      if (value.sparks > base.sparks + 1e-9 || (Math.abs(value.sparks - base.sparks) <= 1e-9 && value.stats > base.stats)) {
        if (!bestSwap || value.sparks > bestSwap.value.sparks || (value.sparks === bestSwap.value.sparks && value.stats > bestSwap.value.stats)) {
          bestSwap = { entries, value, from: d, to: upScore, refill, opt: { card: up.card, replaces: d.card, gain: value.sparks - base.sparks, statGain: value.stats - base.stats } };
        }
      }
    }
    if (bestSwap) {
      steps.push(`Borrow ${bestSwap.to.card.name} (LB${bestSwap.to.lb}) instead of your own copy at LB${bestSwap.from.lb}, which frees a slot${bestSwap.refill ? ` for ${bestSwap.refill.card.name}` : ''}: +${(bestSwap.opt.gain * 100).toFixed(1)}% expected sparks`);
      deck.splice(0, deck.length, ...bestSwap.entries);
      borrow = bestSwap.opt;
    }
  }

  const { map: coverage, sparks, conflicts } = evaluate(stateOf(deck, targets, ctx), targets, ctx);
  return { deck, steps, coverage, sparks, conflicts, borrow, borrowAlternatives: alternatives };
}

export interface WishlistEntry { key: number; skillId: number; name: string; form: string | null; gated: boolean; isTarget: boolean; reason: string; weight: number }

/**
 * Candidates for the prioritized-skills list, best first: targets gated behind an event choice, then other
 * choice-gated skills the deck's events offer, then targets given without a choice (fillers).
 */
export function wishlistCandidates(deck: CardScore[], targets: Target[], ctx: Ctx): WishlistEntry[] {
  const entries: WishlistEntry[] = [];
  const seen = new Set<number>();
  const targetFamilies = new Set(targets.flatMap((t) => [...t.familyIds]));
  const ev = evaluate(stateOf(deck, targets, ctx), targets, ctx);
  for (const t of targets) {
    // every option the run could pick, including ones currently losing a conflict, so the order can be changed
    const all = (ev.full.get(t.id) ?? []).filter((s) => s.kind !== 'lineage' && s.kind !== 'innate' && s.kind !== 'awakening');
    if (!all.length) continue;
    const choice = all.filter((s) => s.isChoice);
    const spark = ev.sparks.get(t.id) ?? 0;
    if (choice.length) {
      // one entry per distinct skill the run can choose: the gold form and the white form are different picks
      const bySkill = new Map<number, SkillSource[]>();
      for (const s of choice) bySkill.set(s.skillId, [...(bySkill.get(s.skillId) ?? []), s]);
      for (const [skillId, srcs] of [...bySkill].sort((a, b) => Number(!!b[1][0]?.gold) - Number(!!a[1][0]?.gold))) {
        const sk = ctx.data.skillById.get(skillId);
        const gold = !!srcs[0]?.gold;
        entries.push({ key: skillId, skillId, name: sk?.name ?? t.name, form: sk && sk.id !== (t.white?.id ?? t.id) ? t.name : null, gated: true, isTarget: true,
          weight: 2 + spark + (gold ? 0.5 : 0), reason: srcs.map((s) => `${s.cardName ? s.cardName + ': ' : ''}${s.detail}`).join('; ') });
        seen.add(skillId);
      }
    } else {
      const src = all.find((s) => s.gold) ?? all[0]!;
      const sk = ctx.data.skillById.get(src.skillId);
      entries.push({ key: src.skillId, skillId: src.skillId, name: sk?.name ?? t.name, form: sk && sk.id !== (t.white?.id ?? t.id) ? t.name : null, gated: false, isTarget: true, weight: spark, reason: 'Given without an event choice.' });
      seen.add(src.skillId);
    }
  }
  // The scenario's own options happen every run whoever is in the deck: list the ones that are not targets too.
  const state = stateOf(deck, targets, ctx);
  for (const o of scenarioOptions(ctx.data, ctx.settings, state.chars)) {
    if (seen.has(o.skillId) || targetFamilies.has(o.skillId)) continue;
    const sk = ctx.data.skillById.get(o.skillId);
    if (!sk || sk.unreleasedEn) continue;
    seen.add(o.skillId);
    entries.push({ key: o.skillId, skillId: o.skillId, name: sk.name, form: null, gated: true, isTarget: false, weight: 1 + 0.5 * ctx.settings.scenarioPickRate * (sk.rarity === 2 ? 1.2 : 1), reason: o.detail });
  }
  // Other choice-gated skills from the deck's and the trainee's events (not targets): listing them steers the AI to that option.
  const offered = [...deck.map((d) => ({ owner: d.card.name, sources: eventSources(d.card, ctx.settings) })), ...(ctx.trainee ? [{ owner: ctx.trainee.name, sources: traineeEventSources(ctx.trainee, ctx.raceWins, ctx.settings) }] : [])];
  for (const { owner, sources } of offered) {
    for (const src of sources) {
      if (!src.isChoice || seen.has(src.skillId) || targetFamilies.has(src.skillId)) continue;
      const sk = ctx.data.skillById.get(src.skillId);
      if (!sk || sk.unreleasedEn) continue;
      seen.add(src.skillId);
      entries.push({ key: src.skillId, skillId: src.skillId, name: sk.name, form: null, gated: true, isTarget: false, weight: 1 + 0.5 * src.pObtain * (sk.rarity === 2 ? 1.2 : 1), reason: `${owner}: ${src.detail}` });
    }
  }
  return entries.sort((a, b) => b.weight - a.weight);
}

/** Up to 10 prioritized skills in the default order. */
export function wishlist(deck: CardScore[], targets: Target[], ctx: Ctx, max = PRIORITIZED_SKILLS_MAX): WishlistEntry[] {
  return wishlistCandidates(deck, targets, ctx).slice(0, max);
}
