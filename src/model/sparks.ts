import type { Card, CardEvent, Character, Data, EventCondition, RaceRef, Reward, Skill, TraineeEvent } from '../types.ts';
import type { Settings } from '../settings.ts';
import { EFFECT, passives } from './stats.ts';
import type { RaceWins } from './races.ts';
import { INSPIRATION_EVENTS, LINEAGE_MAX_PER_SIDE, STARS_PER_SPARK_MAX } from './rules.ts';

/** A target as the user picked it, resolved to its skill family. */
export interface Target {
  id: number;            // the family id: the white form's skill id when there is one
  name: string;
  white: Skill | null;   // white ○ form
  circle: Skill | null;  // ◎ form (only reachable through inheritance)
  gold: Skill | null;    // gold upgrade
  familyIds: Set<number>;
}

const isGold = (s: Skill) => s.rarity === 2;
const isCircle = (s: Skill) => s.rarity === 1 && s.name.includes('◎');
const isCross = (s: Skill) => s.rarity === 1 && s.name.includes('×');

/** Build the family (white, ◎, gold) for any member skill id. */
export function resolveTarget(id: number, data: Data): Target | null {
  const s = data.skillById.get(id);
  if (!s) return null;
  const members = [s, ...s.versions.map((v) => data.skillById.get(v)).filter((x): x is Skill => !!x)];
  const gold = members.find(isGold) ?? null;
  const circle = members.find(isCircle) ?? null;
  const white = members.find((m) => m.rarity === 1 && !isCircle(m) && !isCross(m)) ?? (s.rarity === 1 ? s : null);
  const familyIds = new Set(members.filter((m) => !isCross(m)).map((m) => m.id));
  const base = white ?? circle ?? gold ?? s;
  return { id: base.id, name: base.name.replace(/ ○$/, ''), white, circle, gold, familyIds };
}

/** Which form of a skill a source hands over. */
export interface SkillForm { gold: boolean; circle: boolean }
export function formOf(id: number, data: Data): SkillForm {
  const s = data.skillById.get(id);
  return { gold: !!s && isGold(s), circle: !!s && isCircle(s) };
}

/** The event an event-backed source comes from. Sources sharing a key come from one event, of which one option is taken per run. */
export interface EventRef { key: string; label: string; option: string }

interface SourceBase extends SkillForm {
  skillId: number;
  pObtain: number;       // chance this source yields the skill during a run
  detail: string;        // where it comes from, e.g. 'Chain event 3 "We Walk Together"'
  cardName?: string;     // the support card providing it (absent for trainee sources)
}
/** A source that is not tied to an event choice. */
export interface PlainSource extends SourceBase { kind: 'hint' | 'innate' | 'awakening' | 'char-event' | 'lineage'; isChoice: false }
/** A source from a card event, one of the trainee's own events, or the scenario's skill event. Choice-gated when the skill comes from one option among several. */
export interface EventSource extends SourceBase { kind: CardEvent['kind'] | TraineeEvent['kind'] | 'scenario'; isChoice: boolean; event: EventRef; linkedCharId?: number }
export type SkillSource = PlainSource | EventSource;
export type SourceKind = SkillSource['kind'];
/** Narrow to a choice-gated source, which always has its event. */
export const isChoiceSource = (s: SkillSource): s is EventSource & { isChoice: true } => s.isChoice;
/** The event key of an event-backed source, null for hints and trainee or lineage sources. */
export const eventKeyOf = (s: SkillSource): string | null => ('event' in s ? s.event.key : null);

/** Expected number of hint events a card produces per run, from Hint Frequency. */
export function expectedHints(card: Card, lb: number, races: number, totalTurns: number, settings: Settings): number {
  const hf = passives(card, lb)[EFFECT.hintFreq] ?? 0;
  const turns = Math.max(0, totalTurns - races) * settings.hintTurnsShare;
  return turns * settings.hintBase * (1 + hf / 100) * settings.hintScale;
}

function rewardSkills(rw: Reward[]): { id: number; share: number }[] {
  const out: { id: number; share: number }[] = [];
  for (const r of rw) {
    if (r.t === 'sk' && typeof r.d === 'number') out.push({ id: r.d, share: 1 });
    if (r.t === 'sr' && Array.isArray(r.d)) for (const x of r.d) out.push({ id: x.d, share: 1 / r.d.length });
  }
  return out;
}

const EVENT_LABEL: Record<CardEvent['kind'], string> = { chain: 'Chain event', random: 'Random event', recreation: 'Outing', special: 'Special event' };

