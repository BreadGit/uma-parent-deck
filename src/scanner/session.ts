// One scanner session: the chosen screenshots, their readings and the review of them. The standalone page and the
// planner both host it; the host decides where the result goes (a download, or the planner's own inventory).
import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { errorMessage, type Inventory } from '../types.ts';
import { LIMIT_BREAKS, MAX_LB } from '../model/rules.ts';
import { LABEL, TITLE } from '../ui/copy.ts';
import { chosenFiles, clearFiles, inputValue, isOpen, matchesWords, numbered, options, queryWords, selectValue } from '../ui/form.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { downloadText } from '../download.ts';
import { createCardPicker } from './card-picker.ts';
import { artworkUrl, cropUrl, loadReferences, pixels, screenshotCanvas } from './images.ts';
import {
  applyReadings, inventoryFromReview, summarize, triage,
  type ApplyMode, type Group, type InventoryChange, type ReviewRow, type Summary, type Triage,
} from './results.ts';
import type { Box, Reference, ScanCard, ScanResult } from './recognize.ts';
import type { WorkerRequest, WorkerResponse } from './worker.ts';
import './style.css';

const lbBadge = (lb: number) => lb === MAX_LB ? 'MLB' : `${lb}LB`;

const PRIVACY_NOTE = 'Screenshots stay in this browser. No account, upload, or API key.';
const SCREENSHOT_GUIDANCE = 'Use full-width, five-column Support Card List screenshots. Include all your SR and SSR cards, with some overlap between screenshots. Keep each person’s inventory in a separate batch.';
const BUSY_NOTICE = 'Still reading. Add more screenshots when this batch finishes, or stop reading first.';
const CONFLICT_STATUS = 'Different LB readings. Correct or exclude one.';
const EXPORT_BLOCKED = 'Resolve uncertain matches, unreadable diamonds, and conflicting readings before downloading.';
const APPLY_BLOCKED = 'Decide the remaining readings first.';
const STATUS_CAPTION = {
  queued: 'Waiting to be read',
  reading: 'Reading…',
  unreadable: 'Could not read this image. Use a PNG, JPEG, or WebP image and try again.',
  noCards: 'No complete card badges found. Use a full-width screenshot of the five-column support card list.',
  failed: 'Not read because recognition stopped. Add this screenshot again.',
  stopped: 'Not read because reading was stopped. Add this screenshot again.',
};
const readingStatus = (name: string, done: number, total: number) => `Reading ${name}${total ? ` · ${done} / ${total} cards` : '…'}`;
const batchSummary = (files: number, readings: number, rare: number) => [
  `${files} screenshot${files === 1 ? '' : 's'}`, `${readings} reading${readings === 1 ? '' : 's'}`,
  ...rare ? [`${rare} R card${rare === 1 ? '' : 's'} ignored`] : [],
].join(' · ');
const reviewSummary = (owned: number, pending: number, duplicates: number, excluded: number) => [
  `${owned} unique card${owned === 1 ? '' : 's'}`, `${pending} to review`,
  `${duplicates} duplicate reading${duplicates === 1 ? '' : 's'} from overlap`, ...excluded ? [`${excluded} excluded`] : [],
].join(' · ');
const changeSummary = (owned: number, unowned: number, changed: number, unchanged: number) => [
  `${owned} newly owned`, `${unowned} marked not owned`, `${changed} limit break${changed === 1 ? '' : 's'} changed`,
  `${unchanged} unchanged`,
].join(' · ');

export interface ScannerHost {
  cards: ScanCard[];
  /** Called after every change so the host renders again. */
  onChange: () => void;
  /** Set when the planner embeds the scanner: readings are applied to its inventory instead of downloaded. */
  apply?: {
    /** The stored inventory the change summary compares the readings with, before any planning overrides. */
    current: () => Inventory;
    /**
     * Store the readings. `edit` turns a stored inventory into the new one; apply it to the latest save, which can hold
     * another tab's change made since the summary was shown.
     */
    onApply: (edit: (current: Inventory) => Inventory) => void;
  };
  /** Set on the standalone page: where the planner lives, for the import instructions. */
  plannerUrl?: string;
}
/** Lives as long as its page: both hosts keep the session, so closing the planner's sheet keeps the review. */
export interface Scanner {
  render(): TemplateResult;
}

