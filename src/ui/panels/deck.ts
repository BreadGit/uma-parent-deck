import { html, nothing, type TemplateResult } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { STATS } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import type { Conflict } from '../../model/sparks.ts';
import { combineSources } from '../../model/sparks.ts';
import { BLUE_STAR_BANDS, cardContribution, deckUniqueExtras, EFFECT, pAbove, passives, raceScale } from '../../model/stats.ts';
import { statScore } from '../../model/rank.ts';
import { PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { data, plan, store, update } from '../context.ts';
import { cardLink, cardThumb, num, pct, pill, skillName, skillWithTip, typeTag } from '../format.ts';
import { tip } from '../tooltip.ts';
import { lbSelect } from './ranking.ts';

// ----- prioritized skills: exclude, restore, add, reorder -----
function excludeSkill(key: number) {
  update((s) => { s.run.wishlistExcluded = [...new Set([...s.run.wishlistExcluded, key])]; s.run.wishlistOrder = s.run.wishlistOrder.filter((x) => x !== key); });
}
function restoreSkill(key: number) {
  update((s) => { s.run.wishlistExcluded = s.run.wishlistExcluded.filter((x) => x !== key); });
}
/** Put an unlisted candidate into the last slot of the list. */
function addSkill(key: number) {
  const cur = plan().wl.map((w) => w.key).filter((x) => x !== key);
  cur.splice(PRIORITIZED_SKILLS_MAX - 1, cur.length, key);
  update((s) => { s.run.wishlistOrder = cur; });
}
function moveSkill(from: number, to: number) {
  const cur = plan().wl.map((w) => w.key);
  const i = cur.indexOf(from), j = cur.indexOf(to);
  if (i < 0 || j < 0 || i === j) return; // stale key after a re-render
  cur.splice(i, 1); cur.splice(j, 0, from);
  update((s) => { s.run.wishlistOrder = cur; });
}
let dragKey: number | null = null;
const dragItem = (ev: Event) => (ev.target as HTMLElement).closest<HTMLElement>('li[data-wl-key]');
const clearDragClasses = (root: HTMLElement) => { for (const x of root.querySelectorAll('li.dragging, li.drop-target')) x.classList.remove('dragging', 'drop-target'); };
const wishlistDrag = {
  dragstart: (ev: DragEvent) => { const li = dragItem(ev); if (!li) return; dragKey = Number(li.dataset.wlKey); li.classList.add('dragging'); ev.dataTransfer?.setData('text/plain', String(dragKey)); },
  dragover: (ev: DragEvent) => { const li = dragItem(ev); if (!li || dragKey == null) return; ev.preventDefault(); clearDragClasses(ev.currentTarget as HTMLElement); li.classList.add('drop-target'); },
  drop: (ev: DragEvent) => { const li = dragItem(ev); if (!li || dragKey == null) return; ev.preventDefault(); const target = Number(li.dataset.wlKey); const from = dragKey; dragKey = null; moveSkill(from, target); },
  dragend: (ev: DragEvent) => { dragKey = null; clearDragClasses(ev.currentTarget as HTMLElement); },
};

function statBreakdown(c: RunPlan) {
  const d = c.deckResult, p = c.pred;
  const scale = raceScale(c.sum.count, data.model, store.settings);
  const focusMul = data.model.focus[store.settings.focus] ?? [1, 1, 1, 1, 1];
  const row = (label: TemplateResult | string, vals: number[], cls = '') => html`<tr class="${cls}"><td>${label}</td>${vals.map((v) => html`<td class="num">${num(v)}</td>`)}<td class="num">${num(vals.reduce((a, b) => a + b, 0))}</td></tr>`;
  const cardRows = d.deck.map((cs) => {
    const cc = cardContribution(cs.card, cs.lb, data.model, deckUniqueExtras(cs.card, cs.lb, d.deck));
    return row(html`${cardThumb(cs.card, 'thumb sm')} ${cardLink(cs.card)} <span class="muted small">(${cc.source === 'model' ? 'model' : `observed${cc.source === 'observed+model' ? ', shifted to LB' + cs.lb : ''}`})</span>`, cc.stats.map((v, i) => v * scale * focusMul[i]!));
  });
  const base = c.trainee?.baseStats ?? [0, 0, 0, 0, 0];
  const penalty = store.settings.lossPenalty * c.sum.expectedLosses;
  const raceBonus = d.deck.reduce((a, cs) => a + (passives(cs.card, cs.lb)[EFFECT.raceBonus] ?? 0), 0);
  return html`<table class="small"><thead><tr><th>Source</th>${STATS.map((st) => html`<th class="num">${st}</th>`)}<th class="num">total</th></tr></thead><tbody>
      ${cardRows}
      ${row(`Career events and ${c.sum.count} races`, p.eventStats.map((v, i) => v * focusMul[i]!))}
      ${row('Inheritance at the start', c.inherited.map((x) => x.start))}
      ${row('Two inspiration events', c.inherited.map((x) => x.inspiration))}
      ${row(`Base stats${c.trainee ? ` (${c.trainee.name})` : ''}`, base)}
      ${penalty ? row('Expected race losses', STATS.map(() => -penalty / 5)) : nothing}
      ${c.statCaps && c.statCaps.capped.some(Boolean) ? row('Scenario cap (base cap + blue spark uncaps)', c.statCaps.cap) : nothing}
      ${row(html`<b>Final</b>`, c.finalMean, 'total')}
      ${row('Run-to-run spread (±1 sd)', p.sd)}
    </tbody></table>
    <div class="small muted">Rank score: stats ${num(c.rank.statPts)} (${STATS.map((st, i) => `${st} ${num(statScore(c.finalMean[i]!))}`).join(', ')}), unique skill Lv ${num(c.rank.uniqueLevel, 1)} for ${num(c.rank.uniquePts)}, skills bought and innate ${num(c.rank.skillPts - c.rank.uniquePts)}. The stat curve is the game's table; the skill terms are estimates.</div>
    <div class="small muted">Card and career rows include the ${store.settings.focus} focus multiplier (${focusMul.map((m) => m.toFixed(2)).join(' / ')}) and the race scaling of ×${scale.toFixed(2)} for ${c.sum.count} races vs the 28 the data was measured at. The spread is the standard deviation of total stats between runs of the same trainee and deck in the Loopacord logs; the card model itself has an RMSE of ${data.model.fit.rmse.toFixed(1)} per stat. Everything here is an empirical fit of logged runs, not the game's formula: the race scaling comes from one 23-race versus 28-race comparison, the focus multipliers from two decks, and the career row (which includes race rewards) was measured at the reference decks' Race Bonus, which the logs do not record. This deck totals ${raceBonus}% Race Bonus; race rewards scale with it (a step at 34% in manual play), but that is not modelled, so cards that differ in Race Bonus may be misranked.${c.statCaps && c.statCaps.capped.some(Boolean) ? ' A stat is clamped to the scenario cap plus the blue sparks\' start-of-run uncaps; uncaps from inspiration events and green sparks are unknown and left out.' : ''}</div>`;
}

function conflicts(c: RunPlan) {
  const d = c.deckResult;
  if (!d.conflicts.length) return nothing;
  const opts = (cf: Conflict) => [cf.taken, ...cf.dropped];
  const involved = [...new Set(d.conflicts.flatMap((cf) => opts(cf).flatMap((o) => (o.target != null ? [o.target] : []))))].map((id) => c.targets.find((t) => t.id === id)?.name ?? '').filter(Boolean);
  return html`<div class="conflicts-box"><h3>Choice conflicts</h3>
    <table class="small conflicts"><thead><tr><th>Event</th><th>Options</th><th>Taken${tip('Skills are taken when they are higher in the Independent training prioritized skills section below.')}</th><th>Not taken</th></tr></thead><tbody>
      ${d.conflicts.map((cf) => html`<tr><td class="wrap">${cf.label}</td>
        <td class="wrap">${opts(cf).map((o) => html`<div>${skillWithTip(o.skillId)}${o.option ? html` <span class="muted">${o.option}</span>` : nothing}</div>`)}</td>
        <td><b>${skillName(cf.taken.skillId)}</b>${cf.taken.target != null ? nothing : html` <span class="muted">(not a target)</span>`}</td><td>${cf.dropped.map((o) => skillName(o.skillId)).join(', ')}</td></tr>`)}
    </tbody></table>
    <div class="small muted">Only one option can be taken per event. Targets involved: ${involved.join(', ')}. Drag the prioritized skills below into a different order to change which one wins. That the list order settles a contested option is an assumption: the game confirms prioritized skills steer choices, not how ties between them resolve.</div></div>`;
}

export function renderDeck(c: RunPlan) {
  const d = c.deckResult;
  const p = c.pred;
  const customized = store.run.wishlistOrder.length > 0 || store.run.wishlistExcluded.length > 0;
  return html`
    <section class="panel">
      <h2>Suggested deck</h2>
      ${d.deck.length ? html`<div class="deck">${repeat([...d.deck.filter((x) => !x.borrowed), ...d.deck.filter((x) => x.borrowed)], (cs) => `${cs.card.id}:${cs.borrowed ? 'b' : 'o'}`, (cs) => html`
        <div class="slot">
          <div class="slot-top">${store.run.pinnedIds.includes(cs.card.id) ? html`<span class="tag pin">pinned</span>` : nothing}${cs.borrowed ? html`<span class="tag borrow">borrow</span>` : nothing}</div>
          ${cardThumb(cs.card, 'slot-art')}
          <div class="name">${cardLink(cs.card)}</div>
          <div class="lb">${cs.borrowed ? html`${cs.card.rarity} · LB4 (friend's)` : html`${cs.card.rarity} · LB ${lbSelect(cs.card, cs.lb, 'small')}`} ${typeTag(cs.card)}</div>
          <div class="cover">${cs.coverage.filter((x) => x.marginal > 0 || x.spark > 0).map((x) => html`<span class="t">${x.target.name} ${pill(x.spark)}${tip(x.sources.map((s) => `${s.detail}: ${pct(s.pObtain)}`).join('\n'))}</span>`)}</div>
        </div>`)}</div>` : html`<div class="muted">No owned cards. Mark cards in the table below.</div>`}
      ${d.borrow ? html`<div class="small gap-top"><b>Borrow:</b> ${cardLink(d.borrow.card)} at LB4${d.borrow.replaces ? html` instead of your own copy at a lower LB` : nothing}${d.borrow.gain > 1e-9 ? html`: +${(d.borrow.gain * 100).toFixed(1)}% expected sparks` : html` <span class="muted">(adds nothing to the targets; the best stat stick)</span>`}.
        ${d.borrowAlternatives.length ? html`<span class="muted">Other borrows: ${d.borrowAlternatives.map((o) => `${o.card.name} (+${(o.gain * 100).toFixed(1)}%)`).join(', ')}.</span>` : nothing}</div>` : nothing}
      <h3>Predicted run (deck ${c.sum.count} races, ${store.settings.focus} focus${c.trainee ? `, ${c.trainee.name}` : ''})</h3>
      <div class="stats">
        <div class="stat outcome">
          <div class="outcome-item"><div class="k">SS or better${tip('An estimate: the rank score is the game\'s stat table plus estimated skill terms, and its spread comes from the fitted stat model.')}</div><div class="v">${pill(c.rank.pSS, c.rank.pSS > 0.5 ? 'ok' : 'warn')}</div></div>
          <div class="outcome-item"><div class="k">Rank score</div><div class="v">${num(c.rank.score)} <span class="sd">±${num(c.rank.sd)}</span></div></div>
          <div class="outcome-item"><div class="k">Estimated SP</div><div class="v">${num(p.sp)}</div></div>
        </div>
        ${STATS.map((s, i) => html`
        <div class="stat"><div class="k">${s}</div><div class="v">${num(c.finalMean[i]!)} <span class="sd">±${num(p.sd[i]!)}</span></div>
          <div class="s">≥${BLUE_STAR_BANDS.mid} ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, BLUE_STAR_BANDS.mid))} · ≥${BLUE_STAR_BANDS.high} ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, BLUE_STAR_BANDS.high))}</div></div>`)}
      </div>
      <details><summary>Where the stats come from</summary>${statBreakdown(c)}</details>
      <h3>Target coverage${tip('The run hands over hints; it buys nothing. Every figure assumes you buy each target at the end (see the worst-case SP cost above). A gold hint gives the gold form at 40% spark chance, a ◎ hint 25%, an ordinary hint 20%.')}</h3>
      <table><thead><tr><th>Skill</th><th class="num">Gold hint</th><th class="num">◎ or white hint</th><th class="num">Spark chance if bought</th><th>Sources</th></tr></thead><tbody>
        ${c.targets.map((t) => {
          const srcs = d.coverage.get(t.id) ?? [];
          const own = combineSources(srcs);
          const spark = d.sparks.get(t.id) ?? 0;
          return html`<tr><td>${skillWithTip(t.white?.id ?? t.id, t.name)}</td><td class="num">${pill(own.pGold)}</td><td class="num">${pill(own.pWhite + own.pCircle)}</td><td class="num">${pill(spark, spark > 0 ? 'ok' : 'warn')}</td>
            <td class="small wrap">${srcs.length ? srcs.map((s) => `${s.cardName ? s.cardName + ': ' : ''}${skillName(s.skillId)} ${pct(s.pObtain)} (${s.detail})`).join('; ') : html`<span class="warn">no source in deck</span>`}</td></tr>`;
        })}
      </tbody></table>
      ${c.targets.length ? html`<div class="small ${c.spCost.total > p.sp ? 'warn' : 'muted'}">Worst-case target SP cost: <b>${num(c.spCost.total)}${c.spCost.incomplete ? '+' : ''}</b> of ${num(p.sp)} estimated SP${c.spCost.total > p.sp ? ', more than the run is expected to earn' : ''}${tip(`The base cost of every target bought once, in the dearest form the run can hand over (${c.spCost.items.map((it) => `${it.skill?.name ?? it.target.name} ${it.cost ?? '?'}`).join(', ')}). No hint discounts, prerequisites or purchase planning: an upper bound to check against the estimated SP. Independent training buys nothing during the run; you choose the purchases at the end.`)}</div>` : nothing}
      ${conflicts(c)}
      <h3>Independent training prioritized skills (up to ${PRIORITIZED_SKILLS_MAX})</h3>
      ${c.wl.length ? html`<ol class="wishlist" @dragstart=${wishlistDrag.dragstart} @dragover=${wishlistDrag.dragover} @drop=${wishlistDrag.drop} @dragend=${wishlistDrag.dragend}>${repeat(c.wl, (w) => w.key, (w, i) => html`<li draggable="true" data-wl-key="${w.key}">
          <span class="wl-num">${i + 1}.</span><span class="grip" title="Drag to reorder">⋮⋮</span>
          ${w.gated && w.isTarget ? html`<span class="tag gold wl-kind">target skill</span>` : w.gated ? html`<span class="tag wl-kind">not a target</span>` : html`<span class="tag warn wl-kind">target but not a choice</span>`}${skillWithTip(w.skillId, w.form ? html`${w.name} <span class="muted">(for ${w.form})</span>` : w.name)} <span class="small muted">${w.reason}</span>
          <button class="small wl-x" data-action="wl-exclude" data-id="${w.key}" title="Remove from the list" @click=${() => excludeSkill(w.key)}>✕</button></li>`)}</ol>` : html`<div class="muted small">Nothing to prioritize yet.</div>`}
      ${c.wlRest.length || c.wlExcluded.length ? html`<div class="small muted">
        ${c.wlRest.length ? html`Not listed: ${c.wlRest.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-add" data-id="${w.key}" title="Add to the list" @click=${() => addSkill(w.key)}>+</button></span>`)} ` : nothing}
        ${c.wlExcluded.length ? html`Removed: ${c.wlExcluded.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-restore" data-id="${w.key}" title="Put back" @click=${() => restoreSkill(w.key)}>+</button></span>`)} ` : nothing}
        ${customized ? html`<button class="small" data-action="wl-reset" @click=${resetWishlist}>Reset order</button>` : nothing}
      </div>` : (customized ? html`<div class="small muted"><button class="small" data-action="wl-reset" @click=${resetWishlist}>Reset order</button></div>` : nothing)}
      <details><summary>How the deck was built</summary><ol class="small">${d.steps.map((s) => html`<li>${s}</li>`)}</ol></details>
    </section>`;
}
const resetWishlist = () => update((s) => { s.run.wishlistOrder = []; s.run.wishlistExcluded = []; });
