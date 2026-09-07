// Standard panel chrome so every panel reads the same: a title, an optional muted subtitle inside the heading,
// an optional info tip, and actions aligned to the right. Sub-sections inside a panel use sub().
import { html, nothing, type TemplateResult } from 'lit-html';
import { tip } from './tooltip.ts';

export interface PanelHead {
  title: string;
  /** Short, muted, inside the <h2> so tests can match on the heading text. */
  subtitle?: string | TemplateResult;
  /** Explanation of what the panel is for, behind an info icon. */
  tip?: string;
  /** Buttons or fields that act on the panel, right-aligned. */
  actions?: TemplateResult | typeof nothing;
}

export function panel(head: PanelHead, body: TemplateResult | typeof nothing) {
  return html`<section class="panel">
    <div class="panel-head">
      <h2>${head.title}${head.subtitle ? html` <span class="panel-sub">${head.subtitle}</span>` : nothing}</h2>
      ${head.tip ? tip(head.tip) : nothing}
      ${head.actions ? html`<span class="panel-actions">${head.actions}</span>` : nothing}
    </div>
    ${body}
  </section>`;
}

/** A sub-section heading inside a panel, with an optional muted note and info tip. */
export function sub(title: string, opts: { note?: string | TemplateResult; tip?: string; actions?: TemplateResult | typeof nothing } = {}) {
  return html`<h3 class="sub-head">${title}${opts.note ? html` <span class="sub-note">${opts.note}</span>` : nothing}${opts.tip ? tip(opts.tip) : nothing}${opts.actions ? html`<span class="panel-actions">${opts.actions}</span>` : nothing}</h3>`;
}
