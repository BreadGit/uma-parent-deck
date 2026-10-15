import { decodeShare, encodeShare, shareCode, sharedChoices, shareKey, shareUrl, ShareCodeError } from '../share.ts';
import { applySharedChoices, defaultState } from '../state.ts';
import { data, onUpdate, stateRevision, store, update, view } from './context.ts';
import { notice } from './dialog.ts';

const TOO_LARGE_NOTICE = 'These choices exceed the share-code size limit. Your saved choices were kept.';
const SYNC_DELAY_MS = 300;

const defaultKey = shareKey(sharedChoices(defaultState(data)));
let lastKey = '';
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let importRequest = 0;

function loadFailureNotice(error: unknown) {
  return error instanceof ShareCodeError && error.reason === 'version' ? 'This code uses a newer or unsupported share format. Try updating the app. Your saved choices were kept.'
    : error instanceof ShareCodeError && error.reason === 'size' ? TOO_LARGE_NOTICE : 'This code is invalid or incomplete. Your saved choices were kept.';
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
      void notice(error instanceof ShareCodeError && error.reason === 'size' ? TOO_LARGE_NOTICE : 'Could not update the share code. Your choices are saved on this device. Try an up-to-date browser.');
    }
  }, SYNC_DELAY_MS);
}

async function loadShare(code: string) {
  const request = ++importRequest, revision = stateRevision();
  try {
    const choices = await decodeShare(code);
    if (request !== importRequest) return;
    if (revision !== stateRevision()) { void notice('Your choices changed while the code was loading. Load it again to replace them.'); return; }
    view.targetEditorId = null;
    view.goalTemplateId = '';
    view.requiredQuery = ''; view.preferredQuery = ''; view.traineeQuery = ''; view.cardQuery = ''; view.ignoreQuery = ''; view.activeSearch = null;
    view.drag = { key: null, over: null };
    if (shareKey(choices) !== shareKey(sharedChoices(store))) {
      update((s) => applySharedChoices(s, choices));
    }
    queueSync(true);
  } catch (error) {
    if (request !== importRequest) return;
    void notice(loadFailureNotice(error));
  }
}

function cancelPendingSharing() {
  generation++; importRequest++;
  clearTimeout(timer);
}

async function loadSharedUrl() {
  // Navigation supersedes both unfinished imports and URL writes for the previous location.
  cancelPendingSharing();
  const code = shareCode(location.href);
  if (code !== null) await loadShare(code); else queueSync(true);
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
