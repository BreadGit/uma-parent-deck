import { html, type TemplateResult } from 'lit-html';
import { SLOTS_PER_YEAR } from '../model/rules.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CAREER_YEARS = ['Junior year', 'Classic year', 'Senior year'];
export const slotLabel = (slot: number) => `${slot % 2 === 0 ? 'Early' : 'Late'} ${MONTHS[Math.floor((slot % SLOTS_PER_YEAR) / 2)]}`;

/** The game's three-year layout, shared by the planner and mission calendar. */
export function agendaGrid(cell: (slot: number) => TemplateResult) {
  return html`<div class="agenda">
    ${CAREER_YEARS.map((year, yi) => html`<div class="agenda-year">
      <div class="agenda-year-head">${year}</div>
      <div class="agenda-grid">${Array.from({ length: SLOTS_PER_YEAR }, (_, i) => cell(yi * SLOTS_PER_YEAR + i))}</div>
    </div>`)}
  </div>`;
}
