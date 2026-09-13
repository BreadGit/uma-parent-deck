// Temporary UI for trying share codes against real saved choices.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { decodeShare, encodeShare } from '../share-prototype.ts';
import { data, refresh, store, update, view } from './context.ts';
import { COPY } from './copy.ts';
import { notice } from './dialog.ts';
import { inputValue } from './fields.ts';

function shareUrl(code: string): string {
  const url = new URL(location.href);
  url.searchParams.set('run', code);
  return url.href;
}

async function generate() {
  try {
    view.shareCode = await encodeShare(structuredClone(store));
    view.shareStatus = COPY.share.generated(view.shareCode.length);
    refresh();
  } catch { await notice(COPY.share.generateFailed); }
}

async function load(value: string): Promise<boolean> {
  try {
    const input = value.trim();
    const code = /^https?:\/\//.test(input) ? new URL(input).searchParams.get('run') ?? '' : input;
    const next = await decodeShare(code, store, data);
    view.shareCode = '';
    view.shareStatus = COPY.share.loaded;
    update((s) => { s.run = next.run; s.settings = next.settings; });
    return true;
  } catch { await notice(COPY.share.loadFailed); return false; }
}

async function copy(value: string, field: string) {
  try { await navigator.clipboard.writeText(value); }
  catch {
    const input = document.querySelector<HTMLTextAreaElement>(`[data-share="${field}"]`);
    await notice(COPY.share.copyManually);
    input?.focus(); input?.select();
  }
}

export async function loadSharedUrl() {
  const url = new URL(location.href);
  const code = url.searchParams.get('run');
  if (code === null) return;
  view.shareOpen = true;
  if (await load(code)) {
    // Consume the import so a later reload or Reset all does not restore it again.
    url.searchParams.delete('run');
    history.replaceState(history.state, '', url);
  }
}

export function renderSharePrototype() {
  return html`<details class="share-prototype" ?open=${view.shareOpen}
    @toggle=${(event: Event) => {
      const open = (event.currentTarget as HTMLDetailsElement).open;
      if (view.shareOpen !== open) { view.shareOpen = open; refresh(); }
    }}>
    <summary>${COPY.share.title}</summary>
    <p>${COPY.share.description}</p>
    <button data-action="generate-share" @click=${generate}>${COPY.share.generate}</button>
    ${view.shareCode ? html`
      <label>${COPY.share.code}<textarea data-share="code" rows="2" readonly .value=${live(view.shareCode)}></textarea></label>
      <button data-action="copy-share-code" @click=${() => copy(view.shareCode, 'code')}>${COPY.share.copyCode}</button>
      <label>${COPY.share.link}<textarea data-share="link" rows="3" readonly .value=${live(shareUrl(view.shareCode))}></textarea></label>
      <button data-action="copy-share-link" @click=${() => copy(shareUrl(view.shareCode), 'link')}>${COPY.share.copyLink}</button>` : nothing}
    <label>${COPY.share.input}<textarea data-share="input" rows="2" .value=${live(view.shareInput)}
      @input=${(event: Event) => { view.shareInput = inputValue(event); refresh(); }}></textarea></label>
    <button data-action="load-share" @click=${() => load(view.shareInput)}>${COPY.share.load}</button>
    <p role="status">${view.shareStatus}</p>
  </details>`;
}
