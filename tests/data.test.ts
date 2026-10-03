// Shape and referential checks on data/*.json: the fields the model reads must exist with the expected types,
// and every skill or character id one file points at must resolve. Run after `npm run fetch` or `npm run fit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { STATS, type AptKey } from '../src/types.ts';
import { uniqueExtras } from '../src/model/stats.ts';
import fixtureJson from '../data/unique-extras-fixture.json' with { type: 'json' };
const fixture = fixtureJson as { uniqueRampShare: number; rows: { cardId: number; lb: number; extras: Record<string, number> }[] };

const data = loadData();
const APT_KEYS: AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const skillExists = (id: number) => data.skillById.has(id);

// The vendored cards these tests pin, and the values read off GameTora for them. After a data refresh changes one of
// these cards, update this table rather than the tests below.
const PINNED = {
  lightHello: 30052, specialWeekR: 10001, digitalSr: 20005, taikiShuttle: 30053, teamSirius: 30081, compoundOnly: 30085,
  kitasanBlack: 30028, haruUraraCard: 105201,
};
const INTERPOLATION: { card: number; effect: number; byLb: number[]; note: string }[] = [
  { card: PINNED.lightHello, effect: 16, byLb: [5, 6, 8, 10, 10], note: 'interpolated between the listed anchors' },
  { card: PINNED.lightHello, effect: 15, byLb: [1, 2, 3, 5, 5], note: 'interpolated between the listed anchors' },
  { card: PINNED.lightHello, effect: 8, byLb: [0, 5, 10, 10, 10], note: 'training effectiveness unlocks at level 35' },
  { card: PINNED.lightHello, effect: 12, byLb: [25, 26, 27, 28, 30], note: 'floor each interpolation' },
  { card: PINNED.lightHello, effect: 9, byLb: [0, 0, 0, 15, 30], note: 'initial speed unlocks at level 45' },
  { card: PINNED.specialWeekR, effect: 1, byLb: [10, 11, 13, 15, 15], note: 'R level caps and trailing plateau' },
  { card: PINNED.digitalSr, effect: 16, byLb: [10, 11, 12, 13, 15], note: 'SR level caps' },
];
const pinned = (id: number) => must(data.cardById.get(id), `pinned card ${id}`);

test('support effects interpolate with floor rounding between anchors, without unlocking early', () => {
  for (const row of INTERPOLATION) {
    const card = pinned(row.card);
    assert.deepEqual(card.effectsByLb.map((e) => e[row.effect] ?? 0), row.byLb, `${card.name} effect ${row.effect}: ${row.note}`);
  }
});

