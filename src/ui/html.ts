/** Tiny tagged template that escapes interpolated strings. Values wrapped by raw() are inserted verbatim. */
export class Raw { constructor(public s: string) {} }
export const raw = (s: string) => new Raw(s);
const esc = (v: unknown): string => {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(esc).join('');
  if (v == null || v === false) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
};
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < values.length ? esc(values[i]) : ''); });
  return new Raw(out);
}
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const num = (x: number, d = 0) => x.toFixed(d);
