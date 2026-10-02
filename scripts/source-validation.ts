import assert from 'node:assert/strict';
import { decodeRewards, eventOnGlobal, normalizeReward, staticEventOnGlobal } from './event-import.ts';
import { fingerprint, pageCacheMatches, pageInput, type PageRevision } from './page-cache.ts';

// Source JSON has several unrelated schemas. Checks below validate values before normalization or comparison.
type Row = Record<string, any>;
export type SourceTables = Record<string, Row[]>;
export interface PageSources { eventNames: Record<string, Row>; palGroupEvents: Record<string, Row>; charEvents: Record<string, Row>; charEventsByCard: Record<string, Row> }
export interface NormalizedTables { cards: Row[]; skills: Row[]; characters: Row[]; races: Row[]; ranks: Row[]; effects: Row[]; scenarios: Row[]; scenarioEvents: Row[] }
const global = (rows: Row[]) => rows.filter((row) => row.release_en);
const equal = (actual: unknown, expected: unknown, label: string) => assert.deepEqual(actual, expected, `Source reconciliation: ${label}`);
function check(valid: unknown, label: string): asserts valid { assert.ok(valid, `Source validation: ${label}`); }
const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate successful HTTP bodies before a download replaces its cached source file. */
export function parseSourceDownload(text: string, shape: 'array' | 'object', source: string): unknown {
  const payload: unknown = JSON.parse(text);
  check(shape === 'array' ? Array.isArray(payload) : object(payload), `${source} did not return the expected JSON ${shape}`);
  return payload;
}

function uniqueRows(rows: Row[], key: string, label: string): void {
  check(Array.isArray(rows), `${label} must be an array`);
  const seen = new Set();
  for (const row of rows) {
    check(object(row) && row[key] != null, `${label} must contain ${key}`);
    check(!seen.has(String(row[key])), `${label} duplicates ${key} ${row[key]}`);
    seen.add(String(row[key]));
  }
}

function idsMatch(source: Row[], result: Row[], sourceKey: string, key: string, label: string): void {
  uniqueRows(result, key, label);
  equal(result.map((row) => String(row[key])).sort(), source.map((row) => String(row[sourceKey])).sort(), `${label} ID completeness`);
}

function validatePage(page: Row, label: string): void {
  check(object(page), `${label} is missing; refresh page data before normalizing`);
  const eventGroups = new Set(['nochoice', 'wchoice', 'outings', 'secret', 'version', 'random', 'dates', 'dates_random', 'special']);
  for (const [group, events] of Object.entries(page)) {
    if (group === 'dance' || group === 'nyear') continue; // Stat selections, not events with skill rewards.
    check(eventGroups.has(group), `${label}.${group} is an unfamiliar event group`);
    check(Array.isArray(events), `${label}.${group} must be an array`);
    for (const [i, source] of events.entries()) {
      check(object(source), `${label}.${group}[${i}] must be an event`);
      const event = eventOnGlobal(source);
      if (!event) continue;
      check(Array.isArray(event.c), `${label}.${group}[${i}] choices are missing`);
      for (const choice of event.c) {
        check(object(choice) && Array.isArray(choice.r), `${label}.${group}[${i}] rewards are missing`);
        choice.r.forEach(normalizeReward);
      }
      if (event.conditions != null) check(Array.isArray(event.conditions) && event.conditions.every(Array.isArray), `${label}.${group}[${i}] conditions must be arrays`);
    }
  }
}

function staticRewards(event: unknown[], dictionary: unknown[]) {
  const selected = staticEventOnGlobal(event);
  const choices = selected[1];
  if (choices === 'no') return [];
  check(Array.isArray(choices), `event ${String(selected[2])} choices must be an array or "no"`);
  return choices.flatMap((choice) => {
    check(Array.isArray(choice) && Array.isArray(choice[1]), `event ${String(selected[2])} reward list is missing`);
    return choice[1].flatMap((id: number) => decodeRewards(dictionary, id));
  }).filter((reward) => reward.t !== 'di');
}

