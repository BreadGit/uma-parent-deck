import type { Card, Skill } from '../types.ts';
import { purchaseCoverage, type Ctx } from './deck.ts';
import { jointSkillForms, type FormDistribution } from './goal-skills.ts';
import { resolveTarget, type Target } from './sparks.ts';
import { skillScore } from './rank.ts';
import type { Aptitudes } from './races.ts';
import { SCENARIO_COMPLETION_SKILLS } from './rules.ts';

export const HINT_DISCOUNT_PERCENT = [0, 10, 20, 30, 35, 40] as const;
export const purchaseCost = (skill: Skill, hintLevel: number) => skill.cost === null ? Infinity : Math.floor(skill.cost * (100 - HINT_DISCOUNT_PERCENT[hintLevel]!) / 100);

export interface Purchases {
  targets: Target[];
  forms: FormDistribution;
  score: number;
  variance: number;
  spent: number;
  unverified: number[];
}

/** Required base skills first, then preferred bases, their upgrades, then rating per SP. */
export function buySkills(targets: Target[], available: string, budget: number, priority: number[], apt: Aptitudes, hintLevel: number, fullCost: ReadonlySet<number> = new Set()) {
  return purchasePolicy(targets, budget, priority, apt, hintLevel, fullCost)(available);
}

function purchasePolicy(targets: Target[], budget: number, priority: number[], apt: Aptitudes, hintLevel: number, fullCost: ReadonlySet<number>) {
  // Costs and ratings do not change between source outcomes. Precompute them once per deck.
  const options = targets.flatMap((t, i) => {
    const forms = [t.white, t.circle, t.gold];
    const family = forms.flatMap((skill, j) => {
      if (!skill || skill.unreleasedEn) return [];
      const total = forms.slice(0, j + 1).filter((s): s is Skill => !!s && !s.unreleasedEn)
        .reduce((sum, s) => sum + purchaseCost(s, fullCost.has(s.id) ? 0 : hintLevel), 0);
      return [{ i, form: j + 1, total, points: skillScore(skill, apt) }];
    });
    // Every sampled outcome uses the same marginal cost and rating for a given upgrade.
    return family.map((o) => {
      const costs = [0, 1, 2, 3].map((form) => o.total - (family.find((f) => f.form === form)?.total ?? 0));
      const ratios = costs.map((cost, form) => (o.points - (family.find((f) => f.form === form)?.points ?? 0)) / Math.max(1, cost));
      return { ...o, costs, ratios };
    });
  });
  const ordered = [...new Set(priority)].map((id) => targets.findIndex((t) => t.id === id)).filter((i) => i >= 0);
  const bases = ordered.map((i) => options.find((o) => o.i === i && o.form === 1));
  const upgrades = ordered.map((i) => options.filter((o) => o.i === i && o.form > 1).reverse());
  return (available: string) => {
    const availableForms = Array.from(available, Number);
    const bought = targets.map(() => 0), points = targets.map(() => 0);
    let remaining = Math.max(0, Math.floor(budget));
    const allowed = options.filter((o) => o.form <= availableForms[o.i]!);
    const canBuy = (o: typeof options[number]) => o.form <= availableForms[o.i]! && o.form > bought[o.i]! && o.costs[bought[o.i]!]! <= remaining;
    const buy = (o: typeof options[number]) => {
      remaining -= o.costs[bought[o.i]!]!; points[o.i] = o.points; bought[o.i] = o.form;
    };
    for (const o of bases) if (o && canBuy(o)) buy(o);
    for (const family of upgrades) for (const o of family) if (canBuy(o)) { buy(o); break; }
    // Greedy fill is a stated purchase policy, not a globally optimal score.
    while (true) {
      let best: typeof options[number] | undefined, bestRatio = 0;
      for (const o of allowed) {
        if (!canBuy(o)) continue;
        const ratio = o.ratios[bought[o.i]!]!;
        if (ratio > bestRatio) { best = o; bestRatio = ratio; }
      }
      if (!best) break;
      buy(best);
    }
    return { state: bought.join(''), score: points.reduce((sum, p) => sum + p, 0), spent: Math.max(0, Math.floor(budget)) - remaining };
  };
}

const quantileCache = new Map<string, number[]>();
/** Stratify every component, then shuffle independently so late dimensions stay balanced too. */
function quantiles(count: number, ids: number[]): number[] {
  let seed = 2166136261;
  for (const id of [...ids].sort((a, b) => a - b)) seed = Math.imul(seed ^ id, 16777619);
  const key = `${count}:${seed}`;
  const cached = quantileCache.get(key);
  if (cached) return cached;
  const random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const out = Array.from({ length: count }, (_, i) => (i + .5) / count);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  quantileCache.set(key, out);
  if (quantileCache.size > 256) quantileCache.delete(quantileCache.keys().next().value!);
  return out;
}

