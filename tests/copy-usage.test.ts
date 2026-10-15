// Shared wording and scanner styles are only worth keeping while something uses them: an entry or class left behind
// by a removed feature reads as current to the next person editing the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LABEL, TITLE } from '../src/ui/copy.ts';

const root = new URL('..', import.meta.url).pathname;
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
const read = (file: string) => ({ file: relative(root, file), text: readFileSync(file, 'utf8') });
/** Templates and pages that can carry a class or shared wording: every module under `src/` and the HTML entry points. */
const markup = [...files(join(root, 'src')).filter(f => f.endsWith('.ts')),
  ...readdirSync(root).filter(f => f.endsWith('.html')).map(f => join(root, f))].map(read);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const [exported, shared] of [['TITLE', TITLE], ['LABEL', LABEL]] as const) {
  test(`every ${exported} entry is used`, () => {
    const used = new RegExp(`(?<![\\w.])${exported}\\.(\\w+)`, 'g');
    const keys = new Set(markup.flatMap(({ text }) => [...text.matchAll(used)].map(m => m[1]!)));
    assert.deepEqual(Object.keys(shared).filter(key => !keys.has(key)), []);
  });
}

/** Class names in a stylesheet's selectors, including those inside at-rule blocks; declarations are skipped. */
function selectorClasses(css: string): string[] {
  const headers = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map(m => m[1]!).filter(h => !h.trim().startsWith('@'));
  return [...new Set(headers.flatMap(h => [...h.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map(m => m[1]!)))];
}
test('every class the scanner stylesheet styles is set by some template', () => {
  const css = readFileSync(join(root, 'src/scanner/style.css'), 'utf8');
  // No template builds a scanner class name from parts (`scan-${x}`); if one does, list its full names here.
  const unstyled = selectorClasses(css).filter(name =>
    !markup.some(({ text }) => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`).test(text)));
  assert.deepEqual(unstyled, []);
});
