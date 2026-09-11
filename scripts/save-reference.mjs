// Renders a reference web page in headless Chromium and saves its main content as Markdown under docs/umamusume/refs/.
// Usage: node scripts/save-reference.mjs <url> <name>
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const [url, name] = process.argv.slice(2);
if (!url || !name) { console.error('usage: save-reference.mjs <url> <name>'); process.exit(1); }
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000); // client-rendered pages; ad and analytics requests keep 'networkidle' from ever firing
const md = await page.evaluate(() => {
  const root = document.querySelector('main') || document.querySelector('article') || document.body;
  const skip = (el) => /nav|header|footer|aside|script|style|noscript|svg|button|form/i.test(el.tagName) || /cookie|banner|advert|sidebar|nav|menu|footer|header/i.test(el.className || '');
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  const out = [];
  const walk = (el) => {
    if (el.nodeType !== 1 || skip(el)) return;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) { out.push('\n' + '#'.repeat(Number(tag[1])) + ' ' + text(el) + '\n'); return; }
    if (tag === 'P') { const t = text(el); if (t) out.push(t + '\n'); return; }
    if (tag === 'LI') { const t = text(el); if (t) out.push('- ' + t); return; }
    if (tag === 'TABLE') {
      const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => text(c).replace(/\|/g, '/')));
      if (rows.length) { out.push(''); out.push('| ' + rows[0].join(' | ') + ' |'); out.push('| ' + rows[0].map(() => '---').join(' | ') + ' |'); for (const r of rows.slice(1)) out.push('| ' + r.join(' | ') + ' |'); out.push(''); }
      return;
    }
    if (tag === 'IMG') { const a = el.getAttribute('alt'); if (a) out.push(`[image: ${a}]`); return; }
    for (const ch of el.children) walk(ch);
    if (['DIV', 'SECTION'].includes(tag) && el.children.length === 0) { const t = text(el); if (t) out.push(t); }
  };
  walk(root);
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
});
const header = `<!-- Saved from ${url} on ${new Date().toISOString().slice(0, 10)} for reference. Rendered page text, converted to Markdown. -->\n\n# ${await page.title()}\n\nSource: ${url}\n\n`;
await fs.writeFile(`docs/umamusume/refs/${name}.md`, header + md.trim() + '\n');
console.log(`${name}: ${md.length} chars`);
await browser.close();
