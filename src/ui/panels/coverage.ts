// Target coverage: which target hints the deck can hand over, through which sources, and what buying them costs.
// Rendered as a section of the prediction details panel.
import { html, nothing } from 'lit-html';
import type { RunPlan } from '../../model/run.ts';
import type { SkillSource } from '../../model/sparks.ts';
import { combineSources } from '../../model/sparks.ts';
import { COPY } from '../copy.ts';
import { num, pill, skillName, skillWithTip } from '../format.ts';
import { tip } from '../tooltip.ts';

/** One source of a target skill: who gives it, which form, how likely, and through what. */
const sourceLine = (s: SkillSource) => html`<div class="src">${s.cardName ? html`<span class="muted">${s.cardName}</span> ` : nothing}${skillName(s.skillId)} ${pill(s.pObtain)} <span class="muted">${s.detail}</span></div>`;

function spCost(c: RunPlan) {
  if (!c.targets.length) return nothing;
  const p = c.pred, over = c.spCost.total > p.sp;
  const detail = c.spCost.items.map((it) => `${it.skill?.name ?? it.target.name}: ${it.purchases.map((s) => `${s.name} ${s.cost ?? '?'}`).join(' + ')} = ${it.cost ?? '?'}`).join(', ');
  return html`<div class="small ${over ? 'warn' : 'muted'}">Worst-case target SP cost: <b>${num(c.spCost.total)}${c.spCost.incomplete ? '+' : ''}</b> of ${num(p.sp)} estimated SP${over ? ', more than the run is expected to earn' : ''}${tip(`${COPY.coverage.spCostTip} (${detail})`)}</div>`;
}

export function coverageTable(c: RunPlan) {
  const d = c.deckResult;
  return html`
    <div class="scroll-x"><table class="coverage"><thead><tr><th>Skill</th><th class="num col-detail">Gold hint</th><th class="num col-detail">◎ or white hint</th><th class="num">Spark chance</th><th>Sources</th></tr></thead><tbody>
      ${c.targets.map((t) => {
        const srcs = d.coverage.get(t.id) ?? [];
        const own = combineSources(srcs);
        const spark = d.sparks.get(t.id) ?? 0;
        return html`<tr><td>${skillWithTip(t.white?.id ?? t.id, t.name)}</td><td class="num col-detail">${pill(own.pGold)}</td><td class="num col-detail">${pill(own.pWhite + own.pCircle)}</td><td class="num">${pill(spark)}</td>
          <td class="small wrap src-list">${srcs.length ? srcs.map(sourceLine) : html`<span class="warn">${COPY.coverage.noSource}</span>`}</td></tr>`;
      })}
      ${c.targets.length ? nothing : html`<tr><td colspan="5" class="muted">${COPY.targets.none}</td></tr>`}
    </tbody></table></div>
    ${spCost(c)}`;
}
