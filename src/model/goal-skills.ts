import type { Data, Reward } from '../types.ts';
import type { Settings } from '../settings.ts';
import { outcomeSkillShares, hasWhiteSpark, isEventSource, type EventSource, type SkillSource, type Target } from './sparks.ts';

// Each digit records a family's best available form: none, white, circle, gold.
interface Distribution { states: Map<string, number>; approximate: boolean }
export interface FormDistribution { count: number; components: { indices: number[]; distribution: Distribution }[] }
/** Project shared outcomes without drawing a different sample for the displayed marginals. */
export function projectForms(forms: FormDistribution, selected: number[]): FormDistribution {
  const components: FormDistribution['components'] = [];
  for (const component of forms.components) {
    const members = selected.flatMap((index, next) => {
      const position = component.indices.indexOf(index);
      return position < 0 ? [] : [{ position, next }];
    });
    if (!members.length) continue;
    const states = new Map<string, number>();
    for (const [state, p] of component.distribution.states) {
      const projected = members.map((m) => state[m.position]).join('');
      states.set(projected, (states.get(projected) ?? 0) + p);
    }
    components.push({ indices: members.map((m) => m.next), distribution: { states, approximate: component.distribution.approximate } });
  }
  return { count: selected.length, components };
}
const MAX_STATES = 4096;
const MAX_COMBINATIONS = 65536;
const add = (d: Map<string, number>, state: string, p: number) => { if (p > 0) d.set(state, (d.get(state) ?? 0) + p); };
const fixed = (state: string): Distribution => ({ states: new Map([[state, 1]]), approximate: false });
const empty = (count: number) => fixed('0'.repeat(count));
const clamp = (p: number) => Math.max(0, Math.min(1, p));
const merge = (a: string, b: string) => Array.from(a, (form, i) => form > b[i]! ? form : b[i]!).join('');
function stateHash(state: string): number {
  let hash = 2166136261;
  for (let i = 0; i < state.length; i++) hash = Math.imul(hash ^ state.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ hash >>> 16, 0x85ebca6b);
  hash = Math.imul(hash ^ hash >>> 13, 0xc2b2ae35);
  return (hash ^ hash >>> 16) >>> 0;
}
function quantiles(d: Distribution, count: number): string[] {
  // Shuffle outcome order deterministically so digit order does not bias repeated resampling.
  const result: string[] = [], states = [...d.states].map(([state, p]) => ({ state, p, hash: stateHash(state) }))
    .sort((a, b) => a.hash - b.hash || a.state.localeCompare(b.state)).map(({ state, p }) => [state, p] as const);
  let i = 0, cumulative = states[0]![1];
  const mass = states.reduce((sum, [, p]) => sum + p, 0);
  for (let sample = 0; sample < count; sample++) {
    const q = (sample + .5) / count * mass;
    while (cumulative < q && i < states.length - 1) cumulative += states[++i]![1];
    result.push(states[i]![0]);
  }
  return result;
}
function bound(d: Distribution): Distribution {
  if (d.states.size <= MAX_STATES) return d;
  const states = new Map<string, number>();
  for (const state of quantiles(d, MAX_STATES)) add(states, state, 1 / MAX_STATES);
  return { states, approximate: true };
}
function combine(a: Distribution, b: Distribution): Distribution {
  const states = new Map<string, number>();
  if (a.states.size * b.states.size > MAX_COMBINATIONS) {
    const left = quantiles(a, MAX_STATES), right = quantiles(b, MAX_STATES);
    // A fixed permutation spreads the paired quantiles without introducing runtime randomness.
    for (let i = 0; i < MAX_STATES; i++) add(states, merge(left[i]!, right[(i * 1597) % MAX_STATES]!), 1 / MAX_STATES);
    return { states, approximate: true };
  }
  for (const [x, p] of a.states) for (const [y, q] of b.states) add(states, merge(x, y), p * q);
  return bound({ states, approximate: a.approximate || b.approximate });
}
function fires(d: Distribution, p: number, count: number): Distribution {
  const states = new Map([['0'.repeat(count), 1 - clamp(p)]]);
  for (const [state, mass] of d.states) add(states, state, mass * clamp(p));
  return { states, approximate: d.approximate };
}
function skillState(id: number, targets: Target[], data: Data): string {
  return targets.map((t) => {
    if (!hasWhiteSpark(t) || !t.familyIds.has(id)) return '0';
    const skill = data.skillById.get(id);
    return skill?.rarity === 2 ? '3' : (t.circle && !t.circle.unreleasedEn) || skill?.name.includes('◎') ? '2' : '1';
  }).join('');
}
function rewardsDistribution(rewards: Reward[], targets: Target[], data: Data, settings: Settings): Distribution {
  let dist = empty(targets.length);
  const seen = new Set<string>();
  for (const reward of rewards) {
    const shares = [...outcomeSkillShares([reward], data, settings)].sort(([a], [b]) => a - b);
    const key = JSON.stringify(shares);
    if (!shares.length || seen.has(key)) continue;
    seen.add(key);
    const states = new Map<string, number>();
    for (const [id, { share }] of shares) add(states, skillState(id, targets, data), share);
    dist = combine(dist, { states, approximate: false });
  }
  return dist;
}
function eventDistribution(sources: EventSource[], targets: Target[], data: Data, settings: Settings): { conditional: Distribution; pFire: number } {
  const first = sources[0]!;
  if (first.roll) {
    const states = new Map<string, number>();
    let approximate = false;
    for (const outcome of first.roll.outcomes) {
      const dist = rewardsDistribution(outcome, targets, data, settings);
      approximate ||= dist.approximate;
      for (const [state, p] of dist.states) add(states, state, p / first.roll.outcomes.length);
    }
    return { conditional: states.size ? bound({ states, approximate }) : empty(targets.length), pFire: first.roll.pFire };
  }
  // Scenario completion and undecoded individual events use their existing marginal source rates.
  const states = new Map<string, number>();
  const unique = [...new Map(sources.map((s) => [s.skillId, s])).values()];
  const pFire = first.chain?.pReach ?? Math.min(1, unique.reduce((a, s) => a + s.pObtain, 0));
  let total = 0;
  for (const s of unique) {
    const p = pFire ? s.pObtain / pFire : 0;
    add(states, skillState(s.skillId, targets, data), p); total += p;
  }
  add(states, '0'.repeat(targets.length), Math.max(0, 1 - total));
  return { conditional: { states, approximate: false }, pFire };
}
function componentForms(targets: Target[], coverage: Map<number, SkillSource[]>, data: Data, settings: Settings): Distribution {
  const events = new Map<string, EventSource[]>();
  let dist = empty(targets.length);
  for (const t of targets) for (const s of coverage.get(t.id) ?? []) {
    if (isEventSource(s)) {
      const group = events.get(s.event.key) ?? [];
      group.push(s); events.set(s.event.key, group);
    } else dist = combine(dist, fires(fixed(skillState(s.skillId, targets, data)), s.pObtain, targets.length));
  }
  const chains = new Map<string, { stage: number; pReach: number; conditional: Distribution }[]>();
  for (const sources of events.values()) {
    const { conditional, pFire } = eventDistribution(sources, targets, data, settings);
    const chain = sources[0]!.chain;
    if (!chain) { dist = combine(dist, fires(conditional, pFire, targets.length)); continue; }
    const stages = chains.get(chain.key) ?? [];
    stages.push({ stage: chain.stage, pReach: clamp(chain.pReach), conditional }); chains.set(chain.key, stages);
  }
  for (const stages of chains.values()) {
    stages.sort((a, b) => a.stage - b.stage);
    for (let i = 1; i < stages.length; i++) stages[i]!.pReach = Math.min(stages[i]!.pReach, stages[i - 1]!.pReach);
    const states = new Map([['0'.repeat(targets.length), 1 - stages[0]!.pReach]]);
    let reached = empty(targets.length), approximate = false;
    stages.forEach((stage, i) => {
      reached = combine(reached, stage.conditional); approximate ||= reached.approximate;
      const deepest = stage.pReach - (stages[i + 1]?.pReach ?? 0);
      for (const [state, p] of reached.states) add(states, state, p * deepest);
    });
    dist = combine(dist, bound({ states, approximate }));
  }
  return dist;
}

