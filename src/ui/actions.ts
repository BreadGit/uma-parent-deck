// Actions more than one panel triggers: settings, pins, and opening the pink spark editor.
import { parseSetting, SETTING_SPEC, type Settings } from '../settings.ts';
import { refresh, store, update, view } from './context.ts';

/** The range a setting accepts, for the message shown when a typed value is rejected. */
export function settingRange(key: keyof Settings): string {
  const spec = SETTING_SPEC[key];
  switch (spec.kind) {
    case 'number': return `Enter a number from ${spec.min} to ${spec.max}.`;
    case 'number-or-null': return `Leave blank or enter a number from ${spec.min} to ${spec.max}.`;
    case 'list': return `Enter ${spec.length} numbers from ${spec.min} to ${spec.max}, separated by commas${spec.sum !== undefined ? `, adding up to ${spec.sum}` : ''}.`;
    case 'enum': return `Choose one of ${spec.values.join(', ')}.`;
    default: return 'This value cannot be edited here.';
  }
}

/** Apply a form value to a setting. Keep rejected drafts in the view, with the accepted range. */
export function setSetting(key: keyof Settings, raw: string | boolean): boolean {
  const v = parseSetting(key, raw);
  if (v === undefined) {
    view.settingErrors = { ...view.settingErrors, [key]: { value: String(raw), message: settingRange(key) } };
    refresh();
    return false;
  }
  const { [key]: _, ...rest } = view.settingErrors;
  view.settingErrors = rest;
  update((s) => { (s.settings as unknown as Record<string, unknown>)[key] = v; });
  return true;
}

export function pinCard(id: number) {
  view.cardQuery = '';
  update((s) => { if (!s.run.pinnedIds.includes(id)) s.run.pinnedIds.push(id); });
}
export function unpinCard(id: number) {
  update((s) => { s.run.pinnedIds = s.run.pinnedIds.filter((x) => x !== id); });
}

/** Open the pink spark editor in Legacy, showing the input column if it is hidden, and move focus to its first field. */
export function openPinkSparks() {
  view.showPinkSparks = true;
  if (store.ui.inputsHidden) update((s) => { s.ui.inputsHidden = false; });
  else refresh();
  document.querySelector<HTMLElement>('[data-pink-lineage="0"]')?.focus();
}
