// Copy and scanner styles are only worth keeping while something uses them: a key or class left behind by a removed
// feature reads as current to the next person editing the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { COPY, SCANNER_COPY } from '../src/ui/copy.ts';

const root = new URL('..', import.meta.url).pathname;
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
const read = (file: string) => ({ file: relative(root, file), text: readFileSync(file, 'utf8') });
const sources = files(join(root, 'src')).filter(f => f.endsWith('.ts') && !f.endsWith('/copy.ts')).map(read);
/** Templates and pages that can carry a class: every module under `src/` and the HTML entry points. */
const markup = [...files(join(root, 'src')).filter(f => f.endsWith('.ts')),
  ...readdirSync(root).filter(f => f.endsWith('.html')).map(f => join(root, f))].map(read);

/** Dotted paths of every string, function or list in a copy object; nested plain objects are walked. */
function leaves(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' && !Array.isArray(child) ? leaves(child, path) : [path];
  });
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The names a file reads a copy object through: the export itself, an import alias (`SCANNER_COPY as C`) and local
 * aliases of a part of it (`const copy = COPY.modelCoverage`), each with the path it stands for.
 */
function aliases(text: string, exported: string): [string, string][] {
  if (!new RegExp(`import\\s*\\{[^}]*\\b${exported}\\b`).test(text)) return [];
  const names: [string, string][] = [[new RegExp(`\\b${exported}\\s+as\\s+(\\w+)`).exec(text)?.[1] ?? exported, '']];
  for (const [name, path] of [...names]) {
    for (const m of text.matchAll(new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*${escape(name)}((?:\\.\\w+)+)\\s*;`, 'g'))) {
      names.push([m[1]!, (path + m[2]!).slice(1)]);
    }
  }
  return names;
}

interface Read { file: string; path: string; computed: boolean }
function reads(exported: string): Read[] {
  return sources.flatMap(({ file, text }) => aliases(text, exported).flatMap(([name, base]) =>
    [...text.matchAll(new RegExp(`(?<![\\w.])${escape(name)}((?:\\.\\w+)*)(\\[)?`, 'g'))]
      .map(m => ({ file, path: [base, m[1]!.slice(1)].filter(Boolean).join('.'), computed: !!m[2] }))));
}
/**
 * A path counts as used when some file reads it, or reads an enclosing object whole below the top level: by a
 * computed key into a lookup table (`COPY.priorities.roles[w.role]`), or as a value whose fields are read later
 * (`COPY.priorities.marks.hintsOnly`). A whole section (`COPY.settings`) never counts, so it cannot hide its entries.
 */
function unused(copy: object, exported: string): string[] {
  const all = reads(exported), read = new Set(all.map(r => r.path));
  const nested = [...read].filter(path => path.includes('.'));
  return leaves(copy).filter(leaf => !read.has(leaf) && !nested.some(path => leaf.startsWith(`${path}.`)));
}
/** A computed key into a whole section would reach every entry in it; index a nested table such as `roles` instead. */
const sectionLookups = (exported: string) => reads(exported)
  .filter(read => read.computed && !read.path.includes('.')).map(read => `${read.file}: ${read.path || exported}[…]`);

for (const [exported, copy] of [['COPY', COPY], ['SCANNER_COPY', SCANNER_COPY]] as const) {
  test(`every ${exported} entry is used`, () => assert.deepEqual(unused(copy, exported), []));
  test(`${exported} sections are not indexed by a computed key`, () => assert.deepEqual(sectionLookups(exported), []));
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