function pageRewards(source: Row) {
  const event = eventOnGlobal(source);
  return event ? event.c.flatMap((choice: Row) => choice.r.map(normalizeReward)).filter((reward: Row) => reward.t !== 'di') : [];
}

/** Legacy snapshots have no revision file. Once revisions exist, an interrupted refresh must not mix source versions. */
export function validatePageRevisions(raw: SourceTables, pages: PageSources, uniqueTexts: Record<string, string>, revisions?: Record<string, PageRevision>): void {
  if (!revisions) return;
  const files = ['training_events__ssr', 'training_events__sr', 'training_events__friend', 'training_events__group',
    'training_events__shared', 'training_events__char', 'training_events__char_card', 'dict__evrew'];
  const sources = Object.fromEntries(files.map((key) => [key, fingerprint(raw[key.replace('__', '/')])]));
  const current = (key: string, card: Row, payload: unknown) => check(pageCacheMatches(revisions[key], pageInput(key, card, sources), payload), `${key} page cache does not match its source revision; finish npm run fetch before normalizing`);
  for (const card of global(raw['support-cards']!)) {
    current(`support:${card.support_id}`, card, { names: pages.eventNames[card.support_id], ...(['friend', 'group'].includes(card.type) ? { full: pages.palGroupEvents[card.support_id] } : {}) });
    if (card.unique?.effects.some((effect: Row) => effect.type >= 100)) current(`unique:${card.support_id}`, card, uniqueTexts[card.support_id]);
  }
  const seen = new Set();
  for (const card of global(raw['character-cards']!).sort((a, b) => a.card_id - b.card_id)) {
    if (seen.has(card.char_id)) current(`outfit:${card.card_id}`, card, pages.charEventsByCard[card.card_id]);
    else current(`character:${card.char_id}`, card, pages.charEvents[card.char_id]);
    seen.add(card.char_id);
  }
}

