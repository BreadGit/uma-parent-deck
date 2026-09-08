import type { Data, Reward } from '../types.ts';
import type { Settings } from '../settings.ts';
import { goldRollChance, isEventSource, type EventSource, type SkillSource, type Target } from './sparks.ts';

// Two base-four digits record the best available form per required family: none, white, circle, gold.
export type FormDistribution = Map<number, number>;
const add = (d: FormDistribution, state: number, p: number) => { if (p > 0) d.set(state, (d.get(state) ?? 0) + p); };
const empty = (): FormDistribution => new Map([[0, 1]]);
const merge = (a: number, b: number) => Math.max(a % 4, b % 4) + 4 * Math.max(Math.floor(a / 4), Math.floor(b / 4));
function combine(a: FormDistribution, b: FormDistribution): FormDistribution {
  const out: FormDistribution = new Map();
  for (const [x, p] of a) for (const [y, q] of b) add(out, merge(x, y), p * q);
  return out;
}
const clamp = (p: number) => Math.max(0, Math.min(1, p));
function fires(d: FormDistribution, p: number): FormDistribution {
  const out = new Map([[0, 1 - clamp(p)]]);
  for (const [state, mass] of d) add(out, state, mass * clamp(p));
  return out;
}
function skillState(id: number, targets: Target[], data: Data): number {
  let state = 0;
  targets.forEach((t, i) => {
    if (!t.familyIds.has(id)) return;
    const skill = data.skillById.get(id);
    const form = skill?.rarity === 2 ? 3 : (t.circle && !t.circle.unreleasedEn) || skill?.name.includes('◎') ? 2 : 1;
    state += form * 4 ** i;
  });
  return state;
}

function rewardsDistribution(rewards: Reward[], targets: Target[], data: Data, settings: Settings): FormDistribution {
  let dist = empty();
  for (const reward of rewards) {
    if (reward.t === 'sk' && typeof reward.d === 'number') {
      dist = combine(dist, new Map([[skillState(reward.d, targets, data), 1]]));
    } else if (reward.t === 'sr' && Array.isArray(reward.d) && reward.d.length) {
      const ids = reward.d.map((r) => r.d);
      const gold = ids.find((id) => data.skillById.get(id)?.rarity === 2);
      const pair = ids.length === 2 && gold !== undefined && data.skillById.get(gold)!.versions.includes(ids.find((id) => id !== gold)!);
      const options: FormDistribution = new Map();
      for (const id of ids) add(options, skillState(id, targets, data), pair ? (id === gold ? goldRollChance(settings.goldRollStat) : 1 - goldRollChance(settings.goldRollStat)) : 1 / ids.length);
      dist = combine(dist, options);
    }
  }
  return dist;
}

function eventDistribution(sources: EventSource[], targets: Target[], data: Data, settings: Settings): { conditional: FormDistribution; pFire: number } {
  const first = sources[0]!;
  if (first.roll) {
    const dist: FormDistribution = new Map();
    for (const outcome of first.roll.outcomes) for (const [state, p] of rewardsDistribution(outcome, targets, data, settings)) add(dist, state, p / first.roll.outcomes.length);
    return { conditional: dist.size ? dist : empty(), pFire: first.roll.pFire };
  }
  // Scenario completion offers mutually exclusive gold/white rewards. Legacy synthetic sources use this path too.
  const dist: FormDistribution = new Map();
  const unique = [...new Map(sources.map((s) => [s.skillId, s])).values()];
  const pFire = first.chain?.pReach ?? Math.min(1, unique.reduce((a, s) => a + s.pObtain, 0));
  let total = 0;
  for (const s of unique) {
    const p = pFire ? s.pObtain / pFire : 0;
    add(dist, skillState(s.skillId, targets, data), p);
    total += p;
  }
  add(dist, 0, Math.max(0, 1 - total));
  return { conditional: dist, pFire };
}

/** Exact joint availability across shared events and chains; independent hint pickups remain an estimate. */
export function jointSkillForms(targets: Target[], coverage: Map<number, SkillSource[]>, data: Data, settings: Settings): FormDistribution {
  if (targets.length > 2) throw new Error('jointSkillForms supports at most two required families');
  const events = new Map<string, EventSource[]>();
  let dist = empty();
  for (const t of targets) for (const s of coverage.get(t.id) ?? []) {
    if (isEventSource(s)) {
      const group = events.get(s.event.key) ?? [];
      group.push(s); events.set(s.event.key, group);
    } else {
      dist = combine(dist, fires(new Map([[skillState(s.skillId, targets, data), 1]]), s.pObtain));
    }
  }
  const chains = new Map<string, { stage: number; pReach: number; conditional: FormDistribution }[]>();
  for (const sources of events.values()) {
    const { conditional, pFire } = eventDistribution(sources, targets, data, settings);
    const chain = sources[0]!.chain;
    if (!chain) { dist = combine(dist, fires(conditional, pFire)); continue; }
    const stages = chains.get(chain.key) ?? [];
    stages.push({ stage: chain.stage, pReach: clamp(chain.pReach), conditional });
    chains.set(chain.key, stages);
  }
  for (const stages of chains.values()) {
    stages.sort((a, b) => a.stage - b.stage);
    for (let i = 1; i < stages.length; i++) stages[i]!.pReach = Math.min(stages[i]!.pReach, stages[i - 1]!.pReach);
    const chainDist: FormDistribution = new Map([[0, 1 - stages[0]!.pReach]]);
    let reached = empty();
    stages.forEach((stage, i) => {
      reached = combine(reached, stage.conditional);
      const deepest = stage.pReach - (stages[i + 1]?.pReach ?? 0);
      for (const [state, p] of reached) add(chainDist, state, p * deepest);
    });
    dist = combine(dist, chainDist);
  }
  return dist;
}

export function whiteGenerationMoments(dist: FormDistribution, lineageCopies: number[], settings: Settings): { both: number; each: number[]; available: number[]; bothAvailable: number } {
  const rates = [0, settings.whiteSparkRate, settings.circleSparkRate, settings.goldSparkRate];
  const each = [0, 0], available = [0, 0];
  let both = 0, bothAvailable = 0;
  for (const [state, p] of dist) {
    const forms = [state % 4, Math.floor(state / 4)];
    const chances = forms.map((form, i) => clamp(rates[form]! * settings.lineageSparkMultiplier ** (lineageCopies[i] ?? 0)));
    forms.forEach((form, i) => { each[i]! += p * chances[i]!; available[i]! += form > 0 ? p : 0; });
    both += p * chances[0]! * chances[1]!;
    if (forms.every((form) => form > 0)) bothAvailable += p;
  }
  return { both, each, available, bothAvailable };
}
