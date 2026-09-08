import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { cardContribution, EFFECT, modelContribution, passives, predictDeck, raceScale, uniqueExtras, uniqueNote, uniqueUnlocked } from '../src/model/stats.ts';
import type { Card, Race } from '../src/types.ts';
import { resolveTarget, cardSourcesForTarget, combineSources, eventKeyOf, eventSources, expectedHints, goldRollChance, pruneConflicts, sparkChance, type EventSource, type SkillSource } from '../src/model/sparks.ts';
import { buildDeck, evaluate, makeCtx, rankCards, traineeCoverage, wishlist, wishlistCandidates, type Ctx } from '../src/model/deck.ts';
import { baseWinChance, buildSchedule, expectedFansBefore, goalRaces, rawWinScore, scheduleSummary, traineeAptitudes, winChance, type Aptitudes } from '../src/model/races.ts';
import { skillScore, statScore, uniqueSkillLevel, uniqueSkillScore } from '../src/model/rank.ts';
import { affinityMultiplier, gainOfSparks, inheritedFromGain, inheritedFromParents, MAX_START_GAIN, sparksFromGain, sparksFromStars, START_GAINS } from '../src/model/inherit.ts';
import { SLOT_COUNT } from '../src/model/rules.ts';

const data = loadData();
const { cards, skills, characters } = data;
const settings = { ...DEFAULT_SETTINGS };
const kitasan = data.cardById.get(30028)!;
const T = data.model.races.totalTurns;
const byName = (n: string) => skills.find((s) => s.name === n && !s.unreleasedEn)!;
const target = (n: string) => resolveTarget(byName(n).id, data)!;
const sw = characters.find((c) => c.name === 'Special Week')!;
const ctxOf = (extra: Partial<Ctx> = {}): Ctx => makeCtx({ data, settings, races: 20, totalTurns: T, trainee: null, ...extra });
const all4 = cards.map((card) => ({ card, lb: 4 }));

// ----- skills and the stat model -----

test('skill families resolve gold and white forms', () => {
  const t = resolveTarget(200352, data)!; // Corner Recovery ○
  assert.equal(t.gold?.name, 'Swinging Maestro');
  assert.equal(t.white?.id, 200352);
  assert.equal(resolveTarget(200351, data)!.id, t.id, 'the gold id resolves to the same family');
});

test('stat model: reproduces observed Kitasan MLB, shifts other limit breaks from the observation, scales with races', () => {
  const obs = data.model.observed.find((o) => o.cardId === 30028 && o.lb === 4)!;
  modelContribution(kitasan, 4, data.model).stats.forEach((v, i) => assert.ok(Math.abs(v - obs.stats[i]!) < 15, `stat ${i}: model ${v} vs observed ${obs.stats[i]}`));
  assert.equal(cardContribution(kitasan, 4, data.model).source, 'observed');
  const c0 = cardContribution(kitasan, 0, data.model);
  assert.equal(c0.source, 'observed+model');
  assert.ok(c0.stats[0]! <= obs.stats[0]!);
  assert.ok(raceScale(23, data.model, settings) > 1.08 && raceScale(23, data.model, settings) < 1.14, 'fewer races, more card stats');
  assert.equal(raceScale(28, data.model, settings), 1);
});

test('compound unique effects are evaluated at run time: deck-dependent ones from the deck, ramping ones at the fitted share, the fan one from the agenda, only through the model', () => {
  const m = data.model, share = m.uniqueRampShare;
  assert.ok(share > 0 && share <= 1);
  const digital = data.cardById.get(30085)!, rudolf = data.cardById.get(30090)!;
  // the n-th SSR of each type, so a type listed twice gives two different cards
  const pick = (types: string[]) => types.map((t, i) => ({ card: cards.filter((c) => c.type === t && c.rarity === 'SSR' && ![30085, 30090].includes(c.id))[types.slice(0, i).filter((x) => x === t).length]!, lb: 4 }));
  const fiveTypes = [{ card: digital, lb: 4 }, ...pick(['speed', 'stamina', 'guts', 'wit', 'pal'])]; // power, speed, stamina, guts, wit, pal
  const fourTypes = [{ card: digital, lb: 4 }, ...pick(['speed', 'speed', 'stamina', 'stamina', 'pal'])]; // power, speed, stamina, pal
  assert.deepEqual(uniqueExtras(digital, 4, m, { deck: fiveTypes }), { [EFFECT.trainingEff]: 15 });
  assert.deepEqual(uniqueExtras(digital, 4, m, { deck: fourTypes }), {});
  assert.deepEqual(uniqueExtras(digital, 4, m), {}, 'without a deck a deck-dependent effect adds nothing');
  assert.ok(modelContribution(digital, 4, m, uniqueExtras(digital, 4, m, { deck: fiveTypes })).stats[2]! > modelContribution(digital, 4, m).stats[2]!, 'more Power from her own facility');
  const withRudolf = [{ card: rudolf, lb: 4 }, ...pick(['speed', 'speed', 'stamina', 'guts', 'pal'])]; // Rudolf is a Stamina card
  const extras = uniqueExtras(rudolf, 4, m, { deck: withRudolf });
  assert.equal(extras[EFFECT.initialStat + 0], 20 + 2, 'two Speed cards at +10 each, plus 2 from the Pal card');
  assert.equal(extras[EFFECT.initialStat + 1], 20 + 2, 'her own Stamina card and the other Stamina card, plus 2 from the Pal card');
  assert.equal(extras[EFFECT.initialStat + 4], 2, 'the Pal card alone for Wit');
  assert.deepEqual(uniqueExtras(kitasan, 4, m, { deck: withRudolf }), {}, 'a basic unique effect adds nothing here');
  // ramping effects at the fitted share: Taiki Shuttle's bond-80 Speed Bonus 1 and Skill Point Bonus 1 (type 101)
  const taiki = data.cardById.get(30053)!;
  assert.deepEqual(uniqueExtras(taiki, 0, m), { [EFFECT.statBonus]: share, [EFFECT.skillPointBonus]: share }, 'an SSR at LB0 is level 30, the unlock level');
  assert.ok(uniqueUnlocked(taiki, 0) && !uniqueUnlocked(data.cardById.get(30081)!, 1) && uniqueUnlocked(data.cardById.get(30081)!, 2), 'Team Sirius unlocks at level 40, LB2 for an SSR');
  assert.deepEqual(uniqueExtras(data.cardById.get(30081)!, 1, m), {});
  // Narita Top Road (type 104, +1 Training Effectiveness per 10,000 fans up to 20): the agenda's fans when given, the share otherwise
  const topRoad = data.cardById.get(30086)!;
  assert.ok(Math.abs(uniqueExtras(topRoad, 4, m)[EFFECT.trainingEff]! - 20 * share) < 1e-9);
  assert.equal(uniqueExtras(topRoad, 4, m, { fansBefore: () => 200000 })[EFFECT.trainingEff], 20, 'at the cap all run');
  assert.deepEqual(uniqueExtras(topRoad, 4, m, { fansBefore: () => 0 }), {}, 'no fans, no effect');
  const ramp = uniqueExtras(topRoad, 4, m, { fansBefore: (slot) => slot * 200000 / 72 })[EFFECT.trainingEff]!;
  assert.ok(ramp > 9 && ramp < 11, `fans rising linearly to the cap give about half of it on average, got ${ramp}`);
  assert.ok(uniqueNote(topRoad, m, { fansBefore: () => 200000 }).includes('+20.0 of 20') && uniqueNote(data.cardById.get(30083)!, m).includes('left out'), 'the tooltip says what was done');
  const obs = data.model.observed.find((o) => o.wellTested && o.lb === 4)!;
  const card = data.cardById.get(obs.cardId)!;
  assert.deepEqual(cardContribution(card, 4, data.model, { [EFFECT.trainingEff]: 15 }).stats, obs.stats, 'an observed row already contains its deck effects');
});