/** Check referential source integrity and required page coverage before deriving any normalized files. */
export function validateSourceTables(raw: SourceTables, pages: PageSources): void {
  const keys: Record<string, string> = { 'support-cards': 'support_id', skills: 'id', 'character-cards': 'card_id', characters: 'char_id', races: 'id', 'ura-races': 'id', 'ura-objectives': 'char_id', scenarios: 'id', 'en/db-files/single_mode_rank': 'id', support_effects: 'id' };
  for (const [table, key] of Object.entries(keys)) uniqueRows(raw[table]!, key, table);
  const skillIds = new Set(raw.skills!.map((skill) => skill.id));
  const refs = (list: unknown, label: string) => {
    check(Array.isArray(list), `${label} must be an array`);
    for (const value of list) check(skillIds.has(Number(value)), `${label} references unknown skill ${String(value)}`);
  };
  for (const skill of raw.skills!) {
    refs(skill.versions ?? [], `skill ${skill.id} versions`);
    const cost = skill.loc?.en?.cost ?? skill.cost;
    check(cost == null || (numeric(cost) && cost >= 0), `skill ${skill.id} cost is invalid`);
  }
  const knownChars = new Set(raw.characters!.map((char) => char.char_id));
  for (const card of global(raw['support-cards']!)) {
    check(knownChars.has(card.char_id), `support ${card.support_id} references unknown character ${card.char_id}`);
    refs(card.hints?.hint_skills ?? [], `support ${card.support_id} hints`);
    refs(card.event_skills_en ?? card.event_skills ?? [], `support ${card.support_id} events`);
    check(object(pages.eventNames[card.support_id]), `support ${card.support_id} page names are missing`);
    if (['friend', 'group'].includes(card.type)) validatePage(pages.palGroupEvents[card.support_id]!, `support ${card.support_id} page`);
  }
  const firstOutfit = new Map<number, number>();
  for (const char of global(raw['character-cards']!).sort((a, b) => a.card_id - b.card_id)) {
    check(knownChars.has(char.char_id), `outfit ${char.card_id} references unknown character`);
    if (!firstOutfit.has(char.char_id)) firstOutfit.set(char.char_id, char.card_id);
    for (const key of ['base_stats', 'stat_bonus']) check(Array.isArray(char[key]) && char[key].length === 5 && char[key].every(numeric), `outfit ${char.card_id} ${key} must have five numeric values`);
    for (const key of ['two_star_stats', 'three_star_stats', 'four_star_stats', 'five_star_stats']) if (char[key] != null) check(Array.isArray(char[key]) && char[key].length === 5 && char[key].every(numeric), `outfit ${char.card_id} ${key} must have five numeric values`);
    check(Array.isArray(char.aptitude) && char.aptitude.length === 10 && char.aptitude.every((grade: string) => /^[SABCDEFG]$/.test(grade)), `outfit ${char.card_id} aptitudes are invalid`);
    for (const key of ['skills_innate', 'skills_event', 'skills_unique']) refs(char[key] ?? [], `outfit ${char.card_id} ${key}`);
    refs(char.skills_awakening_en ?? char.skills_awakening ?? [], `outfit ${char.card_id} awakening skills`);
    validatePage(pages.charEvents[char.char_id]!, `character ${char.char_id} page`);
    if (firstOutfit.get(char.char_id) !== char.card_id) validatePage(pages.charEventsByCard[char.card_id]!, `outfit ${char.card_id} page`);
    check(raw['ura-objectives']!.some((entry) => entry.char_id === char.char_id), `outfit ${char.card_id} has no career objective source`);
  }
  const instances = new Set(raw.races!.map((race) => race.id));
  for (const calendar of raw['ura-races']!) check(calendar.special_race || instances.has(calendar.instance), `calendar ${calendar.id} references missing race instance ${calendar.instance}`);
  for (const file of ['training_events/ssr', 'training_events/sr', 'training_events/shared']) {
    const owners = new Set();
    for (const entry of raw[file]!) {
      check(Array.isArray(entry) && Array.isArray(entry[1]), `${file} has malformed owner/event data`);
      check(!owners.has(entry[0]), `${file} duplicates owner ${entry[0]}`); owners.add(entry[0]);
      entry[1].forEach((event: unknown[]) => staticRewards(event, raw['dict/evrew']!));
    }
  }
  const ranks = [...raw['en/db-files/single_mode_rank']!].sort((a, b) => a.min_value - b.min_value);
  ranks.forEach((rank, i) => {
    check(numeric(rank.min_value) && numeric(rank.max_value) && rank.max_value >= rank.min_value, `rank ${rank.id} has invalid bounds`);
    if (i) check(rank.min_value === ranks[i - 1]!.max_value + 1, `rank ${rank.id} has a gap or overlap`);
  });
}

