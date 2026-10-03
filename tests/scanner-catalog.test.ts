import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scannerCards } from '../scripts/scanner-catalog.ts';
import { artworkPath, badgeCards, referencePath } from '../src/scanner/assets.ts';
import { loadData } from '../src/data.ts';

const root = new URL('..', import.meta.url).pathname;

test('every SR and SSR card has its scanner reference, so the scanner can match it', () => {
  const cards = loadData().cards;
  assert.deepEqual(cards.filter(c => c.rarity !== 'R' && !existsSync(join(root, 'public', referencePath(c.id)))).map(c => c.id), [],
    'generate them with npm run build:scanner-artwork');
  assert.deepEqual(badgeCards(cards).filter(c => !existsSync(join(root, 'public', artworkPath(c.id)))).map(c => c.id), [],
    'the badge templates come from these cards\' artwork');
});
test('the catalog marks a card matchable only when its reference exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanner-catalog-'));
  try {
    const card = (id: number, rarity: string) => ({ id, rarity, name: `Card ${id}`, charName: 'Uma', type: 'speed', extra: true });
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data/cards.json'), JSON.stringify([card(10001, 'R'), card(20001, 'SR'), card(30001, 'SSR')]));
    for (const id of [10001, 30001]) {
      mkdirSync(dirname(join(dir, 'public', referencePath(id))), { recursive: true });
      writeFileSync(join(dir, 'public', referencePath(id)), '');
    }
    assert.deepEqual(scannerCards(dir).map(c => [c.id, c.hasReference]), [[10001, false], [20001, false], [30001, true]],
      'R cards are never matched; an SR card without its file cannot be');
    assert.equal('extra' in scannerCards(dir)[0]!, false, 'only the fields the scanner reads are kept');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
