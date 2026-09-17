type SourceObject = Record<string, unknown>;
type UniquePayload = { type: number; value: number; [key: string]: unknown };
type SourceUnique = { level: number; effects: UniquePayload[]; [key: string]: unknown };
type SourceCard = SourceObject & { support_id: number; rarity: number; effects: number[][]; unique?: SourceUnique | null };

const LEVELS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const LB_LEVELS: Record<number, number[]> = { 1: [20, 25, 30, 35, 40], 2: [25, 30, 35, 40, 45], 3: [30, 35, 40, 45, 50] };
const CARD_FIELDS = new Set([
  'char_id', 'char_name', 'effects', 'event_skills', 'event_skills_en', 'hints', 'obtained', 'rarity',
  'release', 'release_en', 'release_ko', 'release_zh_tw', 'support_id', 'tid', 'type', 'url_name',
  'rare_stuff', 'unique', 'unique_desc', 'name_en_gl', 'name_jp', 'name_ko', 'name_tw',
  'title_en', 'title_ja', 'title_ko', 'title_zh_tw',
]);
const MECHANIC_FIELD = /(?:^|_)(?:effects?|bonus(?:es)?|passives?|unique|hints?|skills?|training|bond|friendship|energy|stats?|rewards?|conditions?|modifiers?|abilit(?:y|ies)|mechanics?)(?:_|$)/i;
const object = (value: unknown): value is SourceObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const id = (value: unknown): value is number => number(value) && Number.isInteger(value) && value > 0;
const descriptiveField = (key: string, value: unknown): boolean => /^(?:name|desc|description|text|title)(?:_[a-z_]+)?$/.test(key) && typeof value === 'string';
const description = (value: SourceObject): string | undefined => {
  for (const key of ['desc_en', 'description', 'text', 'desc']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key];
  }
  return undefined;
};

function fail(path: string, reason: string): never {
  throw new Error(`Support import: ${path} ${reason}. Check the source format before replacing normalized data.`);
}

function checkFields(value: SourceObject, known: Set<string>, path: string, mechanicsOnly = false): void {
  for (const key of Object.keys(value)) {
    const words = key.replace(/([a-z])([A-Z])/g, '$1_$2');
    if (known.has(key)) continue;
    if (mechanicsOnly || MECHANIC_FIELD.test(words)) fail(`${path}.${key}`, 'is an unfamiliar mechanic field');
    const nested = value[key];
    if (object(nested)) checkFields(nested, new Set(), `${path}.${key}`);
    if (Array.isArray(nested)) nested.forEach((entry, index) => {
      if (object(entry)) checkFields(entry, new Set(), `${path}.${key}[${index}]`);
    });
  }
}

function validateHint(hint: unknown, path: string): void {
  if (!object(hint) || !id(hint.hint_type) || !number(hint.hint_value)) fail(path, 'must contain a numeric type and value');
  checkFields(hint, new Set(['hint_type', 'hint_value']), path, true);
}

function validateCard(value: unknown, index: number): asserts value is SourceCard {
  if (!object(value)) fail(`cards[${index}]`, 'must be an object');
  const path = `card ${value.support_id ?? index}`;
  if (!id(value.support_id)) fail(`${path}.support_id`, 'must be a positive integer');
  if (!id(value.rarity) || !LB_LEVELS[value.rarity]) fail(`${path}.rarity`, 'has no known level caps');
  checkFields(value, CARD_FIELDS, path);
  if (!Array.isArray(value.effects)) fail(`${path}.effects`, 'must be an array');
  const seen = new Set<number>();
  for (const [i, row] of value.effects.entries()) {
    if (!Array.isArray(row) || row.length !== LEVELS.length + 1 || !id(row[0]) || !row.slice(1).every(number)) {
      fail(`${path}.effects[${i}]`, 'must contain an effect ID followed by 11 numeric level values');
    }
    if (seen.has(row[0])) fail(`${path}.effects[${i}]`, 'duplicates an effect ID');
    seen.add(row[0]);
  }
  if (value.unique != null) {
    if (!object(value.unique) || !id(value.unique.level) || !Array.isArray(value.unique.effects)) {
      fail(`${path}.unique`, 'must contain an unlock level and an effects array');
    }
    checkFields(value.unique, new Set(['level', 'effects']), `${path}.unique`);
    for (const [i, effect] of value.unique.effects.entries()) {
      if (!object(effect) || !id(effect.type) || !number(effect.value)) fail(`${path}.unique.effects[${i}]`, 'must contain a numeric type and value');
      for (const [key, parameter] of Object.entries(effect)) {
        if (effect.type < 100 && !['type', 'value'].includes(key) && !descriptiveField(key, parameter)) {
          fail(`${path}.unique.effects[${i}].${key}`, 'cannot be folded into an ordinary passive without evaluating this parameter');
        }
        if (/^value_\d+$/.test(key) && !number(parameter)) fail(`${path}.unique.effects[${i}].${key}`, 'must be numeric');
      }
    }
  }
  if (value.unique_desc != null && typeof value.unique_desc !== 'string') fail(`${path}.unique_desc`, 'must be text');
  if (value.unique_desc && value.unique == null) fail(`${path}.unique_desc`, 'has no unique unlock information');
  if (value.hints != null) {
    if (!object(value.hints)) fail(`${path}.hints`, 'must be an object');
    checkFields(value.hints, new Set(['hint_skills', 'hint_others']), `${path}.hints`, true);
    if (value.hints.hint_others != null) {
      if (!Array.isArray(value.hints.hint_others)) fail(`${path}.hints.hint_others`, 'must be an array');
      for (const [i, hint] of value.hints.hint_others.entries()) {
        const hintPath = `${path}.hints.hint_others[${i}]`;
        if (Array.isArray(hint)) hint.forEach((entry, j) => validateHint(entry, `${hintPath}[${j}]`));
        else if (object(hint) && 'level' in hint) {
          if (!id(hint.level) || !Array.isArray(hint.stats)) fail(hintPath, 'must contain an unlock level and a stats array');
          checkFields(hint, new Set(['level', 'stats']), hintPath, true);
          hint.stats.forEach((entry, j) => validateHint(entry, `${hintPath}.stats[${j}]`));
        } else validateHint(hint, hintPath);
      }
    }
  }
}