/**
 * One chosen screenshot, listed as soon as its batch starts so an interrupted batch names every file it did not read.
 * `count` and `rare` are its readings once `read`.
 */
interface Source { id: string; name: string; image: string; count: number; rare: number; status: SourceStatus }
type SourceStatus = keyof typeof STATUS_CAPTION | 'read';
/** Statuses of a file that was not read, which adding it again replaces. */
const NOT_READ: ReadonlySet<SourceStatus> = new Set(['unreadable', 'noCards', 'failed', 'stopped']);
const FAILED_TO_READ: ReadonlySet<SourceStatus> = new Set(['unreadable', 'noCards', 'failed']);
class WorkerFailure extends Error {}
/** The answer each worker request settles with. */
interface Answer { references: void; scan: ScanResult }
/** The pixel buffers a request hands over to the worker instead of copying. */
function transferables(request: WorkerRequest): Transferable[] {
  const images = request.kind === 'references' ? request.references.flatMap(r => [r.image, r.artwork]) : [request.image];
  return [...new Set(images.flatMap(image => image ? [image.data.buffer] : []))];
}
/** Settles as `promise` does, or rejects as soon as `signal` aborts, so an abandoned step never resumes its batch. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
const boxAttr = (box: Box | undefined) => box ? [box.x, box.y, box.width, box.height].map(Math.round).join(',') : nothing;

export function createScanner(host: ScannerHost): Scanner {
  const { cards, onChange: paint } = host;
  const cardById = new Map(cards.map(c => [c.id, c]));
  const catalog = cards.filter(c => c.rarity !== 'R').sort((a, b) => a.charName.localeCompare(b.charName) || a.id - b.id);
  const cardPicker = createCardPicker(catalog, paint);
  const lbOptions = [{ value: '', label: 'Not read' }, ...numbered(LIMIT_BREAKS, lb => lb === MAX_LB ? `${lb} (MLB)` : String(lb))];

  let sources: Source[] = [], rows: ReviewRow[] = [];
  let busy = false, status = '', error = '', notice = '';
  let query = '', previewOpen = false, dragging = false, sourcesOpen = false, readyOpen = false;
  let mode: ApplyMode = 'replace';
  /** The one tile expanded into an editor: `c<cardId>` for a read card, `r<rowKey>` for an excluded row, `u<cardId>` for an unseen card. */
  let openKey: string | null = null;
  let nextKey = 1;
  let batch: AbortController | null = null;

  // One worker keeps the loaded references and matching templates between batches. The decoded references move to
  // it rather than staying on this thread, so a failed worker is dropped and the next batch loads them again.
  let worker: Worker | null = null;
  let failure = '';

  function failWorker(current: Worker, detail: string) {
    if (worker !== current) return;
    console.error('Scanner worker failed:', detail);
    current.terminate(); worker = null; failure = detail;
  }
  /**
   * Sends one request and settles with its answer: nothing for references, the readings for a scan. The promise
   * rejects when the worker fails or replies with an error (and the worker is dropped), or when `signal` aborts.
   */
  function call<K extends WorkerRequest['kind']>(current: Worker, request: Extract<WorkerRequest, { kind: K }>,
    { progress, signal }: { progress?: (done: number, total: number) => void; signal?: AbortSignal } = {}): Promise<Answer[K]> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      if (worker !== current) return reject(new WorkerFailure(failure));
      const settle = () => {
        current.removeEventListener('message', onMessage);
        current.removeEventListener('error', onError);
        current.removeEventListener('messageerror', onMessageError);
        signal?.removeEventListener('abort', onAbort);
      };
      const fail = (detail: string) => { settle(); failWorker(current, detail); reject(new WorkerFailure(detail)); };
      const onMessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.kind === 'progress') progress?.(data.done, data.total);
        else if (data.kind === 'error') fail(data.message);
        else { settle(); resolve((data.kind === 'result' ? data.result : undefined) as Answer[K]); }
      };
      const onError = (event: ErrorEvent) => fail(event.message ?? '');
      const onMessageError = () => fail('unreadable worker message');
      const onAbort = () => { settle(); reject(signal!.reason); };
      current.addEventListener('message', onMessage);
      current.addEventListener('error', onError);
      current.addEventListener('messageerror', onMessageError);
      signal?.addEventListener('abort', onAbort, { once: true });
      current.postMessage(request, transferables(request));
    });
  }
  async function startWorker(loaded: Reference[], signal: AbortSignal): Promise<Worker> {
    const current = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker = current;
    // A worker that fails between requests is dropped too, so the next batch starts another.
    current.addEventListener('error', event => failWorker(current, event.message ?? ''));
    current.addEventListener('messageerror', () => failWorker(current, 'unreadable worker message'));
    await call(current, { kind: 'references', references: loaded }, { signal });
    return current;
  }

  /** A screenshot added again replaces its earlier attempt that was not read. */
  function replaceAttempts(name: string) {
    const replaced = (s: Source) => s.name === name && NOT_READ.has(s.status);
    for (const s of sources) if (replaced(s) && s.image) URL.revokeObjectURL(s.image);
    sources = sources.filter(s => !replaced(s));
  }
  function interrupt(reason: 'failed' | 'stopped') { for (const s of sources) if (s.status === 'queued' || s.status === 'reading') s.status = reason; }
  async function addFiles(files: File[]) {
    if (!files.length) return;
    if (busy) { notice = BUSY_NOTICE; paint(); return; }
    const { signal } = batch = new AbortController();
    const step = <T>(promise: Promise<T>) => unlessAborted(promise, signal);
    for (const file of files) replaceAttempts(file.name);
    const queue = files.map((file): { file: File; source: Source } =>
      ({ file, source: { id: String(nextKey++), name: file.name, image: '', count: 0, rare: 0, status: 'queued' } }));
    sources.push(...queue.map(q => q.source));
    busy = true; error = ''; notice = ''; status = 'Loading card artwork…'; paint();
    let loading = !worker;
    try {
      let scanWorker = worker;
      if (!scanWorker) {
        const loaded = await step(loadReferences(cards, signal));
        loading = false;
        scanWorker = await startWorker(loaded, signal);
      }
      for (const { file, source } of queue) {
        source.status = 'reading';
        status = readingStatus(file.name, 0, 0); paint();
        const canvas = await step(screenshotCanvas(file).catch(() => null));
        if (!canvas) { source.status = 'unreadable'; paint(); continue; }
        const blob = await step(new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .8)));
        if (blob) source.image = URL.createObjectURL(blob);
        const result = await call(scanWorker, { kind: 'scan', image: pixels(canvas) }, { signal,
          progress: (done, total) => { status = readingStatus(file.name, done, total); paint(); } });
        Object.assign(source, { count: result.detections.length, rare: result.ignoredR,
          status: result.detections.length || result.ignoredR ? 'read' : 'noCards' });
        for (const detection of result.detections) {
          rows.push({ key: nextKey++, source: source.id, crop: cropUrl(canvas, detection.box), detection,
            cardId: detection.candidates[0]?.id ?? null, lb: detection.lb,
            reviewed: detection.confident && detection.lb !== null, excluded: false });
        }
        paint();
      }
    } catch (e) {
      // Stop and New inventory settle the batch themselves.
      if (signal.aborted) return;
      if (!(e instanceof WorkerFailure)) console.error(e);
      const detail = errorMessage(e);
      error = loading ? 'Could not load the card artwork. Check the connection and try again.'
        : `Recognition stopped. Completed results are kept. Try adding the remaining screenshots again.${detail ? ` Details: ${detail}` : ''}`;
      interrupt('failed');
    } finally {
      if (!signal.aborted) { busy = false; status = ''; paint(); }
    }
  }
  function stop() {
    batch?.abort(); worker?.terminate(); worker = null;
    interrupt('stopped');
    busy = false; status = 'Stopped'; paint();
  }
  function reset() {
    cardPicker.close();
    for (const source of sources) if (source.image) URL.revokeObjectURL(source.image);
    stop();
    sources = []; rows = []; query = ''; status = ''; error = ''; notice = ''; openKey = null; paint();
  }
  async function newInventory() { if (await confirmDialog('Start a new inventory? This clears the current screenshots and review results.', 'New inventory')) reset(); }
  /** A card the user adds by hand, searched for in a new row at the top of the decisions. */
  function addManual() {
    const row: ReviewRow = { key: nextKey++, source: '', crop: '', detection: null, cardId: null, lb: null, reviewed: false, excluded: false };
    rows.unshift(row); query = ''; paint();
    document.querySelector<HTMLElement>(`[data-row="${row.key}"] [data-card]`)?.focus();
  }
  /** A card picked from the unseen grid with its limit break: it is complete at once. */
  function addOwned(cardId: number, lb: number) {
    rows.unshift({ key: nextKey++, source: '', crop: '', detection: null, cardId, lb, reviewed: true, excluded: false });
    openKey = null; paint();
  }
  /** Edits apply to every reading of the card, so overlapping screenshots stay in agreement. */
  function edit(target: ReviewRow[], values: Partial<ReviewRow>) { for (const row of target) Object.assign(row, values); paint(); }
  function toggle(key: string) { openKey = openKey === key ? null : key; paint(); }

  /** While a batch is read the zone refuses files, as the disabled file input does, and says why. */
  function onDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
    if (busy && notice !== BUSY_NOTICE) { notice = BUSY_NOTICE; paint(); }
    else if (!busy && !dragging) { dragging = true; paint(); }
  }
  function onDragLeave(event: DragEvent) {
    // Moving between the zone's own children also fires dragleave.
    if ((event.currentTarget as Element).contains(event.relatedTarget as Node | null)) return;
    dragging = false; paint();
  }
  function onChoose(event: Event) {
    void addFiles(chosenFiles(event));
    clearFiles(event);
  }
  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false; paint();
    void addFiles(Array.from(event.dataTransfer?.files ?? []));
  }
  const toggled = (set: (value: boolean) => void) => (e: Event) => { set(isOpen(e)); paint(); };

  const stepHead = (step: number, title: string, note: string | TemplateResult | typeof nothing = nothing,
    actions: TemplateResult | typeof nothing = nothing) =>
    html`<div class="panel-head"><h2 data-step=${step}>${title}</h2>
      ${note === nothing ? nothing : html`<span class="panel-sub">${note}</span>`}
      ${actions === nothing ? nothing : html`<span class="panel-actions">${actions}</span>`}</div>`;
  function fileButton(label: string, cls = '') {
    return html`<label class="scan-file-button ${cls}">${label}<input data-files type="file" accept="image/png,image/jpeg,image/webp"
      multiple ?disabled=${busy} @change=${onChoose} /></label>`;
  }
  const sourceCaption = (s: Source) => s.status === 'read'
    ? `${s.count} reading${s.count === 1 ? '' : 's'}${s.rare ? ` · ${s.rare} R cards ignored` : ''}` : STATUS_CAPTION[s.status];
  function gallery() {
    return html`<div class="scan-sources">${repeat(sources, s => s.id, s => html`<figure>
      ${s.image ? html`<a href=${s.image} target="_blank" rel="noopener"><img src=${s.image} alt=${s.name} /></a>` : nothing}
      <figcaption>${s.name}<br />${sourceCaption(s)}</figcaption>
    </figure>`)}</div><p class="muted">Cropped or covered rows may be missed. Include them fully in another screenshot, or add the card manually.</p>`;
  }
  function uploadStep() {
    const failed = sources.filter(s => FAILED_TO_READ.has(s.status)), stopped = sources.filter(s => s.status === 'stopped');
    const readings = sources.reduce((n, s) => n + s.count, 0), rare = sources.reduce((n, s) => n + s.rare, 0);
    const started = sources.length > 0 || busy;
    return html`<section class="panel scan-upload ${dragging ? 'scan-dragging' : ''}" data-dropzone
      @dragenter=${onDragOver} @dragover=${onDragOver} @dragleave=${onDragLeave} @drop=${onDrop}>
      ${stepHead(1, 'Screenshots', started ? html`<span data-batch>${batchSummary(sources.length, readings, rare)}</span>` : nothing,
        busy ? html`<button data-stop class="small" @click=${stop}>Stop reading</button>` : started ? fileButton('Add more', 'small') : nothing)}
      ${started ? html`<details ?open=${sourcesOpen} @toggle=${toggled(v => { sourcesOpen = v; })}>
          <summary>Show screenshots</summary>${gallery()}</details>`
        : html`<div class="scan-dropzone">${fileButton('Choose screenshots')}<p class="muted">or drop them anywhere on this panel</p><p class="scan-privacy">${PRIVACY_NOTE}</p></div>`}
      <details class="scan-howto about"><summary>How to take screenshots</summary><p class="small">${SCREENSHOT_GUIDANCE}</p><p class="small">${host.apply
          ? 'R cards are ignored in screenshots and keep their current limit break in your inventory.'
          : 'R cards are ignored in screenshots and exported at 4LB (MLB).'}</p>
        ${started ? html`<p class="small scan-privacy">${PRIVACY_NOTE}</p>` : nothing}</details>
      ${notice ? html`<p class="scan-notice" data-notice>${notice}</p>` : nothing}
      ${error || failed.length ? html`<div role="alert" class="field-error scan-messages">
        ${error ? html`<p>${error}</p>` : nothing}${failed.map(s => html`<p>${s.name}: ${sourceCaption(s)}</p>`)}</div>` : nothing}
      ${stopped.length ? html`<div class="scan-messages">${stopped.map(s => html`<p>${s.name}: ${sourceCaption(s)}</p>`)}</div>` : nothing}
    </section>`;
  }

  function label(row: ReviewRow, conflicts: Set<number>) {
    if (row.excluded) return 'Excluded';
    if (row.cardId === null) return LABEL.selectCard;
    if (conflicts.has(row.cardId)) return CONFLICT_STATUS;
    if (row.lb === null) return row.reviewed ? 'Set limit break' : 'Check limit break';
    return row.reviewed ? 'Ready' : 'Check card match';
  }
  function candidates(row: ReviewRow) {
    if (row.reviewed || !row.detection?.candidates.length) return nothing;
    return html`<details><summary>Suggested matches</summary><div class="scan-candidates">
      ${row.detection.candidates.map(match => {
        const card = cardById.get(match.id), name = card?.name ?? String(match.id);
        return html`<button class="scan-candidate" aria-label=${name} title=${name}
          @click=${() => edit([row], { cardId: match.id, reviewed: true })}>
          <img src=${artworkUrl(match.id)} alt="" /><span>${card?.charName ?? name}</span></button>`;
      })}
    </div></details>`;
  }
  /** One editable card: a single reading, or every reading of one card when screenshots overlapped. */
  function reviewCard(target: ReviewRow[], result: Summary, sourceById: Map<string, Source>, cls = '') {
    const row = target[0]!;
    const card = row.cardId !== null ? cardById.get(row.cardId) : null;
    const lb = row.lb === null ? '' : String(row.lb);
    const where = target.length > 1 ? `Seen in ${target.length} screenshots` : sourceById.get(row.source)?.name ?? 'Added manually';
    return html`<article class="scan-card ${cls} ${result.pending.has(row.key) ? 'scan-pending' : ''} ${row.excluded ? 'scan-excluded' : ''}"
      data-row=${row.key}>
      <div class="scan-pictures">
        ${row.crop ? html`<img class="scan-crop" src=${row.crop} alt="Screenshot crop" data-box=${boxAttr(row.detection?.box)} />` : nothing}
        ${card ? html`<img class="scan-artwork" src=${artworkUrl(card.id)} alt=${`Reference artwork: ${card.name}`} />` : nothing}
      </div>
      <div class="scan-card-fields">
        <div class="scan-row-head"><span class="scan-source">${where}</span>
          <span class="scan-result-label" data-row-status>${label(row, result.conflicts)}</span></div>
        ${cardPicker.render(row.key, card, id => edit(target, { cardId: id, reviewed: true }))}
        <div class="scan-row-actions">
          <label>Limit break<select data-row-lb=${row.key} .value=${live(lb)}
            @change=${(e: Event) => edit(target, { lb: selectValue(e) ? Number(selectValue(e)) : null })}>
            ${options(lbOptions, lb)}</select></label>
          ${!row.excluded && !row.reviewed ? html`<button class="primary" data-confirm=${row.key}
            ?disabled=${row.cardId === null || row.lb === null} @click=${() => edit(target, { reviewed: true })}>Confirm</button>` : nothing}
          <button data-exclude=${row.key} @click=${() => edit(target, { excluded: !row.excluded })}>
            ${row.excluded ? 'Restore' : 'Exclude'}</button>
        </div>
        ${candidates(row)}
      </div>
    </article>`;
  }
  /** Screenshots that disagree: each reading is shown with its crop, and one tap settles the card. */
  function conflictCard(group: Group, sourceById: Map<string, Source>) {
    return html`<article class="scan-card scan-pending scan-conflict" data-row=${group.rows[0]!.key} data-conflict=${group.cardId}>
      <div class="scan-pictures"><img class="scan-artwork" src=${artworkUrl(group.cardId)} alt=${`Reference artwork: ${group.card.name}`} /></div>
      <div class="scan-card-fields">
        <div class="scan-row-head"><span class="scan-source">${group.card.name}</span>
          <span class="scan-result-label" data-row-status>${CONFLICT_STATUS}</span></div>
        <div class="scan-conflict-options">${group.rows.map(row => html`<div class="scan-conflict-option">
          ${row.crop ? html`<img class="scan-crop" src=${row.crop} alt=${sourceById.get(row.source)?.name ?? 'Added manually'} />` : nothing}
          <span class="scan-source">${sourceById.get(row.source)?.name ?? 'Added manually'}</span>
          <button class="primary small" data-use=${row.key} @click=${() => edit(group.rows, { lb: row.lb })}>Use ${lbBadge(row.lb!)}</button>
        </div>`)}</div>
        <div class="scan-row-actions"><button data-exclude=${group.rows[0]!.key} @click=${() => edit(group.rows, { excluded: true })}>Exclude</button></div>
      </div>
    </article>`;
  }
  /** A compact card in the read, excluded and unseen grids. Its editor opens in the grid right under it. */
  function tile(card: ScanCard, lb: number | null, key: string, box?: Box, cls = '') {
    return html`<button class="scan-tile ${cls}" data-tile=${key} data-card-id=${card.id} data-lb=${lb ?? ''} data-box=${boxAttr(box)}
      aria-pressed=${openKey === key} aria-expanded=${openKey === key} title=${card.name} @click=${() => toggle(key)}>
      <span class="scan-tile-art"><img src=${artworkUrl(card.id)} alt="" loading="lazy" />
        ${lb !== null ? html`<span class="scan-lb">${lbBadge(lb)}</span>` : nothing}</span>
      <span class="scan-tile-name">${card.charName}</span>
    </button>`;
  }
  /** The editor for an unseen card: choosing its limit break adds it as a reading. */
  function unseenEditor(card: ScanCard) {
    return html`<div class="scan-tile-editor scan-unseen-editor" data-add-card=${card.id}>
      <img class="scan-artwork" src=${artworkUrl(card.id)} alt="" />
      <div><p class="scan-source">${card.name}</p>
        <label>Owned at limit break<select data-add-lb=${card.id} .value=${live('')}
          @change=${(e: Event) => { if (selectValue(e)) addOwned(card.id, Number(selectValue(e))); }}>
          ${options(lbOptions, '')}</select></label></div>
    </div>`;
  }
  function reviewStep(result: Summary, t: Triage) {
    const words = queryWords(query);
    const matches = (text: string) => matchesWords(words, text);
    const sourceById = new Map(sources.map(s => [s.id, s]));
    const rowText = (row: ReviewRow) => `${row.cardId !== null ? cardById.get(row.cardId)?.name : ''} ${sourceById.get(row.source)?.name ?? ''}`;
    const attention = t.attention.filter(row => matches(rowText(row)));
    const conflicts = t.conflicts.filter(g => matches(g.card.name));
    const ready = t.ready.filter(g => matches(g.card.name));
    const excluded = t.excluded.filter(row => matches(rowText(row)));
    const unseen = t.unseen.filter(c => matches(c.name));
    const decide = t.attention.length + t.conflicts.length;
    const note = busy ? html`<span class="scan-reading" data-reading><span class="scan-spinner" aria-hidden="true"></span><span role="status">${status}</span></span>`
      : html`<span data-summary role="status">${rows.length ? reviewSummary(result.owned, decide, result.duplicates, t.excluded.length) : status}</span>`;
    const toolbar = html`<div class="scan-toolbar">
      <button data-add @click=${addManual} ?disabled=${busy}>Add a card</button>
      ${rows.length || sources.length ? html`<button data-new @click=${newInventory} ?disabled=${busy}>New inventory</button>` : nothing}
    </div>`;
    // Steps after the first stay dimmed until a batch has finished reading.
    const waiting = busy || !rows.length ? 'scan-waiting' : '';
    if (!rows.length) return html`<section class="panel scan-review ${waiting}">${stepHead(2, 'Check readings', note, toolbar)}<p class="muted">Add screenshots or cards to create an inventory.</p></section>`;
    const editor = (key: string, target: ReviewRow[]) => openKey === key ? reviewCard(target, result, sourceById, 'scan-tile-editor') : nothing;
    return html`<section class="panel scan-review ${waiting}">
      ${stepHead(2, 'Check readings', note, toolbar)}
      <div class="scan-filters">
        <input type="search" aria-label="Filter by card or screenshot name" placeholder="Filter cards" .value=${live(query)}
          @input=${(e: Event) => { query = inputValue(e); paint(); }} />
      </div>
      ${decide ? html`<h3 class="scan-group-head scan-decide">Needs a decision <span class="pill">${decide}</span></h3>
        <div class="scan-cards" data-decide>
          ${repeat(conflicts, g => `g${g.cardId}`, g => conflictCard(g, sourceById))}
          ${repeat(attention, row => row.key, row => reviewCard([row], result, sourceById))}
        </div>` : html`<p class="scan-all-ready" data-all-ready>All ${t.ready.length} card${t.ready.length === 1 ? '' : 's'} read with confidence.</p>`}
      <details data-ready ?open=${readyOpen} @toggle=${toggled(v => { readyOpen = v; })}>
        <summary>Read with confidence <span class="pill">${t.ready.length}</span> <span class="muted small">Open to check a reading or change a limit break.</span></summary>
        <div class="scan-tiles">${repeat(ready, g => g.cardId, g => html`
          ${tile(g.card, g.lbs[0] ?? null, `c${g.cardId}`, g.rows[0]?.detection?.box)}${editor(`c${g.cardId}`, g.rows)}`)}</div>
      </details>
      ${t.excluded.length ? html`<details data-excluded>
        <summary>Excluded <span class="pill">${t.excluded.length}</span></summary>
        <div class="scan-tiles">${repeat(excluded, r => r.key, r => {
          const card = r.cardId !== null ? cardById.get(r.cardId) : undefined;
          return card ? html`${tile(card, r.lb, `r${r.key}`, r.detection?.box, 'scan-dim')}${editor(`r${r.key}`, [r])}`
            : reviewCard([r], result, sourceById, 'scan-tile-editor');
        })}</div>
      </details>` : nothing}
      <details data-unseen>
        <summary>Not seen in screenshots <span class="pill">${t.unseen.length}</span> <span class="muted small">Tap a card you own to add it.</span></summary>
        <div class="scan-tiles">${repeat(unseen, c => c.id, c => html`
          ${tile(c, null, `u${c.id}`, undefined, 'scan-dim')}${openKey === `u${c.id}` ? unseenEditor(c) : nothing}`)}</div>
      </details>
      ${!attention.length && !conflicts.length && !ready.length && !excluded.length && !unseen.length && query
        ? html`<p>No cards match this filter.</p>` : nothing}
    </section>`;
  }

  const canFinish = (result: Summary) => !busy && (rows.length > 0 || sources.some(s => s.rare > 0)) && result.pending.size === 0;
  const inventoryJson = (result: Summary) => JSON.stringify(inventoryFromReview(rows, cards, result), null, 1);
  const download = (result: Summary) => downloadText('inventory.json', inventoryJson(result) + '\n', 'application/json');
  function apply(result: Summary) {
    if (!host.apply || !canFinish(result)) return;
    let applied = null as InventoryChange | null;
    host.apply.onApply((current) => (applied = applyReadings(current, cards, result, mode)).inventory);
    if (applied) notice = `Inventory updated: ${applied.owned.length} marked owned, ${applied.unowned.length} marked not owned, ${applied.changed.length} limit breaks changed.`;
    paint();
  }
  const modeOption = (value: ApplyMode, title: string, hint: string) => html`<label class="scan-mode">
    <input type="radio" name="scan-mode" value=${value} .checked=${live(mode === value)} data-mode=${value}
      @change=${() => { mode = value; paint(); }} /><span><strong>${title}</strong><br /><span class="muted small">${hint}</span></span></label>`;
  /** Explains what the action bar's button will do; the button itself stays in the bar so there is only one. */
  function finishStep(result: Summary, t: Triage) {
    if (!host.apply) {
      return html`<section class="panel scan-export ${canFinish(result) ? '' : 'scan-waiting'}">${stepHead(3, 'Download')}<p>SR and SSR cards missing from the reviewed results will be exported as not owned. Check coverage before downloading.</p>
        <p>In Uma parent deck, choose ${LABEL.importFile} in the ${TITLE.inventory} panel and select the downloaded inventory.json. ${host.plannerUrl ? html`<a href=${host.plannerUrl}>Open Uma parent deck</a>` : nothing}</p>
        ${result.pending.size ? html`<p class="scan-result-label">${EXPORT_BLOCKED}</p>` : nothing}
        ${canFinish(result) ? html`<details data-preview ?open=${previewOpen} @toggle=${toggled(v => { previewOpen = v; })}>
          <summary>Preview JSON</summary>${previewOpen ? html`<pre data-json>${inventoryJson(result)}</pre>` : nothing}</details>` : nothing}
      </section>`;
    }
    const planned = canFinish(result) ? applyReadings(host.apply.current(), cards, result, mode) : null;
    const changes = planned ? planned.owned.length + planned.unowned.length + planned.changed.length : 0;
    const names = (list: ScanCard[]) => list.map(c => c.name).join(', ');
    return html`<section class="panel scan-export ${planned ? '' : 'scan-waiting'}">${stepHead(3, 'Apply to inventory')}
      <div class="scan-modes">
        ${modeOption('replace', 'Replace my inventory', `SR and SSR cards not seen in any screenshot (${t.unseen.length}) become not owned.`)}
        ${modeOption('update', 'Update only the cards that were read', 'Every other card keeps its current value.')}
      </div>
      ${planned ? html`<p data-change-summary>${changes ? changeSummary(planned.owned.length, planned.unowned.length, planned.changed.length, planned.unchanged) : 'The readings match the current inventory.'}</p>
        ${changes ? html`<details class="scan-change-list"><summary>Show the cards</summary>
          ${planned.owned.length ? html`<p><strong>Owned:</strong> ${names(planned.owned)}</p>` : nothing}
          ${planned.changed.length ? html`<p><strong>Changed:</strong> ${names(planned.changed)}</p>` : nothing}
          ${planned.unowned.length ? html`<p><strong>Not owned:</strong> ${names(planned.unowned)}</p>` : nothing}
        </details>` : nothing}`
        : rows.length ? html`<p class="scan-result-label">${EXPORT_BLOCKED}</p>` : nothing}
    </section>`;
  }
  /** Stays in view at the bottom and holds the only finish button, so it never hides behind a long review. */
  function actionBar(result: Summary, t: Triage) {
    const decide = t.attention.length + t.conflicts.length;
    const ready = canFinish(result);
    return html`<div class="scan-bar ${ready ? '' : 'scan-waiting'}" data-bar>
      <span data-bar-summary>${rows.length ? `${t.ready.length} ready${decide ? ` · ${decide} to decide` : ''}` : 'No readings yet'}</span>
      ${host.apply
        ? html`<button class="primary" data-apply ?disabled=${!ready} title=${ready ? '' : APPLY_BLOCKED} @click=${() => apply(result)}>Apply to inventory</button>`
        : html`<button class="primary" data-download ?disabled=${!ready} title=${ready ? '' : APPLY_BLOCKED} @click=${() => download(result)}>Download inventory.json</button>`}
    </div>`;
  }

  function render() {
    const result = summarize(rows, cards);
    const t = triage(rows, cards, result);
    return html`<div class="scan-flow">${uploadStep()}${reviewStep(result, t)}${finishStep(result, t)}${actionBar(result, t)}</div>`;
  }
  return { render };
}
