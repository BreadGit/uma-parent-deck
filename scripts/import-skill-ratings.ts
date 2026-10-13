// Import only direct GameWith evaluation values from UmaTools' full export, never its cost fallbacks.
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './json-file.ts';
import { isGold, isNormalOrGold, type Skill } from '../src/types.ts';

interface ExportedSkill { skill_jp?: string; is_evo: boolean; skill_type: string; base_value: unknown }
const data = (name: string) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
const exportFile = process.argv[2];
if (!exportFile) throw new Error('Usage: node scripts/import-skill-ratings.ts <UmaTools full export.json>');
const source: { metadata: { source_url: string; scraped_at_utc: string }; skills: ExportedSkill[] } = await readJson(exportFile);
const skills: Skill[] = await readJson(data('skills.json'));
const normalize = (name: string | null | undefined) => name?.normalize('NFKC').replaceAll('◯', '○');
const ratings: Record<number, { base: number; nameJp: string | null }> = {};
for (const skill of skills) {
  if (skill.unreleasedEn || !isNormalOrGold(skill)) continue;
  const matches = source.skills.filter((row) => normalize(row.skill_jp) === normalize(skill.nameJp)
    && !row.is_evo && (row.skill_type === 'gold') === isGold(skill));
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
