import type { Card, CardEvent, Character, Data, EventCondition, RaceRef, Reward, Skill, TraineeEvent } from '../types.ts';
import { DEFAULT_SETTINGS, type Settings } from '../settings.ts';
import { EFFECT, passives } from './stats.ts';
import type { RaceWins } from './races.ts';
import { GOLD_ROLL_BY_STAT, INSPIRATION_EVENTS, LINEAGE_MAX_PER_SIDE, SCENARIO_COMPLETION_SKILLS, STARS_PER_SPARK_MAX } from './rules.ts';
import { affinityMultiplier } from './inherit.ts';

/** A target as the user picked it, resolved to its skill family. */
export interface Target {
  id: number;            // the family id: the white form's skill id when there is one
  name: string;
  white: Skill | null;   // normal-rarity base form, which may or may not have a ○ suffix
  circle: Skill | null;  // actual ◎ family member, if one exists; purchasable without a separate hint
  gold: Skill | null;    // gold upgrade
  familyIds: Set<number>;
}
export const hasWhiteSpark = (target: Target): boolean => !!target.white && !target.white.unreleasedEn;

const isGold = (s: Skill) => s.rarity === 2;
const isCircle = (s: Skill) => s.rarity === 1 && s.name.includes('◎');
/**
 * A debuff: a × form or a negative event skill (Gatekept, Wallflower, …). GameTora's icon ids end in 4 for both.
 * The game gives them at events and never sells them, so one is neither a target form nor a purchase.
 */
export const isDebuff = (s: Skill) => s.rarity === 1 && (s.name.includes('×') || (s.iconId ?? 0) % 10 === 4);

/** Build the family (white, ◎, gold) for any member skill id. */
export function resolveTarget(id: number, data: Data): Target | null {
  const s = data.skillById.get(id);
  if (!s) return null;
  // GameTora lists a debuff among the versions of its positive counterpart (Gatekept with Focus and Concentration).
  // It is its own family: nothing upgrades it, and it cannot supply or be supplied by the counterpart.
  if (isDebuff(s)) return { id: s.id, name: s.name, white: s, circle: null, gold: null, familyIds: new Set([s.id]) };
  const members = [s, ...s.versions.map((v) => data.skillById.get(v)).filter((x): x is Skill => !!x)];
  const gold = members.find(isGold) ?? null;
  const circle = members.find(isCircle) ?? null;
  const white = members.find((m) => m.rarity === 1 && !isCircle(m) && !isDebuff(m)) ?? (s.rarity === 1 ? s : null);
  const base = white ?? circle ?? gold ?? s;
  const familyIds = new Set(members.filter((m) => !isDebuff(m) && (m.rarity !== 1 || m.id === white?.id || m.id === circle?.id)).map((m) => m.id));
  const name = base.unreleasedEn && gold && !gold.unreleasedEn ? gold.name : base.name;
  return { id: base.id, name: name.replace(/ ○$/, ''), white, circle, gold, familyIds };
}

/** Which form of a skill a source hands over. */
export interface SkillForm { gold: boolean; circle: boolean }
export function formOf(id: number, data: Data): SkillForm {
  const s = data.skillById.get(id);
  return { gold: !!s && isGold(s), circle: !!s && isCircle(s) };
}

/** The event an event-backed source comes from. Sources sharing a key come from one event, of which one option is taken per run. */
export interface EventRef { key: string; label: string; option: string; optionIndex: number }
/** A stage of a card's chain (or a Pal card's dates): reaching stage k means every earlier stage happened too. */
export interface ChainRef { key: string; stage: number; pReach: number }

interface SourceBase extends SkillForm {
  skillId: number;
  pObtain: number;       // chance this source yields the skill during a run
  detail: string;        // where it comes from, e.g. 'Chain event 3 "We Walk Together"'
  cardName?: string;     // the support card providing it (absent for trainee sources)
}
/** A source that is not tied to an event choice. */
export interface PlainSource extends SourceBase { kind: 'hint' | 'innate' | 'awakening' | 'char-event' | 'lineage'; isChoice: false }
/** A source from a card event, one of the trainee's own events, or the scenario. Choice-gated when the skill comes from one option among several. */
export interface EventSource extends SourceBase { kind: CardEvent['kind'] | TraineeEvent['kind'] | 'scenario'; isChoice: boolean; event: EventRef; linkedCharId?: number; chain?: ChainRef; roll?: EventRoll }
export interface SkillReward extends SkillForm { skillId: number; share: number; rolled: boolean }
/** Equally likely outcomes contain independent reward draws; skills within each draw are exclusive. */
export interface EventRoll { pFire: number; outcomes: SkillReward[][][] }
export interface ResolvedEvent { event: EventRef; chain?: ChainRef; roll: EventRoll }
export type SkillSource = PlainSource | EventSource;
export type SourceKind = SkillSource['kind'];
/** Narrow to a choice-gated source, which always has its event. */
export const isChoiceSource = (s: SkillSource): s is EventSource & { isChoice: true } => s.isChoice;
export const isEventSource = (s: SkillSource): s is EventSource => 'event' in s;
/** The event key of an event-backed source, null for hints and trainee or lineage sources. */
export const eventKeyOf = (s: SkillSource): string | null => (isEventSource(s) ? s.event.key : null);

