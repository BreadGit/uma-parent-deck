// User-facing text lives in the module that shows it; src/ui/copy.ts keeps only wording more than one module shows.
// Copy and scanner styles are only worth keeping while something uses them: a key or class left behind by a removed
// feature reads as current to the next person editing the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LABEL, TITLE } from '../src/ui/copy.ts';

const root = new URL('..', import.meta.url).pathname;
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
const read = (file: string) => ({ file: relative(root, file), text: readFileSync(file, 'utf8') });
const sources = files(join(root, 'src')).filter(f => f.endsWith('.ts') && !f.endsWith('/copy.ts')).map(read);
/** Templates and pages that can carry a class: every module under `src/` and the HTML entry points. */
const markup = [...files(join(root, 'src')).filter(f => f.endsWith('.ts')),
  ...readdirSync(root).filter(f => f.endsWith('.html')).map(f => join(root, f))].map(read);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reads = (text: string, path: string) => new RegExp(`(?<![\\w.])${escape(path)}(?![\\w])`).test(text);

for (const [exported, shared] of [['TITLE', TITLE], ['LABEL', LABEL]] as const) {
  test(`every ${exported} entry is shown by more than one module`, () => {
    const single = Object.keys(shared).flatMap(key => {
      const users = sources.filter(({ text }) => reads(text, `${exported}.${key}`)).map(({ file }) => file);
      return users.length > 1 ? [] : [`${exported}.${key}: ${users.join(', ') || 'unused'}`];
    });
    assert.deepEqual(single, [], 'wording only one module shows belongs in that module');
  });
}

/**
 * A module's own text is the `copy` object it declares at the top level. Each entry must be read in the module; a
 * nested table counts as read when the module indexes it, passes it whole, or reads every entry of it, directly or
 * through a local alias (`const L = copy.limits;`).
 */
test('every entry of a module\'s copy object is used there', () => {
  const unused = sources.flatMap(({ file, text }) => {
    const block = /^const copy = \{\n([\s\S]*?)^\} as const;/m.exec(text);
    if (!block) return [];
    const rest = text.slice(0, block.index) + text.slice(block.index + block[0].length);
    const entries = [...block[1]!.matchAll(/^ {2}(\w+)(: \{\n([\s\S]*?)^ {2}\},)?/gm)].map(m => ({ key: m[1]!, nested: m[3] }));
    return entries.flatMap(({ key, nested }) => {
      if (!reads(rest, `copy.${key}`)) return [`${file}: copy.${key}`];
      if (nested === undefined) return [];
      const alias = new RegExp(`(\\w+) = copy\\.${key}[;,]`, 'g');
      const aliases = [...rest.matchAll(alias)].map(m => m[1]!), others = rest.replace(alias, '');
      if ([`copy\\.${key}`, ...aliases].some(base => new RegExp(`(?<![\\w.])${base}(?![\\w.])`).test(others))) return [];
      return [...nested.matchAll(/^ {4}(\w+):/gm)].map(m => m[1]!)
        .filter(sub => ![`copy.${key}`, ...aliases].some(base => reads(rest, `${base}.${sub}`)))
        .map(sub => `${file}: copy.${key}.${sub}`);
    });
  });
  assert.deepEqual(unused, []);
});

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