test('prediction: focus multiplies the split, growth raises event stats, race losses cost stat points', () => {
  const grown = characters.find((c) => c.growth.some((g) => g >= 20))!;
  const gi = grown.growth.findIndex((g) => g >= 20);
  const deck = cards.filter((c) => c.rarity === 'SSR').slice(0, 6).map((card) => ({ card, lb: 4 }));
  const balanced = predictDeck(deck, grown, 20, 'balanced', 0, data.model, settings);
  const sprint = predictDeck(deck, grown, 20, 'sprint', 0, data.model, settings);
  const f = data.model.focus;
  balanced.mean.forEach((v, i) => assert.ok(Math.abs(sprint.mean[i]! / v - f.sprint[i]! / f.balanced[i]!) < 1e-6, `focus ratio on stat ${i}`));
  const flat = predictDeck(deck, { ...grown, growth: [0, 0, 0, 0, 0] }, 20, 'balanced', 0, data.model, settings);
  assert.ok(Math.abs(balanced.eventStats[gi]! / flat.eventStats[gi]! - (1 + data.model.growthEffect * grown.growth[gi]! / 100)) < 1e-9, 'growth scales the event stats');
  const penalised = predictDeck(deck, grown, 20, 'balanced', 2, data.model, { ...settings, lossPenalty: 50 });
  balanced.mean.forEach((v, i) => assert.ok(Math.abs(v - penalised.mean[i]! - 100 / 5) < 1e-9, 'each expected loss removes lossPenalty points spread over five stats'));
});

// ----- sources: hints and events -----

test('hints: a card is a hint source for its hint skills, with hints per run from turns off the track and Hint Frequency', () => {
  const corner = resolveTarget(200352, data)!; // Corner Recovery ○, on Kitasan's hint list
  const hint = cardSourcesForTarget(kitasan, 4, corner, 28, T, data, settings).find((s) => s.kind === 'hint' && s.skillId === 200352)!;
  const eh = expectedHints(kitasan, 4, 28, T, settings);
  assert.ok(hint.pObtain > 0 && hint.pObtain < 1);
  assert.ok(Math.abs(hint.pObtain - (1 - Math.pow(1 - 1 / kitasan.hintSkills.length, eh))) < 1e-9, 'P(at least one hint) over a uniform pool');
  const hf = (c: Card) => passives(c, 4)[EFFECT.hintFreq] ?? 0;
  const noHf = cards.find((c) => c.rarity === 'SSR' && hf(c) === 0)!;
  const withHf = cards.find((c) => hf(c) >= 30)!;
  const base = expectedHints(noHf, 4, 20, T, settings);
  assert.ok(Math.abs(base - (T - 20) * settings.hintTurnsShare * settings.hintBase * settings.hintScale) < 1e-9);
  assert.ok(expectedHints(noHf, 4, 28, T, settings) < base, 'more races, fewer training turns, fewer hints');
  assert.ok(Math.abs(expectedHints(withHf, 4, 20, T, settings) / base - (1 + hf(withHf) / 100)) < 1e-9);
});

test('event outcomes: outcomes of one option are equally likely, a gold/white random pair is the stat-gated gold roll, a skill in every option is not gated, many random events scale', () => {
  const riko = data.cardById.get(10060)!; // random 2, option 1: one outcome gives Ramp Up, the other Maverick ○
  const rikoEv = eventSources(riko, settings, data).filter((s) => s.kind === 'random' && s.event.key.endsWith(':random:2'));
  const rampUp = rikoEv.find((s) => data.skillById.get(s.skillId)?.name === 'Ramp Up')!;
  const maverick = rikoEv.find((s) => data.skillById.get(s.skillId)?.name === 'Maverick ○')!;
  const pFire = settings.randomEventRate * Math.min(1, 2 / riko.randomEvents.length);
  assert.ok(Math.abs(rampUp.pObtain - pFire / 2) < 1e-9 && rampUp.detail.includes('one of 2 outcomes'));
  assert.ok(Math.abs(maverick.pObtain - pFire / 2) < 1e-9 && rampUp.event.optionIndex === maverick.event.optionIndex);
  // the documented gold roll by the stat of the card's type
  assert.deepEqual([399, 400, 600, 700, 800, 1000, 1200].map(goldRollChance), [0.3, 0.6, 0.65, 0.75, 0.8, 0.9, 0.9]);
  const fine = data.cardById.get(30010)!; // chain 3: Speed Star (gold) or Prepared to Pass (its white form), by the Wit stat
  const shared = eventSources(fine, settings, data).filter((s) => s.event.key.endsWith(':chain:3'));
  const g = goldRollChance(settings.goldRollStat);
  assert.equal(shared.length, 2);
  assert.ok(Math.abs(shared.find((s) => data.skillById.get(s.skillId)?.name === 'Speed Star')!.pObtain - settings.chainRatesSSR[2]! * g) < 1e-9, 'gold at the documented rate for the assumed stat');
  assert.ok(Math.abs(shared.find((s) => data.skillById.get(s.skillId)?.name === 'Prepared to Pass')!.pObtain - settings.chainRatesSSR[2]! * (1 - g)) < 1e-9, 'white otherwise');
  const professor = cardSourcesForTarget(kitasan, 4, resolveTarget(200331, data)!, 28, T, data, settings).find((s) => s.kind === 'chain')!; // Kitasan chain 3: Professor of Curvature in both options
  assert.ok(professor.gold && !professor.isChoice && Math.abs(professor.pObtain - settings.chainRatesSSR[2]!) < 1e-9);
  const sirius = data.cardById.get(30081)!; // 14 random events: scaled so two fire on average
  assert.ok(eventSources(sirius, settings, data).find((s) => s.kind === 'random')!.pObtain <= settings.randomEventRate * 2 / sirius.randomEvents.length + 1e-9);
});

