// One scanner session: the chosen screenshots, their readings and the review of them. The standalone page and the
// planner both host it; the host decides where the result goes (a download, or the planner's own inventory).
import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import type { Inventory } from '../types.ts';
import { SCANNER_COPY as C } from '../ui/copy.ts';
import { inputValue, numbered, options, selectValue } from '../ui/form.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { downloadText } from '../download.ts';
import { createCardPicker } from './card-picker.ts';
import { artworkUrl, cropUrl, loadReferences, pixels, screenshotCanvas } from './images.ts';
import {
  applyReadings, cardIndex, inventoryFromReview, summarize, triage,
  type ApplyMode, type Group, type ReviewRow, type Summary, type Triage,
} from './results.ts';
import type { Box, Pixels, Reference, ScanCard, ScanResult } from './recognize.ts';
import type { WorkerRequest } from './worker.ts';
import './style.css';

export interface ScannerHost {
  cards: ScanCard[];
  /** Called after every change so the host renders again. */
  onChange: () => void;
  /** Set when the planner embeds the scanner: readings are applied to its inventory instead of downloaded. */
  apply?: {
    current: () => Inventory;
    /** The planner's effective limit break for a card, including its rarity default. */
    effective: (card: ScanCard) => number | null;
    onApply: (inventory: Inventory) => void;
  };
  /** Set on the standalone page: where the planner lives, for the import instructions. */
  plannerUrl?: string;
}
export interface Scanner {
  render(): TemplateResult;
  dispose(): void;
}

/** One chosen screenshot. `done` stays false while it is read; one left unfinished records why in `error` or `stopped`. */
interface Source { id: string; name: string; image: string; count: number; rare: number; done: boolean; error: string; stopped: boolean }
class WorkerFailure extends Error {}
const boxAttr = (box: Box | undefined) => box ? [box.x, box.y, box.width, box.height].map(Math.round).join(',') : nothing;