/** Reconcile normalized runtime fields with source values, independent of runtime model tests. */
export function reconcileSources(raw: SourceTables, pages: PageSources, out: NormalizedTables): void {
  idsMatch(global(raw['support-cards']!), out.cards, 'support_id', 'id', 'cards');
  idsMatch(raw.skills!, out.skills, 'id', 'id', 'skills');
  idsMatch(global(raw['character-cards']!), out.characters, 'card_id', 'cardId', 'characters');
  idsMatch(raw['en/db-files/single_mode_rank']!, out.ranks, 'id', 'id', 'ranks');
  idsMatch(raw.support_effects!, out.effects, 'id', 'id', 'support effects');
  idsMatch(raw.scenarios!.filter((scenario) => scenario.start_en), out.scenarios, 'id', 'id', 'scenarios');
  const cards = new Map(raw['support-cards']!.map((card) => [card.support_id, card]));
  const staticChain = new Map([...raw['training_events/ssr']!, ...raw['training_events/sr']!].map((entry) => [entry[0], entry[1]]));
  const shared = new Map(raw['training_events/shared']!.map((entry) => [entry[0], entry[1]]));
  const checkEvents = (actual: Row[], expected: Row[][], label: string) => {
    equal(actual.length, expected.length, `${label} event count`);
    actual.forEach((event, index) => {
      equal(event.index, index + 1, `${label} event index`);
      equal(event.choices.flatMap((choice: Row) => choice.outcomes.flat()), expected[index], `${label} event ${index + 1} rewards`);
    });
  };
  for (const card of out.cards) {
    const source = cards.get(card.id)!;
    equal(card.hintSkills, (source.hints?.hint_skills ?? []).map(Number), `support ${card.id} hint skills`);
    equal(card.eventSkills, (source.event_skills_en ?? source.event_skills ?? []).map(Number), `support ${card.id} Global event skills`);
    equal(Object.keys(card.effects).sort(), source.effects.map((row: number[]) => String(row[0])).sort(), `support ${card.id} passive completeness`);
    for (const row of source.effects) row.slice(1).forEach((value: number, i: number) => {
      if (value !== -1) equal(card.effects[row[0]][i], value, `support ${card.id} passive ${row[0]} anchor ${i}`);
    });
    const levels = source.rarity === 1 ? [4, 5, 6, 7, 8] : source.rarity === 2 ? [5, 6, 7, 8, 9] : [6, 7, 8, 9, 10];
    const maxLevels = source.rarity === 1 ? [20, 25, 30, 35, 40] : source.rarity === 2 ? [25, 30, 35, 40, 45] : [30, 35, 40, 45, 50];
    levels.forEach((levelIndex, lb) => {
      const expected = Object.fromEntries(Object.entries(card.effects).filter(([, values]) => (values as number[])[levelIndex] !== 0).map(([key, values]) => [key, (values as number[])[levelIndex]]));
      if (source.unique && maxLevels[lb]! >= source.unique.level) for (const effect of source.unique.effects) if (effect.type < 100) expected[`u${effect.type}`] = effect.value;
      equal(card.effectsByLb[lb], expected, `support ${card.id} limit break ${lb} passives/unlocks`);
    });
    if (source.unique) {
      for (const [key, value] of Object.entries(source.unique)) equal(card.unique[key], value, `support ${card.id} unique payload ${key}`);
    } else equal(card.unique, null, `support ${card.id} has no source unique`);
    const page = pages.palGroupEvents[card.id];
    if (page) {
      for (const [target, group] of [['randomEvents', page.random ?? []], ['specialEvents', page.special ?? []], ['recreationEvents', page.dates ?? page.dates_random ?? []]] as const) {
        checkEvents(card[target], group.filter((event: Row) => eventOnGlobal(event)).map(pageRewards), `support ${card.id} ${target}`);
      }
      equal(card.chainEvents, [], `support ${card.id} has no normal chain`);
    } else {
      checkEvents(card.chainEvents, (staticChain.get(card.id) ?? []).map((event: unknown[]) => staticRewards(event, raw['dict/evrew']!)), `support ${card.id} chain`);
      checkEvents(card.randomEvents, (shared.get(card.charId) ?? []).map((event: unknown[]) => staticRewards(event, raw['dict/evrew']!)), `support ${card.id} random`);
    }
  }
  const skills = new Map(raw.skills!.map((skill) => [skill.id, skill]));
  for (const skill of out.skills) {
    const source = skills.get(skill.id)!, en = source.loc?.en ?? {};
    equal([skill.name, skill.cost, skill.iconId, skill.versions, skill.tags, skill.desc], [source.name_en ?? source.enname ?? source.jpname, en.cost ?? source.cost ?? null, en.iconid ?? source.iconid ?? null, source.versions ?? [], en.type ?? source.type ?? [], source.desc_en ?? source.endesc ?? ''], `skill ${skill.id} Global name/cost/icon/versions/effect tags/description`);
    equal([skill.hintCards, skill.eventCards, skill.innateChars, skill.eventChars], [(en.sup_hint ?? []).flat(), (en.sup_e ?? []).flat(), en.char ?? [], en.char_e ?? []], `skill ${skill.id} Global acquisition sources`);
  }
  const characters = new Map(raw['character-cards']!.map((char) => [char.card_id, char]));
  const aptKeys = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
  for (const char of out.characters) {
    const source = characters.get(char.cardId)!;
    equal(aptKeys.map((key) => char.aptitudes[key]), source.aptitude, `outfit ${char.cardId} aptitudes`);
    for (const [target, key] of [['growth', 'stat_bonus'], ['baseStats', 'base_stats'], ['twoStarStats', 'two_star_stats'], ['threeStarStats', 'three_star_stats'], ['fourStarStats', 'four_star_stats'], ['fiveStarStats', 'five_star_stats']]) equal(char[target!], source[key!] ?? null, `outfit ${char.cardId} ${target}`);
    equal(char.awakeningSkills, (source.skills_awakening_en ?? source.skills_awakening ?? []).map(Number), `outfit ${char.cardId} Global awakening skills`);
    const page = pages.charEvents[char.charId]!, outfit = pages.charEventsByCard[char.cardId] ?? page;
    const expectedEvents = [...['nochoice', 'wchoice', 'outings', 'secret'].flatMap((group) => page[group] ?? []), ...(outfit.version ?? [])].filter((event) => eventOnGlobal(event));
    equal(char.events.length, expectedEvents.length, `outfit ${char.cardId} event completeness`);
    char.events.forEach((event: Row, i: number) => equal(event.choices.flatMap((choice: Row) => choice.outcomes.flat()), pageRewards(expectedEvents[i]!), `outfit ${char.cardId} event ${i} rewards`));
    const objective = raw['ura-objectives']!.find((entry) => entry.char_id === char.charId)!;
    const expectedGoals = new Map<string, unknown[]>();
    for (const goal of objective.objectives) if (goal.cond_type === 1 && goal.turn <= 72) for (const race of goal.races ?? []) {
      const key = `${goal.turn - 1}:${race.id}`;
      if (!expectedGoals.has(key)) expectedGoals.set(key, [Number(goal.cond_value ?? 0), race.name_en, race.distance, race.terrain === 2 ? 'dirt' : 'turf', race.grade, race.fans_needed ?? 0, race.fans_gained ?? 0]);
    }
    const actualGoals = new Map<string, unknown[]>();
    for (const goal of char.goals) for (const race of goal.races) actualGoals.set(`${goal.slot}:${race.raceId}`, [goal.required, race.name, race.distance, race.surface, race.grade, race.fansNeeded, race.fansGain]);
    equal(actualGoals, expectedGoals, `outfit ${char.cardId} race objectives`);
  }
  const instances = new Map(raw.races!.map((race) => [race.id, race]));
  const calendar = raw['ura-races']!.filter((entry) => instances.get(entry.instance)?.grade === 100);
  idsMatch(calendar, out.races, 'id', 'calendarId', 'G1 calendar');
  const fanCounts = new Map<number, number>(), fanSets = new Map<number, number>();
  const registerFans = (map: Map<number, number>, key: number, value: number, label: string) => {
    if (map.has(key)) equal(value, map.get(key), `${label} has consistent fan rewards`);
    map.set(key, value);
  };
  for (const entry of raw['ura-objectives']!) for (const goal of entry.objectives) for (const race of goal.races ?? []) if (race.fans_gained) registerFans(fanCounts, race.id, race.fans_gained, `race ${race.id}`);
  for (const date of raw['ura-races']!) {
    const raceId = instances.get(date.instance)?.race_id;
    if (fanCounts.has(raceId)) registerFans(fanSets, date.fans_gain, fanCounts.get(raceId)!, `fan set ${date.fans_gain}`);
  }
  for (const race of out.races) {
    const source = instances.get(race.raceInstanceId)!, date = calendar.find((entry) => entry.id === race.calendarId)!;
    equal([race.raceId, race.name, race.distance, race.surface, race.year, race.month, race.half, race.fansNeeded], [source.race_id, source.name_en, source.distance, source.terrain === 2 ? 'dirt' : 'turf', date.year, date.month, date.half, date.fans_needed], `calendar ${race.calendarId} race/date/requirements`);
    check(numeric(race.fansGain) && race.fansGain > 0, `calendar ${race.calendarId} has no resolved fan reward`);
    equal(race.fansGain, fanCounts.get(race.raceId) ?? fanSets.get(date.fans_gain), `calendar ${race.calendarId} fan reward`);
  }
  for (const rank of out.ranks) {
    const source = raw['en/db-files/single_mode_rank']!.find((entry) => entry.id === rank.id)!;
    equal([rank.min, rank.max], [source.min_value, source.max_value], `rank ${rank.id} boundaries`);
  }
  for (const scenario of out.scenarios) {
    const source = raw.scenarios!.find((entry) => entry.id === scenario.id)!;
    equal(scenario.linkedChars, (source.scenario_linked_characters ?? []).map((char: Row) => ({ charId: char.char_id, name: char.name_en })), `scenario ${scenario.id} linked characters`);
  }
  const skillIds = new Set(out.skills.map((skill) => skill.id));
  for (const owner of [...out.cards, ...out.characters]) {
    const events = owner.events ?? [...owner.chainEvents, ...owner.randomEvents, ...owner.recreationEvents, ...owner.specialEvents];
    for (const event of events) for (const choice of event.choices) for (const reward of choice.outcomes.flat()) {
      const references = reward.t === 'sk' || reward.t === 'sg' ? [reward.d] : reward.t === 'sr' ? reward.d.map((entry: Row) => entry.d) : [];
      for (const id of references) check(skillIds.has(id), `${owner.id ?? owner.cardId} event ${event.name ?? event.index} references unknown skill ${String(id)}`);
    }
  }
  const expectedScenarioEvents: Row[] = [];
  for (const row of raw['training_events/scenario']!) for (const group of row.slice(1)) for (const event of group) {
    if (!Array.isArray(event[1])) continue;
    const branches = event[1].map((choice: unknown[]) => {
      check(Array.isArray(choice[1]), `scenario event ${event[0]} has malformed choices`);
      const rewards = choice[1].flatMap((id) => decodeRewards(raw['dict/evrew']!, id));
      return { linked: rewards.find((reward) => reward.t === 'sl')?.d, skills: rewards.filter((reward) => reward.t === 'sk').map((reward) => reward.d) };
    });
    if (!branches.some((branch: Row) => branch.linked != null && branch.skills.length)) continue;
    const choices = branches.map((branch: Row) => {
      check(branch.linked == null ? branch.skills.length === 1 : branch.skills.length === 2, `scenario event ${event[0]} has an unsupported linked-skill reward structure`);
      return branch.linked == null ? { linkedCharId: null, skill: branch.skills[0] } : { linkedCharId: branch.linked, goldSkill: branch.skills[0], whiteSkill: branch.skills[1] };
    });
    expectedScenarioEvents.push({ scenarioId: row[0], eventId: event[0], strId: String(event[2]), choices });
  }
  equal(out.scenarioEvents, expectedScenarioEvents, 'scenario linked skill reward completeness');
  for (const event of out.scenarioEvents) {
    check(raw.scenarios!.some((scenario) => scenario.id === event.scenarioId), `event ${event.eventId} references unknown scenario`);
    for (const choice of event.choices) for (const key of ['skill', 'goldSkill', 'whiteSkill']) if (choice[key] != null) check(skillIds.has(choice[key]), `scenario event ${event.eventId} ${key} references unknown skill`);
  }
}