test('ownership odds combine sources the way the game runs them: duplicates in one outcome count once, outcomes of one option are exclusive, chain stages are nested, options of one event are alternatives', () => {
  const r3 = settings.chainRatesSSR[2]!, g = goldRollChance(settings.goldRollStat);
  // El Condor Pasa chain 3 writes Speed Star into two conditional branches of one outcome; Matikanetannhauser chain 3 writes It's On! into three
  const condor = cardSourcesForTarget(data.cardById.get(30102)!, 4, target('Speed Star'), 20, T, data, settings).filter((s) => eventKeyOf(s)?.endsWith(':chain:3'));
  assert.equal(condor.length, 1);
  assert.ok(Math.abs(condor[0]!.pObtain - r3) < 1e-9 && Math.abs(combineSources(condor).pGold - r3) < 1e-9, 'one 12% source, not 24%');
  const machitan = cardSourcesForTarget(data.cardById.get(30103)!, 4, target("It's On!"), 20, T, data, settings).filter((s) => eventKeyOf(s)?.endsWith(':chain:3'));
  assert.equal(machitan.length, 1);
  assert.ok(Math.abs(machitan[0]!.pObtain - r3) < 1e-9);
  // Fine Motion chain 3: gold or white, never both, so P(any) is the event chance
  const fine = cardSourcesForTarget(data.cardById.get(30010)!, 4, target('Speed Star'), 20, T, data, settings).filter((s) => eventKeyOf(s)?.endsWith(':chain:3'));
  const own = combineSources(fine);
  assert.ok(Math.abs(own.pAny - r3) < 1e-9 && Math.abs(own.pGold - r3 * g) < 1e-9 && Math.abs(own.pWhite - r3 * (1 - g)) < 1e-9);
  // Twin Turbo [TT Ignition!]: Givin' It 1000% from chain 2 (one outcome) and chain 3 (every outcome); reaching 3 implies 2
  const turbo = cardSourcesForTarget(data.cardById.get(30112)!, 4, target("Givin' It 1000%"), 20, T, data, settings).filter((s): s is EventSource & { chain: NonNullable<EventSource['chain']> } => s.kind === 'chain');
  const [r1, r2] = settings.chainRatesSSR as [number, number];
  const q2 = turbo.find((s) => s.chain.stage === 2)!.pObtain / r2, q3 = turbo.find((s) => s.chain.stage === 3)!.pObtain / r3;
  assert.ok(Math.abs(q3 - 1) < 1e-9);
  const nested = (r1 - r2) * 0 + (r2 - r3) * q2 + r3 * (1 - (1 - q2) * (1 - q3));
  assert.ok(Math.abs(combineSources(turbo).pAny - nested) < 1e-9, `nested ${nested}, got ${combineSources(turbo).pAny}`);
  assert.ok(combineSources(turbo).pAny < 1 - (1 - r2 * q2) * (1 - r3 * q3), 'less than independent stages');
  // a target offered by two options of one event counts one option
  const twoOptions: SkillSource[] = [0, 1].map((optionIndex) => ({ kind: 'chain', skillId: 1, gold: false, circle: false, pObtain: 0.5, isChoice: false, detail: '', event: { key: 'x:chain:1', label: '', option: `option ${optionIndex + 1}`, optionIndex } }));
  const pruned = pruneConflicts(new Map([[1, twoOptions]]), [1]).map.get(1)!;
  assert.equal(pruned.length, 1);
  assert.ok(Math.abs(combineSources(pruned).pAny - 0.5) < 1e-9);
  // and the option kept is the one worth the most to the target as a whole, not the one with the single best source:
  // Sasami Anshinzawa's Date 3 offers Nothing Ventured (gold) in both options and Risky Business (white) in the second only
  const sasami = data.cardById.get(30080)!;
  const risky = target('Risky Business');
  const date3 = cardSourcesForTarget(sasami, 4, risky, 20, T, data, settings).filter((s) => eventKeyOf(s) === `${sasami.id}:recreation:3`);
  assert.equal(date3.length, 3);
  assert.ok(date3.some((s) => s.gold && (s as EventSource).event.optionIndex === 0) && date3.some((s) => s.gold && (s as EventSource).event.optionIndex === 1));
  const kept = pruneConflicts(new Map([[risky.id, date3]]), [], [], settings);
  assert.deepEqual(kept.map.get(risky.id)!.map((s) => (s as EventSource).event.optionIndex), [1, 1], 'the second option gives the gold at the same chance plus the white form');
  assert.equal(kept.conflicts.length, 0, 'one target on the event: nothing was contested');
  assert.ok(Math.abs(combineSources(kept.map.get(risky.id)!).pAny - 2 * date3[0]!.pObtain) < 1e-9);
  // spark rates by form
  assert.ok(Math.abs(sparkChance({ pGold: 1, pWhite: 0 }, settings, 0) - settings.goldSparkRate) < 1e-9);
  assert.ok(Math.abs(sparkChance({ pGold: 0, pCircle: 1, pWhite: 0 }, settings, 0) - settings.circleSparkRate) < 1e-9);
  assert.ok(Math.abs(sparkChance({ pGold: 0, pWhite: 1 }, settings, 2) - settings.whiteSparkRate * 1.21) < 1e-9, 'each lineage copy multiplies by 1.1');
});

test('Pal and Group outings are skill sources at their own rates', () => {
  const lightHello = data.cardById.get(30052)!;
  const seeYa = resolveTarget(201661, data)!; // Playtime's Over (white) / See Ya Later! (gold)
  assert.equal(seeYa.gold?.id, 201662);
  const srcs = cardSourcesForTarget(lightHello, 4, seeYa, 20, T, data, settings);
  const finale = srcs.find((s) => s.kind === 'recreation')!;
  assert.ok(finale.gold && Math.abs(finale.pObtain - settings.palChainRate) < 1e-9, 'the finale gives the gold form at the date-chain rate');
  assert.ok(combineSources(srcs).pGold > 0.95);
  const throne = data.cardById.get(30067)!;
  assert.ok(Math.abs(cardSourcesForTarget(throne, 4, resolveTarget(201113, data)!, 20, T, data, settings).find((s) => s.kind === 'recreation')!.pObtain - settings.groupFinaleRate) < 1e-9);
  assert.ok(Math.abs(cardSourcesForTarget(throne, 4, resolveTarget(200452, data)!, 20, T, data, settings).find((s) => s.kind === 'recreation')!.pObtain - settings.groupOutingRate) < 1e-9);
});

test('lineage sparks: each copy rolls twice at the assumed affinity to hand over the hint, and each copy multiplies the spark chance', () => {
  const t = resolveTarget(200352, data)!;
  const ctx = ctxOf({ trainee: sw, lineage: new Map([[t.id, { k1: 1, k2: 1, p1: 3, p2: 3 }]]) });
  const lin = (traineeCoverage([t], ctx).sources.get(t.id) ?? []).find((s) => s.kind === 'lineage')!;
  const perEvent = Math.min(1, settings.whiteSparkInheritRates[2]! * affinityMultiplier(settings));
  assert.ok(Math.abs(lin.pObtain - (1 - Math.pow(1 - perEvent, 4))) < 1e-9, 'two sparks, two inspiration events each');
  const weak = { ...settings, affinity: 0 };
  const lin0 = (traineeCoverage([t], { ...ctx, settings: weak }).sources.get(t.id) ?? []).find((s) => s.kind === 'lineage')!;
  assert.ok(lin0.pObtain < lin.pObtain, 'a lower affinity lowers the hint chance');
});

