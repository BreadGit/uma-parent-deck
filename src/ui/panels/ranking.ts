// Every card scored against the targets, with the limit-break dropdowns that make up the inventory.
import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { STATS, type Card } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import type { CardScore } from '../../model/deck.ts';
import { cardTargetChances, compareTargetChances, type TargetSparkChance } from '../../model/card-ranking.ts';
import { MODELLED_UNIQUE_TYPES, uniqueNote } from '../../model/stats.ts';
import { modelContribution } from '../../model/stats.ts';
import { data, store, update } from '../context.ts';
import { cardThumb, cardUrl, goalProbability, num, pct, skillName, typeIcon } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';
import { pinCard, unpinCard } from './run.ts';

/** Set a card's limit break, or mark it not owned. The rarity's default LB means "no entry". */
function setLb(card: Card, value: string) {
  update((s) => {
    const id = String(card.id);
    if (value === 'none') s.inventory[id] = null;
    else if (Number(value) === s.settings.defaultLb[card.rarity]) delete s.inventory[id];
    else s.inventory[id] = Number(value);
  });
}
/**
 * The LB dropdown shared by the deck slots and the ranking table. The value is bound live: once a user has changed
 * a <select>, the browser ignores later `selected` attribute changes on its options, so a select element that lit
 * reuses for a different card would keep showing the old choice.
 */
export function lbSelect(c: RunPlan, card: Card, lb: number, cls = '') {
  const owned = !c.unowned.has(card.id);
  const explicit = store.inventory[String(card.id)] !== undefined;
  return html`<select data-lb="${card.id}" class="${cls} ${explicit ? '' : 'muted'}" .value=${live(owned ? String(lb) : 'none')} @change=${(e: Event) => setLb(card, (e.target as HTMLSelectElement).value)}>
    <option value="none" ?selected=${!owned}>not owned</option>
    ${[0, 1, 2, 3, 4].map((l) => html`<option value="${l}" ?selected=${owned && lb === l}>${l}${!explicit && lb === l ? ' (default)' : ''}</option>`)}</select>`;
}

/** Observed-vs-model note for the Basis column. */
function basisTip(x: CardScore): string {
  const obs = data.model.observed.filter((o) => o.cardId === x.card.id && o.wellTested);
  const exact = obs.find((o) => o.lb === x.lb) ?? obs.reduce<typeof obs[number] | null>((a, b) => (!a || Math.abs(b.lb - x.lb) < Math.abs(a.lb - x.lb) ? b : a), null);
  if (!exact) return 'Observed in the Loopacord logs.';
  const m = modelContribution(x.card, exact.lb, data.model);
  const signed = (d: number) => `${d >= 0 ? '+' : ''}${d.toFixed(0)}`;
  const deltas = STATS.map((st, i) => `${st} ${exact.stats[i]} vs ${m.stats[i]!.toFixed(0)} (${signed(exact.stats[i]! - m.stats[i]!)})`).join('\n');
  const head = exact.lb === x.lb ? `Observed at LB${exact.lb} over ${exact.runs} logged runs (${exact.source}).` : `Observed at LB${exact.lb} over ${exact.runs} logged runs (${exact.source}); shifted to LB${x.lb} by the model's difference between the two limit breaks.`;
  return `${head}\n\nObserved vs model at LB${exact.lb} (28 races):\n${deltas}\nSP ${exact.sp} vs ${m.sp.toFixed(0)} (${signed(exact.sp - m.sp)})`;
}

const SORT_KEYS: Record<string, (x: CardScore) => number> = {
  stats: (x) => x.statPower, sp: (x) => x.sp,
  speed: (x) => x.stats[0]!, stamina: (x) => x.stats[1]!, power: (x) => x.stats[2]!, guts: (x) => x.stats[3]!, wit: (x) => x.stats[4]!,
};
const TARGET_TIP = 'Sorted by the sum of Required target chances, then Preferred target chances, then Total stat gain. Each percentage uses this card\'s own skill sources and assumes rank SS for star quality. Required sparks use your minimum stars; Preferred sparks use 2★+. Current skill priorities and lineage generation bonuses apply. Trainee, scenario, inherited hints and other cards are excluded. These are individual chances, not the improvement from replacing a card or the chance of completing your parent goal.';
const targetLabel = (x: TargetSparkChance) => `${x.target.name} ${x.stars}★+`;
const sourceDetails = (x: TargetSparkChance) => x.sources.length
  ? x.sources.map((s) => `${skillName(s.skillId)} via ${s.detail}: ${pct(s.pObtain)} skill acquisition`).join('\n')
  : 'No available source on this card under the current skill priorities.';
const targetDetails = (x: TargetSparkChance) => `${targetLabel(x)}: ${goalProbability(x.probability)}\n${sourceDetails(x)}`;
function targetChancesCell(targets: TargetSparkChance[]) {
  const available = targets.filter((x) => x.probability > 0);
  const hidden = available.slice(4);
  const more = hidden.map(targetDetails).join('\n\n');
  return html`<td class="cover target-chances" data-target-chances>
    ${available.slice(0, 4).map((x) => html`<div class="target-spark" data-target-spark="${x.target.id}"><span>${targetLabel(x)}</span> <span class="target-spark-value"><span class="pill">${goalProbability(x.probability)}</span>${tip(sourceDetails(x))}</span></div>`)}
    ${hidden.length ? html`<button type="button" class="target-more" data-target-more data-tip="${more}" aria-label="${hidden.length} more targets. ${more}">+${hidden.length} more</button>` : nothing}
  </td>`;
}

