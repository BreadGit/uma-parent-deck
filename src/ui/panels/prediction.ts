// The predicted run: rank, SP and final stats with their blue-spark band chances. Where every stat point comes from
// is rendered by the prediction details panel through statBreakdown().
import { html, nothing, type TemplateResult } from 'lit-html';
import { STATS } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { BLUE_STAR_BANDS, cardContribution, EFFECT, passives, raceScale, uniqueExtras } from '../../model/stats.ts';
import { data, store } from '../context.ts';
import { COPY } from '../copy.ts';
import { basisLabel } from '../effect-coverage.ts';
import { capitalize, cardLink, cardThumb, num, pill } from '../format.ts';
import { about, panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

export function statBreakdown(c: RunPlan) {
  const d = c.deckResult, p = c.pred;
  const scale = raceScale(c.ctx.races, data.model, store.settings);
  const focusMul = data.model.focus[store.settings.focus] ?? [1, 1, 1, 1, 1];
  const row = (label: TemplateResult | string, vals: number[], cls = '') => html`<tr class="${cls}"><td>${label}</td>${vals.map((v) => html`<td class="num">${num(v)}</td>`)}<td class="num">${num(vals.reduce((a, b) => a + b, 0))}</td></tr>`;
  const cardRows = d.deck.map((cs) => {
    const cc = cardContribution(cs.card, cs.lb, data.model, uniqueExtras(cs.card, cs.lb, data.model, { deck: d.deck, fansBefore: c.ctx.fansBefore }));
    return row(html`${cardThumb(cs.card, 'thumb thumb-sm')} ${cardLink(cs.card)} <span class="muted small">(${basisLabel(cs.card, cs.lb, cc.source)})</span>`, cc.stats.map((v, i) => v * scale * focusMul[i]!));
  });
  const base = c.trainee?.baseStats ?? [0, 0, 0, 0, 0];
  const penalty = store.settings.lossPenalty * c.sum.expectedLosses;
  const raceBonus = d.deck.reduce((a, cs) => a + (passives(cs.card, cs.lb)[EFFECT.raceBonus] ?? 0), 0);
  const capped = !!c.statCaps && c.statCaps.capped.some(Boolean);
  return html`<div class="scroll-x" data-stat-breakdown><table class="small"><thead><tr><th>Source</th>${STATS.map((st) => html`<th class="num">${st}</th>`)}<th class="num">total</th></tr></thead><tbody>
      ${cardRows}
      ${row(`Career events and ${c.ctx.races} total races`, p.eventStats.map((v, i) => v * focusMul[i]!))}
      ${row('Inheritance at the start', c.inherited.map((x) => x.start))}
      ${row('Two inspiration events', c.inherited.map((x) => x.inspiration))}
      ${row(`Base stats${c.trainee ? ` (${c.trainee.name})` : ''}`, base)}
      ${penalty ? row('Expected race losses', STATS.map(() => -penalty / 5)) : nothing}
      ${capped ? row('Scenario cap (base cap + blue spark uncaps)', c.statCaps!.cap) : nothing}
      ${row('Conversion above 1,200 and caps', c.finalMean.map((v, i) => v - c.rawFinalMean[i]!))}
      ${row(html`<b>Final</b>`, c.finalMean, 'total')}
      ${row('Estimated spread (±1 sd)', c.finalSd)}
    </tbody></table></div>
    <p class="small ${c.purchases.spent > p.sp ? 'warn' : 'muted'}">Rank score: stats ${num(c.rank.statPts)}, unique skill Lv ${num(c.rank.uniqueLevel, 1)} for ${num(c.rank.uniquePts)}, purchased skills ${num(c.rank.skillPts - c.rank.uniquePts)}. ${COPY.prediction.skillCost(`${num(c.purchases.spent)}${c.purchases.incomplete ? '+' : ''}`, num(p.sp), c.purchases.spent > p.sp)}</p>
    ${about(COPY.details.aboutStats, [
      COPY.prediction.scaling(store.settings.focus, focusMul.map((m) => m.toFixed(2)).join(' / '), scale.toFixed(2), c.ctx.races, data.model.races.reference),
      COPY.prediction.purchases(c.skillRating.pointsPerSp, c.skillRating.referenceRate, c.skillRating.referenceSp, c.skillRating.fallback, c.skillRating.unverified.length),
      COPY.prediction.evidence(data.model.fit.rmse.toFixed(1), data.model.fit.n),
      `${COPY.prediction.raceBonus(raceBonus)}${capped ? ` ${COPY.prediction.capped}` : ''}`,
    ])}`;
}

export function renderPrediction(c: RunPlan) {
  const p = c.pred;
  const subtitle = `${c.sum.count} calendar + ${c.ctx.races - c.sum.count} finale races · ${capitalize(store.settings.focus)} focus${c.trainee ? ` · ${c.trainee.name}` : ''}`;
  return panel({ title: COPY.prediction.title, kind: 'result', subtitle, tip: COPY.prediction.tip }, html`
    <div class="stats">
      <div class="stat outcome">
        <div class="outcome-item"><div class="stat-k">SS or better${tip(COPY.prediction.ssTip)}</div><div class="stat-v">${pill(c.rank.pSS, '', true)}</div></div>
        <div class="outcome-item"><div class="stat-k">Rank score</div><div class="stat-v">${num(c.rank.score)} <span class="sd">±${num(c.rank.sd)}</span></div></div>
        <div class="outcome-item"><div class="stat-k">Estimated SP</div><div class="stat-v">${num(p.sp)}</div></div>
      </div>
      ${STATS.map((s, i) => html`
      <div class="stat"><div class="stat-k">${s}</div><div class="stat-v">${num(c.finalMean[i]!)} <span class="sd">±${num(c.finalSd[i]!)}</span></div>
        <div class="stat-s"><span class="band">≥${BLUE_STAR_BANDS.mid} ${pill(c.statChances[i]!.mid, '', true)}</span> <span class="band">≥${BLUE_STAR_BANDS.high} ${pill(c.statChances[i]!.high, '', true)}</span></div></div>`)}
    </div>`);
}
