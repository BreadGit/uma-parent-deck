import { html, nothing, render } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { cards } from 'virtual:scanner-catalog';
import { SCANNER_COPY as C } from '../ui/copy.ts';
import { inputValue, options, selectValue } from '../ui/form.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { downloadText } from '../download.ts';
import { createCardPicker } from './card-picker.ts';
import { artworkUrl, cropUrl, loadReferences, pixels, screenshotCanvas } from './images.ts';
import { inventoryFromReview, summarize, type ReviewRow } from './results.ts';
import type { Reference, ScanResult } from './recognize.ts';
import type { WorkerRequest } from './worker.ts';
import '../style.css';
import './style.css';

const root = document.getElementById('scanner')!;
const catalog = cards.filter(c => c.rarity !== 'R').sort((a, b) => a.charName.localeCompare(b.charName) || a.id - b.id);
const cardById = new Map(cards.map(c => [c.id, c]));
const cardPicker = createCardPicker(catalog, change);
const lbOptions = [{ value: '', label: C.unknownLb }, ...[0, 1, 2, 3, 4].map(lb => ({ value: String(lb), label: lb === 4 ? '4LB / MLB' : `${lb}LB` }))];
interface Source { id: string; name: string; image: string; count: number; rare: number; error: string }
let sources: Source[] = [], rows: ReviewRow[] = [];
let busy = false, status = '', error = '', query = '', reviewOnly = false;
let nextKey = 1, generation = 0;
let worker: Worker | null = null;
let references: Promise<Reference[]> | null = null;
let rejectScan: ((reason: Error) => void) | null = null;

function change() { paint(); }
function edit(row: ReviewRow, values: Partial<ReviewRow>) { Object.assign(row, values); change(); }
function post(message: WorkerRequest) { worker!.postMessage(message); }
async function scan(canvas: HTMLCanvasElement, name: string): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    rejectScan = reject;
    worker!.onerror = () => reject(new Error('worker'));
    worker!.onmessage = ({ data }) => {
      if (data.kind === 'progress') { status = C.scanning(name, data.done, data.total); change(); }
      else if (data.kind === 'result') { rejectScan = null; resolve(data.result); }
      else { rejectScan = null; reject(new Error('worker')); }
    };
    post({ kind: 'scan', image: pixels(canvas) });
  });
}