// ----- scenario and event choices -----

test("Our Grand Concert's Senior November event: a linked character in the run (as trainee or card) turns her option gold, every option is a prioritized-skill candidate", () => {
  const focus = target('Focus');
  assert.equal(focus.gold?.name, 'Concentration');
  const ctx = ctxOf();
  const bourbon = cards.find((c) => c.charName === 'Mihono Bourbon' && c.type === 'wit')!;
  const without = evaluate(traineeCoverage([focus], ctx), [focus], ctx).map.get(focus.id)!.filter((s) => s.kind === 'scenario');
  assert.equal(without.length, 1); assert.ok(!without[0]!.gold, 'Focus (normal) when Bourbon is absent');
  const d = buildDeck([{ card: bourbon, lb: 4 }], [focus], ctx, [bourbon.id], 1);
  const withCard = d.coverage.get(focus.id)!.filter((s) => s.kind === 'scenario');
  assert.equal(withCard.length, 1); assert.ok(withCard[0]!.gold, 'Concentration when Bourbon is in the deck');
  const bourbonUma = characters.find((c) => c.name === 'Mihono Bourbon')!;
  const asTrainee = ctxOf({ trainee: bourbonUma });
  assert.ok(evaluate(traineeCoverage([focus], asTrainee), [focus], asTrainee).map.get(focus.id)!.some((s) => s.kind === 'scenario' && s.gold), 'Concentration when Bourbon is the trainee');
  assert.ok(!cardSourcesForTarget(kitasan, 4, focus, 20, T, data, settings).some((s) => s.kind === 'scenario'), 'a card alone is not a scenario source');
  // Tachyon as a card: her option is the gold Come What May, listed instead of All I've Got
  const allIveGot = target("All I've Got");
  const tachyon = cards.find((c) => c.charName === 'Agnes Tachyon' && c.rarity === 'SSR')!;
  const e = buildDeck([{ card: tachyon, lb: 4 }], [allIveGot], ctx, [tachyon.id], 1);
  assert.ok(e.coverage.get(allIveGot.id)!.filter((s) => s.kind === 'scenario').every((s) => s.gold));
  const wl = wishlistCandidates(e.deck, [allIveGot], ctx).map((w) => w.name);
  assert.ok(wl.includes('Come What May') && !wl.includes("All I've Got"), `list: ${wl.join(', ')}`);
  // with Focus also targeted, both scenario options stay listed even though only one can be taken
  const both = { ...ctx, priority: [focus.id, allIveGot.id] };
  const names = wishlistCandidates(buildDeck([{ card: tachyon, lb: 4 }], [allIveGot, focus], both, [tachyon.id], 1).deck, [allIveGot, focus], both).map((w) => w.name);
  assert.ok(names.includes('Come What May') && names.includes('Focus'), `both options listed: ${names.join(', ')}`);
  // every option is a candidate even with no targets
  const bare = wishlistCandidates([], [], ctx).map((w) => w.name);
  for (const n of ['Focus', "All I've Got", 'Full Tilt', 'Rosy Outlook', 'Lane Legerdemain']) assert.ok(bare.includes(n), `${n} missing from ${bare.join(', ')}`);
  const bareBourbon = wishlistCandidates([], [], asTrainee).map((w) => w.name);
  assert.ok(bareBourbon.includes('Concentration') && !bareBourbon.includes('Focus'));
});

test('one option per event: the prioritized order decides which target takes it, the loser stays listed, and an option that gives two targets keeps both', () => {
  const groundwork = resolveTarget(201601, data)!, focus = target('Focus');
  const falcon = cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power')!; // chain 1 offers Groundwork or Focus
  const targets = [groundwork, focus];
  const a = buildDeck([{ card: falcon, lb: 4 }], targets, ctxOf({ priority: [groundwork.id, focus.id] }), [], 1);
  assert.equal(a.conflicts.length, 1);
  assert.equal(a.conflicts[0]!.taken.target, groundwork.id);
  const key = a.conflicts[0]!.eventKey;
  assert.ok(a.coverage.get(groundwork.id)!.some((s) => eventKeyOf(s) === key) && !a.coverage.get(focus.id)!.some((s) => eventKeyOf(s) === key), 'Focus is not counted from the shared event');
  const b = buildDeck([{ card: falcon, lb: 4 }], targets, ctxOf({ priority: [focus.id, groundwork.id] }), [], 1);
  assert.equal(b.conflicts[0]!.taken.target, focus.id);
  assert.ok((a.sparks.get(groundwork.id) ?? 0) > (b.sparks.get(groundwork.id) ?? 0), 'Groundwork spark chance rises when it is first');
  const names = wishlistCandidates(a.deck, targets, ctxOf({ priority: [groundwork.id, focus.id] })).map((w) => w.name);
  assert.ok(names.includes('Groundwork') && names.includes('Focus'), `both options listed: ${names.join(', ')}`);
  // Ines Fujin chain 2: option 1 gives Medium Straightaways ○ and Sympathy together; option 2 gives Standard Distance ○ and Final Push
  const ines = data.cardById.get(20030)!;
  const straight = target('Medium Straightaways ○'), sympathy = target('Sympathy'), standard = target('Standard Distance ○');
  const ikey = `${ines.id}:chain:2`;
  const c = buildDeck([{ card: ines, lb: 4 }], [straight, sympathy], ctxOf({ priority: [straight.id, sympathy.id] }), [], 1);
  assert.ok(c.coverage.get(straight.id)!.some((s) => eventKeyOf(s) === ikey) && c.coverage.get(sympathy.id)!.some((s) => eventKeyOf(s) === ikey), 'the same option awards both');
  assert.ok(!c.conflicts.some((x) => x.eventKey === ikey), 'nothing to report');
  const d = buildDeck([{ card: ines, lb: 4 }], [straight, standard], ctxOf({ priority: [straight.id, standard.id] }), [], 1);
  assert.ok(!d.coverage.get(standard.id)!.some((s) => eventKeyOf(s) === ikey));
  assert.equal(d.conflicts.find((x) => x.eventKey === ikey)?.dropped[0]?.target, standard.id);
});

test('a non-target option ranked above a target takes the event and is reported, with every form of its family ranked together', () => {
  const focus = target('Focus'), lane = byName('Lane Legerdemain'), allIveGot = target("All I've Got");
  const base = ctxOf();
  assert.ok(wishlistCandidates([], [focus], base)[0]!.isTarget, 'targets come first');
  const normal = evaluate(traineeCoverage([focus], base), [focus], { ...base, priority: [focus.id, lane.id] });
  assert.ok(normal.map.get(focus.id)!.some((s) => s.kind === 'scenario') && normal.conflicts.length === 0, 'Focus keeps the scenario event when ranked first');
  const blocked = evaluate(traineeCoverage([focus], base), [focus], { ...base, priority: [lane.id, focus.id] });
  assert.ok(!blocked.map.get(focus.id)!.some((s) => s.kind === 'scenario'), 'Lane Legerdemain ranked first takes the event');
  assert.equal(blocked.conflicts.length, 1);
  assert.equal(blocked.conflicts[0]!.taken.skillId, lane.id);
  assert.equal(blocked.conflicts[0]!.taken.target, null);
  // Come What May ranked first as a non-target; with Tachyon absent the event offers All I've Got instead, which still outranks Focus
  const r = evaluate(traineeCoverage([focus], base), [focus], { ...base, priority: [...allIveGot.familyIds, focus.id] });
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0]!.taken.skillId, allIveGot.white!.id);
});

