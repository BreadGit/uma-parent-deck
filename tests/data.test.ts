// Shape and referential checks on data/*.json: the fields the model reads must exist with the expected types,
// and every skill or character id one file points at must resolve. Run after `npm run fetch` or `npm run fit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { STATS, type AptKey } from '../src/types.ts';

const data = loadData();
const APT_KEYS: AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const skillExists = (id: number) => data.skillById.has(id);

test('cards carry the fields the stat and spark models read', () => {
  assert.ok(data.cards.length > 100);
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
  // compound unique effects (types 100 and up) keep their payload and are not folded into the passives
  for (const c of data.cards) {
    for (const u of c.unique?.effects ?? []) if (u.type >= 100) for (const e of c.effectsByLb) assert.ok(!(`u${u.type}` in e), `${c.name} folds compound unique type ${u.type}`);
  }
  const taiki = data.cardById.get(30053)!;
  assert.ok(taiki.unique?.effects.some((u) => u.type === 101 && u.value_1 != null), 'Taiki Shuttle keeps the compound payload');
  assert.ok(taiki.unique?.text?.includes('bond gauge is at least 80'), "and GameTora's rendered text for it");
  for (const c of data.cards) if (c.unique?.effects.some((u) => u.type >= 100)) assert.ok(c.unique.text, `${c.name} compound unique effect has its text`);
  // the approximable compound types are folded into the passives from the unlock level on; the deck-dependent ones are not
  assert.deepEqual(taiki.unique?.model?.effects, { '3': 0.75, '30': 0.75 }, 'type 101 at the fitted share of the run');
  assert.equal(taiki.effectsByLb[0]!.u3, 0.75, 'an SSR at LB0 is level 30, the unlock level');
  assert.deepEqual(data.cardById.get(30067)!.unique?.model?.effects, { '30': 1.5 }, 'a type 101 with a single effect');
  const topRoad = data.cardById.get(30086)!;
  assert.equal(topRoad.effectsByLb[4]!.u8, 20, 'type 104: the fan cap in full');
  const digital = data.cardById.get(30085)!;
  assert.deepEqual(digital.unique?.model?.effects, {}, 'type 103 waits for the deck');
  assert.ok(!Object.keys(digital.effectsByLb[4]!).some((k) => k.startsWith('u')));
  const urara = data.charByCardId.get(105201)!;
  assert.equal(urara.goals.find((g) => g.races[0]?.name === 'Arima Kinen')?.required, 0, "Haru Urara's Arima Kinen is participation only");
  // decoding canary: Kitasan Black's third chain event hands out Professor of Curvature in both options
  const kitasan = data.cardById.get(30028)!;
  assert.equal(kitasan.chainEvents.length, 3);
  assert.ok(kitasan.chainEvents[2]!.choices.every((ch) => ch.outcomes.flat().some((r) => r.t === 'sk' && r.d === 200331)));
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
        if (cond.type === 'win_n_of') assert.ok(cond.n >= 1 && cond.n <= cond.races.length);
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
  assert.ok(data.ranks.some((r) => r.name === 'SS'));
});

test('scenario events reference known skills and characters', () => {
  assert.ok(data.scenarioEvents.some((e) => e.scenarioId === 3), 'Our Grand Concert events present');
  for (const ev of data.scenarioEvents) for (const ch of ev.choices) {
    for (const id of [ch.goldSkill, ch.whiteSkill, ch.skill]) if (id != null) assert.ok(skillExists(id), `scenario ${ev.scenarioId} skill ${id}`);
    if (ch.linkedCharId != null && ev.scenarioId === 3) assert.ok(data.charById.has(ch.linkedCharId), `scenario 3 linked character ${ch.linkedCharId}`);
  }
});

test('stat model has every field the predictor reads', () => {
  const m = data.model;
  assert.deepEqual(m.stats, STATS);
  for (const k of ['fr', 'mo', 'te', 'sb'] as const) assert.ok(isNum(m.slopes[k]), `slope ${k}`);
  assert.ok(isNum(m.floor) && isNum(m.growthEffect) && isNum(m.races.totalTurns) && isNum(m.races.reference));
  assert.equal(m.sigma.length, 5);
  for (const f of ['balanced', 'stamina', 'sprint'] as const) assert.equal(m.focus[f].length, 5, `focus ${f}`);
  assert.equal(m.eventBase['28']?.length, 5);
  assert.ok(isNum(m.eventSp['28']));
  for (const o of m.observed) {
    assert.ok(data.cardById.has(o.cardId), `observed row for unknown card ${o.cardId}`);
    assert.equal(o.stats.length, 5);
  }
});
