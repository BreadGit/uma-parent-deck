// Share actions and URL synchronization. Persisted choices still change only through context.update().
import { decodeShare, encodeShare, sharedChoices, shareKey, shareUrl, shareCodeFromInput, ShareCodeError } from '../share.ts';
import { applySharedChoices, defaultState } from '../state.ts';
import { data, onUpdate, refresh, stateRevision, store, update, view } from './context.ts';
import { COPY } from './copy.ts';
import { notice } from './dialog.ts';

const defaultKey = shareKey(sharedChoices(defaultState(data)));
let lastKey = '';
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let importRequest = 0;

function errorMessage(error: unknown) {
  return error instanceof ShareCodeError && error.reason === 'version' ? COPY.share.unsupported
    : error instanceof ShareCodeError && error.reason === 'size' ? COPY.share.tooLarge : COPY.share.loadFailed;
}

/** Invalidate in-flight compression immediately, before debouncing the next snapshot. */
function queueSync(force = false) {
  const choices = sharedChoices(store), key = shareKey(choices);
  if (!force && key === lastKey) return;
  lastKey = key;
  const request = ++generation;
  clearTimeout(timer);
  // Reloading during the debounce must use the latest saved choices, never an older URL snapshot.
  history.replaceState(history.state, '', shareUrl(location.href, null));
  view.shareCode = '';
  view.sharePending = true;
  view.shareStatus = COPY.share.updating;
  timer = setTimeout(async () => {
    try {
      const code = await encodeShare(choices);
      if (request !== generation) return;
      history.replaceState(history.state, '', shareUrl(location.href, key === defaultKey ? null : code));
      view.shareCode = code;
      view.shareStatus = COPY.share.ready(code.length);
    } catch (error) {
      if (request !== generation) return;
      // An older link must not claim to represent inputs we could not encode.
      history.replaceState(history.state, '', shareUrl(location.href, null));
      view.shareStatus = error instanceof ShareCodeError && error.reason === 'size' ? COPY.share.tooLarge : COPY.share.generateFailed;
    }
    view.sharePending = false;
    refresh();
  }, 300);
}

export async function loadShare(value: string, startup = false) {
  const request = ++importRequest, revision = stateRevision;
  view.shareLoading = true;
  view.shareOpen = true;
  refresh();
  try {
    const choices = await decodeShare(shareCodeFromInput(value));
    if (request !== importRequest) return;
    if (revision !== stateRevision) { void notice(COPY.share.editedDuringLoad); return; }
    view.targetEditorId = null;
    view.goalTemplateId = '';
    view.query = ''; view.traineeQuery = ''; view.cardQuery = ''; view.activeSearch = null;
    view.drag = { key: null, over: null };
    view.shareInput = '';
    if (shareKey(choices) !== shareKey(sharedChoices(store))) {
      try { update((s) => applySharedChoices(s, choices)); }
      catch (error) {
        if (!(error instanceof DOMException) || !['QuotaExceededError', 'SecurityError'].includes(error.name)) throw error;
        queueSync(true);
        void notice(COPY.share.saveFailed);
        return;
      }
    }
    queueSync(true);
  } catch (error) {
    if (request !== importRequest) return;
    if (startup) view.shareStatus = errorMessage(error);
    void notice(errorMessage(error));
  } finally {
    if (request === importRequest) { view.shareLoading = false; refresh(); }
  }
}

export async function copyShare(field: 'code' | 'link') {
  const code = view.shareCode;
  if (!code || view.sharePending) return;
  try {
    await navigator.clipboard.writeText(field === 'code' ? code : shareUrl(location.href, code));
    view.shareStatus = COPY.share.copied;
    refresh();
  } catch {
    await notice(COPY.share.copyManually);
    const input = document.querySelector<HTMLTextAreaElement>(`[data-share="${field}"]`);
    input?.focus(); input?.select();
  }
}

/** Run before mounting so a URL import cannot race the first edits or publish a plan for the old inputs. */
export async function initializeSharing() {
  onUpdate(queueSync);
  const code = new URL(location.href).searchParams.get('run');
  if (code !== null) await loadShare(code, true); else queueSync();
  window.addEventListener('popstate', () => {
    const code = new URL(location.href).searchParams.get('run');
    if (code !== null) void loadShare(code); else { queueSync(true); refresh(); }
  });
}

/** Reset all reloads the page. Cancel asynchronous writes before removing the old import URL. */
export function clearSharedUrl() {
  generation++; importRequest++;
  clearTimeout(timer);
  history.replaceState(history.state, '', shareUrl(location.href, null));
}
