// URL import and synchronization. Persisted choices still change only through context.update().
import { decodeShare, encodeShare, sharedChoices, shareKey, shareUrl, ShareCodeError } from '../share.ts';
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
  timer = setTimeout(async () => {
    try {
      const code = await encodeShare(choices);
      if (request !== generation) return;
      history.replaceState(history.state, '', shareUrl(location.href, key === defaultKey ? null : code));
    } catch (error) {
      if (request !== generation) return;
      // An older link must not claim to represent inputs we could not encode.
      history.replaceState(history.state, '', shareUrl(location.href, null));
      void notice(error instanceof ShareCodeError && error.reason === 'size' ? COPY.share.tooLarge : COPY.share.generateFailed);
    }
  }, 300);
}

async function loadShare(code: string) {
  const request = ++importRequest, revision = stateRevision;
  refresh();
  try {
    const choices = await decodeShare(code);
    if (request !== importRequest) return;
    if (revision !== stateRevision) { void notice(COPY.share.editedDuringLoad); return; }
    view.targetEditorId = null;
    view.goalTemplateId = '';
    view.requiredQuery = ''; view.preferredQuery = ''; view.traineeQuery = ''; view.cardQuery = ''; view.activeSearch = null;
    view.drag = { key: null, over: null };
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
    void notice(errorMessage(error));
  } finally {
    if (request === importRequest) refresh();
  }
}

function cancelPendingSharing() {
  generation++; importRequest++;
  clearTimeout(timer);
}

async function loadSharedUrl() {
  // Navigation supersedes both unfinished imports and URL writes for the previous location.
  cancelPendingSharing();
  const code = new URL(location.href).searchParams.get('run');
  if (code !== null) await loadShare(code); else { queueSync(true); refresh(); }
}

/** Run before mounting so a URL import cannot race the first edits or publish a plan for the old inputs. */
export async function initializeSharing() {
  onUpdate(queueSync);
  window.addEventListener('popstate', () => { void loadSharedUrl(); });
  await loadSharedUrl();
}

/** Reset all reloads the page. Cancel asynchronous writes before removing the old import URL. */
export function clearSharedUrl() {
  cancelPendingSharing();
  history.replaceState(history.state, '', shareUrl(location.href, null));
}