// ----- the agenda -----

const raceAt = (surface: Race['surface'], category: Race['category']): Race => ({ calendarId: 't', raceInstanceId: 0, raceId: 1, name: 't', distance: 2000, category, surface, year: 2, month: 5, half: 1, fansNeeded: 0, fansGain: 0, unreleasedEn: false });
const aptOf = (turf: Aptitudes['turf'], medium: Aptitudes['medium']): Aptitudes => traineeAptitudes(null, { turf, medium });

test("independent-training win odds: 110% at A/A minus the surface and distance penalties, then the streak penalty, clamped to 0..100% (Shoppo_ura's data)", () => {
  const r = raceAt('turf', 'medium');
  assert.ok(Math.abs(rawWinScore(r, aptOf('A', 'A')) - 1.1) < 1e-9);
  assert.equal(baseWinChance(r, aptOf('A', 'A')), 1);
  assert.equal(baseWinChance(r, aptOf('S', 'A')), 1, 'S counts as A');
  const cases: [Aptitudes['turf'], Aptitudes['medium'], number][] = [['A', 'B', 1.0], ['B', 'A', 1.0], ['A', 'E', 0.7], ['E', 'A', 0.6], ['A', 'G', 0.2], ['G', 'A', 0.2], ['C', 'E', 0.5], ['G', 'G', 0]];
  for (const [t, m, p] of cases) assert.ok(Math.abs(baseWinChance(r, aptOf(t, m)) - p) < 1e-9, `${t}/${m} -> ${p}`);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((k) => Number(winChance(1.1, k).toFixed(4))), [1, 1, 1, 0.9, 0.8, 0.6, 0.6], 'A/A absorbs the third race');
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((k) => Number(winChance(1.0, k).toFixed(4))), [1, 1, 0.95, 0.8, 0.7, 0.5], 'A/B loses from the third race');
  assert.deepEqual([1, 3, 4, 6].map((k) => Number(winChance(0.2, k).toFixed(4))), [0.2, 0.15, 0, 0]);
});

test('the agenda: one race per slot above the threshold, each G1 once, manual picks honoured, the streak penalty drops a race and says so', () => {
  const apt = traineeAptitudes(sw, {});
  const sched = buildSchedule(data.races, apt, 0.8, new Map());
  const sum = scheduleSummary(sched);
  assert.ok(sum.count > 5 && sum.count < 30, `count ${sum.count}`);
  const sel = sched.filter((s) => s.selected);
  assert.ok(sel.every((s) => s.pWin >= 0.8));
  assert.equal(new Set(sel.map((s) => s.race.raceId)).size, sel.length, 'each G1 at most once');
  assert.equal(new Set(sel.map((s) => s.slot)).size, sel.length, 'one race per slot');
  const dirt = sched.find((s) => s.race.surface === 'dirt');
  assert.ok(dirt && dirt.base <= 0.5);
  const arima = sched.filter((s) => s.race.name === 'Arima Kinen');
  const forced = buildSchedule(data.races, apt, 0.8, new Map([[arima[0]!.race.calendarId, true], [arima[1]!.race.calendarId, false]]));
  assert.ok(forced.find((s) => s.race.calendarId === arima[0]!.race.calendarId)!.selected && !forced.find((s) => s.race.calendarId === arima[1]!.race.calendarId)!.selected);
  const allA = traineeAptitudes(null, { turf: 'A', dirt: 'A', sprint: 'A', mile: 'A', medium: 'A', long: 'A' });
  const tight = buildSchedule(data.races, allA, 0.95, new Map());
  const tightSel = tight.filter((s) => s.selected);
  assert.ok(tightSel.length > 10 && tightSel.every((s) => s.consecutive <= 3), 'a fourth race in a row would sit at 90% and fail a 95% threshold');
  assert.ok(tightSel.some((s) => s.consecutive === 3 && s.pWin === 1), 'three in a row is still 100%');
  assert.ok(tight.some((s) => !s.selected && s.reason.startsWith('Streak penalty')), 'the dropped race says so');
  assert.ok(buildSchedule(data.races, allA, 0.85, new Map()).some((s) => s.selected && s.consecutive === 4), 'at 85% a fourth race (90%) gets through');
});

test('career goals are fixed in the agenda: a placement objective is won automatically, a participation-only one rolls the odds', () => {
  const seiun = characters.find((c) => c.name === 'Seiun Sky')!;
  const goals = goalRaces(seiun);
  assert.ok(goals.some((g) => g.name.includes('Tokyo Yushun')));
  const sched = buildSchedule(data.races, traineeAptitudes(seiun, {}), 0.8, new Map(), new Map(), goals);
  const derby = sched.find((s) => s.race.name.includes('Tokyo Yushun') && s.selected)!;
  assert.ok(derby.goal && derby.pWin === 1, 'the Derby is a selected goal and a top-five requirement, so it is won');
  assert.ok(!sched.some((s) => s.race.name === 'Japanese Oaks' && s.selected), 'the Oaks cannot be run in the Derby slot');
  assert.equal(sched.filter((s) => s.race.name === 'Arima Kinen' && s.selected).length, 2, 'both Arima goals run even though it is the same G1');
  const urara = characters.find((c) => c.name === 'Haru Urara')!;
  const ug = goalRaces(urara);
  assert.equal(ug.find((g) => g.name === 'Arima Kinen')!.autoWin, false, 'Haru Urara only has to take part in the Arima Kinen');
  assert.equal(ug.find((g) => g.name === 'JBC Sprint')!.autoWin, true, 'she must win the JBC Sprint');
  const us = buildSchedule(data.races, traineeAptitudes(urara, {}), 0.8, new Map(), new Map(), ug);
  assert.ok(us.find((s) => s.selected && s.goal && s.race.name === 'Arima Kinen')!.pWin < 0.3, 'turf G on her default aptitudes');
  assert.equal(us.find((s) => s.selected && s.goal && s.race.name === 'JBC Sprint')!.pWin, 1);
});

// ----- rating -----

