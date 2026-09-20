import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { makeCtx, wishlistCandidates } from '../src/model/deck.ts';
import { resolveTarget } from '../src/model/sparks.ts';
import { SCENARIO_COMPLETION_SKILLS } from '../src/model/rules.ts';

const data = loadData();
const ctx = makeCtx({ data, settings: DEFAULT_SETTINGS, races: 20, totalTurns: 72, trainee: null });
const target = (name: string) => resolveTarget(data.skills.find((s) => s.name === name && !s.unreleasedEn)!.id, data)!;

test('automatic outing rewards identify the card and event for the displayed form', () => {
  const skill = target('See Ya Later!');
  const card = data.cards.find((c) => c.name === '[From the Ground Up] Light Hello')!;
  const entry = wishlistCandidates([{ card, lb: 4 }], [skill], ctx).find((w) => w.targetId === skill.id)!;
  assert.equal(entry.name, 'See Ya Later!');
  assert.equal(entry.gated, false);
  assert.ok(entry.reason.includes(card.name));
  assert.match(entry.reason, /Date 5 "At Rainbow Cove"/);
  assert.match(entry.reason, /one of 2 outcomes/);
  assert.doesNotMatch(entry.reason, /Given without an event choice/);
});

test('automatic sources retain both hints and events without repeating identical event options', () => {
  const skill = target('After-School Stroll');
  const card = {
    ...data.cardById.get(30028)!, name: 'Source test card', hintSkills: [skill.id], eventSkills: [skill.id],
    randomEvents: [], recreationEvents: [], specialEvents: [],
    chainEvents: [{ kind: 'chain' as const, index: 1, name: 'Shared reward', choices: [0, 1].map(() => ({ outcomes: [[{ t: 'sk', d: skill.id }]] })) }],
  };
  const entry = wishlistCandidates([{ card, lb: 4 }], [skill], ctx).find((w) => w.targetId === skill.id)!;
  assert.equal(entry.gated, false);
  assert.match(entry.reason, /Source test card: Hint/);
  assert.match(entry.reason, /Source test card: Chain event 1 "Shared reward"/);
  assert.equal(entry.reason.match(/Shared reward/g)?.length, 1);
});

test('trainee and scenario rewards identify their owner and preserve conditions', () => {
  const skill = target('After-School Stroll');
  const trainee = {
    ...data.characters[0]!, innateSkills: [], awakeningSkills: [], eventSkills: [skill.id],
    events: [{ kind: 'story' as const, index: 1, name: 'Training reward', choices: [{ outcomes: [[{ t: 'sk', d: skill.id }]] }] }],
  };
  const entry = wishlistCandidates([], [skill], { ...ctx, trainee }).find((w) => w.targetId === skill.id)!;
  assert.ok(entry.reason.includes(trainee.name));
  assert.match(entry.reason, /Training reward/);
  const undecoded = wishlistCandidates([], [skill], { ...ctx, trainee: { ...trainee, events: [] } }).find((w) => w.targetId === skill.id)!;
  assert.ok(undecoded.reason.includes(trainee.name));
  assert.match(undecoded.reason, /not decoded.*trigger unknown/);
  const completion = resolveTarget(SCENARIO_COMPLETION_SKILLS[ctx.settings.scenarioId]!.gold, data)!;
  const reward = wishlistCandidates([], [completion], ctx).find((w) => w.targetId === completion.id)!;
  assert.match(reward.reason, /Our Grand Concert/);
  assert.match(reward.reason, /18 or more songs/);
  assert.doesNotMatch(reward.reason, /fewer than/, 'the gold entry does not describe the white form');
});
