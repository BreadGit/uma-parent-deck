// Copy and import controls, with visible notices for choices unavailable in the current game data.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { shareUrl } from '../../share.ts';
import { unavailableRunChoices } from '../../model/run.ts';
import { data, refresh, store, view } from '../context.ts';
import { COPY } from '../copy.ts';
import { inputValue } from '../fields.ts';
import { panel } from '../panel.ts';
import { copyShare, loadShare } from '../share.ts';

export function renderShare() {
  const missing = unavailableRunChoices(store.run, data);
  const unavailable = missing.trainee !== null || missing.cards.length > 0 || missing.skills.length > 0;
  return panel({ title: COPY.share.title }, html`
    ${unavailable ? html`<div class="small warn" data-unavailable-choices role="status">
      <p>${COPY.share.unavailable}</p>
      ${missing.trainee !== null ? html`<p>${COPY.share.missingTrainee(missing.trainee)}</p>` : nothing}
      ${missing.cards.length ? html`<p>${COPY.share.missingCards(missing.cards)}</p>` : nothing}
      ${missing.skills.length ? html`<p>${COPY.share.missingSkills(missing.skills)}</p>` : nothing}
    </div>` : nothing}
    <details data-share-controls ?open=${view.shareOpen} @toggle=${(event: Event) => {
      const open = (event.currentTarget as HTMLDetailsElement).open;
      if (view.shareOpen !== open) { view.shareOpen = open; refresh(); }
    }}>
      <summary>${COPY.share.controls}</summary>
      <p class="small">${COPY.share.description}</p>
      <label class="share-field">${COPY.share.code}<textarea data-share="code" rows="2" readonly .value=${live(view.shareCode)}></textarea></label>
      <button data-action="copy-share-code" ?disabled=${!view.shareCode || view.sharePending} @click=${() => copyShare('code')}>${COPY.share.copyCode}</button>
      <label class="share-field">${COPY.share.link}<textarea data-share="link" rows="3" readonly .value=${live(view.shareCode ? shareUrl(location.href, view.shareCode) : '')}></textarea></label>
      <button data-action="copy-share-link" ?disabled=${!view.shareCode || view.sharePending} @click=${() => copyShare('link')}>${COPY.share.copyLink}</button>
      <label class="share-field">${COPY.share.input}<textarea data-share="input" rows="2" .value=${live(view.shareInput)}
        @input=${(event: Event) => { view.shareInput = inputValue(event); refresh(); }}></textarea></label>
      <button data-action="load-share" ?disabled=${view.shareLoading || !view.shareInput.trim()} @click=${() => loadShare(view.shareInput)}>${COPY.share.load}</button>
      <p class="small" data-share-status role="status">${view.shareStatus}</p>
    </details>`);
}
