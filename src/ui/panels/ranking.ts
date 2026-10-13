// Every card scored against the targets, with the limit-break dropdowns that make up the inventory.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { perStat, STATS, type StatValues } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import type { CardScore } from '../../model/deck.ts';
import { cardTargetChances, compareTargetChances, rankingRows, type TargetSparkChance } from '../../model/card-ranking.ts';
import { cardEffectCoverage } from '../../model/support-effects.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { ignoreToggle, pinToggle } from '../card-toggles.ts';
import { LABEL, TITLE } from '../copy.ts';
import { deckOrder } from './deck.ts';
import { basisLabel, basisTip, coverageFlag } from '../effect-coverage.ts';
import { isChecked, lbSelect } from '../fields.ts';
import { cardThumb, cardUrl, num, probability, skillName, typeIcon } from '../format.ts';
import { about, panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const SCORING_ABOUT = 'How cards are scored';
const copy = {
  tip: 'Every Global support card scored against your targets. Set the limit break of the cards you own here (or mark them not owned); the deck and the predictions follow. Pinned cards and the suggested deck stay on top whatever the sort; each row\'s buttons pin the card or ignore it for this run.',
  showUnowned: 'Show not owned',
  columns: { card: 'Card', lb: 'LB', targets: 'Target spark chances', total: 'Total', sp: 'SP', basis: LABEL.basisColumn },
  sortHint: 'pins and the suggested deck first, then click a header to sort',
  targetTip: `Sorted by the sum of Required target chances, then priority-weighted Preferred target chances, then Total stat gain. Each percentage is this card's own chance at rank SS. See "${SCORING_ABOUT}" below.`,
  basisTip: (reference: number, selected: number) => `Where each card's stat and SP estimates come from: community results at the shown limit break, an observation adjusted from a nearby limit break, or the formula alone. Each label's info icon gives the source and the effects the formula leaves out. The model uses ${reference} races as its reference, then scales card stats and SP to your ${selected}-race schedule; the training focus adjusts stats only.`,
  traineeCard: "trainee's card",
  totalTip: (races: number, focus: string, multipliers: string) => `What the card adds to the final stats at ${races} races under the ${focus} focus: each stat column carries that focus's multiplier (${multipliers}) and Total is their sum. Target spark sorting uses Total when Required and Preferred chances both tie.`,
  source: (skill: string, detail: string, chance: string) => `${skill} via ${detail}: ${chance} skill acquisition`,
  noSource: 'No available source on this card under the current skill priorities.',
  moreTargets: (n: number) => `+${n} more`,
  fewerTargets: 'Show fewer',
  aboutTitle: SCORING_ABOUT,
  about: [
    'Each percentage uses this card\'s own skill sources and assumes rank SS for star quality. Required sparks use your minimum stars; Preferred sparks count at any star level. Their ranking weights halve with each priority step; individual percentages are unweighted.',
    'Current skill priorities and lineage generation bonuses apply. Trainee, scenario, inherited hints and other cards are excluded. These are individual chances, not the improvement from replacing a card or the chance of completing your parent goal.',
    'Observed and adjusted stat estimates come from recorded runs, so they already include effects the formula cannot separate, and they stay fixed when deck-dependent effects change. Model estimates use only the effects the formula covers. The suggested deck\'s estimate limitations list what is left out for each deck card.',
  ],
} as const;

// The Basis label keeps the row one line tall: the per-card facts live in the info icon's tooltip, like every other
// tip on the page, and the rules shared by every card are in the column header tip and the panel notes.
function basis(c: RunPlan, x: CardScore) {
  const effects = cardEffectCoverage(x.card, x.lb, data.model, { fansBefore: c.ctx.fansBefore });
  const flag = coverageFlag(effects);
  return html`<span class="basis-label" data-basis=${x.card.id}><span data-basis-label>${basisLabel(x.card, x.lb, x.source)}</span>${flag ? html` <span class="tag warn" data-formula-coverage>${flag}</span>` : nothing}${tip(basisTip(x.card, x.lb, x.source, effects))}</span>`;
}

const SORT_KEYS: Record<string, (x: CardScore) => number> = {
  stats: (x) => x.statPower, sp: (x) => x.sp,
  speed: (x) => x.stats[0]!, stamina: (x) => x.stats[1]!, power: (x) => x.stats[2]!, guts: (x) => x.stats[3]!, wit: (x) => x.stats[4]!,
};
const targetLabel = (x: TargetSparkChance) => `${x.target.name}${x.role === 'required' ? ` ${x.stars}★+` : ''}`;
const sourceDetails = (x: TargetSparkChance) => x.sources.length
  ? x.sources.map((s) => copy.source(skillName(s.skillId), s.detail, probability(s.pObtain))).join('\n')
  : copy.noSource;
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
    ${hidden.length ? html`<button type="button" class="target-more" data-target-more aria-expanded=${expanded} aria-controls=${detailsId} @click=${() => toggleTargets(cardId)}>${expanded ? copy.fewerTargets : copy.moreTargets(hidden.length)}</button>
      <div id=${detailsId} ?hidden=${!expanded}>${expanded ? hidden.map(targetChance) : nothing}</div>` : nothing}
  </td>`;
}

function row(c: RunPlan, x: CardScore, chances: TargetSparkChance[], focusMul: StatValues) {
  const owned = !c.unowned.has(x.card.id);
  const ignored = store.run.ignoredIds.includes(x.card.id);
  return html`<tr class="${owned ? '' : 'dim'} ${ignored ? 'ignored' : ''}" data-ranking-row=${x.card.id}>
    <td>${cardThumb(x.card)}</td>
    <td><div class="ranking-card"><div class="ranking-card-name">${typeIcon(x.card)}<a class="card-link" href="${cardUrl(x.card)}" target="_blank" rel="noopener">${x.card.charName}</a>${c.trainee && c.trainee.charId === x.card.charId ? html` <span class="tag warn">${copy.traineeCard}</span>` : nothing}<br/><span class="small muted">${x.card.title}</span></div>
      ${pinToggle(x.card)}${ignoreToggle(x.card)}
    </div></td>
    <td>${lbSelect(c, x.card, x.lb)}</td>
    ${targetChancesCell(x.card.id, chances)}
    ${perStat((stat, i) => html`<td class="num" data-card-stat="${stat}">${num(x.stats[i] * focusMul[i])}</td>`)}
    <td class="num" data-card-stat-total><b>${num(x.statPower)}</b></td><td class="num">${num(x.sp)}</td>
    <td class="basis small">${basis(c, x)}</td>
  </tr>`;
}

export function renderRanking(c: RunPlan) {
  const fn = SORT_KEYS[store.ui.sortKey];
  const sortKey = fn ? store.ui.sortKey : 'score';
  const chances = new Map(c.ranking.map((x) => [x.card.id, cardTargetChances(x, store.run.targets, c.ctx)]));
  // per-stat cells carry the training focus multipliers, like the Total column (their focus-weighted sum)
  const focusMul: StatValues = data.model.focus[store.settings.focus] ?? [1, 1, 1, 1, 1];
  const rows = rankingRows(c.ranking.filter((x) => store.ui.showUnowned || !c.unowned.has(x.card.id)), store.run.pinnedIds, deckOrder(c), (a, b) =>
    fn ? fn(b) - fn(a) : compareTargetChances(chances.get(a.card.id)!, chances.get(b.card.id)!));
  // A native button makes each header sortable from the keyboard; the info tip stays beside it, outside the button.
  const th = (k: string, label: string, help?: string, cls = 'num') => html`<th class=${cls} aria-sort=${sortKey === k ? 'descending' : 'none'}><button type="button" class="sort-button" data-sort="${k}" @click=${() => update((s) => { s.ui.sortKey = k; })}>${label}${sortKey === k ? html`<span aria-hidden="true"> ▾</span>` : nothing}</button>${help ? tip(help) : nothing}</th>`;
  const totalTip = copy.totalTip(c.ctx.races, store.settings.focus, focusMul.map((m) => m.toFixed(2)).join(' / '));
  const actions = html`<label class="row"><span class="row-k">${copy.showUnowned}</span><input type="checkbox" data-setting="showUnowned" .checked=${live(store.ui.showUnowned)} @change=${(e: Event) => update((s) => { s.ui.showUnowned = isChecked(e); })} /></label>`;
  return panel({ title: TITLE.ranking, kind: 'result', subtitle: `${rows.length} cards · ${copy.sortHint}`, tip: copy.tip, actions, cls: 'panel-live' }, html`
    <div class="scroll"><table class="ranking-table"><thead><tr><th></th><th>${copy.columns.card}</th><th>${copy.columns.lb}</th>${th('score', copy.columns.targets, copy.targetTip, '')}${STATS.map((s) => th(s, s))}${th('stats', copy.columns.total, totalTip)}${th('sp', copy.columns.sp)}<th>${copy.columns.basis}${tip(copy.basisTip(data.model.races.reference, c.ctx.races))}</th></tr></thead><tbody>
      ${repeat(rows, (x) => x.card.id, (x) => row(c, x, chances.get(x.card.id)!.targets, focusMul))}
    </tbody></table></div>
    ${about(copy.aboutTitle, copy.about)}`);
}