async function addFiles(files: File[]) {
  if (busy || !files.length) return;
  const token = ++generation;
  busy = true; error = ''; status = C.loading; change();
  try {
    if (!worker) {
      references ??= loadReferences(cards).catch(e => { references = null; throw e; });
      const loaded = await references;
      if (token !== generation) return;
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      post({ kind: 'references', references: loaded });
    }
    for (const file of files) {
      if (token !== generation) break;
      const source: Source = { id: String(nextKey++), name: file.name, image: '', count: 0, rare: 0, error: '' };
      sources.push(source);
      status = C.scanning(file.name, 0, 0); change();
      let canvas: HTMLCanvasElement;
      try { canvas = await screenshotCanvas(file); }
      catch { source.error = C.failed(file.name); error = source.error; change(); continue; }
      if (token !== generation) break;
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .8));
      if (token !== generation) break;
      if (blob) source.image = URL.createObjectURL(blob);
      const result = await scan(canvas, file.name);
      if (token !== generation) break;
      source.count = result.detections.length; source.rare = result.ignoredR;
      if (!source.count && !source.rare) { source.error = C.noCards; error = `${file.name}: ${C.noCards}`; }
      for (const detection of result.detections) {
        rows.push({ key: nextKey++, source: source.id, crop: cropUrl(canvas, detection.box), detection,
          cardId: detection.candidates[0]?.id ?? null, lb: detection.lb,
          reviewed: detection.confident && detection.lb !== null, excluded: false });
      }
      change();
    }
  } catch {
    if (token === generation) {
      error = worker ? C.scannerFailed : C.referencesFailed;
      worker?.terminate(); worker = null;
    }
  } finally {
    if (token === generation) { busy = false; status = ''; change(); }
  }
}
function stop() {
  generation++; worker?.terminate(); worker = null;
  rejectScan?.(new Error('cancelled')); rejectScan = null;
  busy = false; status = C.stopped; change();
}
function reset() {
  cardPicker.close();
  for (const source of sources) if (source.image) URL.revokeObjectURL(source.image);
  stop(); sources = []; rows = []; query = ''; reviewOnly = false; status = ''; error = ''; change();
}
async function newInventory() { if (await confirmDialog(C.newBatchConfirm, C.newBatch)) reset(); }
function addManual() {
  const row: ReviewRow = { key: nextKey++, source: '', crop: '', detection: null, cardId: null, lb: null, reviewed: false, excluded: false };
  rows.unshift(row); query = ''; change();
  root.querySelector<HTMLInputElement>(`[data-card="${row.key}"]`)?.focus();
}
function label(row: ReviewRow, conflicts: Set<number>) {
  if (row.excluded) return C.excluded;
  if (row.cardId === null) return C.selectCard;
  if (row.cardId !== null && conflicts.has(row.cardId)) return C.conflict;
  if (row.lb === null) return C.unreadable;
  return row.reviewed ? C.confirmed : C.uncertain;
}
function reviewRow(row: ReviewRow, conflicts: Set<number>, pending: Set<number>) {
  const card = row.cardId !== null ? cardById.get(row.cardId) : null;
  const source = sources.find(s => s.id === row.source);
  return html`<article class="scan-card ${pending.has(row.key) ? 'scan-pending' : ''} ${row.excluded ? 'scan-excluded' : ''}" data-row=${row.key}>
    <div class="scan-pictures">
      ${row.crop ? html`<img class="scan-crop" src=${row.crop} alt=${C.source} />` : nothing}
      ${card ? html`<img class="scan-artwork" src=${artworkUrl(card.id)} alt=${`${C.reference}: ${card.name}`} />` : nothing}
    </div>
    <div class="scan-card-fields">
      <p class="scan-source">${source?.name ?? C.manual}</p>
      ${cardPicker.render(row.key, card, id => edit(row, { cardId: id, reviewed: true }))}
      <div class="scan-row-actions"><label>${C.lb}<select data-lb=${row.key} .value=${live(row.lb === null ? '' : String(row.lb))}
        @change=${(e: Event) => edit(row, { lb: selectValue(e) ? Number(selectValue(e)) : null })}>
        ${options(lbOptions, row.lb === null ? '' : String(row.lb))}</select></label>
        ${!row.excluded && !row.reviewed ? html`<button data-confirm=${row.key} ?disabled=${row.cardId === null || row.lb === null} @click=${() => edit(row, { reviewed: true })}>${C.confirm}</button>` : nothing}
        <button data-exclude=${row.key} @click=${() => edit(row, { excluded: !row.excluded })}>${row.excluded ? C.restore : C.exclude}</button>
      </div>
      <p class="scan-result-label">${label(row, conflicts)}</p>
      ${!row.reviewed && row.detection?.candidates.length ? html`<details><summary>${C.candidates}</summary><div class="scan-candidates">
        ${row.detection.candidates.map(match => html`<button @click=${() => edit(row, { cardId: match.id, reviewed: true })} title=${cardById.get(match.id)?.name ?? String(match.id)}>
          <img src=${artworkUrl(match.id)} alt=${cardById.get(match.id)?.name ?? String(match.id)} /></button>`)}
      </div></details>` : nothing}
    </div>
  </article>`;
}
function paint() {
  const result = summarize(rows, cards);
  const canExport = !busy && (rows.length > 0 || sources.some(source => source.rare > 0)) && result.pending.size === 0;
  const shown = rows.filter(row => (!reviewOnly || result.pending.has(row.key)) &&
    `${row.cardId ? cardById.get(row.cardId)?.name : ''} ${sources.find(s => s.id === row.source)?.name ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  render(html`
    <header class="scan-header"><div><h1>${C.title}</h1><p>${C.subtitle}</p></div>
      <button aria-label=${C.changeTheme} @click=${() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; }}>◐</button>
    </header>
    <main class="scan-main">
      <section class="panel scan-upload" @dragover=${(e: DragEvent) => e.preventDefault()} @drop=${(e: DragEvent) => { e.preventDefault(); void addFiles(Array.from(e.dataTransfer?.files ?? [])); }}>
        <h2>${C.drop}</h2><p>${C.guidance}</p>
        <label class="scan-file-button">${C.choose}<input data-files type="file" accept="image/png,image/jpeg,image/webp" multiple ?disabled=${busy}
          @change=${(e: Event) => { const input = e.target as HTMLInputElement; void addFiles(Array.from(input.files ?? [])); input.value = ''; }} /></label>
        <p class="scan-privacy">${C.privacy}</p><p>${C.rare}</p>
        ${status ? html`<p role="status">${status}</p>` : nothing}
        ${error ? html`<p role="alert" class="field-error">${error}</p>` : nothing}
        ${busy ? html`<button data-stop @click=${stop}>${C.cancel}</button>` : nothing}
      </section>
      ${sources.length ? html`<section class="panel"><details><summary>${C.screenshots} (${sources.length})</summary>
        <div class="scan-sources">${repeat(sources, s => s.id, s => html`<figure>
          ${s.image ? html`<a href=${s.image} target="_blank" rel="noopener"><img src=${s.image} alt=${s.name} /></a>` : nothing}
          <figcaption>${s.name}<br />${s.error || C.fileSummary(s.count, s.rare)}</figcaption>
        </figure>`)}</div></details><p class="muted">${C.partial}</p></section>` : nothing}
      <section class="panel scan-review">
        <div class="scan-toolbar"><h2>${C.review}</h2><button data-add @click=${addManual} ?disabled=${busy}>${C.add}</button>
          ${rows.length || sources.length ? html`<button data-new @click=${newInventory} ?disabled=${busy}>${C.newBatch}</button>` : nothing}</div>
        ${rows.length ? html`<p data-summary>${C.summary(result.owned, result.pending.size, result.duplicates)}</p>
          <div class="scan-filters"><button data-review-filter aria-pressed=${reviewOnly} @click=${() => { reviewOnly = !reviewOnly; change(); }}>${reviewOnly ? C.showAll : C.needsReview}</button>
            <input type="search" aria-label=${C.search} placeholder=${C.search} .value=${live(query)} @input=${(e: Event) => { query = inputValue(e); change(); }} /></div>
          <div class="scan-cards">${repeat(shown, row => row.key, row => reviewRow(row, result.conflicts, result.pending))}</div>
          ${shown.length ? nothing : html`<p>${query ? C.noFilterMatches : C.emptyReview}</p>`}
        ` : html`<p class="muted">${C.noExport}</p>`}
      </section>
      <section class="panel scan-export"><h2>${C.download}</h2><p>${C.missing}</p><p>${C.import}</p>
        <button class="primary" data-download ?disabled=${!canExport}
          @click=${() => downloadText('inventory.json', JSON.stringify(inventoryFromReview(rows, cards), null, 1) + '\n', 'application/json')}>${C.download}</button>
        ${result.pending.size ? html`<p class="scan-result-label">${C.exportBlocked}</p>` : nothing}
        ${canExport ? html`<details><summary>${C.preview}</summary><pre data-json>${JSON.stringify(inventoryFromReview(rows, cards), null, 1)}</pre></details>` : nothing}
      </section>
    </main>`, root);
}
if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
paint();
