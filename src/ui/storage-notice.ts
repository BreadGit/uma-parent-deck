import { html, nothing } from 'lit-html';
import { hasNewerSave, isStorageUnavailable, removeUnreadableSave, replaceNewerSave, unreadableSave } from '../state.ts';
import { downloadText } from '../download.ts';
import { renderNow, store } from './context.ts';
import { confirmDialog } from './dialog.ts';

async function removeCopy() {
  if (!await confirmDialog('Remove the unreadable save? It cannot be recovered afterwards.', 'Remove')) return;
  removeUnreadableSave(store);
  renderNow();
}

async function replaceNewer() {
  if (!await confirmDialog('Saving here replaces the newer save with this older format. Choices only the newer version understands are lost. Continue?', 'Save here')) return;
  replaceNewerSave(store);
  renderNow();
}

function unreadableNotice() {
  const raw = unreadableSave();
  if (raw === null) return nothing;
  return html`<div class="banner" data-unreadable-save role="status"><p>A save in this browser could not be read, so this page saves your choices in its place. Download the unreadable save if you want to keep it.</p>
    <button class="small" data-action="download-unreadable" @click=${() => downloadText('uma-parent-deck-unreadable-save.txt', raw)}>Download the unreadable save</button>
    <button class="small" data-action="remove-unreadable" @click=${removeCopy}>Remove it</button></div>`;
}

export const storageNotice = () => html`${hasNewerSave()
  ? html`<div class="banner" data-newer-save role="status"><p>The choices in this browser were saved by a newer version of this page, so this older page does not save changes. Reload to get the newer version.</p>
    <button class="small" data-action="replace-newer-save" @click=${replaceNewer}>Save changes here anyway</button></div>`
  : nothing}${isStorageUnavailable()
  ? html`<p class="banner" data-storage-warning role="status">This browser cannot save your changes. You can keep using this page, but changes may be lost when you leave. Copy the run URL and export your inventory before leaving; advanced settings are not included in the run URL.</p>`
  : nothing}${unreadableNotice()}`;
