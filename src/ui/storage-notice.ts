import { html, nothing } from 'lit-html';
import { newerSave, removeUnreadableSave, replaceNewerSave, replaceUnreadableSave, storageUnavailable, uncopiedUnreadable, unreadableSave } from '../state.ts';
import { downloadText } from '../download.ts';
import { refresh, store } from './context.ts';
import { confirmDialog } from './dialog.ts';

const copy = {
  newerSave: 'The choices in this browser were saved by a newer version of this page, so this older page does not save changes. Reload to get the newer version.',
  replaceNewerSave: 'Save changes here anyway',
  replaceNewerSaveConfirm: 'Saving here replaces the newer save with this older format. Choices only the newer version understands are lost. Continue?',
  replaceNewerSaveAction: 'Save here',
  unreadableSave: 'The choices saved in this browser could not be read. A copy of the unreadable save is kept in this browser until you remove it.',
  downloadUnreadable: 'Download the unreadable save',
  removeUnreadable: 'Remove the copy',
  removeUnreadableConfirm: 'Remove the copy of the unreadable save? It cannot be recovered afterwards.',
  removeUnreadableAction: 'Remove',
  uncopiedUnreadableSave: 'The choices saved in this browser could not be read. This page does not save changes until you replace the unreadable save.',
  replaceUnreadable: 'Replace it and save changes',
  replaceUnreadableConfirm: 'Replace the unreadable save with the choices on this page? It cannot be recovered afterwards.',
  replaceUnreadableAction: 'Replace',
  storageUnavailable: 'This browser cannot save your changes. You can keep using this page, but changes may be lost when you leave. Copy the run URL and export your inventory before leaving; advanced settings are not included in the run URL.',
} as const;

async function removeCopy() {
  if (!await confirmDialog(copy.removeUnreadableConfirm, copy.removeUnreadableAction)) return;
  removeUnreadableSave();
  refresh();
}

/** Without a copy, the unreadable save is still in place; replacing it lets this page save again. */
async function replaceUnreadable() {
  if (!await confirmDialog(copy.replaceUnreadableConfirm, copy.replaceUnreadableAction)) return;
  replaceUnreadableSave(store);
  refresh();
}

async function replaceNewer() {
  if (!await confirmDialog(copy.replaceNewerSaveConfirm, copy.replaceNewerSaveAction)) return;
  replaceNewerSave(store);
  refresh();
}

/** The copy of an unreadable save stays offered until the user removes it, so its notice outlives the session that found it. */
function unreadableNotice() {
  const raw = unreadableSave();
  if (raw === null) return nothing;
  const inPlace = uncopiedUnreadable !== null;
  return html`<div class="banner" data-unreadable-save role="status"><p>${inPlace ? copy.uncopiedUnreadableSave : copy.unreadableSave}</p>
    <button class="small" data-action="download-unreadable" @click=${() => downloadText('uma-parent-deck-unreadable-save.txt', raw)}>${copy.downloadUnreadable}</button>
    ${inPlace
      ? html`<button class="small" data-action="replace-unreadable" @click=${replaceUnreadable}>${copy.replaceUnreadable}</button>`
      : html`<button class="small" data-action="remove-unreadable" @click=${removeCopy}>${copy.removeUnreadable}</button>`}</div>`;
}

export const storageNotice = () => html`${newerSave
  ? html`<div class="banner" data-newer-save role="status"><p>${copy.newerSave}</p>
    <button class="small" data-action="replace-newer-save" @click=${replaceNewer}>${copy.replaceNewerSave}</button></div>`
  : nothing}${storageUnavailable
  ? html`<p class="banner" data-storage-warning role="status">${copy.storageUnavailable}</p>`
  : nothing}${unreadableNotice()}`;