/** Expected number of hint events a card produces per run, from Hint Frequency. */
export function expectedHints(card: Card, lb: number, races: number, totalTurns: number, settings: Settings): number {
  const hf = passives(card, lb)[EFFECT.hintFreq] ?? 0;
  const turns = Math.max(0, totalTurns - races) * settings.hintTurnsShare;
  return turns * settings.hintBase * (1 + hf / 100) * settings.hintScale;
}

/** Chance a final chain event rolls the gold skill rather than its white form, at a stat of the card's type (mechanics document table). */
export function goldRollChance(stat: number): number {
  return (GOLD_ROLL_BY_STAT.find(([min]) => stat >= min) ?? GOLD_ROLL_BY_STAT[GOLD_ROLL_BY_STAT.length - 1])![1];
}

/**
 * Chance of each skill given one outcome of an event option. A skill listed several times in the outcome (GameTora
 * writes conditional branches into one list) counts once. A "random skill" reward that is a gold skill and its own
 * white form is the stat-gated gold roll; any other random list splits evenly.
 */
export function outcomeSkillShares(outcome: Reward[], data: Data, settings: Settings): Map<number, { share: number; rolled: boolean }> {
  const out = new Map<number, { share: number; rolled: boolean }>();
  const put = (id: number, share: number, rolled: boolean) => { const cur = out.get(id); if (!cur || cur.share < share) out.set(id, { share, rolled: rolled || !!cur?.rolled }); };
  for (const r of outcome) {
    if (r.t === 'sk' && typeof r.d === 'number') put(r.d, 1, false);
    if (r.t === 'sr' && Array.isArray(r.d)) {
      const ids = r.d.map((x) => x.d);
      const skills = ids.map((id) => data.skillById.get(id));
      const gi = skills.findIndex((s) => !!s && isGold(s));
      const pair = ids.length === 2 && gi >= 0 && !!skills[gi] && skills[gi]!.versions.includes(ids[1 - gi]!);
      if (pair) {
        const g = goldRollChance(settings.goldRollStat);
        put(ids[gi]!, g, true);
        put(ids[1 - gi]!, 1 - g, true);
      } else for (const id of ids) put(id, 1 / ids.length, false);
    }
  }
  return out;
}

/** Decode raw rewards once, before either estimator sees an event. Duplicate reward draws count once. */
export function decodeEventRoll(raw: { pFire: number; outcomes: Reward[][] }, data: Data, settings: Settings): EventRoll {
  return { pFire: raw.pFire, outcomes: raw.outcomes.map((outcome) => {
    const draws = new Map<string, SkillReward[]>();
    for (const reward of outcome) {
      const shares = [...outcomeSkillShares([reward], data, settings)].sort(([a], [b]) => a - b);
      if (shares.length) draws.set(JSON.stringify(shares), shares.map(([skillId, chance]) => ({ skillId, ...chance, ...formOf(skillId, data) })));
    }
    return [...draws.values()];
  }) };
}

/** Conditional chance of any matching skill, retaining both shared outcomes and independent draws. */
function rollChance(roll: EventRoll, matches: (reward: SkillReward) => boolean): number {
  return roll.outcomes.reduce((p, outcome) => p + (1 - outcome.reduce((miss, draw) =>
    miss * (1 - Math.min(1, draw.reduce((sum, reward) => sum + (matches(reward) ? reward.share : 0), 0))), 1)) / roll.outcomes.length, 0);
}

/** Resolve retained sources into the event outcomes shared by coverage and joint estimation.
 * Removing a reward leaves its probability as no skill; the remaining shares never renormalize.
 */
export function resolveEventSources(sources: EventSource[]): ResolvedEvent[] {
  const groups = new Map<string, EventSource[]>();
  for (const source of sources) {
    const key = `${source.event.key}#${source.event.optionIndex}`;
    const group = groups.get(key) ?? [];
    group.push(source); groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!, allowed = new Set(group.map((s) => s.skillId));
    let roll: EventRoll;
    if (first.roll) roll = { pFire: first.roll.pFire,
      outcomes: first.roll.outcomes.map((outcome) => outcome.map((draw) => draw.filter((reward) => allowed.has(reward.skillId)))) };
    else {
      // Completion rewards and undecoded events retain their existing exclusive marginal rates.
      const unique = [...new Map(group.map((s) => [s.skillId, s])).values()];
      const pFire = first.chain?.pReach ?? Math.min(1, unique.reduce((p, s) => p + s.pObtain, 0));
      roll = { pFire, outcomes: [[unique.map((s) => ({ skillId: s.skillId, gold: s.gold, circle: s.circle, rolled: false, share: pFire ? s.pObtain / pFire : 0 }))]] };
    }
    return { event: first.event, chain: first.chain, roll };
  });
}