/** Preserve shared event outcomes before the SP budget couples otherwise independent families. */
export function budgetForms(targets: Target[], available: FormDistribution, budget: number, priority: number[], apt: Aptitudes, hintLevel: number, samples = 512, fullCost: ReadonlySet<number> = new Set()): Purchases {
  let outcomes = new Map<string, number>([['0'.repeat(targets.length), 1]]);
  let approximate = available.components.some((c) => c.distribution.approximate);
  const combinations = available.components.reduce((n, c) => n * c.distribution.states.size, 1);
  const merge = (state: string, part: string, indices: number[]) => { const out = [...state]; indices.forEach((i, j) => { out[i] = part[j]!; }); return out.join(''); };
  if (combinations <= Math.min(4096, samples)) {
    for (const component of available.components) {
      const next = new Map<string, number>();
      for (const [state, p] of outcomes) for (const [part, q] of component.distribution.states) next.set(merge(state, part, component.indices), p * q);
      outcomes = next;
    }
  } else {
    approximate = true;
    outcomes = new Map();
    const fixed = Array<string>(targets.length).fill('0');
    const components = available.components.flatMap((c) => {
      const states = [...c.distribution.states];
      if (states.length === 1) {
        c.indices.forEach((i, j) => { fixed[i] = states[0]![0][j]!; });
        return [];
      }
      return [{ indices: c.indices, states, quantiles: quantiles(samples, c.indices.map((i) => targets[i]!.id)) }];
    });
    for (let n = 1; n <= samples; n++) {
      const sampled = fixed.slice();
      for (const c of components) {
        const q = c.quantiles[n - 1]!;
        let cumulative = 0, selected = c.states[c.states.length - 1]![0];
        for (const [part, mass] of c.states) { cumulative += mass; if (q < cumulative) { selected = part; break; } }
        c.indices.forEach((i, j) => { sampled[i] = selected[j]!; });
      }
      const state = sampled.join('');
      outcomes.set(state, (outcomes.get(state) ?? 0) + 1 / samples);
    }
  }
  const states = new Map<string, number>();
  const buy = purchasePolicy(targets, budget, priority, apt, hintLevel, fullCost);
  let score = 0, second = 0, spent = 0;
  for (const [state, p] of outcomes) {
    const purchase = buy(state);
    states.set(purchase.state, (states.get(purchase.state) ?? 0) + p);
    score += purchase.score * p; second += purchase.score ** 2 * p; spent += purchase.spent * p;
  }
  return { targets, forms: { count: targets.length, components: [{ indices: targets.map((_, i) => i), distribution: { states, approximate } }] },
    score, variance: Math.max(0, second - score ** 2), spent,
    unverified: targets.flatMap((t, i) => [t.white, t.circle, t.gold].filter((s, form) => s && !s.unreleasedEn && s.rating === undefined && [...states].some(([state, p]) => p > 0 && Number(state[i]) === form + 1)).map((s) => s!.id)) };
}

export function estimatePurchases(deck: { card: Card; lb: number }[], ctx: Ctx, budget: number, priority: number[], apt: Aptitudes, samples = 512): Purchases {
  const completion = SCENARIO_COMPLETION_SKILLS[ctx.settings.scenarioId];
  const ids = [...priority, ...ctx.lineage.keys(), ...deck.flatMap(({ card }) => [...card.hintSkills, ...card.eventSkills]),
    ...(ctx.trainee ? [...ctx.trainee.innateSkills, ...ctx.trainee.awakeningSkills, ...ctx.trainee.eventSkills] : []),
    ...ctx.data.scenarioEvents.filter((e) => e.scenarioId === ctx.settings.scenarioId).flatMap((e) => e.choices.flatMap((c) => [c.skill, c.whiteSkill, c.goldSkill])),
    ...(completion ? [completion.white, completion.gold] : [])];
  const targets = [...new Map(ids.flatMap((id) => { const t = id === undefined ? null : resolveTarget(id, ctx.data); return t ? [[t.id, t] as const] : []; })).values()];
  const coverage = purchaseCoverage(deck, targets, ctx);
  return budgetForms(targets, jointSkillForms(targets, coverage, ctx.data), budget, priority, apt, ctx.settings.purchaseHintLevel, samples, new Set([...(ctx.trainee?.innateSkills ?? []), ...(ctx.trainee?.awakeningSkills ?? [])]));
}