/** A compound unique effect: whether the model evaluates it, with GameTora's text and the assumption behind the evaluation. */
function uniqueTag(c: RunPlan, card: Card) {
  if (!card.unique?.effects.some((u) => u.type >= 100)) return nothing;
  const modelled = card.unique.effects.some((u) => MODELLED_UNIQUE_TYPES.has(u.type));
  return html` <span class="tag ${modelled ? '' : 'warn'}">${modelled ? 'unique approximated' : 'unique not modelled'}</span>${tip(`Unique effect: ${card.unique.text ?? 'conditional effect'}. Model: ${uniqueNote(card, data.model, { fansBefore: c.ctx.fansBefore }) || 'left out'}. An observed row includes the real effect at the observed limit break.`)}`;
}

const PANEL_TIP = 'Every Global support card scored against your targets. Set the limit break of the cards you own here (or mark them not owned); the deck and the predictions follow.';

export function renderRanking(c: RunPlan) {
  const fn = SORT_KEYS[store.ui.sortKey];
  const sortKey = fn ? store.ui.sortKey : 'score';
  const chances = new Map(c.ranking.map((x) => [x.card.id, cardTargetChances(x, store.run.targets, c.ctx)]));
  // per-stat cells carry the training focus multipliers, like the Total column (their focus-weighted sum)
  const focusMul = data.model.focus[store.settings.focus] ?? [1, 1, 1, 1, 1];
  const rows = c.ranking.filter((x) => store.ui.showUnowned || !c.unowned.has(x.card.id)).sort((a, b) =>
    fn ? fn(b) - fn(a) : compareTargetChances(chances.get(a.card.id)!, chances.get(b.card.id)!));
  const th = (k: string, label: string | TemplateResult, cls = 'num') => html`<th class="${cls} sortable" data-sort="${k}" @click=${() => update((s) => { s.ui.sortKey = k; })}>${label}${sortKey === k ? ' ▾' : ''}</th>`;
  const actions = html`<label class="row"><span class="k">Show not owned</span><input type="checkbox" data-setting="showUnowned" .checked=${live(store.ui.showUnowned)} @change=${(e: Event) => update((s) => { s.ui.showUnowned = (e.target as HTMLInputElement).checked; })} /></label>`;
  return panel({ title: 'Card ranking', subtitle: `(${rows.length} cards · click a header to sort)`, tip: PANEL_TIP, actions }, html`
    <div class="scroll"><table><thead><tr><th></th><th>Card</th><th>LB</th>${th('score', html`Target spark chances${tip(TARGET_TIP)}`, '')}${STATS.map((s) => th(s, s))}${th('stats', html`Total${tip(`What the card adds to the final stats at ${c.sum.count} races under the ${store.settings.focus} focus: each stat column carries that focus's multiplier (${focusMul.map((m) => m.toFixed(2)).join(' / ')}) and Total is their sum. Target spark sorting uses Total when Required and Preferred chances both tie.`)}`)}${th('sp', 'SP')}<th>Basis${tip('Where the stat numbers come from. "Observed" means the Loopacord logs have this card at this limit break, "observed at another LB" shifts a logged limit break by the model, and "model" is the fitted formula from the card passives.')}</th></tr></thead><tbody>
      ${repeat(rows, (x) => x.card.id, (x) => {
        const owned = !c.unowned.has(x.card.id);
        const pinned = store.run.pinnedIds.includes(x.card.id);
        const pinLabel = `${pinned ? 'Unpin' : 'Pin'} ${x.card.charName} [${x.card.title}]`;
        return html`<tr class="${owned ? '' : 'dim'}">
          <td>${cardThumb(x.card)}</td>
          <td><div class="ranking-card"><div class="ranking-card-name">${typeIcon(x.card)}<a class="card-link" href="${cardUrl(x.card)}" target="_blank" rel="noopener">${x.card.charName}</a>${c.trainee && c.trainee.charId === x.card.charId ? html` <span class="tag warn">trainee's card</span>` : nothing}<br/><span class="small muted">${x.card.title}</span></div>
            <button type="button" class="ranking-pin ${pinned ? 'active' : ''}" data-action="toggle-card-pin" data-id="${x.card.id}" aria-label="${pinLabel}" aria-pressed="${pinned}" title="${pinLabel}" @click=${() => pinned ? unpinCard(x.card.id) : pinCard(x.card.id)}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M22.3126 10.1753L20.8984 11.5895L20.1913 10.8824L15.9486 15.125L15.2415 18.6606L13.8273 20.0748L9.58466 15.8321L4.63492 20.7819L3.2207 19.3677L8.17045 14.4179L3.92781 10.1753L5.34202 8.76107L8.87756 8.05396L13.1202 3.81132L12.4131 3.10422L13.8273 1.69L22.3126 10.1753Z"></path></svg></button>
          </div></td>
          <td>${lbSelect(c, x.card, x.lb)}</td>
          ${targetChancesCell(chances.get(x.card.id)!.targets)}
          ${x.stats.map((v, i) => html`<td class="num" data-card-stat="${STATS[i]}">${num(v * (focusMul[i] ?? 1))}</td>`)}
          <td class="num" data-card-stat-total><b>${num(x.statPower)}</b></td><td class="num">${num(x.sp)}</td>
          <td class="small muted">${x.source === 'model' ? 'model' : html`observed${tip(basisTip(x))}`}${uniqueTag(c, x.card)}</td>
        </tr>`;
      })}
    </tbody></table></div>`);
}