const EVENT_LABEL: Record<CardEvent['kind'], string> = { chain: 'Chain event', random: 'Random event', recreation: 'Outing', special: 'Special event' };

/** Settings are edited in place, so the cache key must reflect their current values. */
const eventSettingsKeys = new WeakMap<Settings, { parts: (number | number[])[]; key: string }>();
function eventSettingsKey(s: Settings): string {
  const parts = [s.chainRatesSSR, s.chainRatesSR, s.randomEventRate, s.palChainRate, s.groupOutingRate, s.groupFinaleRate, s.specialEventRate, s.goldRollStat,
    s.charStoryEventRate, s.charOutingRate, s.charUndecodedEventRate, s.charConditionFallbackRate];
  const previous = eventSettingsKeys.get(s);
  if (previous && parts.every((part, i) => {
    const old = previous.parts[i];
    return Array.isArray(part) ? Array.isArray(old) && part.length === old.length && part.every((v, j) => v === old[j]) : part === old;
  })) return previous.key;
  const key = parts.flat().join(',');
  eventSettingsKeys.set(s, { parts: parts.map((part) => Array.isArray(part) ? [...part] : part), key });
  return key;
}
const eventSourceCache = new WeakMap<Card, { key: string; value: EventSource[] }>();

/** Skill sources from a card's events (form untagged), memoized per card and event settings. */
export function eventSources(card: Card, settings: Settings, data: Data): EventSource[] {
  const key = eventSettingsKey(settings);
  const hit = eventSourceCache.get(card);
  if (hit && hit.key === key) return hit.value;
  const value = computeEventSources(card, settings, data);
  eventSourceCache.set(card, { key, value });
  return value;
}

/**
 * Skill sources of one event that fires with chance `pFire`: one per skill per option, with the chance the option's
 * outcomes give that skill (outcomes are assumed equally likely; the game does not publish their odds). A skill
 * offered by only some of several options is choice-gated. `owner` names the card or trainee in labels,
 * `keyPrefix` groups the event's options under one key so that one option is taken per run.
 */
function scanEvent(ev: CardEvent | TraineeEvent, pFire: number, label: string, owner: string, keyPrefix: string, settings: Settings, data: Data, extra: Partial<EventSource> = {}): EventSource[] {
  const out: EventSource[] = [];
  const nChoices = ev.choices.length;
  const name = `${label} ${ev.index}${ev.name ? ` "${ev.name}"` : ''}`;
  const perChoice = ev.choices.map((choice) => {
    const nOut = choice.outcomes.length;
    const roll = decodeEventRoll({ pFire, outcomes: choice.outcomes }, data, settings);
    const perSkill = new Map<number, { p: number; rolled: boolean }>();
    for (const reward of roll.outcomes.flat(2)) {
      const cur = perSkill.get(reward.skillId);
      perSkill.set(reward.skillId, { p: cur?.p ?? rollChance(roll, (r) => r.skillId === reward.skillId), rolled: reward.rolled || !!cur?.rolled });
    }
    const flagged = choice.outcomes.flat().filter((reward) => reward.r).flatMap((reward) =>
      reward.t === 'sk' && typeof reward.d === 'number' ? [reward.d] : reward.t === 'sr' && Array.isArray(reward.d) ? reward.d.map((skill) => skill.d) : []);
    return { nOut, perSkill, roll, flagged };
  });
  perChoice.forEach(({ nOut, perSkill, roll, flagged }, ci) => {
    for (const [id, { p, rolled }] of perSkill) {
      const inAll = perChoice.every((c) => c.perSkill.has(id));
      const how = [nOut > 1 ? `one of ${nOut} outcomes` : '', rolled ? 'gold rolled against the white form' : '', flagged.includes(id) ? 'source reward flag not evaluated' : ''].filter(Boolean).join(', ');
      out.push({ kind: ev.kind, skillId: id, gold: false, circle: false, pObtain: pFire * p, isChoice: nChoices > 1 && !inAll,
        event: { key: `${keyPrefix}:${ev.kind}:${ev.index}`, label: `${owner}'s ${name.charAt(0).toLowerCase()}${name.slice(1)}`, option: `option ${ci + 1}`, optionIndex: ci },
        detail: `${name}${how ? ` (${how})` : ''}`, roll, ...extra });
    }
  });
  return out;
}