test('cards carry the fields the stat and spark models read', () => {
  assert.ok(data.cards.length > 100, `only ${data.cards.length} cards`);
  for (const c of data.cards) {
    assert.ok(['R', 'SR', 'SSR'].includes(c.rarity), `${c.name} rarity`);
    assert.ok([...STATS, 'pal', 'group'].includes(c.type), `${c.name} type ${c.type}`);
    assert.equal(c.effectsByLb.length, 5, `${c.name} effects per limit break`);
    for (const e of c.effectsByLb) for (const v of Object.values(e)) assert.ok(isNum(v), `${c.name} effect value`);
    for (const id of [...c.hintSkills, ...c.eventSkills]) assert.ok(skillExists(id), `${c.name} references unknown skill ${id}`);
    for (const ev of [...c.chainEvents, ...c.randomEvents, ...c.recreationEvents, ...c.specialEvents]) {
      assert.ok(['chain', 'random', 'recreation', 'special'].includes(ev.kind), `${c.name} event kind`);
      assert.ok(ev.index >= 1, `${c.name} event index`);
      for (const choice of ev.choices) for (const outcome of choice.outcomes) for (const r of outcome) {
        if (r.t === 'sk') assert.ok(typeof r.d === 'number' && skillExists(r.d), `${c.name} event skill ${String(r.d)}`);
        if (r.t === 'sr') assert.ok(Array.isArray(r.d) && r.d.every((x) => skillExists(x.d)), `${c.name} random-skill reward`);
      }
    }
    if (c.rarity === 'SSR') assert.ok(c.chainEvents.length <= 3, `${c.name} chain events`);
  }
  // compound unique effects (types 100 and up) keep their payload and are not folded into the passives: only basic
  // unique types appear as u<type> keys, from the unlock limit break on
  for (const c of data.cards) {
    if (!c.unique) continue;
    assert.ok(Number.isInteger(c.unique.fromLb) && c.unique.fromLb >= 0 && c.unique.fromLb <= 5, `${c.name} unique fromLb`);
    const basic = new Set(c.unique.effects.filter((u) => u.type < 100).map((u) => `u${u.type}`));
    c.effectsByLb.forEach((e, lb) => {
      const uKeys = Object.keys(e).filter((k) => k.startsWith('u'));
      for (const k of uKeys) assert.ok(basic.has(k), `${c.name} folds ${k} into the passives`);
      assert.equal(uKeys.length > 0, lb >= c.unique!.fromLb && basic.size > 0, `${c.name} basic unique at LB${lb}`);
    });
  }
  const taiki = pinned(PINNED.taikiShuttle);
  assert.ok(taiki.unique?.effects.some((u) => u.type === 101 && u.value_1 != null), 'Taiki Shuttle keeps the compound payload');
  assert.equal(taiki.unique?.fromLb, 0, 'an SSR at LB0 is level 30, the unlock level');
  assert.equal(pinned(PINNED.teamSirius).unique?.fromLb, 2, 'Team Sirius unlocks at level 40');
  assert.ok(taiki.unique?.text?.includes('bond gauge is at least 80'), "and GameTora's rendered text for it");
  for (const c of data.cards) if (c.unique?.effects.some((u) => u.type >= 100)) {
    assert.ok(c.unique.text, `${c.name} compound unique effect has its text`);
    assert.ok(!/^Unlocked at level/.test(c.unique.text), `${c.name}: the unlock line was kept instead of the effect`);
  }
  assert.ok(pinned(PINNED.teamSirius).unique?.text?.startsWith('Gain Training Effectiveness (10)'), 'a level-40 unlock (Team Sirius) still gets the effect line');
  assert.ok(!Object.keys(pinned(PINNED.compoundOnly).effectsByLb[4]!).some((k) => k.startsWith('u')), 'a compound-only unique folds nothing');
  const urara = must(data.charByCardId.get(PINNED.haruUraraCard), `the character of pinned card ${PINNED.haruUraraCard}`);
  assert.equal(urara.goals.find((g) => g.races[0]?.name === 'Arima Kinen')?.required, 0, "Haru Urara's Arima Kinen is participation only");
  // decoding canary: Kitasan Black's third chain event hands out Professor of Curvature in both options
  const kitasan = pinned(PINNED.kitasanBlack);
  assert.equal(kitasan.chainEvents.length, 3);
  assert.ok(kitasan.chainEvents[2]!.choices.every((ch) => ch.outcomes.flat().some((r) => r.t === 'sk' && r.d === 200331)), "Kitasan Black's chain 3 gives Professor of Curvature in every option");
});

test('the fit script and the app add the same compound unique passives: the fixture the fit wrote is reproduced by uniqueExtras()', () => {
  assert.equal(fixture.uniqueRampShare, data.model.uniqueRampShare, 'the fixture and the model come from the same fit');
  assert.ok(fixture.rows.length >= 5 * 30, `${fixture.rows.length} rows`);
  const seen = new Set<number>();
  for (const row of fixture.rows) {
    const card = must(data.cardById.get(row.cardId), `data.cardById.get(${row.cardId})`);
    assert.ok(card, `fixture card ${row.cardId}`);
    seen.add(card.id);
    const mine = uniqueExtras(card, row.lb, data.model);
    const want = Object.entries(row.extras).map(([k, v]) => [Number(k), v] as const).sort((a, b) => a[0] - b[0]);
    const got = Object.entries(mine).map(([k, v]) => [Number(k), v] as const).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(got.map(([k]) => k), want.map(([k]) => k), `${card.name} LB${row.lb}: effects ${got.map(([k]) => k)} vs fit ${want.map(([k]) => k)}`);
    got.forEach(([, v], i) => assert.ok(Math.abs(v - want[i]![1]) < 1e-9, `${card.name} LB${row.lb} effect ${want[i]![0]}: ${v} vs fit ${want[i]![1]}`));
  }
  for (const c of data.cards) if (c.unique?.effects.some((u) => u.type >= 100)) assert.ok(seen.has(c.id), `${c.name} is missing from the fixture; run npm run fit`);
});

