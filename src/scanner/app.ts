import { html, nothing, render } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { cards } from 'virtual:scanner-catalog';
import type { Theme } from '../state.ts';
import { SCANNER_COPY as C } from '../ui/copy.ts';
import { inputValue, numbered, options, selectValue } from '../ui/form.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { followTheme, themeToggle } from '../ui/theme.ts';
import { downloadText } from '../download.ts';
import { createCardPicker } from './card-picker.ts';
import { artworkUrl, cropUrl, loadReferences, pixels, screenshotCanvas } from './images.ts';
import { inventoryFromReview, summarize, type ReviewRow, type Summary } from './results.ts';
import type { Reference, ScanResult } from './recognize.ts';
import type { WorkerRequest } from './worker.ts';
import '../style.css';
import './style.css';

const root = document.getElementById('scanner')!;
const catalog = cards.filter(c => c.rarity !== 'R').sort((a, b) => a.charName.localeCompare(b.charName) || a.id - b.id);
const cardById = new Map(cards.map(c => [c.id, c]));
const cardPicker = createCardPicker(catalog, paint);
const lbOptions = [{ value: '', label: C.unknownLb }, ...numbered([0, 1, 2, 3, 4], C.lbOption)];
/** Relative, so the standalone build links to a planner served beside it. */
const PLANNER = './index.html';

/** One chosen screenshot. `done` stays false while it is read; one left unfinished records why in `error` or `stopped`. */
interface Source { id: string; name: string; image: string; count: number; rare: number; done: boolean; error: string; stopped: boolean }

// Nothing here persists: closing the page discards the screenshots and the review.
let sources: Source[] = [], rows: ReviewRow[] = [];
let busy = false, status = '', error = '', notice = '';
let progress: { done: number; total: number } | null = null;
let query = '', reviewOnly = false, previewOpen = false, dragging = false, theme: Theme = 'system';
let nextKey = 1, generation = 0;

// One worker keeps the loaded references and matching templates between batches. A failed worker is dropped and
// the next batch starts another.
class WorkerFailure extends Error {}
let worker: Worker | null = null;
let failure = '';
let references: Promise<Reference[]> | null = null;
let rejectScan: ((reason: Error) => void) | null = null;

function failWorker(current: Worker, detail: string) {
  if (worker !== current) return;
  console.error('Scanner worker failed:', detail);
  current.terminate(); worker = null; failure = detail;
  rejectScan?.(new WorkerFailure(detail)); rejectScan = null;
}
function post(current: Worker, message: WorkerRequest) { current.postMessage(message); }
function startWorker(loaded: Reference[]): Promise<Worker> {
  const current = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker = current;
  current.onerror = event => failWorker(current, event.message ?? '');
  current.onmessageerror = () => failWorker(current, 'unreadable worker message');
  return new Promise((resolve, reject) => {
    rejectScan = reject;
    current.onmessage = ({ data }) => {
      if (worker !== current) return;
      if (data.kind === 'ready') { rejectScan = null; resolve(current); }
      else failWorker(current, data.message ?? '');
    };
    post(current, { kind: 'references', references: loaded });
  });
}
async function scan(current: Worker, canvas: HTMLCanvasElement, name: string): Promise<ScanResult> {
  if (worker !== current) throw new WorkerFailure(failure);
  return new Promise((resolve, reject) => {
    rejectScan = reject;
    current.onmessage = ({ data }) => {
      if (worker !== current) return;
      if (data.kind === 'progress') {
        status = C.scanning(name, data.done, data.total); progress = { done: data.done, total: data.total }; paint();
      }
      else if (data.kind === 'result') { rejectScan = null; resolve(data.result); }
      else failWorker(current, data.message ?? '');
    };
    post(current, { kind: 'scan', image: pixels(canvas) });
  });
}