function computeEventSources(card: Card, settings: Settings, data: Data): EventSource[] {
  const out: EventSource[] = [];
  const chainRates = card.rarity === 'SSR' ? settings.chainRatesSSR : card.rarity === 'SR' ? settings.chainRatesSR : [];
  const scan = (ev: CardEvent, pFire: number, label: string, chain?: ChainRef) => out.push(...scanEvent(ev, pFire, label, card.name, String(card.id), settings, data, { cardName: card.name, ...(chain ? { chain } : {}) }));
  // chain stages are nested: stage k needs every stage before it
  card.chainEvents.forEach((ev) => { const pReach = chainRates[ev.index - 1] ?? 0; scan(ev, pReach, EVENT_LABEL.chain, { key: `${card.id}:chain`, stage: ev.index, pReach }); });
  const randomScale = Math.min(1, 2 / Math.max(1, card.randomEvents.length));
  card.randomEvents.forEach((ev) => scan(ev, settings.randomEventRate * randomScale, EVENT_LABEL.random));
  const nRec = card.recreationEvents.length;
  card.recreationEvents.forEach((ev) => {
    if (card.type === 'pal') { scan(ev, settings.palChainRate, 'Date', { key: `${card.id}:date`, stage: ev.index, pReach: settings.palChainRate }); return; }
    scan(ev, ev.index === nRec ? settings.groupFinaleRate : settings.groupOutingRate, ev.index === nRec ? 'Group finale' : 'Member outing');
  });
  card.specialEvents.forEach((ev) => scan(ev, settings.specialEventRate, EVENT_LABEL.special));
  return out;
}

/** All ways a card can give a skill from a target family. */
export function cardSourcesForTarget(card: Card, lb: number, target: Target, races: number, totalTurns: number, data: Data, settings: Settings): SkillSource[] {
  const out: SkillSource[] = [];
  const hintsInFamily = card.hintSkills.filter((id) => target.familyIds.has(id));
  if (hintsInFamily.length) {
    const eh = expectedHints(card, lb, races, totalTurns, settings);
    const pool = Math.max(1, card.hintSkills.length);
    // Poisson pickup counts split uniformly across skills. The mean is not a fixed number of draws.
    const pEach = -Math.expm1(-eh / pool);
    for (const id of hintsInFamily) out.push({ kind: 'hint', skillId: id, ...formOf(id, data), pObtain: pEach, isChoice: false, detail: `Hint (${eh.toFixed(1)} hints/run over ${pool} skills)`, cardName: card.name });
  }
  for (const src of eventSources(card, settings, data)) {
    if (target.familyIds.has(src.skillId)) out.push({ ...src, ...formOf(src.skillId, data) });
  }
  return out;
}

// ----- the trainee's own events -----

const winOf = (r: RaceRef, wins: RaceWins) => wins.get(r.year != null ? `${r.raceId}|${r.year}` : String(r.raceId)) ?? 0;
const scheduled = (r: RaceRef, wins: RaceWins) => wins.has(r.year != null ? `${r.raceId}|${r.year}` : String(r.raceId));
/** P(at least n of independent events with chances ps). */
function atLeast(n: number, ps: number[]): number {
  let dist = [1]; // dist[k] = P(exactly k so far)
  for (const p of ps) { const next = Array<number>(dist.length + 1).fill(0); dist.forEach((d, k) => { next[k]! += d * (1 - p); next[k + 1]! += d * p; }); dist = next; }
  return dist.slice(n).reduce((a, b) => a + b, 0);
}
/** Chance one secret-event condition is met, given the agenda's win chances. */
export function conditionChance(c: EventCondition, wins: RaceWins, settings: Settings): number {
  switch (c.type) {
    case 'win': return c.races.reduce((a, r) => a * winOf(r, wins), 1);
    case 'win_all': return c.races.reduce((a, r) => a * winOf(r, wins), 1);
    case 'win_any': return 1 - c.races.reduce((a, r) => a * (1 - winOf(r, wins)), 1);
    case 'win_n_of': return atLeast(c.n, c.races.map((r) => winOf(r, wins)));
    case 'participate': return scheduled(c.race, wins) ? 1 : 0;
    case 'do_not_participate': return scheduled(c.race, wins) ? 0 : 1;
    case 'date': return 1;
    case 'unknown': return settings.charConditionFallbackRate;
  }
}
const TRAINEE_EVENT_LABEL: Record<TraineeEvent['kind'], string> = { story: 'Story event', choice: 'Choice event', outing: 'Outing', secret: 'Secret event' };
/** Chance one of the trainee's events fires in a run, before any option choice. */
function traineeEventRate(ev: TraineeEvent, wins: RaceWins, settings: Settings): number {
  if (ev.kind === 'secret') return (ev.conditions ?? []).reduce((a, c) => a * conditionChance(c, wins, settings), 1);
  return ev.kind === 'outing' ? settings.charOutingRate : settings.charStoryEventRate;
}
const traineeSourceCache = new WeakMap<Character, { wins: RaceWins; key: string; value: EventSource[] }>();
/**
 * Every skill source from the trainee's own events (form untagged), given the agenda. Secret events are scored by
 * their race conditions. Memoized per trainee, agenda (by identity) and event settings: a deck build evaluates the
 * run state thousands of times and the trainee's events do not change within it.
 */
