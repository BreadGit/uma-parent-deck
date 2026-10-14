// Standard panel chrome so every panel reads the same: a title, an optional step number, an optional muted subtitle,
// an optional info tip, and actions aligned to the right. Sub-sections inside a panel use sub(); longer explanations
// go in about().
import { html, nothing, type TemplateResult } from 'lit-html';
import { tip } from './tooltip.ts';

export interface PanelHead {
  title: string;
  /** Position in the input flow, shown before the title. */
  step?: number;
  /** A result panel: distinct surface so output reads differently from input. */
  kind?: 'input' | 'result';
  subtitle?: string;
  tip?: string;
  actions?: TemplateResult | typeof nothing;
  cls?: string;
}

export function panel(head: PanelHead, body: TemplateResult | typeof nothing) {
  return html`<section class="panel ${head.kind === 'result' ? 'panel-result' : ''} ${head.cls ?? ''}">
    <div class="panel-head">
      <h2 data-step=${head.step ?? nothing}>${head.title}</h2>
      ${head.subtitle ? html`<span class="panel-sub" data-panel-sub>${head.subtitle}</span>` : nothing}
      ${head.tip ? tip(head.tip) : nothing}
      ${head.actions ? html`<span class="panel-actions">${head.actions}</span>` : nothing}
    </div>
    ${body}
  </section>`;
}

/** A sub-section heading inside a panel, with an optional info tip. */
export function sub(title: string, help?: string) {
  return html`<div class="sub-head"><h3>${title}</h3>${help ? tip(help) : nothing}</div>`;
}

/** A collapsed explanation at the end of a panel or section, for anything longer than a tooltip should hold. */
export function about(title: string, body: readonly string[] | TemplateResult) {
  return html`<details class="about"><summary>${title}</summary>${Array.isArray(body) ? body.map((p) => html`<p class="small">${p}</p>`) : body}</details>`;
}