/** The settings eventSources reads, as a cache key. */
const eventSettingsKey = (s: Settings) => [s.chainRatesSSR, s.chainRatesSR, s.randomEventRate, s.palChainRate, s.groupOutingRate, s.groupFinaleRate, s.specialEventRate, s.bigRewardRate].flat().join(',');
const eventSourceCache = new WeakMap<Card, { key: string; value: EventSource[] }>();

/** Skill sources from a card's events (form untagged), memoized per card and event settings. */
export function eventSources(card: Card, settings: Settings): EventSource[] {
  const key = eventSettingsKey(settings);
  const hit = eventSourceCache.get(card);
  if (hit && hit.key === key) return hit.value;
  const value = computeEventSources(card, settings);
  eventSourceCache.set(card, { key, value });
  return value;
}

/**
 * Skill sources of one event that fires with chance `pFire`: one per skill per option. A skill offered by only
 * some of several options is choice-gated. `owner` names the card or trainee in labels, `keyPrefix` groups the
 * event's options under one key for conflict resolution.
 */
function scanEvent(ev: CardEvent | TraineeEvent, pFire: number, label: string, owner: string, keyPrefix: string, settings: Settings, extra: Partial<EventSource> = {}): EventSource[] {
  const out: EventSource[] = [];
  const nChoices = ev.choices.length;
  const name = `${label} ${ev.index}${ev.name ? ` "${ev.name}"` : ''}`;
  ev.choices.forEach((choice, ci) => {
    const nOut = choice.outcomes.length;
    // Outcomes of one choice are mutually exclusive: add up the chance per skill across outcomes.
    const perSkill = new Map<number, { p: number; where: Set<string> }>();
    choice.outcomes.forEach((outcome, oi) => {
      const pOutcome = nOut === 1 ? 1 : oi === nOut - 1 ? settings.bigRewardRate : (1 - settings.bigRewardRate) / (nOut - 1);
      for (const { id, share } of rewardSkills(outcome)) {
        const cur = perSkill.get(id) ?? { p: 0, where: new Set<string>() };
        cur.p += pOutcome * share;
        if (nOut > 1) cur.where.add(oi === nOut - 1 ? 'big reward' : 'small reward');
        perSkill.set(id, cur);
      }
    });
    for (const [id, { p, where }] of perSkill) {
      const inAll = ev.choices.every((c) => c.outcomes.some((o) => rewardSkills(o).some((x) => x.id === id)));
      const both = where.size === 1 ? `, ${[...where][0]}` : '';
      out.push({ kind: ev.kind, skillId: id, gold: false, circle: false, pObtain: pFire * p, isChoice: nChoices > 1 && !inAll,
        event: { key: `${keyPrefix}:${ev.kind}:${ev.index}`, label: `${owner}'s ${name.charAt(0).toLowerCase()}${name.slice(1)}`, option: `option ${ci + 1}` },
        detail: `${name}${both}`, ...extra });
    }
  });
  return out;
}