/** A screenshot added again replaces its earlier failed or unfinished attempt. */
function replaceAttempts(name: string) {
  for (const s of sources) if (s.name === name && (s.error || s.stopped) && s.image) URL.revokeObjectURL(s.image);
  sources = sources.filter(s => s.name !== name || !(s.error || s.stopped));
}
async function addFiles(files: File[]) {
  if (!files.length) return;
  if (busy) { notice = C.busyDrop; paint(); return; }
  const token = ++generation, current = () => token === generation;
  busy = true; error = ''; notice = ''; status = C.loading; progress = { done: 0, total: 0 }; paint();
  let scanner = worker, loading = !scanner;
  try {
    if (!scanner) {
      references ??= loadReferences(cards).catch(e => { references = null; throw e; });
      const loaded = await references;
      if (!current()) return;
      loading = false;
      scanner = await startWorker(loaded);
    }
    for (const file of files) {
      if (!current()) break;
      replaceAttempts(file.name);
      const source: Source = { id: String(nextKey++), name: file.name, image: '', count: 0, rare: 0,
        done: false, error: '', stopped: false };
      sources.push(source);
      status = C.scanning(file.name, 0, 0); progress = { done: 0, total: 0 }; paint();
      const canvas = await screenshotCanvas(file).catch(() => null);
      if (!current()) break;
      if (!canvas) { Object.assign(source, { done: true, error: C.unreadableFile }); paint(); continue; }
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .8));
      if (!current()) break;
      if (blob) source.image = URL.createObjectURL(blob);
      const result = await scan(scanner, canvas, file.name);
      if (!current()) break;
      Object.assign(source, { done: true, count: result.detections.length, rare: result.ignoredR,
        error: result.detections.length || result.ignoredR ? '' : C.noCards });
      for (const detection of result.detections) {
        rows.push({ key: nextKey++, source: source.id, crop: cropUrl(canvas, detection.box), detection,
          cardId: detection.candidates[0]?.id ?? null, lb: detection.lb,
          reviewed: detection.confident && detection.lb !== null, excluded: false });
      }
      paint();
    }
  } catch (e) {
    if (current()) {
      if (!(e instanceof WorkerFailure)) console.error(e);
      error = loading ? C.referencesFailed : C.scannerFailed(e instanceof Error ? e.message : String(e));
      for (const s of sources) if (!s.done) Object.assign(s, { done: true, error: C.failedMidway });
    }
  } finally {
    if (current()) { busy = false; status = ''; progress = null; paint(); }
  }
}
function stop() {
  generation++; worker?.terminate(); worker = null;
  rejectScan?.(new Error('cancelled')); rejectScan = null;
  for (const s of sources) if (!s.done) Object.assign(s, { done: true, stopped: true });
  busy = false; progress = null; status = C.stopped; paint();
}
function reset() {
  cardPicker.close();
  for (const source of sources) if (source.image) URL.revokeObjectURL(source.image);
  stop();
  sources = []; rows = []; query = ''; reviewOnly = false; status = ''; error = ''; notice = ''; paint();
}
async function newInventory() { if (await confirmDialog(C.newBatchConfirm, C.newBatch)) reset(); }
function addManual() {
  const row: ReviewRow = { key: nextKey++, source: '', crop: '', detection: null, cardId: null, lb: null,
    reviewed: false, excluded: false };
  rows.unshift(row); query = ''; paint();
  root.querySelector<HTMLInputElement>(`[data-card="${row.key}"]`)?.focus();
}
function edit(row: ReviewRow, values: Partial<ReviewRow>) { Object.assign(row, values); paint(); }

/** While a batch is read the zone refuses files, as the disabled file input does, and says why. */
function onDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  if (busy && notice !== C.busyDrop) { notice = C.busyDrop; paint(); }
  else if (!busy && !dragging) { dragging = true; paint(); }
}
function onDragLeave(event: DragEvent) {
  // Moving between the zone's own children also fires dragleave.
  if ((event.currentTarget as Element).contains(event.relatedTarget as Node | null)) return;
  dragging = false; paint();
}
function onChoose(event: Event) {
  const input = event.target as HTMLInputElement;
  void addFiles(Array.from(input.files ?? []));
  input.value = '';
}
function onDrop(event: DragEvent) {
  event.preventDefault();
  dragging = false; paint();
  void addFiles(Array.from(event.dataTransfer?.files ?? []));
}