test('rating: the UmaTools stat table exactly (values computed from its code), skills by form and aptitude bucket, the unique skill by stars and level', () => {
  for (const [v, pts] of [[0, 0], [-5, 0], [400, 577], [600, 1143], [1000, 2635], [1199, 3835], [1200, 3841], [1201, 3849], [1249, 4240], [1250, 4249], [1500, 6773], [1999, 14261], [2000, 14280], [2001, 14298]] as const) assert.equal(statScore(v), pts, `stat ${v}`);
  assert.equal(skillScore(byName('Groundwork'), null), 217);
  const sprint = skills.find((s) => s.rarity === 1 && s.tags.includes('sho') && !s.unreleasedEn)!;
  const apt = (g: Aptitudes['sprint']) => traineeAptitudes(null, { sprint: g });
  assert.deepEqual((['A', 'C', 'E', 'G'] as const).map((g) => skillScore(sprint, apt(g))), [1.1, 0.9, 0.8, 0.7].map((m) => Math.round(217 * m)));
  assert.equal(skillScore(byName('Groundwork'), apt('G')), 217, 'an unconditioned skill ignores aptitudes');
  assert.equal(skillScore(byName('Concentration'), null), 508);
  assert.deepEqual([uniqueSkillScore(3, 3), uniqueSkillScore(5, 6), uniqueSkillScore(2, 4), uniqueSkillScore(1, 1)], [510, 1020, 480, 120]);
  // The upgraded unique starts again at Lv1 at 3★; each career adds at most three levels.
  const turf = traineeAptitudes(null, {});
  assert.deepEqual([1, 2, 3, 4, 5].map((stars) => uniqueSkillLevel(stars, turf, () => 0, settings)), [1, 2, 1, 2, 3]);
  assert.deepEqual([1, 2, 3, 4, 5].map((stars) => uniqueSkillLevel(stars, turf, () => 200000, { ...settings, uniqueAprilBondRate: 1 })), [4, 5, 4, 5, 6]);
  assert.equal(uniqueSkillLevel(3, turf, () => 200000, { ...settings, uniqueAprilBondRate: 0.5 }), 3.5);
  assert.equal(uniqueSkillLevel(5, turf, () => 200000, { ...settings, uniqueAprilBondRate: 1 }), 6, 'capped');
  assert.equal(uniqueSkillLevel(3, turf, (slot) => (slot > 60 ? 130000 : 50000), settings), 2, 'only the December check is reached');
  assert.equal(uniqueSkillLevel(3, turf, (slot) => (slot >= 71 ? 120000 : 50000), settings), 2, 'fans through early December qualify for Christmas');
  assert.equal(uniqueSkillLevel(3, turf, (slot) => (slot >= 72 ? 120000 : 50000), settings), 1, 'fans from Arima Kinen in slot 71 arrive after the Christmas check');
  assert.equal(uniqueSkillLevel(3, traineeAptitudes(null, { turf: 'G', dirt: 'A' }), () => 45000, { ...settings, uniqueAprilBondRate: 1 }), 2, 'a dirt trainee clears the 40,000-fan February check');
});

// ----- inheritance -----

test('blue sparks: 20 distinct start gains each decoding to one star combination, fixed start gains, uncaps, and an assumed mean roll per inspiration proc at the affinity setting', () => {
  assert.equal(START_GAINS.length, 20);
  assert.equal(MAX_START_GAIN, 63);
  assert.equal(new Set(START_GAINS.map((g) => g.gain)).size, 20, 'no two star combinations show the same +XX');
  for (const g of START_GAINS) assert.equal(gainOfSparks(g.stars), g.gain);
  assert.deepEqual(sparksFromGain(26), [1, 3], '+26 is a 1★ and a 3★');
  assert.deepEqual(sparksFromGain(63), [3, 3, 3]);
  assert.deepEqual(sparksFromGain(7), [], 'a value the screen cannot show has no sparks');
  assert.deepEqual(sparksFromStars(7), [3, 3, 1], 'old slider totals still pack into sparks for migration');
  const s = { ...settings, affinity: 150, blueInspirationGainMean: [5.5, 8.5, 14.5] };
  const full = inheritedFromGain(63, s);
  assert.equal(full.start, 63, 'the start gain is fixed');
  assert.equal(full.uncap, 48, 'three 3★ sparks raise the cap by 16 each');
  assert.ok(Math.abs(full.inspiration - 3 * 2 * 14.5) < 1e-9, 'at 150 every proc is certain and adds the assumed mean roll, twice');
  assert.equal(full.inspirationMax, 3 * 2 * 28, 'at most 28 per proc');
  const mixed = inheritedFromGain(26, { ...s, affinity: 0 });
  assert.ok(Math.abs(mixed.inspiration - 2 * (0.9 * 14.5 + 0.7 * 5.5)) < 1e-9, 'at 0 affinity each spark rolls at its own star odds');
  assert.equal(mixed.uncap, 16 + 4);
  const two = inheritedFromParents([[63, 0, 0, 0, 0], [21, 0, 0, 0, 0]], 0, s);
  assert.equal(two.start, 84);
  assert.equal(two.uncap, 64);
});

// ----- the deck builder -----

test('deck: six distinct characters, one borrowed slot at the borrowed limit break, the trainee excluded, a wishlist of at most ten', () => {
  const ctx = ctxOf({ trainee: sw });
  const targets = [200352, 200762].map((id) => resolveTarget(id, data)!);
  const pool = cards.filter((c) => c.rarity === 'SSR').map((card) => ({ card, lb: 4 }));
  const r = rankCards(pool, targets, traineeCoverage(targets, ctx), ctx);
  assert.ok(r[0]!.marginalValue >= r[r.length - 1]!.marginalValue);
  const d = buildDeck(pool, targets, ctx, [30052]);
  assert.equal(d.deck.length, 6);
  assert.equal(d.deck[0]!.card.id, 30052);
  assert.equal(new Set(d.deck.map((x) => x.card.charId)).size, 6);
  assert.ok(!d.deck.some((x) => x.card.charId === sw.charId));
  const p = predictDeck(d.deck.map((x) => ({ card: x.card, lb: x.lb })), sw, 20, 'stamina', 1, data.model, settings);
  assert.ok(p.mean.every((v) => v > 300 && v < 1600), JSON.stringify(p.mean));
  assert.ok(wishlist(d.deck, targets, ctx).length <= 10);
  const srPool = cards.filter((c) => c.rarity === 'SR').map((card) => ({ card, lb: 2 }));
  const e = buildDeck(srPool, [resolveTarget(200352, data)!, resolveTarget(201601, data)!], ctx, [], 6, all4);
  assert.equal(e.deck.filter((x) => x.borrowed).length, 1);
  assert.ok(e.borrow && e.borrow.gain >= 0 && e.deck.find((x) => x.borrowed)!.lb === 4);
  assert.equal(new Set(e.deck.map((x) => x.card.charId)).size, 6);
});

