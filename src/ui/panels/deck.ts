// The suggested deck and what it predicts: the six cards, the run's stats and rank, target coverage, choice
// conflicts and the prioritized-skill list to enter in independent training.
import { html, nothing, type TemplateResult } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { STATS } from '../../types.ts';
import { downloadText } from '../../download.ts';
import type { RunPlan } from '../../model/run.ts';
import type { Conflict, SkillSource } from '../../model/sparks.ts';
import { combineSources, resolveTarget } from '../../model/sparks.ts';
import { BLUE_STAR_BANDS, cardContribution, EFFECT, pAbove, passives, raceScale, uniqueExtras } from '../../model/stats.ts';
import { statScore } from '../../model/rank.ts';
import { PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { data, plan, store, update } from '../context.ts';
import { capitalize, cardLink, cardThumb, goalProbability, num, pct, pill, skillName, skillWithTip, typeIcon } from '../format.ts';
import { panel, sub } from '../panel.ts';
import { tip } from '../tooltip.ts';
import { lbSelect } from './ranking.ts';

// ----- prioritized skills: exclude, restore, add, reorder -----
const requiredSkill = (key: number) => store.run.targets.some((t) => t.role === 'required' && t.id === resolveTarget(key, data)?.id);
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
/** Move an entry one place up or down; the drag handlers and the arrow buttons both end up here. */
function nudgeSkill(key: number, delta: number) {
  const cur = plan().wl.map((w) => w.key);
  const i = cur.indexOf(key), j = i + delta;
  if (i < 0 || j < 0 || j >= cur.length) return;
  if (requiredSkill(cur[i]!) !== requiredSkill(cur[j]!)) return;
  cur.splice(i, 1); cur.splice(j, 0, key);
  update((s) => { s.run.wishlistOrder = cur; });
}
function moveSkill(from: number, to: number) {
  const cur = plan().wl.map((w) => w.key);
  const i = cur.indexOf(from), j = cur.indexOf(to);
  if (i < 0 || j < 0 || i === j) return; // stale key after a re-render
  if (requiredSkill(from) !== requiredSkill(to)) return;
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
const resetWishlist = () => update((s) => { s.run.wishlistOrder = []; s.run.wishlistExcluded = []; });
const exportWishlist = () => downloadText('prioritized-skills.txt', plan().wl.map((w) => w.name).join('\n') + '\n');

/** One source of a target skill: who gives it, which form, how likely, and through what. */
const sourceLine = (s: SkillSource) => html`<div class="src">${s.cardName ? html`<span class="muted">${s.cardName}</span> ` : nothing}${skillName(s.skillId)} ${pill(s.pObtain)} <span class="muted">${s.detail}</span></div>`;

function statBreakdown(c: RunPlan) {
  const d = c.deckResult, p = c.pred;
  const scale = raceScale(c.sum.count, data.model, store.settings);
  const focusMul = data.model.focus[store.settings.focus] ?? [1, 1, 1, 1, 1];
  const row = (label: TemplateResult | string, vals: number[], cls = '') => html`<tr class="${cls}"><td>${label}</td>${vals.map((v) => html`<td class="num">${num(v)}</td>`)}<td class="num">${num(vals.reduce((a, b) => a + b, 0))}</td></tr>`;
  const cardRows = d.deck.map((cs) => {
    const cc = cardContribution(cs.card, cs.lb, data.model, uniqueExtras(cs.card, cs.lb, data.model, { deck: d.deck, fansBefore: c.ctx.fansBefore }));
    return row(html`${cardThumb(cs.card, 'thumb sm')} ${cardLink(cs.card)} <span class="muted small">(${cc.source === 'model' ? 'model' : `observed${cc.source === 'observed+model' ? ', shifted to LB' + cs.lb : ''}`})</span>`, cc.stats.map((v, i) => v * scale * focusMul[i]!));
  });
  const base = c.trainee?.baseStats ?? [0, 0, 0, 0, 0];
  const penalty = store.settings.lossPenalty * c.sum.expectedLosses;
  const raceBonus = d.deck.reduce((a, cs) => a + (passives(cs.card, cs.lb)[EFFECT.raceBonus] ?? 0), 0);
  const capped = !!c.statCaps && c.statCaps.capped.some(Boolean);
  return html`<div class="scroll-x"><table class="small"><thead><tr><th>Source</th>${STATS.map((st) => html`<th class="num">${st}</th>`)}<th class="num">total</th></tr></thead><tbody>
      ${cardRows}
      ${row(`Career events and ${c.sum.count} races`, p.eventStats.map((v, i) => v * focusMul[i]!))}
      ${row('Inheritance at the start', c.inherited.map((x) => x.start))}
      ${row('Two inspiration events', c.inherited.map((x) => x.inspiration))}
      ${row(`Base stats${c.trainee ? ` (${c.trainee.name})` : ''}`, base)}
      ${penalty ? row('Expected race losses', STATS.map(() => -penalty / 5)) : nothing}
      ${capped ? row('Scenario cap (base cap + blue spark uncaps)', c.statCaps!.cap) : nothing}
      ${row(html`<b>Final</b>`, c.finalMean, 'total')}
      ${row('Run-to-run spread (±1 sd)', p.sd)}
    </tbody></table></div>
    <div class="small muted">Rank score: stats ${num(c.rank.statPts)} (${STATS.map((st, i) => `${st} ${num(statScore(c.finalMean[i]!))}`).join(', ')}), unique skill Lv ${num(c.rank.uniqueLevel, 1)} for ${num(c.rank.uniquePts)}, skills bought and innate ${num(c.rank.skillPts - c.rank.uniquePts)}. The stat curve is the game's table; the skill terms are estimates.</div>
    <div class="small muted">Card and career rows include the ${store.settings.focus} focus multiplier (${focusMul.map((m) => m.toFixed(2)).join(' / ')}) and a race scaling of ×${scale.toFixed(2)} for ${c.sum.count} races against the 28 the data was measured at. The spread is the standard deviation of total stats between logged runs of one trainee and deck; the card model itself has an RMSE of ${data.model.fit.rmse.toFixed(1)} per stat over ${data.model.fit.n} observations. Everything here is an empirical fit of logged runs, not the game's formula: the race scaling comes from one 23-race versus 28-race comparison, the focus multipliers from two decks, and the career row (which includes race rewards) was measured at the reference decks' Race Bonus. This deck has ${raceBonus}% Race Bonus, which is not modelled, so cards that differ in Race Bonus may be misranked.${capped ? ' A stat is clamped to the scenario cap plus the blue sparks\' start-of-run uncaps; uncaps from inspiration events and green sparks are unknown and left out.' : ''}</div>`;
}

function conflicts(c: RunPlan) {
  const d = c.deckResult;
  if (!d.conflicts.length) return nothing;
  const opts = (cf: Conflict) => [cf.taken, ...cf.dropped];
  return html`<div class="conflicts-box">${sub('Choice conflicts', { tip: 'These events offer more than one wanted skill, and the run can pick only one option per event. The option whose skill sits higher in the prioritized list below wins; drag the list to change it. That the list order settles a contested option is an assumption: the game confirms prioritized skills steer choices, not how ties between them resolve.' })}
    <div class="scroll-x"><table class="small conflicts"><thead><tr><th>Event</th><th>Options</th><th>Taken</th><th>Not taken</th></tr></thead><tbody>
      ${d.conflicts.map((cf) => html`<tr><td class="wrap">${cf.label}</td>
        <td class="wrap">${opts(cf).map((o) => html`<div>${skillWithTip(o.skillId)}${o.option ? html` <span class="muted">${o.option}</span>` : nothing}</div>`)}</td>
        <td><b>${skillName(cf.taken.skillId)}</b>${cf.taken.target != null ? nothing : html` <span class="muted">(not a target)</span>`}</td><td>${cf.dropped.map((o) => skillName(o.skillId)).join(', ')}</td></tr>`)}
    </tbody></table></div></div>`;
}

export function renderDeck(c: RunPlan) {
  const d = c.deckResult;
  const deck = d.deck.length ? html`<div class="deck">${repeat([...d.deck.filter((x) => !x.borrowed), ...d.deck.filter((x) => x.borrowed)], (cs) => `${cs.card.id}:${cs.borrowed ? 'b' : 'o'}`, (cs) => html`
    <div class="slot">
      <div class="slot-top">${store.run.pinnedIds.includes(cs.card.id) ? html`<span class="tag pin">pinned</span>` : nothing}${cs.borrowed ? html`<span class="tag borrow">borrow</span>` : nothing}</div>
      ${cardThumb(cs.card, 'slot-art')}
      <div class="name">${typeIcon(cs.card)}${cardLink(cs.card, html`${cs.card.charName}<span class="muted title">${cs.card.title}</span>`)}</div>
      <div class="lb">${cs.borrowed ? html`LB4 (friend's)` : html`LB ${lbSelect(cs.card, cs.lb, 'small')}`}</div>
      <div class="cover">${cs.coverage.filter((x) => x.marginal > 0 || x.spark > 0).map((x) => html`<span class="t">${x.target.name} <span class="n"><span class="muted">spark</span> ${pill(x.spark)}${tip(x.sources.map((s) => `${s.detail}: ${pct(s.pObtain)}`).join('\n'))}</span></span>`)}</div>
    </div>`)}</div>` : html`<div class="muted">No owned cards. Mark the cards you own in the card ranking.</div>`;
  const scoreText = (score: NonNullable<RunPlan['search']>['score']) => `${goalProbability(score.probability)}${score.probability === score.upperProbability ? '' : ' to ' + goalProbability(score.upperProbability)} for ${score.count === score.total ? 'every requirement' : score.count + ' of ' + score.total + ' requirements'}`;
  const borrow = d.borrow ? html`<div class="small gap-top" data-goal-borrow><b>Borrow:</b> ${cardLink(d.borrow.card)} at LB4.
    ${c.search ? html`This complete deck has ${scoreText(c.search.score)}.
      ${c.search.alternatives.length ? html`<span class="muted">Other legal borrows with the same owned cards: ${c.search.alternatives.map((o) => `${data.cardById.get(o.cardId)!.name} (${scoreText(o.score)})`).join('; ')}.</span>` : nothing}` : nothing}</div>` : nothing;
  return panel({ title: 'Suggested deck', tip: 'Five owned cards and one borrowed card. Search favors completing every required spark, then preferred sparks on successful parents within the advanced tie tolerance. This is the best deck found under the estimates, not a guaranteed global optimum. Standalone card spark chances do not add up to this complete-deck probability.' }, html`
    ${deck}${borrow}
    ${c.issues.length ? html`<div role="alert" data-plan-issues>${c.issues.map((issue) => html`<p class="warn">${issue}</p>`)}</div>` : renderPrediction(c)}
    <details><summary>How the deck was built</summary><ol class="small">${d.steps.map((s) => html`<li>${s}</li>`)}</ol></details>`);
}

const PREDICTION_TIP = `Means with the run-to-run spread (±1 sd) from an empirical fit of logged independent-training runs. ≥${BLUE_STAR_BANDS.mid} and ≥${BLUE_STAR_BANDS.high} are the chances of the stat reaching the 2★ and 3★ blue spark bands.`;
const COVERAGE_TIP = 'Chance the run hands over each target\'s hint, by form. The spark chance assumes you buy the best hinted form at the end: gold at 40%, otherwise a released ◎ upgrade at 25%, otherwise the base skill at 20%. Where a ◎ exists, buying it needs no separate hint. The run itself buys nothing.';
const PRIORITY_TIP = `Enter these in independent training's prioritized skills list, in this order. Only these ${PRIORITIZED_SKILLS_MAX} steer the run's event choices. Required targets come first; drag a row or use the arrows to reorder within each priority group. Excluded choices are not counted as available sources.`;
const KIND_TAG: Record<'target' | 'other' | 'given', { cls: string; label: string; tip: string }> = {
  target: { cls: 'gold', label: 'target', tip: 'Leads to a target and needs the run to pick this option at an event.' },
  other: { cls: '', label: 'not a target', tip: 'Not a target, but listing it steers the run to this option and its skill.' },
  given: { cls: 'warn', label: 'target, no choice', tip: 'A target the run gets without choosing anything. It is listed to fill the slot; the order does not matter for it.' },
};

function renderPrediction(c: RunPlan) {
  const d = c.deckResult, p = c.pred;
  const customized = store.run.wishlistOrder.length > 0 || store.run.wishlistExcluded.length > 0;
  const kindTag = (w: { skillId: number; gated: boolean; isTarget: boolean }) => { const k = KIND_TAG[w.gated ? (w.isTarget ? 'target' : 'other') : 'given']; return html`<span class="tag ${k.cls} wl-kind" data-tip="${k.tip}">${requiredSkill(w.skillId) ? 'required' : k.label}</span>`; };
  return html`
      ${sub('Predicted run', { note: `${c.sum.count} races · ${capitalize(store.settings.focus)} focus${c.trainee ? ` · ${c.trainee.name}` : ''}`, tip: PREDICTION_TIP })}
      <div class="stats">
        <div class="stat outcome">
          <div class="outcome-item"><div class="k">SS or better${tip('Chance the final rank is SS or above, which improves white spark star odds. An estimate: the rank score is the game\'s stat table plus estimated skill terms, and its spread comes from the fitted stat model.')}</div><div class="v">${pill(c.rank.pSS, c.rank.pSS > 0.5 ? 'ok' : 'warn')}</div></div>
          <div class="outcome-item"><div class="k">Rank score</div><div class="v">${num(c.rank.score)} <span class="sd">±${num(c.rank.sd)}</span></div></div>
          <div class="outcome-item"><div class="k">Estimated SP</div><div class="v">${num(p.sp)}</div></div>
        </div>
        ${STATS.map((s, i) => html`
        <div class="stat"><div class="k">${s}</div><div class="v">${num(c.finalMean[i]!)} <span class="sd">±${num(p.sd[i]!)}</span></div>
          <div class="s">≥${BLUE_STAR_BANDS.mid} ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, BLUE_STAR_BANDS.mid))} · ≥${BLUE_STAR_BANDS.high} ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, BLUE_STAR_BANDS.high))}</div></div>`)}
      </div>
      <details><summary>Where the stats come from</summary>${statBreakdown(c)}</details>
      ${sub('Target coverage', { tip: COVERAGE_TIP })}
      <div class="scroll-x"><table class="coverage"><thead><tr><th>Skill</th><th class="num col-detail">Gold hint</th><th class="num col-detail">◎ or white hint</th><th class="num">Spark chance</th><th>Sources</th></tr></thead><tbody>
        ${c.targets.map((t) => {
          const srcs = d.coverage.get(t.id) ?? [];
          const own = combineSources(srcs);
          const spark = d.sparks.get(t.id) ?? 0;
          return html`<tr><td>${skillWithTip(t.white?.id ?? t.id, t.name)}</td><td class="num col-detail">${pill(own.pGold)}</td><td class="num col-detail">${pill(own.pWhite + own.pCircle)}</td><td class="num">${pill(spark, spark > 0 ? 'ok' : 'warn')}</td>
            <td class="small wrap src-list">${srcs.length ? srcs.map(sourceLine) : html`<span class="warn">no source in the deck</span>`}</td></tr>`;
        })}
      </tbody></table></div>
      ${c.targets.length ? html`<div class="small ${c.spCost.total > p.sp ? 'warn' : 'muted'}">Worst-case target SP cost: <b>${num(c.spCost.total)}${c.spCost.incomplete ? '+' : ''}</b> of ${num(p.sp)} estimated SP${c.spCost.total > p.sp ? ', more than the run is expected to earn' : ''}${tip(`The base cost of every target bought once in its best hinted form, with prerequisites and no hint discounts (${c.spCost.items.map((it) => `${it.skill?.name ?? it.target.name}: ${it.purchases.map((s) => `${s.name} ${s.cost ?? '?'}`).join(' + ')} = ${it.cost ?? '?'}`).join(', ')}). An upper bound to check against the estimated SP; you choose the purchases at the end of the run.`)}</div>` : nothing}
      ${conflicts(c)}
      <p class="small muted">Required targets come before preferred and other skills. Your ordering applies within each group.</p>
      ${c.priorityIssues.map((note) => html`<p class="small warn" data-priority-conflict>${note}</p>`)}
      ${sub('Prioritized skills', { note: `up to ${PRIORITIZED_SKILLS_MAX}`, tip: PRIORITY_TIP, actions: html`<button class="small" data-action="wl-export" ?disabled=${!c.wl.length} @click=${exportWishlist}>Export list</button>${customized ? html`<button class="small" data-action="wl-reset" @click=${resetWishlist}>Reset list</button>` : nothing}` })}
      ${c.wl.length ? html`<ol class="wishlist" @dragstart=${wishlistDrag.dragstart} @dragover=${wishlistDrag.dragover} @drop=${wishlistDrag.drop} @dragend=${wishlistDrag.dragend}>${repeat(c.wl, (w) => w.key, (w, i) => html`<li draggable="true" data-wl-key="${w.key}">
          <span class="wl-num">${i + 1}.</span><span class="grip" title="Drag to reorder">⋮⋮</span>
          <span class="wl-body">${kindTag(w)}${skillWithTip(w.skillId, w.form ? html`${w.name} <span class="muted">(for ${w.form})</span>` : w.name)} <span class="small muted">${w.reason}</span></span>
          <span class="wl-actions"><button class="small wl-move" data-action="wl-up" data-id="${w.key}" title="Move up" ?disabled=${i === 0 || requiredSkill(w.key) !== requiredSkill(c.wl[i - 1]!.key)} @click=${() => nudgeSkill(w.key, -1)}>▲</button><button class="small wl-move" data-action="wl-down" data-id="${w.key}" title="Move down" ?disabled=${i === c.wl.length - 1 || requiredSkill(w.key) !== requiredSkill(c.wl[i + 1]!.key)} @click=${() => nudgeSkill(w.key, 1)}>▼</button><button class="small wl-x" data-action="wl-exclude" data-id="${w.key}" title="Remove from the list" @click=${() => excludeSkill(w.key)}>✕</button></span></li>`)}</ol>` : html`<div class="muted small">Nothing to prioritize yet.</div>`}
      ${c.wlRest.length || c.wlExcluded.length ? html`<div class="small muted wl-extra">
        ${c.wlRest.length ? html`<span>Not listed:</span> ${c.wlRest.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-add" data-id="${w.key}" title="Add to the list" @click=${() => addSkill(w.key)}>+</button></span>`)}` : nothing}
        ${c.wlExcluded.length ? html`<span>Removed:</span> ${c.wlExcluded.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-restore" data-id="${w.key}" title="Put back" @click=${() => restoreSkill(w.key)}>+</button></span>`)}` : nothing}
      </div>` : nothing}
  `;
}
