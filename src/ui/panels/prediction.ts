import { html, nothing, type TemplateResult } from 'lit-html';
import { perStat, STATS, type StatValues } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { BLUE_STAR_BANDS, cardContribution, raceScale } from '../../model/stats.ts';
import { EFFECT, passives, uniqueExtras } from '../../model/support-effects.ts';
import { data, store } from '../context.ts';
import { TITLE } from '../copy.ts';
import { basisLabel } from '../effect-coverage.ts';
import { capitalize, cardLink, cardThumb, estimatedProbability, num, pill } from '../format.ts';
import { about, panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

export function statBreakdown(c: RunPlan) {
  const d = c.deckResult, p = c.pred;
  const scale = raceScale(c.ctx.races, data.model, store.settings);
  const focusMul = data.model.focus[store.settings.focus];
  const row = (label: TemplateResult | string, vals: StatValues, cls = '') => html`<tr class="${cls}"><td>${label}</td>${vals.map((v) => html`<td class="num">${num(v)}</td>`)}<td class="num">${num(vals.reduce((a, b) => a + b, 0))}</td></tr>`;
  const cardRows = d.deck.map((cs) => {
    const cc = cardContribution(cs.card, cs.lb, data.model, uniqueExtras(cs.card, cs.lb, data.model, { deck: d.deck, fansBefore: c.ctx.fansBefore }));
    return row(html`${cardThumb(cs.card, 'thumb thumb-sm')} ${cardLink(cs.card)} <span class="muted small">(${basisLabel(cs.card, cs.lb, cc.source)})</span>`, perStat((_, i) => cc.stats[i] * scale * focusMul[i]));
  });
  const base: StatValues = c.trainee?.baseStats ?? [0, 0, 0, 0, 0];
  const penalty = store.settings.lossPenalty * c.sum.expectedLosses;
  const raceBonus = d.deck.reduce((a, cs) => a + (passives(cs.card, cs.lb)[EFFECT.raceBonus] ?? 0), 0);
  const capped = !!c.statCaps && c.statCaps.capped.some(Boolean);
  const rating = c.skillRating, unverified = rating.unverified.length;
  const method = [
    `Card stats and SP use a race scaling of ×${scale.toFixed(2)} for ${c.ctx.races} races against the model's ${data.model.races.reference}-race reference. Career rewards use a separate estimate based on 23-race and 28-race measurements. Both card and career stats include the ${store.settings.focus} focus multiplier (${focusMul.map((m) => m.toFixed(2)).join(' / ')}); SP does not.`,
    `Rank assumes all estimated SP is spent, averaging ${rating.pointsPerSp.toFixed(2)} rating points per SP. ${rating.fallback ? 'No obtainable skill has a known positive price.' : 'Obtainable skills contribute when their full-price value beats the reference rate. Availability limits their contribution, and inefficient optional skills or upgrades can be skipped.'} About ${Math.round(rating.referenceSp).toLocaleString()} SP uses a reference rate of ${rating.referenceRate.toFixed(2)} points per SP, derived from released white skills and the trainee's aptitudes independently of the deck. This rate is a planning assumption, not calibrated spending data. Fractional expected purchases approximate availability; shared outcomes and actual purchase budgets can differ. The full-price cost of the targets is checked separately, using each family's highest obtainable form with prerequisites, and the listed extras are priced apart from it. Goal spark chances assume the target forms are bought even when their cost exceeds estimated SP. Hint discounts, Fast Learner and SP variation are not modeled. ${unverified ? `${unverified} skill forms lack a verified individual rating and use rarity estimates. ` : ''}The skill-score spread describes uncertainty in spending efficiency; it is not a calibrated success rate.`,
    `The spread uses raw gains between logged runs, with a sample-variance correction and estimated inspiration variance. The full total is converted above 1,200 before caps and rating. Correlated stats and errors in the predicted mean are not measured by this spread. The card formula's fitting error is ${data.model.fit.rmse.toFixed(1)} per stat over ${data.model.fit.n} observations; this is not an accuracy guarantee for new cards. Race scaling comes from the measured 23-race and 28-race schedules, and focus multipliers come from one measured deck.`,
    `Career rewards include race rewards measured with the reference deck's Race Bonus. The baseline does not adjust for this deck's ${raceBonus}% Race Bonus, so comparisons between decks may miss that difference.${capped ? ' A stat is clamped to the scenario cap plus the blue sparks\' start-of-run uncaps. Uncaps from inspiration events and green sparks are unknown and left out.' : ''}`,
  ];
  return html`<div class="scroll-x" data-stat-breakdown><table class="small"><thead><tr><th>Source</th>${STATS.map((st) => html`<th class="num">${st}</th>`)}<th class="num">total</th></tr></thead><tbody>
      ${cardRows}
      ${row(`Career events and ${c.ctx.races} total races`, perStat((_, i) => p.eventStats[i] * focusMul[i]))}
      ${row('Inheritance at the start', perStat((_, i) => c.inherited[i].start))}
      ${row('Two inspiration events', perStat((_, i) => c.inherited[i].inspiration))}
      ${row(`Base stats${c.trainee ? ` (${c.trainee.name})` : ''}`, base)}
      ${penalty ? row('Expected race losses', perStat(() => -penalty / STATS.length)) : nothing}
      ${capped ? row('Scenario cap (base cap + blue spark uncaps)', c.statCaps!.cap) : nothing}
      ${row('Conversion above 1,200 and caps', perStat((_, i) => c.finalMean[i] - c.rawFinalMean[i]))}
      ${row(html`<b>Final</b>`, c.finalMean, 'total')}
      ${row('Estimated spread (±1 sd)', c.finalSd)}
    </tbody></table></div>
    <p class="small ${c.spCost.total > p.sp ? 'warn' : 'muted'}">Rank score: stats ${num(c.rank.statPts)}, unique skill Lv ${num(c.rank.uniqueLevel, 1)} for ${num(c.rank.uniquePts)}, purchased skills ${num(c.rank.skillPts - c.rank.uniquePts)}. Buying every target at full price costs ${num(c.spCost.total)}${c.spCost.incomplete ? '+' : ''} of ${num(p.sp)} estimated SP${c.spCost.total > p.sp ? ', more than the run is expected to earn' : ''} (the worst case in ${TITLE.coverage}). The listed extras would add ${num(c.purchases.extrasCost.total)}${c.purchases.extrasCost.incomplete ? '+' : ''} SP; the run does not need them.</p>
    ${about('How the stats are estimated', method)}`;
}

export function renderPrediction(c: RunPlan) {
  const p = c.pred;
  const subtitle = `${c.sum.count} calendar + ${c.ctx.races - c.sum.count} finale races · ${capitalize(store.settings.focus)} focus${c.trainee ? ` · ${c.trainee.name}` : ''}`;
  return panel({ title: TITLE.prediction, kind: 'result', subtitle, tip: `Means with the run-to-run spread (±1 sd) from an empirical fit of logged independent-training runs. ≥${BLUE_STAR_BANDS.mid} and ≥${BLUE_STAR_BANDS.high} are the chances of the stat reaching the 2★ and 3★ blue spark bands.` }, html`
    <div class="stats">
      <div class="stat outcome">
        <div class="outcome-item"><div class="stat-k">SS or better${tip("Chance the final rank is SS or above, which improves white spark star odds. An estimate: the rank score is the game's stat table plus estimated skill terms, and its spread comes from the fitted stat model.")}</div><div class="stat-v">${pill(estimatedProbability(c.rank.pSS))}</div></div>
        <div class="outcome-item"><div class="stat-k">Rank score</div><div class="stat-v">${num(c.rank.score)} <span class="sd">±${num(c.rank.sd)}</span></div></div>
        <div class="outcome-item"><div class="stat-k">Estimated SP</div><div class="stat-v">${num(p.sp)}</div></div>
      </div>
      ${perStat((s, i) => html`
      <div class="stat"><div class="stat-k">${s}</div><div class="stat-v">${num(c.finalMean[i])} <span class="sd">±${num(c.finalSd[i])}</span></div>
        <div class="stat-s"><span class="band">≥${BLUE_STAR_BANDS.mid} ${pill(estimatedProbability(c.statChances[i].mid))}</span> <span class="band">≥${BLUE_STAR_BANDS.high} ${pill(estimatedProbability(c.statChances[i].high))}</span></div></div>`)}
    </div>`);
}