test('pins are a shortlist: the best five owned pins fill the owned slots, a leftover pin is borrowed unless borrowFromAll, the rest are reported', () => {
  const corner = resolveTarget(200352, data)!;
  const targets = [corner, resolveTarget(201601, data)!];
  const ctx = ctxOf();
  const pool = cards.map((card) => ({ card, lb: 2 }));
  const seen = new Set<number>(); const pins: number[] = [];
  for (const c of cards.filter((c) => c.rarity === 'SSR')) { if (!seen.has(c.charId)) { seen.add(c.charId); pins.push(c.id); } if (pins.length === 8) break; }
  const d = buildDeck(pool, targets, ctx, pins, 6, all4);
  const owned = d.deck.filter((x) => !x.borrowed);
  assert.equal(owned.length, 5);
  assert.ok(owned.every((x) => pins.includes(x.card.id)), 'every owned slot is a pin');
  const b = d.deck.find((x) => x.borrowed)!;
  assert.ok(pins.includes(b.card.id) && b.lb === 4, "the friend's slot goes to a leftover pin at LB4");
  assert.equal(d.steps.filter((s) => s.includes('pinned but not chosen')).length, 2);
  const lastChosen = owned[owned.length - 1]!;
  const before = traineeCoverage(targets, ctx);
  for (const id of pins.filter((id) => !owned.some((x) => x.card.id === id))) assert.ok(rankCards([{ card: data.cardById.get(id)!, lb: 2 }], targets, before, ctx)[0]!.marginalValue <= rankCards([{ card: lastChosen.card, lb: 2 }], targets, before, ctx)[0]!.marginalValue + 1e-9, 'no left-out pin outscores the last chosen');
  const srPins = cards.filter((c) => c.rarity === 'SR' && c.charName !== 'Kitasan Black').filter((c, i, arr) => arr.findIndex((x) => x.charId === c.charId) === i).slice(0, 7).map((c) => c.id);
  const among = buildDeck(pool, [corner], ctx, { pinnedIds: srPins, borrowPool: all4 });
  const b1 = among.deck.find((x) => x.borrowed)!;
  assert.ok(srPins.includes(b1.card.id) && b1.lb === 4 && among.deck.filter((x) => srPins.includes(x.card.id)).length === 6);
  const overall = buildDeck(pool, [corner], ctx, { pinnedIds: srPins, borrowPool: all4, borrowFromAll: true });
  assert.ok(overall.deck.find((x) => x.borrowed)!.marginalValue >= b1.marginalValue - 1e-9, 'a free choice is at least as good as the best leftover pin');
  assert.equal(overall.steps.filter((s) => s.includes('pinned but not chosen')).length, 2);
});

test('one card per character among pins: the better of two pins of one character is kept, whether owned or unowned, and the other is reported', () => {
  const corner = resolveTarget(200352, data)!;
  const ctx = ctxOf();
  const kitas = cards.filter((c) => c.charName === 'Kitasan Black').map((c) => c.id);
  assert.ok(kitas.length >= 2);
  const d = buildDeck(all4, [corner], ctx, kitas, 6, all4);
  assert.equal(d.deck.filter((x) => x.card.charName === 'Kitasan Black').length, 1);
  assert.ok(d.steps.some((s) => s.includes('pinned but not chosen, same character as')));
  const kitaSr = cards.find((c) => c.charName === 'Kitasan Black' && c.id !== kitasan.id)!;
  // the other Kitasan card owned at LB0; the SSR unowned and hinting Corner Recovery at LB4: the borrow wins
  const e = buildDeck([{ card: kitaSr, lb: 0 }], [corner], ctx, { pinnedIds: [kitaSr.id, kitasan.id], borrowPool: all4 });
  assert.ok(e.deck.some((x) => x.card.id === kitasan.id && x.borrowed) && !e.deck.some((x) => x.card.id === kitaSr.id));
  assert.ok(e.steps.some((s) => s.startsWith(kitaSr.name) && s.includes('same character as')));
  // a pinned card of a character with another card in the pool keeps its own card in the deck
  const bourbon = cards.find((c) => c.charName === 'Mihono Bourbon' && c.type === 'wit')!;
  const f = buildDeck(cards.map((card) => ({ card, lb: 2 })), [target('Focus')], ctx, [bourbon.id], 6, all4);
  const bourbons = f.deck.filter((x) => x.card.charId === bourbon.charId);
  assert.equal(bourbons.length, 1);
  assert.equal(bourbons[0]!.card.id, bourbon.id);
});

test("unowned pins ask for the friend's slot: the best one is borrowed over a better free choice (still listed), the rest say where the slot went", () => {
  const corner = resolveTarget(200352, data)!;
  const ctx = ctxOf();
  const ownedPool = cards.filter((c) => c.charName !== 'Kitasan Black' && c.rarity !== 'SSR').map((card) => ({ card, lb: 2 }));
  const weak = ownedPool.find((p) => !p.card.hintSkills.includes(200352) && !p.card.eventSkills.length)!; // no way to give Corner Recovery
  assert.ok(buildDeck(ownedPool, [corner], ctx, { pinnedIds: [weak.card.id], borrowPool: all4 }).deck.some((x) => x.card.id === weak.card.id && !x.borrowed), 'an owned pin takes an owned slot');
  const palmer = cards.find((c) => c.charName === 'Mejiro Palmer' && c.rarity === 'SSR')!; // not in the owned pool
  const e = buildDeck(ownedPool, [corner], ctx, { pinnedIds: [palmer.id], borrowPool: all4 });
  const b = e.deck.find((x) => x.borrowed)!;
  assert.ok(b.card.id === palmer.id && b.lb === 4, 'the unowned pin is the borrow');
  assert.ok(e.borrowAlternatives.length > 0 && !e.borrowAlternatives.some((o) => o.card.id === palmer.id || e.deck.some((x) => !x.borrowed && x.card.charId === o.card.charId)), 'other borrows are listed, never the borrow itself or a character already in the deck');
  assert.ok(e.borrowAlternatives.every((o, i, arr) => i === 0 || arr[i - 1]!.gain >= o.gain - 1e-9), 'best first');
  const rPool = cards.filter((c) => c.rarity === 'R').map((card) => ({ card, lb: 4 }));
  const unowned = cards.filter((c) => c.rarity === 'SSR').filter((c, i, arr) => arr.findIndex((x) => x.charId === c.charId) === i).slice(0, 3).concat(kitasan).map((c) => c.id);
  const f = buildDeck(rPool, [corner], ctx, { pinnedIds: unowned, borrowPool: all4 });
  assert.equal(f.deck.filter((x) => x.borrowed).length, 1);
  assert.equal(f.deck.find((x) => x.borrowed)!.card.id, kitasan.id, 'Kitasan hints Corner Recovery, so she is the best of the unowned pins');
  assert.equal(f.steps.filter((s) => s.includes("the friend's slot went to")).length, 3);
});

