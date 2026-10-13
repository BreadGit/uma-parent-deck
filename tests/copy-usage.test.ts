// User-facing text lives in the module that shows it; src/ui/copy.ts keeps only wording more than one module shows.
// Copy and scanner styles are only worth keeping while something uses them: a key or class left behind by a removed
// feature reads as current to the next person editing the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
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

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;

/** The entries of a module's top-level `copy` object, with the keys of each nested table, and the module without it. */
function copyObject(file: string, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const keyOf = (entry: ts.ObjectLiteralElementLike) => {
    assert.ok(entry.name && (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)), `${file}: every copy entry needs a plain key`);
    return entry.name.text;
  };
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(d => ts.isIdentifier(d.name) && d.name.text === 'copy');
    if (!declaration) continue;
    const object = declaration.initializer && unwrap(declaration.initializer);
    assert.ok(object && ts.isObjectLiteralExpression(object), `${file}: copy must be an object literal`);
    return {
      rest: text.slice(0, statement.getStart(source)) + text.slice(statement.end),
      entries: object.properties.map(entry => {
        const value = ts.isPropertyAssignment(entry) ? unwrap(entry.initializer) : undefined;
        return { key: keyOf(entry), nested: value && ts.isObjectLiteralExpression(value) ? value.properties.map(keyOf) : undefined };
      }),
    };
  }
  return null;
}

/**
 * A module's own text is the `copy` object it declares at the top level. Each entry must be read in the module; a
 * nested table counts as read when the module indexes it, passes it whole, or reads every entry of it, directly or
 * through a local alias (`const L = copy.limits;`).
 */
test('every entry of a module\'s copy object is used there', () => {
  const unused = sources.flatMap(({ file, text }) => {
    const copy = copyObject(file, text);
    if (!copy) return [];
    const { rest, entries } = copy;
    return entries.flatMap(({ key, nested }) => {
      if (!reads(rest, `copy.${key}`)) return [`${file}: copy.${key}`];
      if (nested === undefined) return [];
      const alias = new RegExp(`(\\w+) = copy\\.${key}[;,]`, 'g');
      const aliases = [...rest.matchAll(alias)].map(m => m[1]!), others = rest.replace(alias, '');
      if ([`copy\\.${key}`, ...aliases].some(base => new RegExp(`(?<![\\w.])${base}(?![\\w.])`).test(others))) return [];
      return nested
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
