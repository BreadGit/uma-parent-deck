// Import only direct GameWith evaluation values from UmaTools' full export, never its cost fallbacks.
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './json-file.ts';

/** @typedef {{ skill_jp?: string, is_evo: boolean, skill_type: string, base_value: unknown }} ExportedSkill */
/** @param {string} name */
const data = (name) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
const exportFile = process.argv[2];
if (!exportFile) throw new Error('Usage: node scripts/import-skill-ratings.mjs <UmaTools full export.json>');
/** @type {{ metadata: { source_url: string, scraped_at_utc: string }, skills: ExportedSkill[] }} */
const source = await readJson(exportFile);
/** @type {import('../src/types.ts').Skill[]} */
const skills = await readJson(data('skills.json'));
/** @param {string | null | undefined} name */
const normalize = (name) => name?.normalize('NFKC').replaceAll('◯', '○');
/** @type {Record<number, { base: number, nameJp: string | null }>} */
const ratings = {};
for (const skill of skills) {
  if (skill.unreleasedEn || ![1, 2].includes(skill.rarity)) continue;
  const matches = source.skills.filter((row) => normalize(row.skill_jp) === normalize(skill.nameJp)
    && !row.is_evo && (row.skill_type === 'gold') === (skill.rarity === 2));
  const values = new Set(matches.map((row) => row.base_value));
  if (values.size !== 1) continue;
  const base = [...values][0];
  if (typeof base !== 'number' || !Number.isInteger(base) || base < 0) throw new Error(`Invalid rating for ${skill.id}`);
  ratings[skill.id] = { base, nameJp: skill.nameJp };
}
const output = {
  source: source.metadata.source_url,
  extractedAt: source.metadata.scraped_at_utc,
  extractor: 'https://github.com/daftuyda/UmaTools/blob/7d3a4e16a73bdccd6794e89546e3cd037f4b9ae5/scripts/data/gamewith-skills.js',
  ratings,
};
await writeJson(data('skill-ratings.json'), output);
console.log(`Imported ${Object.keys(ratings).length} verified skill ratings`);
