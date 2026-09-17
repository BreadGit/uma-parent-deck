// The predicted run: rank, SP and final stats with their blue-spark band chances, and where every stat point
// comes from.
import { html, nothing, type TemplateResult } from 'lit-html';
import { STATS } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { BLUE_STAR_BANDS, cardContribution, EFFECT, pAbove, passives, raceScale, uniqueExtras } from '../../model/stats.ts';
import { statScore } from '../../model/rank.ts';
import { data, store } from '../context.ts';
import { COPY } from '../copy.ts';
import { basisLabel } from '../effect-coverage.ts';
import { capitalize, cardLink, cardThumb, num, pill } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

function statBreakdown(c: RunPlan) {
  const d = c.deckResult, p = c.pred;
  const scale = raceScale(c.sum.count, data.model, store.settings);
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
    <p class="small muted">Rank score: stats ${num(c.rank.statPts)} (${STATS.map((st, i) => `${st} ${num(statScore(c.finalMean[i]!))}`).join(', ')}), unique skill Lv ${num(c.rank.uniqueLevel, 1)} for ${num(c.rank.uniquePts)}, skills bought and innate ${num(c.rank.skillPts - c.rank.uniquePts)}. The stat curve is the game's table; the skill terms are estimates.</p>
    <p class="small muted">Card and career rows include the ${store.settings.focus} focus multiplier (${focusMul.map((m) => m.toFixed(2)).join(' / ')}) and a race scaling of ×${scale.toFixed(2)} for ${c.sum.count} races against the 28 the data was measured at. The spread is the standard deviation of total stats between logged runs of one trainee and deck; the card model itself has an RMSE of ${data.model.fit.rmse.toFixed(1)} per stat over ${data.model.fit.n} observations. Everything here is an empirical fit of logged runs, not the game's formula: the race scaling comes from one 23-race versus 28-race comparison, the focus multipliers from two decks, and the career row (which includes race rewards) was measured at the reference decks' Race Bonus. This deck has ${raceBonus}% Race Bonus, which is not modelled, so cards that differ in Race Bonus may be misranked.${capped ? ' A stat is clamped to the scenario cap plus the blue sparks\' start-of-run uncaps; uncaps from inspiration events and green sparks are unknown and left out.' : ''}</p>`;
}

export function renderPrediction(c: RunPlan) {
  const p = c.pred;
  const subtitle = `${c.sum.count} races · ${capitalize(store.settings.focus)} focus${c.trainee ? ` · ${c.trainee.name}` : ''}`;
  return panel({ title: COPY.prediction.title, kind: 'result', subtitle, tip: COPY.prediction.tip }, html`
    <div class="stats">
      <div class="stat outcome">
        <div class="outcome-item"><div class="stat-k">SS or better${tip(COPY.prediction.ssTip)}</div><div class="stat-v">${pill(c.rank.pSS)}</div></div>
        <div class="outcome-item"><div class="stat-k">Rank score</div><div class="stat-v">${num(c.rank.score)} <span class="sd">±${num(c.rank.sd)}</span></div></div>
        <div class="outcome-item"><div class="stat-k">Estimated SP</div><div class="stat-v">${num(p.sp)}</div></div>
      </div>
      ${STATS.map((s, i) => html`
      <div class="stat"><div class="stat-k">${s}</div><div class="stat-v">${num(c.finalMean[i]!)} <span class="sd">±${num(p.sd[i]!)}</span></div>
        <div class="stat-s"><span class="band">≥${BLUE_STAR_BANDS.mid} ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, BLUE_STAR_BANDS.mid))}</span> <span class="band">≥${BLUE_STAR_BANDS.high} ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, BLUE_STAR_BANDS.high))}</span></div></div>`)}
    </div>
    <details><summary>${COPY.prediction.breakdown}</summary>${statBreakdown(c)}</details>`);
}
