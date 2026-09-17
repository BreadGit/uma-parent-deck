// Every card scored against the targets, with the limit-break dropdowns that make up the inventory.
import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { STATS } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import type { CardScore } from '../../model/deck.ts';
import { cardTargetChances, compareTargetChances, type TargetSparkChance } from '../../model/card-ranking.ts';
import { cardEffectCoverage } from '../../model/support-effects.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { pinCard, unpinCard } from '../actions.ts';
import { COPY } from '../copy.ts';
import { basisLabel, basisTip, coverageFlag } from '../effect-coverage.ts';
import { isChecked, lbSelect } from '../fields.ts';
import { cardThumb, cardUrl, num, probability, skillName, typeIcon } from '../format.ts';
import { about, panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

// The Basis label keeps the row one line tall: the per-card facts live in its tooltip (hover, focus, or tap to pin),
// and the rules shared by every card are in the column header tip and the panel notes.
function basis(c: RunPlan, x: CardScore) {
  const effects = cardEffectCoverage(x.card, x.lb, data.model, { fansBefore: c.ctx.fansBefore });
  const flag = coverageFlag(effects);
  return html`<span class="basis-label" tabindex="0" data-basis=${x.card.id} data-tip=${basisTip(x.card, x.lb, x.source, effects)}>${basisLabel(x.card, x.lb, x.source)}${flag ? html` <span class="tag warn" data-formula-coverage>${flag}</span>` : nothing}</span>`;
}

const SORT_KEYS: Record<string, (x: CardScore) => number> = {
  stats: (x) => x.statPower, sp: (x) => x.sp,
  speed: (x) => x.stats[0]!, stamina: (x) => x.stats[1]!, power: (x) => x.stats[2]!, guts: (x) => x.stats[3]!, wit: (x) => x.stats[4]!,
};
const targetLabel = (x: TargetSparkChance) => `${x.target.name}${x.role === 'required' ? ` ${x.stars}★+` : ''}`;
const sourceDetails = (x: TargetSparkChance) => x.sources.length
  ? x.sources.map((s) => `${skillName(s.skillId)} via ${s.detail}: ${probability(s.pObtain)} skill acquisition`).join('\n')
  : 'No available source on this card under the current skill priorities.';
const targetChance = (x: TargetSparkChance) => html`<div class="target-spark" data-target-spark=${x.target.id}><span>${targetLabel(x)}</span> <span class="target-spark-value"><span class="pill">${probability(x.probability)}</span>${tip(sourceDetails(x))}</span></div>`;
function toggleTargets(cardId: number) {
  view.expandedRankingCards = view.expandedRankingCards.includes(cardId)
    ? view.expandedRankingCards.filter((id) => id !== cardId) : [...view.expandedRankingCards, cardId];
  refresh();
}
function targetChancesCell(cardId: number, targets: TargetSparkChance[]) {
  const available = targets.filter((x) => x.probability > 0);
  const hidden = available.slice(4);
  const expanded = view.expandedRankingCards.includes(cardId), detailsId = `card-targets-${cardId}`;
  return html`<td class="cover target-chances" data-target-chances>
    ${available.slice(0, 4).map(targetChance)}
    ${hidden.length ? html`<button type="button" class="target-more" data-target-more aria-expanded=${expanded} aria-controls=${detailsId} @click=${() => toggleTargets(cardId)}>${expanded ? 'Show fewer' : `+${hidden.length} more`}</button>
      <div id=${detailsId} ?hidden=${!expanded}>${expanded ? hidden.map(targetChance) : nothing}</div>` : nothing}
  </td>`;
}

const PIN_ICON = html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M22.3126 10.1753L20.8984 11.5895L20.1913 10.8824L15.9486 15.125L15.2415 18.6606L13.8273 20.0748L9.58466 15.8321L4.63492 20.7819L3.2207 19.3677L8.17045 14.4179L3.92781 10.1753L5.34202 8.76107L8.87756 8.05396L13.1202 3.81132L12.4131 3.10422L13.8273 1.69L22.3126 10.1753Z"></path></svg>`;

function row(c: RunPlan, x: CardScore, chances: TargetSparkChance[], focusMul: number[]) {
  const owned = !c.unowned.has(x.card.id);
  const pinned = store.run.pinnedIds.includes(x.card.id);
  const pinLabel = `${pinned ? 'Unpin' : 'Pin'} ${x.card.charName} [${x.card.title}]`;
  return html`<tr class="${owned ? '' : 'dim'}">
    <td>${cardThumb(x.card)}</td>
    <td><div class="ranking-card"><div class="ranking-card-name">${typeIcon(x.card)}<a class="card-link" href="${cardUrl(x.card)}" target="_blank" rel="noopener">${x.card.charName}</a>${c.trainee && c.trainee.charId === x.card.charId ? html` <span class="tag warn">${COPY.ranking.traineeCard}</span>` : nothing}<br/><span class="small muted">${x.card.title}</span></div>
      <button type="button" class="ranking-pin ${pinned ? 'active' : ''}" data-action="toggle-card-pin" data-id="${x.card.id}" aria-label="${pinLabel}" aria-pressed="${pinned}" data-tip="${pinLabel}" @click=${() => pinned ? unpinCard(x.card.id) : pinCard(x.card.id)}>${PIN_ICON}</button>
    </div></td>
    <td>${lbSelect(c, x.card, x.lb)}</td>
    ${targetChancesCell(x.card.id, chances)}
    ${x.stats.map((v, i) => html`<td class="num" data-card-stat="${STATS[i]}">${num(v * (focusMul[i] ?? 1))}</td>`)}
    <td class="num" data-card-stat-total><b>${num(x.statPower)}</b></td><td class="num">${num(x.sp)}</td>
    <td class="basis small">${basis(c, x)}</td>
  </tr>`;
}

export function renderRanking(c: RunPlan) {
  const fn = SORT_KEYS[store.ui.sortKey];
  const sortKey = fn ? store.ui.sortKey : 'score';
  const chances = new Map(c.ranking.map((x) => [x.card.id, cardTargetChances(x, store.run.targets, c.ctx)]));
  // per-stat cells carry the training focus multipliers, like the Total column (their focus-weighted sum)
  const focusMul = data.model.focus[store.settings.focus] ?? [1, 1, 1, 1, 1];
  const rows = c.ranking.filter((x) => store.ui.showUnowned || !c.unowned.has(x.card.id)).sort((a, b) =>
    fn ? fn(b) - fn(a) : compareTargetChances(chances.get(a.card.id)!, chances.get(b.card.id)!));
  const th = (k: string, label: string | TemplateResult, cls = 'num') => html`<th class="${cls} sortable" data-sort="${k}" aria-sort=${sortKey === k ? 'descending' : 'none'} @click=${() => update((s) => { s.ui.sortKey = k; })}>${label}${sortKey === k ? ' ▾' : ''}</th>`;
  const totalTip = `What the card adds to the final stats at ${c.sum.count} races under the ${store.settings.focus} focus: each stat column carries that focus's multiplier (${focusMul.map((m) => m.toFixed(2)).join(' / ')}) and Total is their sum. Target spark sorting uses Total when Required and Preferred chances both tie.`;
  const actions = html`<label class="row"><span class="row-k">${COPY.ranking.showUnowned}</span><input type="checkbox" data-setting="showUnowned" .checked=${live(store.ui.showUnowned)} @change=${(e: Event) => update((s) => { s.ui.showUnowned = isChecked(e); })} /></label>`;
  return panel({ title: COPY.ranking.title, kind: 'result', subtitle: `${rows.length} cards · ${COPY.ranking.sortHint}`, tip: COPY.ranking.tip, actions, cls: 'panel-live' }, html`
    <div class="scroll"><table class="ranking-table"><thead><tr><th></th><th>Card</th><th>LB</th>${th('score', html`Target spark chances${tip(COPY.ranking.targetTip)}`, '')}${STATS.map((s) => th(s, s))}${th('stats', html`Total${tip(totalTip)}`)}${th('sp', 'SP')}<th>Basis${tip(COPY.ranking.basisTip(data.model.races.reference, c.sum.count))}</th></tr></thead><tbody>
      ${repeat(rows, (x) => x.card.id, (x) => row(c, x, chances.get(x.card.id)!.targets, focusMul))}
    </tbody></table></div>
    ${about(COPY.ranking.aboutTitle, COPY.ranking.about)}`);
}
