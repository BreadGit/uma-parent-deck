import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { readFileSync } from 'node:fs';
import { GOAL_TEMPLATES } from '../src/model/goal-templates.ts';
import { sanitizeGoal, sanitizeTargets } from '../src/model/goal-input.ts';
import { hasWhiteSpark, resolveTarget } from '../src/model/sparks.ts';
import { planRun } from '../src/model/run.ts';
import { defaultState, migrate } from '../src/state.ts';
import { loadData } from '../src/data.ts';

const data = loadData();
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const source = readFileSync(new URL('../docs/spark-goal-templates.md', import.meta.url), 'utf8');

test('template catalog preserves supplied names, order, spark requirements, and priorities', () => {
  const entries = source.split(/^(?:- )?(.+ parent \(.+\))\s*$/m).slice(1);
  assert.equal(GOAL_TEMPLATES.length, 12);
  assert.equal(entries.length, GOAL_TEMPLATES.length * 2);
  assert.equal(new Set(GOAL_TEMPLATES.map((t) => t.id)).size, GOAL_TEMPLATES.length);
  for (const [i, template] of GOAL_TEMPLATES.entries()) {
    assert.equal(template.name, entries[i * 2]);
    assert.ok(template.id, `${template.name} has an id`);
    const body = entries[i * 2 + 1]!;
    const field = (name: string) => must(body.split('\n').find((line) => line.trim().startsWith(`- ${name}: `))).trim().slice(name.length + 4);
    const blue = field('blue sparks').match(/^(.*) ([123])\*$/)!;
    assert.deepEqual(template.goal.blueStats, blue[1] === 'any' ? ['speed', 'stamina', 'power', 'guts', 'wit'] : blue[1]!.split(', '));
    assert.equal(template.goal.blueStars, Number(blue[2]));
    const pink = field('pink sparks').match(/^(.*) ([123])\*$/)!;
    assert.deepEqual(template.goal.pink, [{ aptitude: pink[1], stars: Number(pink[2]) }]);
    for (const role of ['required', 'preferred'] as const) {
      const expected = field(role).split(', ').map((entry) => {
        const parts = entry.match(/^(.*?) (?:([123])\*|p=(\d+))$/)!;
        return { name: normalize(parts[1]!), value: Number(parts[2] ?? parts[3]) };
      });
      assert.deepEqual(template.targets.filter((t) => t.role === role).map((t) => {
        const resolved = resolveTarget(t.id, data)!;
        assert.equal(resolved.id, t.id);
        assert.ok(hasWhiteSpark(resolved), `${resolved.name} has a white spark form`);
        return { name: normalize(resolved.name), value: role === 'required' ? t.stars : t.priority };
      }), expected, template.name);
    }
    assert.deepEqual(sanitizeGoal(template.goal), template.goal);
    assert.deepEqual(sanitizeTargets(template.targets, data), template.targets);
    if (body.includes('optional description')) {
      assert.equal(template.description, field('optional description'));
    }
  }
});

test('template copies stay editable and saved lineage survives targets disappearing and returning', () => {
  const original = structuredClone(GOAL_TEMPLATES);
  const saved = defaultState(data);
  saved.run.targetLineage = { 210052: [2, 0, 0, 0, 0, 0] };
  for (const index of [2, 0, 2]) {
    const copy = structuredClone(GOAL_TEMPLATES[index]!);
    saved.run.goal = copy.goal;
    saved.run.targets = copy.targets;
    assert.deepEqual(migrate({ current: saved }, data).run, saved.run);
  }
  saved.run.goal.pink[0]!.stars = 1;
  saved.run.targets[0]!.stars = 3;
  saved.run.targets.at(-1)!.priority = 3;
  assert.deepEqual(GOAL_TEMPLATES, original);
});

test('all supplied templates produce finite estimates without modifying the catalog', () => {
  const original = structuredClone(GOAL_TEMPLATES);
  for (const template of GOAL_TEMPLATES) {
    const saved = defaultState(data), copy = structuredClone(template);
    saved.run.traineeCardId = 100101;
    saved.run.goal = copy.goal;
    saved.run.targets = copy.targets;
    Object.assign(saved.run.targetLineage, copy.targetLineage);
    const plan = planRun(saved.run, saved.settings, saved.inventory, data, { search: false });
    assert.ok(Number.isFinite(plan.goalEstimate.probability), template.name);
    if (template.targetLineage) assert.ok(plan.goalEstimate.probability! > 0, template.name);
    assert.equal(plan.goalEstimate.required.length, template.targets.filter((t) => t.role === 'required').length);
    assert.equal(plan.goalEstimate.preferred.length, template.targets.filter((t) => t.role === 'preferred').length);
  }
  assert.deepEqual(GOAL_TEMPLATES, original);
});

test('godly defaults give every required white spark inherited hints and accept Any pink at two stars', async () => {
  const { lineageSources } = await import('../src/model/sparks.ts');
  const { DEFAULT_SETTINGS } = await import('../src/settings.ts');
  assert.equal(GOAL_TEMPLATES.filter((t) => t.name.endsWith('(godly)')).length, 4);
  for (const template of GOAL_TEMPLATES.filter((t) => t.name.endsWith('(godly)'))) {
    const required = template.targets.filter((g) => g.role === 'required');
    assert.deepEqual(template.goal.pink, [{ aptitude: 'any', stars: 2 }]);
    assert.doesNotMatch(template.description!, /turf|stand-in|track distance/i);
    assert.deepEqual(Object.keys(template.targetLineage!).map(Number).sort(), required.map((g) => g.id).sort(), template.name);
    for (const goal of required) {
      const lineage = template.targetLineage![goal.id]!;
      assert.deepEqual(lineage, [3, 2, 2, 3, 2, 2], 'three copies totaling 7★ on each side');
      const target = resolveTarget(goal.id, data)!;
      assert.deepEqual(lineageSources(target, undefined, DEFAULT_SETTINGS), []);
      const inherited = lineageSources(target, lineage, DEFAULT_SETTINGS);
      // Each side spreads seven stars as 3, 2, 2. Each copy rolls at both inspiration events.
      const p3 = Math.min(1, DEFAULT_SETTINGS.whiteSparkInheritRates[2]! * (1 + DEFAULT_SETTINGS.affinity / 100));
      const p2 = Math.min(1, DEFAULT_SETTINGS.whiteSparkInheritRates[1]! * (1 + DEFAULT_SETTINGS.affinity / 100));
      assert.ok(Math.abs(inherited[0]!.pObtain - (1 - (1 - p3) ** 4 * (1 - p2) ** 8)) < 1e-12, `${target.name} inherited hint chance ${inherited[0]!.pObtain}`);
    }
  }
  assert.ok(GOAL_TEMPLATES.filter((t) => !t.name.endsWith('(godly)')).every((t) => !t.targetLineage), 'only godly templates carry lineage');
});
