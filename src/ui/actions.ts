import { parseSetting, SETTING_SPEC, type Settings } from '../settings.ts';
import { renderNow, store, update, view } from './context.ts';

function settingRange(key: keyof Settings): string {
  const spec = SETTING_SPEC[key];
  switch (spec.kind) {
    case 'number': return `Enter a number from ${spec.min} to ${spec.max}.`;
    case 'number-or-null': return `Leave blank or enter a number from ${spec.min} to ${spec.max}.`;
    case 'list': return `Enter ${spec.length} numbers ${spec.bounds ? `from ${spec.bounds.map(([low, high]) => `${low} to ${high}`).join(', ')} in order` : `from ${spec.min} to ${spec.max}`}, separated by commas${spec.sum !== undefined ? `, adding up to ${spec.sum}` : ''}${spec.nonIncreasing ? ', each no larger than the one before' : ''}.`;
    case 'enum': return `Choose one of ${spec.values.join(', ')}.`;
    default: return 'This value cannot be edited here.';
  }
}

/** Apply a form value to a setting. Keep rejected drafts in the view, with the accepted range. */
export function setSetting(key: keyof Settings, raw: string) {
  const v = parseSetting(key, raw);
  if (v === undefined) {
    view.settingErrors = { ...view.settingErrors, [key]: { value: raw, message: settingRange(key) } };
    return;
  }
  const { [key]: _, ...rest } = view.settingErrors;
  view.settingErrors = rest;
  update((s) => { Object.assign(s.settings, { [key]: v }); });
}

/** A card is pinned or ignored, never both: each choice clears the other. */
export function pinCard(id: number) {
  view.cardQuery = '';
  update((s) => {
    s.run.ignoredIds = s.run.ignoredIds.filter((x) => x !== id);
    if (!s.run.pinnedIds.includes(id)) s.run.pinnedIds.push(id);
  });
}
export function unpinCard(id: number) {
  update((s) => { s.run.pinnedIds = s.run.pinnedIds.filter((x) => x !== id); });
}
export function ignoreCard(id: number) {
  view.ignoreQuery = '';
  update((s) => {
    s.run.pinnedIds = s.run.pinnedIds.filter((x) => x !== id);
    if (!s.run.ignoredIds.includes(id)) s.run.ignoredIds.push(id);
  });
}
export function unignoreCard(id: number) {
  update((s) => { s.run.ignoredIds = s.run.ignoredIds.filter((x) => x !== id); });
}

export function openPinkSparks() {
  view.showPinkSparks = true;
  if (store.ui.inputsHidden) update((s) => { s.ui.inputsHidden = false; });
  else renderNow();
  document.querySelector<HTMLElement>('[data-pink-lineage="0"]')?.focus();
}