export function traineeEventSources(trainee: Character, wins: RaceWins, settings: Settings, data: Data): EventSource[] {
  const key = eventSettingsKey(settings);
  const hit = traineeSourceCache.get(trainee);
  if (hit && hit.wins === wins && hit.key === key) return hit.value;
  const value = computeTraineeEventSources(trainee, wins, settings, data);
  traineeSourceCache.set(trainee, { wins, key, value });
  return value;
}
function computeTraineeEventSources(trainee: Character, wins: RaceWins, settings: Settings, data: Data): EventSource[] {
  const out: EventSource[] = [];
  const offered = new Set<number>(); // every skill some event gives, whether or not it can fire under this agenda
  for (const ev of trainee.events) {
    for (const c of ev.choices) for (const o of c.outcomes) for (const id of outcomeSkillShares(o, data, settings).keys()) offered.add(id);
    const rate = traineeEventRate(ev, wins, settings);
    if (rate <= 0) continue;
    out.push(...scanEvent(ev, rate, TRAINEE_EVENT_LABEL[ev.kind], trainee.name, 'trainee', settings, data));
  }
  // skills GameTora lists for her events that no decoded event gives: usually an alternate outfit's own events, whose
  // page the tool has not fetched, so the trigger is unknown and a placeholder rate applies
  for (const id of trainee.eventSkills) if (!offered.has(id)) out.push({ kind: 'story', skillId: id, gold: false, circle: false, pObtain: settings.charUndecodedEventRate, isChoice: false, event: { key: `trainee:flat:${id}`, label: `${trainee.name}'s event`, option: '', optionIndex: 0 }, detail: 'Character event not decoded (listed for her events, trigger unknown)' });
  return out;
}

export function traineeSources(trainee: Character, target: Target, data: Data, settings: Settings, wins: RaceWins): SkillSource[] {
  const out: SkillSource[] = [];
  for (const id of trainee.innateSkills) if (target.familyIds.has(id)) out.push({ kind: 'innate', skillId: id, ...formOf(id, data), pObtain: 1, isChoice: false, detail: 'Innate skill' });
  for (const id of trainee.awakeningSkills) if (target.familyIds.has(id)) out.push({ kind: 'awakening', skillId: id, ...formOf(id, data), pObtain: 1, isChoice: false, detail: 'Awakening skill' });
  for (const src of traineeEventSources(trainee, wins, settings, data)) if (target.familyIds.has(src.skillId)) out.push({ ...src, ...formOf(src.skillId, data) });
  return out;
}

/** Existing copies of a target white spark in the lineage: per parent side, how many umas carry it and the star total. */
export interface Lineage { k1: number; p1: number; k2: number; p2: number }
export const NO_LINEAGE: Lineage = { k1: 0, k2: 0, p1: 0, p2: 0 };
export const lineageCount = (l: Lineage) => l.k1 + l.k2;

/** Split a parent side's stars over its copies of the spark as evenly as possible, at most STARS_PER_SPARK_MAX each. */
function spread(stars: number, k: number): number[] {
  const n = Math.max(0, Math.min(LINEAGE_MAX_PER_SIDE, k));
  if (n <= 0) return [];
  const out = Array<number>(n).fill(0);
  let left = Math.max(0, Math.min(STARS_PER_SPARK_MAX * n, Math.round(stars)));
  for (let i = 0; left > 0; i = (i + 1) % n) { out[i]! += 1; left -= 1; }
  return out.map((v) => Math.max(1, v));
}
/** The sparks on each parent side, by stars. */
export const lineageSparksBySide = (l: Lineage): [number[], number[]] => [spread(l.p1, l.k1), spread(l.p2, l.k2)];
export const lineageSparks = (l: Lineage): number[] => lineageSparksBySide(l).flat();

/** Inherited white sparks roll at each of the two inspiration events, at the assumed affinity, and hand over the white hint. */
export function lineageSources(target: Target, lineage: Lineage | undefined, settings: Settings): SkillSource[] {
  if (!hasWhiteSpark(target) || !lineage || lineageCount(lineage) <= 0) return [];
  let miss = 1;
  const parts: string[] = [];
  for (const stars of lineageSparks(lineage)) {
    const rate = settings.whiteSparkInheritRates[Math.max(0, Math.min(2, stars - 1))] ?? 0.03;
    const pOnce = Math.min(1, rate * affinityMultiplier(settings));
    miss *= Math.pow(1 - pOnce, INSPIRATION_EVENTS);
    parts.push(`${stars}★ ${pct1(pOnce)}/event`);
  }
  return [{ kind: 'lineage', skillId: target.white?.id ?? target.id, gold: false, circle: false, pObtain: 1 - miss, isChoice: false,
    detail: `Lineage: ${lineageCount(lineage)} spark${lineageCount(lineage) === 1 ? '' : 's'} (${parts.join(', ')}) over two inspiration events` }];
}
const pct1 = (x: number) => `${(x * 100).toFixed(0)}%`;

