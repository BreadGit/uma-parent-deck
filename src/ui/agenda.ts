import { html, type TemplateResult } from 'lit-html';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const CAREER_YEARS = ['Junior year', 'Classic year', 'Senior year'];
export const slotLabel = (slot: number) => `${slot % 2 === 0 ? 'Early' : 'Late'} ${MONTHS[Math.floor((slot % 24) / 2)]}`;

/** The game's three-year layout, shared by the planner and mission calendar. */
export function agendaGrid(cell: (slot: number) => TemplateResult) {
  return html`<div class="agenda">
    ${CAREER_YEARS.map((year, yi) => html`<div class="agenda-year">
      <div class="agenda-year-head">${year}</div>
      <div class="agenda-grid">${Array.from({ length: 24 }, (_, i) => cell(yi * 24 + i))}</div>
    </div>`)}
  </div>`;
}