test("the upgrade check borrows a deck card's LB4 copy when that frees a slot worth more, but never evicts a pinned borrow, and a pin of the trainee's own character is reported", () => {
  const corner = resolveTarget(200352, data)!;
  const ctx = ctxOf();
  // only Kitasan owned (at LB0) and only Kitasan borrowable: the upgrade step swaps the owned copy for the LB4 borrow
  const d = buildDeck([{ card: kitasan, lb: 0 }], [corner], ctx, [30028], 6, [{ card: kitasan, lb: 4 }]);
  const k = d.deck.find((x) => x.card.id === 30028)!;
  assert.ok(k.borrowed && k.lb === 4 && d.borrow?.replaces?.id === 30028 && d.deck.length === 1);
  // with borrowFromAll, an owned LB0 pin that is the best card overall ends up as the LB4 borrow
  const others = cards.filter((c) => c.rarity === 'SSR' && c.charName !== 'Kitasan Black').filter((c, i, arr) => arr.findIndex((x) => x.charId === c.charId) === i).slice(0, 5).map((c) => c.id);
  const e = buildDeck(cards.map((card) => ({ card, lb: 0 })), [corner], ctx, { pinnedIds: [...others, 30028], borrowPool: all4, borrowFromAll: true });
  const kita = e.deck.find((x) => x.card.id === 30028)!;
  assert.ok(kita.borrowed && kita.lb === 4 && e.deck.length === 6 && e.borrow?.replaces?.id === 30028);
  // a pinned borrow holds even when the upgrade would prefer Kitasan LB4
  const swCtx = ctxOf({ trainee: sw });
  const palmer = cards.find((c) => c.charName === 'Mejiro Palmer' && c.rarity === 'SSR')!;
  const f = buildDeck([{ card: kitasan, lb: 0 }], [corner], swCtx, { pinnedIds: [palmer.id], borrowPool: all4 });
  assert.equal(f.deck.find((x) => x.borrowed)!.card.id, palmer.id);
  assert.ok(f.deck.some((x) => x.card.id === kitasan.id && x.lb === 0));
  const swCard = cards.find((c) => c.charId === sw.charId)!;
  const g = buildDeck(all4, [corner], swCtx, { pinnedIds: [swCard.id], borrowPool: all4 });
  assert.ok(!g.deck.some((x) => x.card.charId === sw.charId) && g.steps.some((s) => s.includes("the trainee's own card")));
});

test('deck swaps preserve full-deck stat value when another card loses a unique effect', () => {
  // Removing Bourbon's Wit type for Vodka's Power disables Digital's five-type unique.
  const pool = [30104, 30001, 30039, 30090, 30085, 30066, 30005].map((id) => ({ card: data.cardById.get(id)!, lb: 4 }));
  const ctx = ctxOf({ races: 28, settings: { ...settings, focus: 'stamina' } });
  const focus = data.model.focus.stamina;
  let previous = -Infinity;
  for (const swapPasses of [0, 1, 2, 3]) {
    const result = buildDeck(pool, [], ctx, { pinnedIds: [], borrowPool: pool, swapPasses });
    const pred = predictDeck(result.deck, null, 28, 'stamina', 0, data.model, ctx.settings);
    const actual = pred.cardStats.reduce((sum, v, i) => sum + v * focus[i]!, 0);
    assert.ok(actual >= previous - 1e-6, `pass ${swapPasses} lowers full-deck value from ${previous} to ${actual}`);
    assert.ok(Math.abs(result.deck.reduce((sum, d) => sum + d.statPower, 0) - actual) < 1e-6, 'stored contributions match the predictor after each pass');
    previous = actual;
  }
});

test('deck card stats include the complete deck even when no swaps run', () => {
  const ctx = ctxOf({ races: 28 });
  const result = buildDeck(all4, [], ctx, { pinnedIds: [30090], borrowPool: all4, swapPasses: 0 });
  for (const d of result.deck) {
    const actual = cardContribution(d.card, d.lb, data.model, uniqueExtras(d.card, d.lb, data.model, { deck: result.deck }));
    assert.deepEqual(d.stats, actual.stats, `card ${d.card.id} must include the other five cards`);
    assert.equal(d.sp, actual.sp);
  }
});

test('the swap pass never leaves the deck worse than the greedy build, reports each swap, never touches a pin, and values stats by the training focus', () => {
  const targets = [200352, 201601, 200762, 200452, 201113].map((id) => resolveTarget(id, data)!);
  const ctx = ctxOf({ trainee: sw });
  const pool = cards.map((card) => ({ card, lb: 2 }));
  const greedy = buildDeck(pool, targets, ctx, { pinnedIds: [30052], borrowPool: all4, swapPasses: 0 });
  const improved = buildDeck(pool, targets, ctx, { pinnedIds: [30052], borrowPool: all4 });
  const value = (d: typeof greedy) => [...d.sparks.values()].reduce((a, b) => a + b, 0);
  const stats = (d: typeof greedy) => d.deck.reduce((a, x) => a + x.statPower, 0);
  assert.ok(value(improved) >= value(greedy) - 1e-9);
  if (Math.abs(value(improved) - value(greedy)) <= 1e-9) assert.ok(stats(improved) >= stats(greedy) - 1e-6);
  const swaps = improved.steps.filter((s) => s.startsWith('Swap '));
  assert.equal(swaps.length > 0, improved.deck.some((d, i) => d.card.id !== greedy.deck[i]?.card.id), 'every change is reported as a swap step');
  assert.ok(!swaps.some((s) => s.startsWith(`Swap ${data.cardById.get(30052)!.name}`)), 'a pinned card is never swapped out');
  assert.equal(new Set(improved.deck.map((x) => x.card.charId)).size, improved.deck.length);
  const finalBorrow = improved.deck.find((x) => x.borrowed)!;
  assert.equal(improved.borrow?.card.id, finalBorrow.card.id, 'the borrow named is the one in the deck after the swaps');
  assert.ok(improved.borrowAlternatives.length > 0 && !improved.borrowAlternatives.some((o) => o.card.id === finalBorrow.card.id || improved.deck.some((x) => !x.borrowed && x.card.charId === o.card.charId)), 'the alternatives follow the final deck');
  const f = data.model.focus;
  buildDeck(pool, [], { ...ctx, settings: { ...settings, focus: 'sprint' } }, { pinnedIds: [30052], borrowPool: all4 }).deck.forEach((d) => assert.ok(Math.abs(d.statPower - d.stats.reduce((a, v, i) => a + v * f.sprint[i]!, 0)) < 1e-6, 'stat power is focus-weighted'));
  buildDeck(pool, [], { ...ctx, settings: { ...settings, focus: 'balanced' } }, { pinnedIds: [30052], borrowPool: all4 }).deck.forEach((d) => assert.ok(Math.abs(d.statPower - d.stats.reduce((a, v) => a + v, 0)) < 1e-6));
});

test('expected fans sum each scheduled race\'s fans times its win chance, the same total the unique-skill checks use', () => {
  const brian = data.charByCardId.get(101601)!;
  const sched = buildSchedule(data.races, brian.aptitudes, 0.8, new Map(), new Map(), goalRaces(brian));
  const sum = scheduleSummary(sched);
  assert.ok(sum.expectedFans > 0);
  assert.equal(sum.expectedFans, expectedFansBefore(sched, SLOT_COUNT));
  const byHand = sched.filter((s) => s.selected).reduce((a, s) => a + s.race.fansGain * Math.min(1, s.pWin), 0);
  assert.equal(sum.expectedFans, byHand);
});