/** Factor independent families before evaluating shared events and chains. There is no target-count limit. */
export function jointSkillForms(targets: Target[], coverage: Map<number, SkillSource[]>, data: Data, settings: Settings): FormDistribution {
  const parents = targets.map((_, i) => i), sourceOwner = new Map<string, number>();
  const root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]!));
  targets.forEach((target, i) => {
    for (const source of coverage.get(target.id) ?? []) {
      if (!isEventSource(source)) continue;
      for (const key of [`event:${source.event.key}`, ...(source.chain ? [`chain:${source.chain.key}`] : [])]) {
        const owner = sourceOwner.get(key);
        if (owner === undefined) sourceOwner.set(key, i); else parents[root(i)] = root(owner);
      }
    }
  });
  const groups = new Map<number, number[]>();
  targets.forEach((_, i) => { const key = root(i), group = groups.get(key) ?? []; group.push(i); groups.set(key, group); });
  return { count: targets.length, components: [...groups.values()].map((indices) => ({ indices, distribution: componentForms(indices.map((i) => targets[i]!), coverage, data, settings) })) };
}
export function whiteGenerationMoments(forms: FormDistribution, lineageCopies: number[], settings: Settings): { all: number; each: number[]; available: number[]; allAvailable: number; approximate: boolean } {
  const rates = [0, settings.whiteSparkRate, settings.circleSparkRate, settings.goldSparkRate];
  const each = Array<number>(forms.count).fill(0), available = [...each];
  let all = 1, allAvailable = 1, approximate = false;
  for (const { indices, distribution } of forms.components) {
    let generated = 0, obtained = 0;
    approximate ||= distribution.approximate;
    for (const [state, p] of distribution.states) {
      let joint = 1, complete = true;
      indices.forEach((index, i) => {
        const form = Number(state[i]), chance = clamp(rates[form]! * settings.lineageSparkMultiplier ** (lineageCopies[index] ?? 0));
        each[index]! += p * chance;
        if (form) available[index]! += p; else complete = false;
        joint *= chance;
      });
      generated += p * joint;
      if (complete) obtained += p;
    }
    all *= generated; allAvailable *= obtained;
  }
  return { all, each, available, allAvailable, approximate };
}

/** Joint generation for a subset, projected from the same shared event outcomes. */
export function subsetGeneration(forms: FormDistribution, copies: number[], selected: number[], settings: Settings): number {
  const wanted = new Set(selected), rates = [0, settings.whiteSparkRate, settings.circleSparkRate, settings.goldSparkRate];
  let probability = 1;
  for (const { indices, distribution } of forms.components) {
    const members = indices.flatMap((index, position) => wanted.has(index) ? [{ index, position }] : []);
    if (!members.length) continue;
    let sum = 0;
    for (const [state, mass] of distribution.states) {
      sum += mass * members.reduce((p, { index, position }) => p * clamp(rates[Number(state[position])]! * settings.lineageSparkMultiplier ** (copies[index] ?? 0)), 1);
    }
    probability *= sum;
  }
  return probability;
}