const SCENARIO_EVENT_LABEL = "Our Grand Concert's scenario skill event (Senior November)";
/**
 * An option of a scenario event with character-linked choices (Our Grand Concert's Senior November live). Given
 * the characters actually in the run (the trainee plus every deck card's character), each linked option yields
 * its gold skill when that character is present and its normal version otherwise; the unaffiliated option always
 * yields its rare hint. Only one option is taken per run, so every option is choice-gated under one event key.
 */
export interface ScenarioOption { skillId: number; event: EventRef; detail: string; linkedCharId?: number }

const scenarioOptionCache = new WeakMap<Data, Map<string, ScenarioOption[]>>();

/** Every option the scenario's linked events offer in a run with these characters present. Memoized per data set. */
export function scenarioOptions(data: Data, settings: Settings, present: Set<number>): ScenarioOption[] {
  const key = `${settings.scenarioId}|${[...present].sort((a, b) => a - b).join(',')}`;
  let perData = scenarioOptionCache.get(data);
  if (!perData) { perData = new Map(); scenarioOptionCache.set(data, perData); }
  const hit = perData.get(key);
  if (hit) return hit;
  const value = computeScenarioOptions(data, settings, present);
  perData.set(key, value);
  return value;
}

function computeScenarioOptions(data: Data, settings: Settings, present: Set<number>): ScenarioOption[] {
  const out: ScenarioOption[] = [];
  const charName = (id: number) => data.charById.get(id)?.name ?? 'linked character';
  for (const ev of data.scenarioEvents) {
    if (ev.scenarioId !== settings.scenarioId) continue;
    const key = `scenario:${ev.eventId}`;
    ev.choices.forEach((ch, optionIndex) => {
      if (ch.linkedCharId == null) {
        if (ch.skill != null) out.push({ skillId: ch.skill, event: { key, label: SCENARIO_EVENT_LABEL, option: 'unaffiliated option', optionIndex }, detail: 'Scenario skill event, unaffiliated option' });
        return;
      }
      const here = present.has(ch.linkedCharId);
      const skill = here ? ch.goldSkill : ch.whiteSkill;
      if (skill == null) return;
      const name = charName(ch.linkedCharId);
      out.push({ skillId: skill, linkedCharId: ch.linkedCharId,
        event: { key, label: SCENARIO_EVENT_LABEL, option: here ? `${name}'s option, gold version because she is in the run` : `${name}'s option, normal version because she is not in the run`, optionIndex },
        detail: here ? `Scenario skill event, ${name}'s option (she is in the run)` : `Scenario skill event, ${name}'s option (she is not in the run)` });
    });
  }
  return out;
}

export function scenarioSources(target: Target, data: Data, settings: Settings, present: Set<number>): SkillSource[] {
  return scenarioOptions(data, settings, present).filter((o) => target.familyIds.has(o.skillId))
    .map((o) => ({ kind: 'scenario' as const, skillId: o.skillId, ...formOf(o.skillId, data), pObtain: settings.scenarioPickRate, isChoice: true, event: o.event, detail: o.detail, roll: decodeEventRoll({ pFire: settings.scenarioPickRate, outcomes: [[{ t: 'sk', d: o.skillId }]] }, data, settings), ...(o.linkedCharId != null ? { linkedCharId: o.linkedCharId } : {}) }));
}

/**
 * The scenario's completion reward: Our Grand Concert gives the gold skill for 18 or more songs learned by late
 * December of the Senior year and the white one otherwise. The two are one outcome roll, not two independent sources.
 */
export function scenarioCompletionSources(target: Target, data: Data, settings: Settings): SkillSource[] {
  const spec = SCENARIO_COMPLETION_SKILLS[settings.scenarioId];
  if (!spec) return [];
  const event: EventRef = { key: `scenario:${settings.scenarioId}:completion`, label: "Our Grand Concert's completion reward", option: '', optionIndex: 0 };
  const out: SkillSource[] = [];
  const p = settings.scenarioSongsRate;
  if (target.familyIds.has(spec.gold) && data.skillById.has(spec.gold)) out.push({ kind: 'scenario', skillId: spec.gold, ...formOf(spec.gold, data), pObtain: p, isChoice: false, event, detail: `Scenario completion (${spec.songsForGold} or more songs learned)` });
  if (target.familyIds.has(spec.white) && data.skillById.has(spec.white)) out.push({ kind: 'scenario', skillId: spec.white, ...formOf(spec.white, data), pObtain: 1 - p, isChoice: false, event, detail: `Scenario completion (fewer than ${spec.songsForGold} songs learned)` });
  return out;
}

