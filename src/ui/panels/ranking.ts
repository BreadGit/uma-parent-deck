import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { STATS, type Card } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import type { CardScore } from '../../model/deck.ts';
import { MODELLED_UNIQUE_TYPES, uniqueNote } from '../../model/stats.ts';
import { modelContribution } from '../../model/stats.ts';
import { data, plan, store, update } from '../context.ts';
import { cardThumb, cardUrl, num, pct, pill, skillName, typeIcon } from '../format.ts';
import { tip } from '../tooltip.ts';

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
export function lbSelect(card: Card, lb: number, cls = '') {
  const owned = !plan().unowned.has(card.id);
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
  score: (x) => x.marginalValue * 1000 + x.statPower / 1000, spark: (x) => x.sparkValue, stats: (x) => x.statPower, sp: (x) => x.sp,
  speed: (x) => x.stats[0]!, stamina: (x) => x.stats[1]!, power: (x) => x.stats[2]!, guts: (x) => x.stats[3]!, wit: (x) => x.stats[4]!,
};

/** A compound unique effect: whether the model evaluates it, with GameTora's text and the assumption behind the evaluation. */
function uniqueTag(card: Card) {
  if (!card.unique?.effects.some((u) => u.type >= 100)) return nothing;
  const modelled = card.unique.effects.some((u) => MODELLED_UNIQUE_TYPES.has(u.type));
  return html` <span class="tag ${modelled ? '' : 'warn'}">${modelled ? 'unique approximated' : 'unique not modelled'}</span>${tip(`Unique effect: ${card.unique.text ?? 'conditional effect'}. Model: ${uniqueNote(card, data.model, { fansBefore: plan().ctx.fansBefore }) || 'left out'}. An observed row includes the real effect at the observed limit break.`)}`;
}

export function renderRanking(c: RunPlan) {
  const fn = SORT_KEYS[store.ui.sortKey] ?? SORT_KEYS.score!;
  // per-stat cells carry the training focus multipliers, like the Total column (their focus-weighted sum)
  const focusMul = data.model.focus[store.settings.focus] ?? [1, 1, 1, 1, 1];
  const pinRank = (x: CardScore) => { const i = store.run.pinnedIds.indexOf(x.card.id); return i < 0 ? Infinity : i; };
  const rows = c.ranking.slice().sort((a, b) => pinRank(a) - pinRank(b) || fn(b) - fn(a));
  const th = (k: string, label: string | TemplateResult, cls = 'num') => html`<th class="${cls} sortable" data-sort="${k}" @click=${() => update((s) => { s.ui.sortKey = k; })}>${label}${store.ui.sortKey === k ? ' ▾' : ''}</th>`;
  return html`
    <section class="panel">
      <h2>Card ranking <span class="small muted">(${rows.length} cards · click a header to sort)</span></h2>
      <div class="scroll"><table><thead><tr><th></th><th>Card</th><th>LB</th>${th('score', html`Added spark chance${tip('How much this card would raise the total expected white sparks over your targets if added to what is already covered by the trainee and the cards picked so far. Overlap with existing sources counts for less, so two cards giving the same skill do not both score full value.')}`)}${th('spark', html`Spark chance alone${tip('Expected white sparks over your targets from this card on its own: the chance it hands over each skill (hint, event, or outing) times the spark rate for the gold or white form.')}`)}<th>Targets</th>${STATS.map((s) => th(s, s))}${th('stats', html`Total${tip(`What the card adds to the final stats at ${c.sum.count} races under the ${store.settings.focus} focus: each stat column carries that focus's multiplier (${focusMul.map((m) => m.toFixed(2)).join(' / ')}) and Total is their sum. The deck builder uses this value when two cards give the same sparks.`)}`)}${th('sp', 'SP')}<th>Basis${tip('Where the stat numbers come from. "Observed" means the Loopacord logs have this card at this limit break, "observed at another LB" shifts a logged limit break by the model, and "model" is the fitted formula from the card passives.')}</th></tr></thead><tbody>
        ${rows.map((x) => {
          const owned = !c.unowned.has(x.card.id);
          return html`<tr class="${owned ? '' : 'dim'}">
            <td>${cardThumb(x.card)}</td>
            <td>${typeIcon(x.card)}${store.run.pinnedIds.includes(x.card.id) ? html`<span class="tag pin">pinned</span>` : nothing}<a class="card-link" href="${cardUrl(x.card)}" target="_blank" rel="noopener">${x.card.charName}</a>${c.trainee && c.trainee.charId === x.card.charId ? html` <span class="tag warn">trainee's card</span>` : nothing}<br/><span class="small muted">${x.card.title}</span></td>
            <td>${lbSelect(x.card, x.lb)}</td>
            <td class="num"><span class="bar" style="width:${Math.min(60, x.marginalValue * 120)}px"></span> ${pill(x.marginalValue, '', 1)}</td>
            <td class="num">${pill(x.sparkValue, '', 1)}</td>
            <td class="cover">${x.coverage.map((cv) => html`<span class="t">${cv.target.name} ${pill(cv.spark)}${tip(cv.sources.map((s) => `${skillName(s.skillId)} via ${s.detail}: ${pct(s.pObtain)}`).join('\n'))}</span>`)}</td>
            ${x.stats.map((v, i) => html`<td class="num">${num(v * (focusMul[i] ?? 1))}</td>`)}
            <td class="num"><b>${num(x.statPower)}</b></td><td class="num">${num(x.sp)}</td>
            <td class="small muted">${x.source === 'model' ? 'model' : html`observed${tip(basisTip(x))}`}${uniqueTag(x.card)}</td>
          </tr>`;
        })}
      </tbody></table></div>
    </section>`;
}