test('skills have rarity, cost and resolvable version links', () => {
  for (const s of data.skills) {
    assert.ok(isNum(s.rarity) && s.rarity >= 1, `${s.name} rarity`);
    assert.ok(s.cost === null || isNum(s.cost), `${s.name} cost`);
    for (const v of s.versions) assert.ok(skillExists(v), `${s.name} version ${v}`);
    assert.ok(typeof s.desc === 'string', `${s.name} desc`);
  }
});

test('characters have aptitudes, growth, base stats and resolvable skills', () => {
  for (const ch of data.characters) {
    for (const k of APT_KEYS) assert.ok(typeof ch.aptitudes[k] === 'string', `${ch.name} aptitude ${k}`);
    assert.equal(ch.growth.length, 5, `${ch.name} growth`);
    assert.equal(ch.baseStats.length, 5, `${ch.name} base stats`);
    for (const t of [ch.twoStarStats, ch.threeStarStats, ch.fourStarStats, ch.fiveStarStats]) if (t) assert.equal(t.length, 5, `${ch.name} star table`);
    if (ch.rarity <= 2) assert.ok(ch.threeStarStats, `${ch.name} ${ch.title} lists a 3★ table`);
    if (ch.rarity === 1) assert.ok(ch.twoStarStats, `${ch.name} ${ch.title} lists a 2★ table`);
    for (const id of [...ch.innateSkills, ...ch.awakeningSkills, ...ch.eventSkills]) assert.ok(skillExists(id), `${ch.name} references unknown skill ${id}`);
    for (const g of ch.goals) { assert.ok(g.slot >= 0 && g.slot < 72, `${ch.name} goal slot ${g.slot}`); assert.ok(isNum(g.required) && g.required >= 0, `${ch.name} goal placement`); for (const r of g.races) assert.ok(isNum(r.fansGain), `${ch.name} goal fans`); }
  }
});

test('trainee events are decoded with resolvable skills and race references', () => {
  const raceIds = new Set(data.races.map((r) => r.raceId));
  const kinds = new Set(['story', 'choice', 'outing', 'secret']);
  let secrets = 0, choiceEvents = 0;
  for (const ch of data.characters) {
    assert.ok(Array.isArray(ch.events) && ch.events.length > 0, `${ch.name} has events`);
    for (const ev of ch.events) {
      assert.ok(kinds.has(ev.kind), `${ch.name} event kind ${ev.kind}`);
      for (const c of ev.choices) for (const o of c.outcomes) for (const r of o) if (r.t === 'sk') assert.ok(typeof r.d === 'number' && skillExists(r.d), `${ch.name} event skill ${String(r.d)}`);
      if (ev.kind === 'secret') { secrets++; assert.ok(Array.isArray(ev.conditions), `${ch.name} secret event has conditions`); }
      if (ev.kind === 'choice') choiceEvents++;
      for (const cond of ev.conditions ?? []) {
        const refs = 'races' in cond ? cond.races : 'race' in cond ? [cond.race] : [];
        for (const r of refs) { assert.ok(raceIds.has(r.raceId), `${ch.name} condition race ${r.raceId} is a calendar G1`); if (r.year != null) assert.ok(r.year >= 1 && r.year <= 3); }
        if (cond.type === 'win_n_of') assert.ok(cond.n >= 1 && cond.n <= cond.races.length, `${ch.name} win_n_of needs 1..${cond.races.length}, got ${cond.n}`);
      }
    }
  }
  assert.ok(secrets > 100 && choiceEvents > 200, `secret ${secrets}, choice ${choiceEvents}`);
});

