import type { Card, CardEvent, Character, Data, Reward, Skill } from '../types.ts';
import type { Settings } from '../settings.ts';
import { EFFECT, passives } from './stats.ts';

/** A target as the user picked it, resolved to its skill family. */
export interface Target {
  id: number;            // the skill id the user picked (white form preferred)
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

export type SourceKind = 'hint' | 'chain' | 'random' | 'recreation' | 'special' | 'innate' | 'awakening' | 'char-event' | 'lineage';
export interface SkillSource {
  kind: SourceKind;
  skillId: number;
  gold: boolean;
  circle: boolean;
  pObtain: number;       // chance this source yields the skill during a run
  isChoice: boolean;     // event: the skill only comes from one of several choices (wishlist matters)
  detail: string;        // where it comes from, e.g. 'Chain event 3 "We Walk Together"'
  cardName?: string;     // the support card providing it (absent for trainee sources)
}

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

/** Skill sources from a card's events, with the wishlist assumed to pick the right choice. */
export function eventSources(card: Card, settings: Settings): SkillSource[] {
  const out: SkillSource[] = [];
  const chainRates = card.rarity === 'SSR' ? settings.chainRatesSSR : card.rarity === 'SR' ? settings.chainRatesSR : [];
  const scan = (ev: CardEvent, pFire: number, label: string) => {
    const nChoices = ev.choices.length;
    ev.choices.forEach((choice) => {
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
        const both = where.size === 2 ? '' : where.size === 1 ? `, ${[...where][0]}` : '';
        out.push({ kind: ev.kind, skillId: id, gold: false, circle: false, pObtain: pFire * p, isChoice: nChoices > 1 && !inAll,
          detail: `${label} ${ev.index}${ev.name ? ` "${ev.name}"` : ''}${both}` });
      }
    });
  };
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
  const tag = (id: number) => {
    const s = data.skillById.get(id);
    return { gold: !!s && isGold(s), circle: !!s && isCircle(s) };
  };
  const hintsInFamily = card.hintSkills.filter((id) => target.familyIds.has(id));
  if (hintsInFamily.length) {
    const eh = expectedHints(card, lb, races, totalTurns, settings);
    const pool = Math.max(1, card.hintSkills.length);
    // P(at least one hint for this skill) with hints drawn uniformly from the pool
    const pEach = 1 - Math.pow(1 - 1 / pool, eh);
    for (const id of hintsInFamily) out.push({ kind: 'hint', skillId: id, ...tag(id), pObtain: pEach, isChoice: false, detail: `Hint (${eh.toFixed(1)} hints/run over ${pool} skills)`, cardName: card.name });
  }
  for (const src of eventSources(card, settings)) {
    if (target.familyIds.has(src.skillId)) out.push({ ...src, ...tag(src.skillId), cardName: card.name });
  }
  return out;
}

export function traineeSources(trainee: Character, target: Target, data: Data): SkillSource[] {
  const out: SkillSource[] = [];
  const tag = (id: number) => { const s = data.skillById.get(id); return { gold: !!s && isGold(s), circle: !!s && isCircle(s) }; };
  for (const id of trainee.innateSkills) if (target.familyIds.has(id)) out.push({ kind: 'innate', skillId: id, ...tag(id), pObtain: 1, isChoice: false, detail: 'Innate skill' });
  for (const id of trainee.awakeningSkills) if (target.familyIds.has(id)) out.push({ kind: 'awakening', skillId: id, ...tag(id), pObtain: 1, isChoice: false, detail: 'Awakening skill' });
  for (const id of trainee.eventSkills) if (target.familyIds.has(id)) out.push({ kind: 'char-event', skillId: id, ...tag(id), pObtain: 0.5, isChoice: false, detail: 'Character event' });
  return out;
}

/** Existing copies of a target white spark in the lineage: how many umas carry it, and each parent side's star total. */
export interface Lineage { n: number; p1: number; p2: number }

/** Split a parent side's stars over its occurrences as evenly as possible (3★ max per spark). */
export function lineageSparks(l: Lineage): number[] {
  const k1 = Math.min(3, Math.ceil(l.n / 2)), k2 = Math.min(3, l.n - k1);
  const spread = (stars: number, k: number) => {
    if (k <= 0) return [] as number[];
    const out = Array<number>(k).fill(0);
    let left = Math.max(0, Math.min(3 * k, Math.round(stars)));
    for (let i = 0; left > 0; i = (i + 1) % k) { out[i]! += 1; left -= 1; }
    return out.map((v) => Math.max(1, v));
  };
  return [...spread(l.p1, k1), ...spread(l.p2, k2)];
}

/** Inherited white sparks roll at each of the two inspiration events and hand over the white hint. */
export function lineageSources(target: Target, lineage: Lineage | undefined, settings: Settings): SkillSource[] {
  if (!lineage || lineage.n <= 0) return [];
  let miss = 1;
  const parts: string[] = [];
  for (const stars of lineageSparks(lineage)) {
    const rate = settings.whiteSparkInheritRates[Math.max(0, Math.min(2, stars - 1))] ?? 0.03;
    const pOnce = Math.min(1, rate * (1 + settings.affinity / 100));
    miss *= Math.pow(1 - pOnce, 2);
    parts.push(`${stars}★ ${pct1(pOnce)}/event`);
  }
  return [{ kind: 'lineage', skillId: target.white?.id ?? target.id, gold: false, circle: false, pObtain: 1 - miss, isChoice: false,
    detail: `Lineage: ${lineage.n} spark${lineage.n === 1 ? '' : 's'} (${parts.join(', ')}) over two inspiration events` }];
}
const pct1 = (x: number) => `${(x * 100).toFixed(0)}%`;

/** Combine independent sources into P(own gold) and P(own white) at run end. */
export function combineSources(sources: SkillSource[]): { pGold: number; pWhite: number; pAny: number } {
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

/** Expected star distribution of a white spark given P(SS). */
export function whiteStarOdds(pSS: number, settings: Settings): number[] {
  return [0, 1, 2].map((k) => pSS * settings.ssStarOdds[k]! + (1 - pSS) * settings.belowSsStarOdds[k]!);
}
