// Import only direct GameWith evaluation values from UmaTools' full export, never its cost fallbacks.
import fs from 'node:fs';

const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const skills = JSON.parse(fs.readFileSync(new URL('../data/skills.json', import.meta.url), 'utf8'));
const normalize = (name) => name?.normalize('NFKC').replaceAll('◯', '○');
const ratings = {};
for (const skill of skills) {
  if (skill.unreleasedEn || ![1, 2].includes(skill.rarity)) continue;
  const matches = source.skills.filter((row) => normalize(row.skill_jp) === normalize(skill.nameJp)
    && !row.is_evo && (row.skill_type === 'gold') === (skill.rarity === 2));
  const values = new Set(matches.map((row) => row.base_value));
  if (values.size !== 1) continue;
  const base = [...values][0];
  if (!Number.isInteger(base) || base < 0) throw new Error(`Invalid rating for ${skill.id}`);
  ratings[skill.id] = { base, nameJp: skill.nameJp };
}
const output = {
  source: source.metadata.source_url,
  extractedAt: source.metadata.scraped_at_utc,
  extractor: 'https://github.com/daftuyda/UmaTools/blob/7d3a4e16a73bdccd6794e89546e3cd037f4b9ae5/scripts/data/gamewith-skills.js',
  ratings,
};
fs.writeFileSync(new URL('../data/skill-ratings.json', import.meta.url), JSON.stringify(output, null, 1) + '\n');
console.log(`Imported ${Object.keys(ratings).length} verified skill ratings`);