/** One option of a contested event: the skill it gives, and the target it serves (null for a non-target option). */
export interface ConflictOption { skillId: number; option: string; target: number | null }
/** An event whose single choice cost a target its sources: the option taken, by prioritized order, and the targets given up. */
export interface Conflict { eventKey: string; label: string; taken: ConflictOption; dropped: ConflictOption[] }
/** A choice-gated option that is not a target but sits in the prioritized list: if ranked above the targets sharing its event, it takes the event. */
export interface Blocker { skillId: number; event: EventRef }

/** The source that names an option for a target: its gold form first, then the highest chance. */
const bestSource = (ss: EventSource[]) => ss.slice().sort((a, b) => Number(b.gold) - Number(a.gold) || b.pObtain - a.pObtain)[0]!;
/**
 * The option of an event that serves a target best: the one whose sources, combined, give the target the highest
 * spark chance, so an option offering the gold form and a white fallback beats one offering the gold form alone.
 */
function bestOption(ss: EventSource[], settings: Settings, target?: Target): EventSource {
  const byOption = new Map<number, EventSource[]>();
  for (const s of ss) byOption.set(s.event.optionIndex, [...(byOption.get(s.event.optionIndex) ?? []), s]);
  let best: { value: number; source: EventSource } | null = null;
  for (const [, sources] of [...byOption].sort((a, b) => a[0] - b[0])) {
    const hints = combineSources(sources);
    const value = sparkChance(target ? purchasedOwnership(target, hints) : hints, settings);
    if (!best || value > best.value + 1e-12) best = { value, source: bestSource(sources) };
  }
  return best!.source;
}

/**
 * One event yields one option. For every event some target's sources come from, take the option the run would pick:
 * a non-target skill listed above every target on that event (a blocker) wins it, else the listed target whose skills
 * come first in `priority` (skill ids in prioritized order, every form of a family ranked together) takes the option
 * worth the most to it. An event no listed skill is offered by steers nothing: only rewards that require no choice survive.
 * A null `priority` means every target is listed, for contexts that have no list yet. An empty list steers nothing.
 * Every target keeps only its sources on the taken option, so a target offered by two options counts one of them,
 * and an option that gives two targets keeps both. `settings` gives the spark rates the options are valued by.
 */
export function pruneConflicts(map: Map<number, SkillSource[]>, priority: number[] | null, blockers: Blocker[] = [], settings: Settings = DEFAULT_SETTINGS, targets: Target[] = []): { map: Map<number, SkillSource[]>; conflicts: Conflict[] } {
  const byEvent = new Map<string, Set<number>>();
  for (const [tid, sources] of map) for (const s of sources) if (isEventSource(s)) byEvent.set(s.event.key, new Set([...(byEvent.get(s.event.key) ?? []), tid]));
  const everyoneListed = priority === null;
  const rank = (skillId: number) => { const i = priority?.indexOf(skillId) ?? -1; return i < 0 ? Infinity : i; };
  const taken = new Map<string, number>();
  const unsteered = new Set<string>();
  const conflicts: Conflict[] = [];
  for (const [key, tids] of byEvent) {
    const sourcesFor = (tid: number) => (map.get(tid) ?? []).filter((s): s is EventSource => isEventSource(s) && s.event.key === key);
    const ordered = [...tids].sort((a, b) => rank(a) - rank(b) || a - b);
    const top = ordered[0]!;
    const label = sourcesFor(top)[0]?.event.label ?? key;
    const blocker = blockers.filter((b) => b.event.key === key && rank(b.skillId) < rank(top)).sort((a, b) => rank(a.skillId) - rank(b.skillId))[0];
    let chosen = -1, takenOption: ConflictOption | null = null;
    if (blocker) { chosen = blocker.event.optionIndex; takenOption = { skillId: blocker.skillId, option: blocker.event.option, target: null }; }
    else if (everyoneListed || rank(top) < Infinity) { const best = bestOption(sourcesFor(top), settings, targets.find((t) => t.id === top)); chosen = best.event.optionIndex; takenOption = { skillId: best.skillId, option: best.event.option, target: top }; }
    if (chosen < 0) {
      unsteered.add(key);
      // A reward offered without a choice still happens. Retain one option so shared rolls stay correlated.
      const automatic = ordered.flatMap(sourcesFor).filter((s) => !s.isChoice);
      if (automatic.length) chosen = bestOption(automatic, settings).event.optionIndex;
    }
    taken.set(key, chosen);
    const dropped = ordered.filter((tid) => !sourcesFor(tid).some((s) => s.event.optionIndex === chosen)).map((tid) => { const s = bestSource(sourcesFor(tid)); return { skillId: s.skillId, option: s.event.option, target: tid }; });
    if (takenOption && (blocker || dropped.length)) conflicts.push({ eventKey: key, label: blocker?.event.label || label, taken: takenOption, dropped });
  }
  const out = new Map<number, SkillSource[]>();
  for (const [tid, sources] of map) out.set(tid, sources.filter((s) => !isEventSource(s) || (taken.get(s.event.key) === s.event.optionIndex && (!unsteered.has(s.event.key) || !s.isChoice))));
  return { map: out, conflicts };
}

