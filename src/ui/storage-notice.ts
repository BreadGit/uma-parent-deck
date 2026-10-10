import { html, nothing } from 'lit-html';
import { newerSave, removeUnreadableSave, replaceNewerSave, saveState, storageUnavailable, uncopiedUnreadable, unreadableSave } from '../state.ts';
import { downloadText } from '../download.ts';
import { refresh, store } from './context.ts';
import { COPY } from './copy.ts';
import { confirmDialog } from './dialog.ts';

async function removeCopy() {
  if (!await confirmDialog(COPY.app.removeUnreadableConfirm, COPY.app.removeUnreadableAction)) return;
  removeUnreadableSave();
  refresh();
}

/** Without room for a copy, the unreadable save is still in place; replacing it lets this page save again. */
async function replaceUnreadable() {
  if (!await confirmDialog(COPY.app.replaceUnreadableConfirm, COPY.app.replaceUnreadableAction)) return;
  removeUnreadableSave();
  saveState(store);
  refresh();
}

async function replaceNewer() {
  if (!await confirmDialog(COPY.app.replaceNewerSaveConfirm, COPY.app.replaceNewerSaveAction)) return;
  replaceNewerSave(store);
  refresh();
}

/** The copy of an unreadable save stays offered until the user removes it, so its notice outlives the session that found it. */
function unreadableNotice() {
  const raw = unreadableSave();
  if (raw === null) return nothing;
  const inPlace = uncopiedUnreadable !== null;
  return html`<div class="banner" data-unreadable-save role="status"><p>${inPlace ? COPY.app.uncopiedUnreadableSave : COPY.app.unreadableSave}</p>
    <button class="small" data-action="download-unreadable" @click=${() => downloadText('uma-parent-deck-unreadable-save.txt', raw)}>${COPY.app.downloadUnreadable}</button>
    ${inPlace
      ? html`<button class="small" data-action="replace-unreadable" @click=${replaceUnreadable}>${COPY.app.replaceUnreadable}</button>`
      : html`<button class="small" data-action="remove-unreadable" @click=${removeCopy}>${COPY.app.removeUnreadable}</button>`}</div>`;
}

export const storageNotice = () => html`${newerSave
  ? html`<div class="banner" data-newer-save role="status"><p>${COPY.app.newerSave}</p>
    <button class="small" data-action="replace-newer-save" @click=${replaceNewer}>${COPY.app.replaceNewerSave}</button></div>`
  : nothing}${storageUnavailable
  ? html`<p class="banner" data-storage-warning role="status">${COPY.app.storageUnavailable}</p>`
  : nothing}${unreadableNotice()}`;