function computeEventSources(card: Card, settings: Settings): EventSource[] {
  const out: EventSource[] = [];
  const chainRates = card.rarity === 'SSR' ? settings.chainRatesSSR : card.rarity === 'SR' ? settings.chainRatesSR : [];
  const scan = (ev: CardEvent, pFire: number, label: string) => out.push(...scanEvent(ev, pFire, label, card.name, String(card.id), settings, { cardName: card.name }));
  card.chainEvents.forEach((ev) => scan(ev, chainRates[ev.index - 1] ?? 0, EVENT_LABEL.chain));
  const randomScale = Math.min(1, 2 / Math.max(1, card.randomEvents.length));
  card.randomEvents.forEach((ev) => scan(ev, settings.randomEventRate * randomScale, EVENT_LABEL.random));
  const nRec = card.recreationEvents.length;
  card.recreationEvents.forEach((ev) => {
    const rate = card.type === 'pal' ? settings.palChainRate : ev.index === nRec ? settings.groupFinaleRate : settings.groupOutingRate;
    scan(ev, rate, card.type === 'pal' ? 'Date' : ev.index === nRec ? 'Group finale' : 'Member outing');
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
    // P(at least one hint for this skill) with hints drawn uniformly from the pool
    const pEach = 1 - Math.pow(1 - 1 / pool, eh);
    for (const id of hintsInFamily) out.push({ kind: 'hint', skillId: id, ...formOf(id, data), pObtain: pEach, isChoice: false, detail: `Hint (${eh.toFixed(1)} hints/run over ${pool} skills)`, cardName: card.name });
  }
  for (const src of eventSources(card, settings)) {
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
/** Every skill source from the trainee's own events (form untagged), given the agenda. Secret events are scored by their race conditions. */
export function traineeEventSources(trainee: Character, wins: RaceWins, settings: Settings): EventSource[] {
  const out: EventSource[] = [];
  const offered = new Set<number>(); // every skill some event gives, whether or not it can fire under this agenda
  for (const ev of trainee.events) {
    for (const c of ev.choices) for (const { id } of c.outcomes.flatMap(rewardSkills)) offered.add(id);
    const rate = traineeEventRate(ev, wins, settings);
    if (rate <= 0) continue;
    out.push(...scanEvent(ev, rate, TRAINEE_EVENT_LABEL[ev.kind], trainee.name, 'trainee', settings));
  }
  // skills GameTora lists for her events but no decoded event gives (a handful of characters): a plain source at the story rate
  for (const id of trainee.eventSkills) if (!offered.has(id)) out.push({ kind: 'story', skillId: id, gold: false, circle: false, pObtain: settings.charStoryEventRate, isChoice: false, event: { key: `trainee:flat:${id}`, label: `${trainee.name}'s event`, option: '' }, detail: 'Character event (not decoded)' });
  return out;
}

export function traineeSources(trainee: Character, target: Target, data: Data, settings: Settings, wins: RaceWins): SkillSource[] {
  const out: SkillSource[] = [];
  for (const id of trainee.innateSkills) if (target.familyIds.has(id)) out.push({ kind: 'innate', skillId: id, ...formOf(id, data), pObtain: 1, isChoice: false, detail: 'Innate skill' });
  for (const id of trainee.awakeningSkills) if (target.familyIds.has(id)) out.push({ kind: 'awakening', skillId: id, ...formOf(id, data), pObtain: 1, isChoice: false, detail: 'Awakening skill' });
  for (const src of traineeEventSources(trainee, wins, settings)) if (target.familyIds.has(src.skillId)) out.push({ ...src, ...formOf(src.skillId, data) });
  return out;
}

/** Existing copies of a target white spark in the lineage: per parent side, how many umas carry it and the star total. */
export interface Lineage { k1: number; p1: number; k2: number; p2: number }
export const NO_LINEAGE: Lineage = { k1: 0, k2: 0, p1: 0, p2: 0 };
export const lineageCount = (l: Lineage) => l.k1 + l.k2;

/** Split a parent side's stars over its copies of the spark as evenly as possible, at most STARS_PER_SPARK_MAX each. */
export function lineageSparks(l: Lineage): number[] {
  const k1 = Math.max(0, Math.min(LINEAGE_MAX_PER_SIDE, l.k1)), k2 = Math.max(0, Math.min(LINEAGE_MAX_PER_SIDE, l.k2));
  const spread = (stars: number, k: number) => {
    if (k <= 0) return [] as number[];
    const out = Array<number>(k).fill(0);
    let left = Math.max(0, Math.min(STARS_PER_SPARK_MAX * k, Math.round(stars)));
    for (let i = 0; left > 0; i = (i + 1) % k) { out[i]! += 1; left -= 1; }
    return out.map((v) => Math.max(1, v));
  };
  return [...spread(l.p1, k1), ...spread(l.p2, k2)];
}

/** Inherited white sparks roll at each of the two inspiration events and hand over the white hint. */
export function lineageSources(target: Target, lineage: Lineage | undefined, settings: Settings): SkillSource[] {
  if (!lineage || lineageCount(lineage) <= 0) return [];
  let miss = 1;
  const parts: string[] = [];
  for (const stars of lineageSparks(lineage)) {
    const rate = settings.whiteSparkInheritRates[Math.max(0, Math.min(2, stars - 1))] ?? 0.03;
    const pOnce = Math.min(1, rate * (1 + settings.affinity / 100));
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
    for (const ch of ev.choices) {
      if (ch.linkedCharId == null) {
        if (ch.skill != null) out.push({ skillId: ch.skill, event: { key, label: SCENARIO_EVENT_LABEL, option: 'unaffiliated option' }, detail: 'Scenario skill event, unaffiliated option' });
        continue;
      }
      const here = present.has(ch.linkedCharId);
      const skill = here ? ch.goldSkill : ch.whiteSkill;
      if (skill == null) continue;
      const name = charName(ch.linkedCharId);
      out.push({ skillId: skill, linkedCharId: ch.linkedCharId,
        event: { key, label: SCENARIO_EVENT_LABEL, option: here ? `${name}'s option, gold version because she is in the run` : `${name}'s option, normal version because she is not in the run` },
        detail: here ? `Scenario skill event, ${name}'s option (she is in the run)` : `Scenario skill event, ${name}'s option (she is not in the run)` });
    }
  }
  return out;
}

export function scenarioSources(target: Target, data: Data, settings: Settings, present: Set<number>): SkillSource[] {
  return scenarioOptions(data, settings, present).filter((o) => target.familyIds.has(o.skillId))
    .map((o) => ({ kind: 'scenario' as const, skillId: o.skillId, ...formOf(o.skillId, data), pObtain: settings.scenarioPickRate, isChoice: true, event: o.event, detail: o.detail, ...(o.linkedCharId != null ? { linkedCharId: o.linkedCharId } : {}) }));
}

/** One option of a contested event: the skill it gives, and the target it serves (null for a non-target option). */
export interface ConflictOption { skillId: number; option: string; target: number | null }
/** An event whose single choice was contested: the option taken, by prioritized order, and the ones given up. */
export interface Conflict { eventKey: string; label: string; taken: ConflictOption; dropped: ConflictOption[] }
/** A choice-gated option that is not a target but sits in the prioritized list: if ranked above the targets sharing its event, it takes the event. */
export interface Blocker { skillId: number; event: EventRef }

/**
 * One event yields one option. When choice-gated sources for different targets share an event, keep the target
 * whose skills come first in `priority` (skill ids in prioritized order, every form of a family ranked together)
 * and drop the rest.
 */
export function pruneConflicts(map: Map<number, SkillSource[]>, priority: number[], blockers: Blocker[] = []): { map: Map<number, SkillSource[]>; conflicts: Conflict[] } {
  const byEvent = new Map<string, Set<number>>();
  for (const [tid, sources] of map) for (const s of sources) if (isChoiceSource(s)) byEvent.set(s.event.key, new Set([...(byEvent.get(s.event.key) ?? []), tid]));
  const rank = (skillId: number) => { const i = priority.indexOf(skillId); return i < 0 ? Infinity : i; };
  const drop = new Map<string, Set<number>>();
  const conflicts: Conflict[] = [];
  for (const [key, tids] of byEvent) {
    // the option of this event that serves a target: prefer its gold form
    const optionFor = (tid: number): ConflictOption => {
      const ss = (map.get(tid) ?? []).filter((s): s is EventSource => isChoiceSource(s) && s.event.key === key);
      const s = ss.find((x) => x.gold) ?? ss[0]!;
      return { skillId: s.skillId, option: s.event.option, target: tid };
    };
    const ordered = [...tids].sort((a, b) => rank(a) - rank(b) || a - b);
    const options = ordered.map(optionFor);
    const label = (map.get(ordered[0]!) ?? []).find((s): s is EventSource => isChoiceSource(s) && s.event.key === key)?.event.label ?? key;
    // a non-target option of this event that the user ranked above every target option wins the event outright
    const blocker = blockers.filter((b) => b.event.key === key && rank(b.skillId) < rank(ordered[0]!)).sort((a, b) => rank(a.skillId) - rank(b.skillId))[0];
    if (blocker) {
      drop.set(key, new Set(ordered));
      conflicts.push({ eventKey: key, label: blocker.event.label || label, taken: { skillId: blocker.skillId, option: blocker.event.option, target: null }, dropped: options });
      continue;
    }
    if (tids.size < 2) continue;
    drop.set(key, new Set(ordered.slice(1)));
    conflicts.push({ eventKey: key, label, taken: options[0]!, dropped: options.slice(1) });
  }
  if (!conflicts.length) return { map, conflicts };
  const out = new Map<number, SkillSource[]>();
  for (const [tid, sources] of map) out.set(tid, sources.filter((s) => !(isChoiceSource(s) && drop.get(s.event.key)?.has(tid))));
  return { map: out, conflicts };
}

/** Combine independent sources into P(own gold) and P(own white) at run end. */
export interface Ownership { pGold: number; pWhite: number; pAny: number }
export function combineSources(sources: SkillSource[]): Ownership {
  let noGold = 1, noAny = 1;
  for (const s of sources) {
    noAny *= 1 - s.pObtain;
    if (s.gold) noGold *= 1 - s.pObtain;
  }
  const pGold = 1 - noGold;
  const pAny = 1 - noAny;
  return { pGold, pWhite: Math.max(0, pAny - pGold), pAny };
}

/** Expected spark probability for a target given ownership odds; each lineage occurrence multiplies it (base × 1.1^n). */
export function sparkChance(own: { pGold: number; pWhite: number }, settings: Settings, lineageN = 0): number {
  const mult = Math.pow(settings.lineageSparkMultiplier, Math.max(0, lineageN));
  return Math.min(1, (own.pGold * settings.goldSparkRate + own.pWhite * settings.whiteSparkRate) * mult);
}