/** Chance of owning the skill at run end in each form, gold > ◎ > white when several are possible. */
export interface Ownership { pGold: number; pCircle: number; pWhite: number; pAny: number }
/** Highest form the player can buy. Only families with a released ◎ member can upgrade without a separate hint. */
export function purchasedOwnership(target: Target, hints: Ownership): Ownership {
  if (!target.circle || target.circle.unreleasedEn) return { ...hints };
  return { ...hints, pCircle: hints.pCircle + hints.pWhite, pWhite: 0 };
}
interface Mass { any: number; goldOrCircle: number; gold: number }
const ZERO_MASS: Mass = { any: 0, goldOrCircle: 0, gold: 0 };
const massOf = (s: SkillSource, p: number): Mass => ({ any: p, goldOrCircle: s.gold || s.circle ? p : 0, gold: s.gold ? p : 0 });

/**
 * Combine a target's sources into ownership odds using resolved event outcomes. Chain stages are nested
 * (stage k implies every earlier stage), so a skill offered by several stages counts once per run.
 * Callers prune each event to its taken option first (`pruneConflicts`); options left unpruned combine as
 * independent groups, on a chain stage as much as on any other event.
 */
export function combineSources(sources: SkillSource[]): Ownership {
  const groups = new Map<string, Mass>();
  const chains = new Map<string, Map<number, { pReach: number; q: Mass }>>();
  let n = 0;
  for (const s of sources) if (!isEventSource(s)) groups.set(`plain:${n++}`, massOf(s, s.pObtain));
  for (const { event, chain, roll } of resolveEventSources(sources.filter(isEventSource))) {
    const q = { any: rollChance(roll, () => true), goldOrCircle: rollChance(roll, (s) => s.gold || s.circle), gold: rollChance(roll, (s) => s.gold) };
    if (chain) {
      const stages = chains.get(chain.key) ?? new Map<number, { pReach: number; q: Mass }>();
      const cur = stages.get(chain.stage)?.q ?? ZERO_MASS;
      stages.set(chain.stage, { pReach: chain.pReach, q: { any: 1 - (1 - cur.any) * (1 - q.any), goldOrCircle: 1 - (1 - cur.goldOrCircle) * (1 - q.goldOrCircle), gold: 1 - (1 - cur.gold) * (1 - q.gold) } });
      chains.set(chain.key, stages);
    } else groups.set(`${event.key}#${event.optionIndex}`, { any: roll.pFire * q.any, goldOrCircle: roll.pFire * q.goldOrCircle, gold: roll.pFire * q.gold });
  }
  for (const [key, stages] of chains) {
    const ordered = [...stages].sort((a, b) => a[0] - b[0]);
    const total: Mass = { any: 0, goldOrCircle: 0, gold: 0 };
    const miss = { any: 1, goldOrCircle: 1, gold: 1 };
    ordered.forEach(([, { pReach, q }], i) => {
      miss.any *= 1 - q.any; miss.goldOrCircle *= 1 - q.goldOrCircle; miss.gold *= 1 - q.gold;
      const deepest = Math.max(0, pReach - (ordered[i + 1]?.[1].pReach ?? 0)); // this is the last stage reached
      total.any += deepest * (1 - miss.any); total.goldOrCircle += deepest * (1 - miss.goldOrCircle); total.gold += deepest * (1 - miss.gold);
    });
    groups.set(`chain:${key}`, total);
  }
  let noAny = 1, noGoldOrCircle = 1, noGold = 1;
  for (const g of groups.values()) { noAny *= 1 - g.any; noGoldOrCircle *= 1 - g.goldOrCircle; noGold *= 1 - g.gold; }
  const pAny = 1 - noAny, pGold = 1 - noGold, pGoldOrCircle = 1 - noGoldOrCircle;
  return { pGold, pCircle: Math.max(0, pGoldOrCircle - pGold), pWhite: Math.max(0, pAny - pGoldOrCircle), pAny };
}

/** Expected spark probability for a target given ownership odds; each lineage occurrence multiplies it (base × 1.1^n). */
export function sparkChance(own: { pGold: number; pCircle?: number; pWhite: number }, settings: Settings, lineageN = 0): number {
  const mult = Math.pow(settings.lineageSparkMultiplier, Math.max(0, lineageN));
  return Math.min(1, (own.pGold * settings.goldSparkRate + (own.pCircle ?? 0) * settings.circleSparkRate + own.pWhite * settings.whiteSparkRate) * mult);
}