export function createScanner(host: ScannerHost): Scanner {
  const { cards, onChange: paint } = host;
  const cardById = cardIndex(cards);
  const catalog = cards.filter(c => c.rarity !== 'R').sort((a, b) => a.charName.localeCompare(b.charName) || a.id - b.id);
  const cardPicker = createCardPicker(catalog, paint);
  const lbOptions = [{ value: '', label: C.unknownLb }, ...numbered([0, 1, 2, 3, 4], C.lbOption)];

  // Nothing here persists: closing the page discards the screenshots and the review.
  let sources: Source[] = [], rows: ReviewRow[] = [];
  let busy = false, status = '', error = '', notice = '';
  let query = '', previewOpen = false, dragging = false, sourcesOpen = false, readyOpen = false;
  let mode: ApplyMode = 'replace';
  /** The one tile expanded into an editor: `c<cardId>` for a read card, `r<rowKey>` for an excluded row, `u<cardId>` for an unseen card. */
  let openKey: string | null = null;
  let nextKey = 1, generation = 0;

  // One worker keeps the loaded references and matching templates between batches. The decoded references move to
  // it rather than staying on this thread, so a failed worker is dropped and the next batch loads them again.
  let worker: Worker | null = null;
  let failure = '';
  let rejectScan: ((reason: Error) => void) | null = null;

  function failWorker(current: Worker, detail: string) {
    if (worker !== current) return;
    console.error('Scanner worker failed:', detail);
    current.terminate(); worker = null; failure = detail;
    rejectScan?.(new WorkerFailure(detail)); rejectScan = null;
  }
  /** Pixel buffers are transferred, not copied: the worker becomes their only owner. */
  function post(current: Worker, message: WorkerRequest, images: (Pixels | null)[]) {
    current.postMessage(message, [...new Set(images.flatMap(image => image ? [image.data.buffer] : []))]);
  }
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
      post(current, { kind: 'references', references: loaded }, loaded.flatMap(r => [r.image, r.artwork]));
    });
  }
  async function scan(current: Worker, canvas: HTMLCanvasElement, name: string): Promise<ScanResult> {
    if (worker !== current) throw new WorkerFailure(failure);
    return new Promise((resolve, reject) => {
      rejectScan = reject;
      current.onmessage = ({ data }) => {
        if (worker !== current) return;
        if (data.kind === 'progress') { status = C.scanning(name, data.done, data.total); paint(); }
        else if (data.kind === 'result') { rejectScan = null; resolve(data.result); }
        else failWorker(current, data.message ?? '');
      };
      const image = pixels(canvas);
      post(current, { kind: 'scan', image }, [image]);
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
    busy = true; error = ''; notice = ''; status = C.loading; paint();
    let scanner = worker, loading = !scanner;
    try {
      if (!scanner) {
        const loaded = await loadReferences(cards);
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
        status = C.scanning(file.name, 0, 0); paint();
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
      if (current()) { busy = false; status = ''; paint(); }
    }
  }
  function stop() {
    generation++; worker?.terminate(); worker = null;
    rejectScan?.(new Error('cancelled')); rejectScan = null;
    for (const s of sources) if (!s.done) Object.assign(s, { done: true, stopped: true });
    busy = false; status = C.stopped; paint();
  }
  function reset() {
    cardPicker.close();
    for (const source of sources) if (source.image) URL.revokeObjectURL(source.image);
    stop();
    sources = []; rows = []; query = ''; status = ''; error = ''; notice = ''; openKey = null; paint();
  }
  async function newInventory() { if (await confirmDialog(C.newBatchConfirm, C.newBatch)) reset(); }
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
  const toggled = (set: (value: boolean) => void) => (e: Event) => { set((e.target as HTMLDetailsElement).open); paint(); };

  // ---- Step 1: screenshots -------------------------------------------------------------------------------------

  /** The planner's panel chrome: a numbered heading, a muted note beside it and actions on the right. */
  const stepHead = (step: number, title: string, note: string | TemplateResult | typeof nothing = nothing,
    actions: TemplateResult | typeof nothing = nothing) =>
    html`<div class="panel-head"><h2 data-step=${step}>${title}</h2>
      ${note === nothing ? nothing : html`<span class="panel-sub">${note}</span>`}
      ${actions === nothing ? nothing : html`<span class="panel-actions">${actions}</span>`}</div>`;
  function fileButton(label: string, cls = '') {
    return html`<label class="scan-file-button ${cls}">${label}<input data-files type="file" accept="image/png,image/jpeg,image/webp"
      multiple ?disabled=${busy} @change=${onChoose} /></label>`;
  }
  const sourceCaption = (s: Source) =>
    s.error || (s.stopped ? C.stoppedMidway : s.done ? C.fileSummary(s.count, s.rare) : C.reading);
  function gallery() {
    return html`<div class="scan-sources">${repeat(sources, s => s.id, s => html`<figure>
      ${s.image ? html`<a href=${s.image} target="_blank" rel="noopener"><img src=${s.image} alt=${s.name} /></a>` : nothing}
      <figcaption>${s.name}<br />${sourceCaption(s)}</figcaption>
    </figure>`)}</div><p class="muted">${C.partial}</p>`;
  }
  function uploadStep() {
    const failed = sources.filter(s => s.error), stopped = sources.filter(s => s.stopped);
    const readings = sources.reduce((n, s) => n + s.count, 0), rare = sources.reduce((n, s) => n + s.rare, 0);
    const started = sources.length > 0 || busy;
    return html`<section class="panel scan-upload ${dragging ? 'scan-dragging' : ''}" data-dropzone
      @dragenter=${onDragOver} @dragover=${onDragOver} @dragleave=${onDragLeave} @drop=${onDrop}>
      ${stepHead(1, C.stepScreenshots, started ? html`<span data-batch>${C.batchSummary(sources.length, readings, rare)}</span>` : nothing,
        busy ? html`<button data-stop class="small" @click=${stop}>${C.cancel}</button>` : started ? fileButton(C.addMore, 'small') : nothing)}
      ${started ? html`<details ?open=${sourcesOpen} @toggle=${toggled(v => { sourcesOpen = v; })}>
          <summary>${C.showScreenshots}</summary>${gallery()}</details>`
        : html`<div class="scan-dropzone">${fileButton(C.choose)}<p class="muted">${C.drop}</p><p class="scan-privacy">${C.privacy}</p></div>`}
      <details class="scan-howto about"><summary>${C.howTo}</summary><p class="small">${C.guidance}</p><p class="small">${host.apply ? C.rareEmbedded : C.rare}</p>
        ${started ? html`<p class="small scan-privacy">${C.privacy}</p>` : nothing}</details>
      ${notice ? html`<p class="scan-notice" data-notice>${notice}</p>` : nothing}
      ${error || failed.length ? html`<div role="alert" class="field-error scan-messages">
        ${error ? html`<p>${error}</p>` : nothing}${failed.map(s => html`<p>${s.name}: ${s.error}</p>`)}</div>` : nothing}
      ${stopped.length ? html`<div class="scan-messages">${stopped.map(s => html`<p>${s.name}: ${C.stoppedMidway}</p>`)}</div>` : nothing}
    </section>`;
  }

  // ---- Step 2: review ------------------------------------------------------------------------------------------

  function label(row: ReviewRow, conflicts: Set<number>) {
    if (row.excluded) return C.excluded;
    if (row.cardId === null) return C.selectCard;
    if (conflicts.has(row.cardId)) return C.conflict;
    if (row.lb === null) return row.reviewed ? C.setLb : C.unreadable;
    return row.reviewed ? C.confirmed : C.uncertain;
  }
  function candidates(row: ReviewRow) {
    if (row.reviewed || !row.detection?.candidates.length) return nothing;
    return html`<details><summary>${C.candidates}</summary><div class="scan-candidates">
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
    const where = target.length > 1 ? C.seenIn(target.length) : sourceById.get(row.source)?.name ?? C.manual;
    return html`<article class="scan-card ${cls} ${result.pending.has(row.key) ? 'scan-pending' : ''} ${row.excluded ? 'scan-excluded' : ''}"
      data-row=${row.key}>
      <div class="scan-pictures">
        ${row.crop ? html`<img class="scan-crop" src=${row.crop} alt=${C.source} data-box=${boxAttr(row.detection?.box)} />` : nothing}
        ${card ? html`<img class="scan-artwork" src=${artworkUrl(card.id)} alt=${`${C.reference}: ${card.name}`} />` : nothing}
      </div>
      <div class="scan-card-fields">
        <div class="scan-row-head"><span class="scan-source">${where}</span>
          <span class="scan-result-label" data-row-status>${label(row, result.conflicts)}</span></div>
        ${cardPicker.render(row.key, card, id => edit(target, { cardId: id, reviewed: true }))}
        <div class="scan-row-actions">
          <label>${C.lb}<select data-lb=${row.key} .value=${live(lb)}
            @change=${(e: Event) => edit(target, { lb: selectValue(e) ? Number(selectValue(e)) : null })}>
            ${options(lbOptions, lb)}</select></label>
          ${!row.excluded && !row.reviewed ? html`<button class="primary" data-confirm=${row.key}
            ?disabled=${row.cardId === null || row.lb === null} @click=${() => edit(target, { reviewed: true })}>${C.confirm}</button>` : nothing}
          <button data-exclude=${row.key} @click=${() => edit(target, { excluded: !row.excluded })}>
            ${row.excluded ? C.restore : C.exclude}</button>
        </div>
        ${candidates(row)}
      </div>
    </article>`;
  }
  /** Screenshots that disagree: each reading is shown with its crop, and one tap settles the card. */
  function conflictCard(group: Group, sourceById: Map<string, Source>) {
    return html`<article class="scan-card scan-pending scan-conflict" data-row=${group.rows[0]!.key} data-conflict=${group.cardId}>
      <div class="scan-pictures"><img class="scan-artwork" src=${artworkUrl(group.cardId)} alt=${`${C.reference}: ${group.card.name}`} /></div>
      <div class="scan-card-fields">
        <div class="scan-row-head"><span class="scan-source">${group.card.name}</span>
          <span class="scan-result-label" data-row-status>${C.conflict}</span></div>
        <div class="scan-conflict-options">${group.rows.map(row => html`<div class="scan-conflict-option">
          ${row.crop ? html`<img class="scan-crop" src=${row.crop} alt=${sourceById.get(row.source)?.name ?? C.manual} />` : nothing}
          <span class="scan-source">${sourceById.get(row.source)?.name ?? C.manual}</span>
          <button class="primary small" data-use=${row.key} @click=${() => edit(group.rows, { lb: row.lb })}>${C.useReading(row.lb!)}</button>
        </div>`)}</div>
        <div class="scan-row-actions"><button data-exclude=${group.rows[0]!.key} @click=${() => edit(group.rows, { excluded: true })}>${C.exclude}</button></div>
      </div>
    </article>`;
  }
  /** A compact card in the read, excluded and unseen grids. Its editor opens in the grid right under it. */
  function tile(card: ScanCard, lb: number | null, key: string, box?: Box, cls = '') {
    return html`<button class="scan-tile ${cls}" data-tile=${key} data-card-id=${card.id} data-lb=${lb ?? ''} data-box=${boxAttr(box)}
      aria-pressed=${openKey === key} aria-expanded=${openKey === key} title=${card.name} @click=${() => toggle(key)}>
      <span class="scan-tile-art"><img src=${artworkUrl(card.id)} alt="" loading="lazy" />
        ${lb !== null ? html`<span class="scan-lb">${C.lbBadge(lb)}</span>` : nothing}</span>
      <span class="scan-tile-name">${card.charName}</span>
    </button>`;
  }
  /** The editor for an unseen card: choosing its limit break adds it as a reading. */
  function unseenEditor(card: ScanCard) {
    return html`<div class="scan-tile-editor scan-unseen-editor" data-add-card=${card.id}>
      <img class="scan-artwork" src=${artworkUrl(card.id)} alt="" />
      <div><p class="scan-source">${card.name}</p>
        <label>${C.ownedAt}<select data-add-lb=${card.id} .value=${live('')}
          @change=${(e: Event) => { if (selectValue(e)) addOwned(card.id, Number(selectValue(e))); }}>
          ${options(lbOptions, '')}</select></label></div>
    </div>`;
  }
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  function reviewStep(result: Summary, t: Triage) {
    const sourceById = new Map(sources.map(s => [s.id, s]));
    const rowText = (row: ReviewRow) => `${row.cardId !== null ? cardById.get(row.cardId)?.name : ''} ${sourceById.get(row.source)?.name ?? ''}`;
    const attention = t.attention.filter(row => matches(rowText(row)));
    const conflicts = t.conflicts.filter(g => matches(g.card.name));
    const ready = t.ready.filter(g => matches(g.card.name));
    const excluded = t.excluded.filter(row => matches(rowText(row)));
    const unseen = t.unseen.filter(c => matches(c.name));
    const decide = t.attention.length + t.conflicts.length;
    const note = busy ? html`<span class="scan-reading" data-reading><span class="scan-spinner" aria-hidden="true"></span><span role="status">${status}</span></span>`
      : html`<span data-summary role="status">${rows.length ? C.summary(result.owned, decide, result.duplicates, t.excluded.length) : status}</span>`;
    const toolbar = html`<div class="scan-toolbar">
      <button data-add @click=${addManual} ?disabled=${busy}>${C.add}</button>
      ${rows.length || sources.length ? html`<button data-new @click=${newInventory} ?disabled=${busy}>${C.newBatch}</button>` : nothing}
    </div>`;
    // Steps after the first stay dimmed until a batch has finished reading.
    const waiting = busy || !rows.length ? 'scan-waiting' : '';
    if (!rows.length) return html`<section class="panel scan-review ${waiting}">${stepHead(2, C.stepReview, note, toolbar)}<p class="muted">${C.noExport}</p></section>`;
    const editor = (key: string, target: ReviewRow[]) => openKey === key ? reviewCard(target, result, sourceById, 'scan-tile-editor') : nothing;
    return html`<section class="panel scan-review ${waiting}">
      ${stepHead(2, C.stepReview, note, toolbar)}
      <div class="scan-filters">
        <input type="search" aria-label=${C.search} placeholder=${C.filter} .value=${live(query)}
          @input=${(e: Event) => { query = inputValue(e); paint(); }} />
      </div>
      ${decide ? html`<h3 class="scan-group-head scan-decide">${C.decide} <span class="pill">${decide}</span></h3>
        <div class="scan-cards" data-decide>
          ${repeat(conflicts, g => `g${g.cardId}`, g => conflictCard(g, sourceById))}
          ${repeat(attention, row => row.key, row => reviewCard([row], result, sourceById))}
        </div>` : html`<p class="scan-all-ready" data-all-ready>${C.allReady(t.ready.length)}</p>`}
      <details data-ready ?open=${readyOpen} @toggle=${toggled(v => { readyOpen = v; })}>
        <summary>${C.ready} <span class="pill">${t.ready.length}</span> <span class="muted small">${C.readyHint}</span></summary>
        <div class="scan-tiles">${repeat(ready, g => g.cardId, g => html`
          ${tile(g.card, g.lbs[0] ?? null, `c${g.cardId}`, g.rows[0]?.detection?.box)}${editor(`c${g.cardId}`, g.rows)}`)}</div>
      </details>
      ${t.excluded.length ? html`<details data-excluded>
        <summary>${C.excludedGroup} <span class="pill">${t.excluded.length}</span></summary>
        <div class="scan-tiles">${repeat(excluded, r => r.key, r => {
          const card = r.cardId !== null ? cardById.get(r.cardId) : undefined;
          return card ? html`${tile(card, r.lb, `r${r.key}`, r.detection?.box, 'scan-dim')}${editor(`r${r.key}`, [r])}`
            : reviewCard([r], result, sourceById, 'scan-tile-editor');
        })}</div>
      </details>` : nothing}
      <details data-unseen>
        <summary>${C.unseen} <span class="pill">${t.unseen.length}</span> <span class="muted small">${C.unseenHint}</span></summary>
        <div class="scan-tiles">${repeat(unseen, c => c.id, c => html`
          ${tile(c, null, `u${c.id}`, undefined, 'scan-dim')}${openKey === `u${c.id}` ? unseenEditor(c) : nothing}`)}</div>
      </details>
      ${!attention.length && !conflicts.length && !ready.length && !excluded.length && !unseen.length && query
        ? html`<p>${C.noFilterMatches}</p>` : nothing}
    </section>`;
  }

  // ---- Step 3: finish ------------------------------------------------------------------------------------------

  const canFinish = (result: Summary) => !busy && (rows.length > 0 || sources.some(s => s.rare > 0)) && result.pending.size === 0;
  const inventoryJson = (result: Summary) => JSON.stringify(inventoryFromReview(rows, cards, result), null, 1);
  const download = (result: Summary) => downloadText('inventory.json', inventoryJson(result) + '\n', 'application/json');
  const change = (result: Summary) => host.apply && canFinish(result)
    ? applyReadings(host.apply.current(), cards, host.apply.effective, result, mode) : null;
  function apply(result: Summary) {
    const planned = change(result);
    if (!planned || !host.apply) return;
    host.apply.onApply(planned.inventory);
    notice = C.applied(planned.owned.length, planned.unowned.length, planned.changed.length); paint();
  }
  const modeOption = (value: ApplyMode, title: string, hint: string) => html`<label class="scan-mode">
    <input type="radio" name="scan-mode" value=${value} .checked=${live(mode === value)} data-mode=${value}
      @change=${() => { mode = value; paint(); }} /><span><strong>${title}</strong><br /><span class="muted small">${hint}</span></span></label>`;
  /** Explains what the action bar's button will do; the button itself stays in the bar so there is only one. */
  function finishStep(result: Summary, t: Triage) {
    if (!host.apply) {
      return html`<section class="panel scan-export ${canFinish(result) ? '' : 'scan-waiting'}">${stepHead(3, C.stepDownload)}<p>${C.missing}</p>
        <p>${C.import} ${host.plannerUrl ? html`<a href=${host.plannerUrl}>${C.openPlanner}</a>` : nothing}</p>
        ${result.pending.size ? html`<p class="scan-result-label">${C.exportBlocked}</p>` : nothing}
        ${canFinish(result) ? html`<details data-preview ?open=${previewOpen} @toggle=${toggled(v => { previewOpen = v; })}>
          <summary>${C.preview}</summary>${previewOpen ? html`<pre data-json>${inventoryJson(result)}</pre>` : nothing}</details>` : nothing}
      </section>`;
    }
    const planned = change(result);
    const changes = planned ? planned.owned.length + planned.unowned.length + planned.changed.length : 0;
    const names = (list: ScanCard[]) => list.map(c => c.name).join(', ');
    return html`<section class="panel scan-export ${planned ? '' : 'scan-waiting'}">${stepHead(3, C.stepApply)}
      <div class="scan-modes">
        ${modeOption('replace', C.modeReplace, C.modeReplaceHint(t.unseen.length))}
        ${modeOption('update', C.modeUpdate, C.modeUpdateHint)}
      </div>
      ${planned ? html`<p data-change-summary>${changes ? C.changeSummary(planned.owned.length, planned.unowned.length, planned.changed.length, planned.unchanged) : C.noChanges}</p>
        ${changes ? html`<details class="scan-change-list"><summary>${C.changeList}</summary>
          ${planned.owned.length ? html`<p><strong>${C.listOwned}</strong> ${names(planned.owned)}</p>` : nothing}
          ${planned.changed.length ? html`<p><strong>${C.listChanged}</strong> ${names(planned.changed)}</p>` : nothing}
          ${planned.unowned.length ? html`<p><strong>${C.listUnowned}</strong> ${names(planned.unowned)}</p>` : nothing}
        </details>` : nothing}`
        : rows.length ? html`<p class="scan-result-label">${C.exportBlocked}</p>` : nothing}
    </section>`;
  }
  /** Stays in view at the bottom and holds the only finish button, so it never hides behind a long review. */
  function actionBar(result: Summary, t: Triage) {
    const decide = t.attention.length + t.conflicts.length;
    const ready = canFinish(result);
    return html`<div class="scan-bar ${ready ? '' : 'scan-waiting'}" data-bar>
      <span data-bar-summary>${rows.length ? C.barSummary(t.ready.length, decide) : C.barEmpty}</span>
      ${host.apply
        ? html`<button class="primary" data-apply ?disabled=${!ready} title=${ready ? '' : C.applyBlocked} @click=${() => apply(result)}>${C.apply}</button>`
        : html`<button class="primary" data-download ?disabled=${!ready} title=${ready ? '' : C.applyBlocked} @click=${() => download(result)}>${C.download}</button>`}
    </div>`;
  }

  function render() {
    const result = summarize(rows, cards);
    const t = triage(rows, cards, result);
    return html`<div class="scan-flow">${uploadStep()}${reviewStep(result, t)}${finishStep(result, t)}${actionBar(result, t)}</div>`;
  }
  function dispose() {
    generation++; worker?.terminate(); worker = null;
    rejectScan?.(new Error('cancelled')); rejectScan = null;
    for (const source of sources) if (source.image) URL.revokeObjectURL(source.image);
  }
  return { render, dispose };
}