test('races sit on the three-year calendar and ranks include SS', () => {
  for (const r of data.races) {
    assert.ok(r.year >= 1 && r.year <= 3 && r.month >= 1 && r.month <= 12 && (r.half === 1 || r.half === 2), `${r.name} calendar`);
    assert.ok(['turf', 'dirt'].includes(r.surface) && ['sprint', 'mile', 'medium', 'long'].includes(r.category), `${r.name} surface/category`);
  }
  assert.ok(data.ranks.some((r) => r.name === 'SS'), 'the SS rank is listed');
});

test('scenario events reference known skills and characters', () => {
  assert.ok(data.scenarioEvents.some((e) => e.scenarioId === 3), 'Our Grand Concert events present');
  for (const ev of data.scenarioEvents) for (const ch of ev.choices) {
    for (const id of [ch.goldSkill, ch.whiteSkill, ch.skill]) if (id != null) assert.ok(skillExists(id), `scenario ${ev.scenarioId} skill ${id}`);
    if (ch.linkedCharId != null && ev.scenarioId === 3) assert.ok(data.charById.has(ch.linkedCharId), `scenario 3 linked character ${ch.linkedCharId}`);
  }
});

test('model coefficients, reference conditions and observed provenance are usable and unambiguous', () => {
  const m = data.model;
  assert.deepEqual(m.stats, STATS);
  for (const k of ['fr', 'mo', 'te', 'sb'] as const) assert.ok(isNum(m.slopes[k]), `slope ${k}`);
  assert.ok(isNum(m.floor) && isNum(m.growthEffect), 'model scalars are finite');
  const vector = (values: number[], name: string, positive = false) => {
    assert.equal(values.length, STATS.length, name);
    assert.ok(values.every((v) => isNum(v) && (positive ? v > 0 : v >= 0)), name);
  };
  assert.ok(m.races.totalTurns > m.races.reference && m.races.reference > 0, 'total turns exceed the reference race count');
  assert.ok(m.uniqueRampShare >= 0 && m.uniqueRampShare <= 1, 'uniqueRampShare is a share');
  for (const values of [m.slopes, m.roleConstants, m.effectSlopes ?? {}, m.sp.effectSlopes ?? {}]) {
    for (const value of Object.values(values)) assert.ok(isNum(value), 'finite fitted coefficient');
  }
  for (const values of [m.sp, m.sp.fallback].filter((v) => v != null)) {
    for (const key of ['base', 'wit', 'friend', 'skillPointBonus'] as const) assert.ok(isNum(values[key]), `SP ${key}`);
  }
  vector(m.sigma, 'stat spread', true);
  for (const focus of ['balanced', 'stamina', 'sprint'] as const) vector(m.focus[focus], focus, true);
  for (const races of ['23', '28']) {
    vector(m.eventBase[races]!, `event stats at ${races} races`);
    assert.ok(isNum(m.eventSp[races]) && m.eventSp[races]! >= 0, `event SP at ${races} races`);
  }
  const seen = new Set<string>();
  for (const observation of m.observed) {
    const key = `${observation.cardId}:${observation.lb}`;
    assert.ok(!seen.has(key), `multiple observed references for ${key}`);
    assert.ok(data.cardById.has(observation.cardId), `observed row for unknown card ${observation.cardId}`);
    seen.add(key);
    assert.ok(Number.isInteger(observation.lb) && observation.lb >= 0 && observation.lb <= 4, key);
    assert.ok(Number.isInteger(observation.runs) && observation.runs >= 10 && observation.wellTested, key);
    assert.equal(observation.raceReference, m.races.reference, `${key} calibration race reference`);
    assert.ok(observation.sourceRef?.length, `${key} has a source location`);
    vector(observation.stats, `${key} stats`);
    assert.ok(isNum(observation.sp) && observation.sp >= 0, `${key} SP`);
  }
});
