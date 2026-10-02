import { html } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';

export interface Option { value: string; label: string; cls?: string }

/**
 * Options for a <select> whose value is bound with `.value=${live(...)}`. The property binding is committed before
 * the options exist, so `selected` picks the initial option; the live binding keeps later renders in step. Options
 * are keyed by value: when a blank placeholder disappears, the remaining option elements must stay put, or the
 * browser keeps the old index and shows the wrong entry.
 */
export const options = (items: readonly Option[], current: string) =>
  repeat(items, (o) => o.value, (o) => html`<option value=${o.value} ?selected=${o.value === current} class=${o.cls ?? ''}>${o.label}</option>`);
export const numbered = (values: readonly number[], label: (n: number) => string): Option[] => values.map((n) => ({ value: String(n), label: label(n) }));

export const selectValue = (e: Event) => (e.target as HTMLSelectElement).value;
export const inputValue = (e: Event) => (e.target as HTMLInputElement).value;
export const inputNumber = (e: Event) => (e.target as HTMLInputElement).valueAsNumber;
export const isChecked = (e: Event) => (e.target as HTMLInputElement).checked;