/** Validate all Global cards before any normalized file is written. Unknown effect IDs remain valid. */
export function validateSupportCards(cards: unknown): void {
  if (!Array.isArray(cards)) fail('cards', 'must be an array');
  cards.forEach((card, index) => {
    if (!object(card)) fail(`cards[${index}]`, 'must be an object');
    if (card.release_en) validateCard(card, index);
  });
}

function interpolate(row: number[]): number[] {
  const values = row.slice(1);
  return LEVELS.map((level, i) => {
    if (values[i] !== -1) return values[i]!;
    let left = i - 1, right = i + 1;
    while (left >= 0 && values[left] === -1) left--;
    if (left < 0) return 0;
    while (right < values.length && values[right] === -1) right++;
    if (right === values.length) return values[left]!;
    return Math.floor(values[left]! + (values[right]! - values[left]!) * (level - LEVELS[left]!) / (LEVELS[right]! - LEVELS[left]!));
  });
}

/** Preserve every numeric effect and the complete unique payload, including fields new to the model. */
export function normalizeSupportMechanics(source: unknown, cachedText?: string) {
  validateCard(source, 0);
  const effects = Object.fromEntries(source.effects.map((row) => [row[0]!, interpolate(row)]));
  const levels = LB_LEVELS[source.rarity]!;
  const effectsByLb = levels.map((level) => {
    const index = LEVELS.indexOf(level);
    const values: Record<string, number> = {};
    for (const [type, perLevel] of Object.entries(effects)) if (perLevel[index] !== 0) values[type] = perLevel[index]!;
    if (source.unique && level >= source.unique.level) {
      for (const effect of source.unique.effects) if (effect.type < 100) values[`u${effect.type}`] = effect.value;
    }
    return values;
  });
  const unlocked = source.unique ? levels.findIndex((level) => level >= source.unique!.level) : -1;
  const text = cachedText?.trim() || (typeof source.unique_desc === 'string' ? source.unique_desc.trim() : '') || (source.unique ? description(source.unique) : undefined);
  const unique = source.unique ? { ...source.unique, fromLb: unlocked < 0 ? 5 : unlocked, ...(text ? { text } : {}) } : null;
  const hintSource = object(source.hints) && Array.isArray(source.hints.hint_others) ? source.hints.hint_others : [];
  const needsSource = hintSource.some((hint) => Array.isArray(hint) || (object(hint) && 'level' in hint));
  return { effects, effectsByLb, unique, ...(needsSource ? { hintOthersSource: hintSource } : {}) };
}

export function normalizeSupportEffects(source: unknown) {
  if (!Array.isArray(source)) fail('effect definitions', 'must be an array');
  const seen = new Set<number>();
  return source.map((effect, index) => {
    if (!object(effect) || !id(effect.id)) fail(`effect definitions[${index}]`, 'must contain a numeric ID');
    if (seen.has(effect.id)) fail(`effect definition ${effect.id}`, 'duplicates an ID');
    seen.add(effect.id);
    checkFields(effect, new Set(['id', 'calc', 'symbol']), `effect definition ${effect.id}`);
    for (const key of ['name_en', 'desc_en', 'symbol', 'calc']) {
      if (effect[key] != null && typeof effect[key] !== 'string') fail(`effect definition ${effect.id}.${key}`, 'must be text');
    }
    return { id: effect.id, name: effect.name_en || `Support effect ${effect.id}`, symbol: effect.symbol ?? 'none', calc: effect.calc ?? 'add', ...(description(effect) ? { description: description(effect) } : {}) };
  });
}