function header() {
  return html`<header class="scan-header">
    <div><a class="scan-planner-link" href=${PLANNER}>${C.planner}</a><h1>${C.title}</h1><p>${C.subtitle}</p></div>
    ${themeToggle(theme, picked => { theme = picked; paint(); })}
  </header>`;
}
function progressBar() {
  if (!progress) return nothing;
  return progress.total ? html`<progress aria-label=${C.progress} max=${progress.total} .value=${progress.done}></progress>`
    : html`<progress aria-label=${C.progress}></progress>`;
}
function uploadPanel() {
  const failed = sources.filter(s => s.error), stopped = sources.filter(s => s.stopped);
  return html`<section class="panel scan-upload ${dragging ? 'scan-dragging' : ''}" data-dropzone
    @dragenter=${onDragOver} @dragover=${onDragOver} @dragleave=${onDragLeave} @drop=${onDrop}>
    <h2>${C.drop}</h2><p>${C.guidance}</p>
    <label class="scan-file-button">${C.choose}<input data-files type="file" accept="image/png,image/jpeg,image/webp" multiple
      ?disabled=${busy} @change=${onChoose} /></label>
    <p class="scan-privacy">${C.privacy}</p><p>${C.rare}</p>
    ${status ? html`<div class="scan-status"><p role="status">${status}</p>${progressBar()}</div>` : nothing}
    ${notice ? html`<p class="scan-notice" data-notice>${notice}</p>` : nothing}
    ${error || failed.length ? html`<div role="alert" class="field-error scan-messages">
      ${error ? html`<p>${error}</p>` : nothing}${failed.map(s => html`<p>${s.name}: ${s.error}</p>`)}</div>` : nothing}
    ${stopped.length ? html`<div class="scan-messages">${stopped.map(s => html`<p>${s.name}: ${C.stoppedMidway}</p>`)}</div>` : nothing}
    ${busy ? html`<button data-stop @click=${stop}>${C.cancel}</button>` : nothing}
  </section>`;
}
function sourceCaption(s: Source) {
  return s.error || (s.stopped ? C.stoppedMidway : s.done ? C.fileSummary(s.count, s.rare) : C.reading);
}
function screenshotsPanel() {
  if (!sources.length) return nothing;
  return html`<section class="panel"><details><summary>${C.screenshots} (${sources.length})</summary>
    <div class="scan-sources">${repeat(sources, s => s.id, s => html`<figure>
      ${s.image ? html`<a href=${s.image} target="_blank" rel="noopener"><img src=${s.image} alt=${s.name} /></a>` : nothing}
      <figcaption>${s.name}<br />${sourceCaption(s)}</figcaption>
    </figure>`)}</div></details><p class="muted">${C.partial}</p></section>`;
}
function label(row: ReviewRow, conflicts: Set<number>) {
  if (row.excluded) return C.excluded;
  if (row.cardId === null) return C.selectCard;
  if (conflicts.has(row.cardId)) return C.conflict;
  if (row.lb === null) return C.unreadable;
  return row.reviewed ? C.confirmed : C.uncertain;
}
function candidates(row: ReviewRow) {
  if (row.reviewed || !row.detection?.candidates.length) return nothing;
  return html`<details><summary>${C.candidates}</summary><div class="scan-candidates">
    ${row.detection.candidates.map(match => {
      const card = cardById.get(match.id), name = card?.name ?? String(match.id);
      return html`<button class="scan-candidate" aria-label=${name} title=${name}
        @click=${() => edit(row, { cardId: match.id, reviewed: true })}>
        <img src=${artworkUrl(match.id)} alt="" /><span>${card?.charName ?? name}</span></button>`;
    })}
  </div></details>`;
}
function reviewRow(row: ReviewRow, result: Summary, source: Source | undefined) {
  const card = row.cardId !== null ? cardById.get(row.cardId) : null;
  const lb = row.lb === null ? '' : String(row.lb);
  return html`<article class="scan-card ${result.pending.has(row.key) ? 'scan-pending' : ''} ${row.excluded ? 'scan-excluded' : ''}"
    data-row=${row.key}>
    <div class="scan-pictures">
      ${row.crop ? html`<img class="scan-crop" src=${row.crop} alt=${C.source} />` : nothing}
      ${card ? html`<img class="scan-artwork" src=${artworkUrl(card.id)} alt=${`${C.reference}: ${card.name}`} />` : nothing}
    </div>
    <div class="scan-card-fields">
      <div class="scan-row-head"><span class="scan-source">${source?.name ?? C.manual}</span>
        <span class="scan-result-label" data-row-status>${label(row, result.conflicts)}</span></div>
      ${cardPicker.render(row.key, card, id => edit(row, { cardId: id, reviewed: true }))}
      <div class="scan-row-actions">
        <label>${C.lb}<select data-lb=${row.key} .value=${live(lb)}
          @change=${(e: Event) => edit(row, { lb: selectValue(e) ? Number(selectValue(e)) : null })}>
          ${options(lbOptions, lb)}</select></label>
        ${!row.excluded && !row.reviewed ? html`<button class="primary" data-confirm=${row.key}
          ?disabled=${row.cardId === null || row.lb === null} @click=${() => edit(row, { reviewed: true })}>${C.confirm}</button>` : nothing}
        <button data-exclude=${row.key} @click=${() => edit(row, { excluded: !row.excluded })}>
          ${row.excluded ? C.restore : C.exclude}</button>
      </div>
      ${candidates(row)}
    </div>
  </article>`;
}
function reviewPanel(result: Summary) {
  const sourceById = new Map(sources.map(s => [s.id, s]));
  const needle = query.toLowerCase();
  const text = (row: ReviewRow) => `${row.cardId !== null ? cardById.get(row.cardId)?.name : ''} ${sourceById.get(row.source)?.name ?? ''}`;
  const shown = rows.filter(row => (!reviewOnly || result.pending.has(row.key)) && text(row).toLowerCase().includes(needle));
  const excluded = rows.length - result.included.length;
  return html`<section class="panel scan-review">
    <div class="scan-toolbar"><h2>${C.review}</h2><button data-add @click=${addManual} ?disabled=${busy}>${C.add}</button>
      ${rows.length || sources.length ? html`<button data-new @click=${newInventory} ?disabled=${busy}>${C.newBatch}</button>`
        : nothing}</div>
    ${rows.length ? html`<p data-summary>${C.summary(result.owned, result.pending.size, result.duplicates, excluded)}</p>
      <div class="scan-filters">
        <button data-review-filter aria-pressed=${reviewOnly} @click=${() => { reviewOnly = !reviewOnly; paint(); }}>
          ${reviewOnly ? C.showAll : C.needsReview}</button>
        <input type="search" aria-label=${C.search} placeholder=${C.filter} .value=${live(query)}
          @input=${(e: Event) => { query = inputValue(e); paint(); }} />
      </div>
      <div class="scan-cards">${repeat(shown, row => row.key, row => reviewRow(row, result, sourceById.get(row.source)))}</div>
      ${shown.length ? nothing : html`<p>${query ? C.noFilterMatches : C.emptyReview}</p>`}
    ` : html`<p class="muted">${C.noExport}</p>`}
  </section>`;
}
const inventoryJson = (result: Summary) => JSON.stringify(inventoryFromReview(rows, cards, result), null, 1);
function exportPanel(result: Summary) {
  const canExport = !busy && (rows.length > 0 || sources.some(source => source.rare > 0)) && result.pending.size === 0;
  return html`<section class="panel scan-export"><h2>${C.download}</h2><p>${C.missing}</p>
    <p>${C.import} <a href=${PLANNER}>${C.openPlanner}</a></p>
    <button class="primary" data-download ?disabled=${!canExport}
      @click=${() => downloadText('inventory.json', inventoryJson(result) + '\n', 'application/json')}>${C.download}</button>
    ${result.pending.size ? html`<p class="scan-result-label">${C.exportBlocked}</p>` : nothing}
    ${canExport ? html`<details data-preview ?open=${previewOpen}
      @toggle=${(e: Event) => { previewOpen = (e.target as HTMLDetailsElement).open; paint(); }}>
      <summary>${C.preview}</summary>${previewOpen ? html`<pre data-json>${inventoryJson(result)}</pre>` : nothing}</details>` : nothing}
  </section>`;
}
function paint() {
  const result = summarize(rows, cards);
  render(html`${header()}<main class="scan-main">
    ${uploadPanel()}${screenshotsPanel()}${reviewPanel(result)}${exportPanel(result)}</main>`, root);
}
followTheme(() => theme);
paint();
