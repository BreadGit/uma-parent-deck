// The panel's claims about each skill must match what the estimate credits for the same list. Random event setups,
// fixed seed: every entry is offered by its events on one option, and pruneConflicts, given every entry as a family and
// the listed skills as the priority, is the ground truth for which options the run takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangePriorities, derivePriority, type PriorityList } from '../src/model/run.ts';
import { pruneConflicts, type EventSource } from '../src/model/sparks.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import type { WishlistEntry } from '../src/model/deck.ts';

function random(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Case { ordered: WishlistEntry[]; added: number[]; max: number }
function makeCase(rand: () => number): Case {
  const int = (n: number) => Math.floor(rand() * n);
  const events = Array.from({ length: 1 + int(5) }, (_, i) => ({ key: `e${i}`, options: 2 + int(3), defaultIndex: rand() < 0.2 ? 1 : 0 }));
  const entry = (key: number, isTarget: boolean): WishlistEntry => {
    const picked = [...new Set(Array.from({ length: 1 + int(2) }, () => int(events.length)))].map((i) => events[i]!);
    return { key, skillId: key, name: `s${key}`, form: null, gated: true, isTarget, role: isTarget ? 'preferred' : 'extra', targetId: isTarget ? key : null, reason: '', weight: 1, owner: '',
      events: picked.map((e) => ({ key: e.key, label: e.key, option: '', optionIndex: int(e.options), ...(e.defaultIndex ? { defaultIndex: e.defaultIndex } : {}) })) };
  };
  const targets = Array.from({ length: 1 + int(6) }, (_, i) => entry(i + 1, true));
  const extras = Array.from({ length: int(6) }, (_, i) => entry(i + 101, false));
  const added = extras.filter(() => rand() < 0.5).map((w) => w.key).sort(() => rand() - 0.5);
  return { ordered: [...targets, ...extras], added, max: 2 + int(9) };
}

/** The events each entry is credited with when `list` is entered, by the estimate's own rule. */
function credited(ordered: WishlistEntry[], list: PriorityList): Map<number, Set<string>> {
  const source = (w: WishlistEntry, e: WishlistEntry['events'][number]): EventSource => ({ kind: 'random', skillId: w.skillId, gold: false, circle: false, pObtain: 0.5, isChoice: true, detail: '', event: e });
  const map = new Map(ordered.map((w) => [w.key, w.events.map((e) => source(w, e))]));
  const kept = pruneConflicts(map, derivePriority(list.listed), [], DEFAULT_SETTINGS, []).map;
  return new Map(ordered.map((w) => [w.key, new Set((kept.get(w.key) ?? []).map((s) => (s as EventSource).event.key))]));
}

const describe = (c: Case, list: PriorityList) => JSON.stringify({ max: c.max, added: c.added, entries: c.ordered.map((w) => [w.key, w.events.map((e) => `${e.key}@${e.optionIndex}${e.defaultIndex ? `/d${e.defaultIndex}` : ''}`)]),
  listed: list.listed.map((w) => w.key), overflow: list.overflow.map((w) => w.key), unlisted: list.unlisted.map((u) => `${u.entry.key}:${u.reason}`), extras: list.extras.map((x) => `${x.entry.key}:${x.status.kind}`) });

test('across random event setups, what the panel says each skill gets matches what the estimate credits', () => {
  const rand = random(20261104);
  for (let n = 0; n < 3000; n++) {
    const c = makeCase(rand);
    const list = arrangePriorities(c.ordered, c.added, c.max);
    const got = credited(c.ordered, list);
    const gets = (key: number) => got.get(key)!.size > 0;
    const where = () => `case ${n}: ${describe(c, list)}`;
    assert.ok(list.listed.length <= c.max, `the list fits the game's limit; ${where()}`);
    for (const w of list.listed) assert.ok(gets(w.key), `listed ${w.key} gets one of its events; ${where()}`);
    for (const u of list.unlisted) {
      if (u.reason === 'first' || u.reason === 'along') assert.ok(gets(u.entry.key), `${u.entry.key} (${u.reason}) gets an event without a listing; ${where()}`);
      if (u.reason === 'lost') assert.ok(!gets(u.entry.key), `${u.entry.key} (lost) gets none of its events; ${where()}`);
    }
    for (const x of list.extras) {
      if (x.status.kind === 'anyway') assert.ok(gets(x.entry.key), `extra ${x.entry.key} (anyway) gets an event without a listing; ${where()}`);
      if (x.status.kind === 'blocked' || x.status.kind === 'swap') assert.ok(!gets(x.entry.key), `extra ${x.entry.key} (${x.status.kind}) gets none of its events; ${where()}`);
      if (x.status.kind !== 'add') continue;
      const after = arrangePriorities(c.ordered, [...c.added, x.entry.key], c.max);
      const gotAfter = credited(c.ordered, after);
      assert.ok(after.listed.some((w) => w.key === x.entry.key) && gotAfter.get(x.entry.key)!.size > 0, `adding ${x.entry.key} lists it and it gets an event; ${where()}`);
      for (const [key, events] of got) if (key < 100 && events.size && !gotAfter.get(key)!.size) assert.fail(`adding ${x.entry.key} takes every event of targeted skill ${key}; ${where()}`);
    }
  }
});
