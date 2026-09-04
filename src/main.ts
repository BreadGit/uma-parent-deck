import { loadData } from './data.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings.ts';
import { effectiveLb, exportInventory, importInventory, loadInventory, saveInventory } from './inventory.ts';
import { html, pct, pill, num, type Raw } from './ui/html.ts';
import { STATS, type AptKey, type Card, type Character, type Grade, type Inventory, type Skill } from './types.ts';
import { buildDeck, rankCards, traineeCoverage, wishlist, type CardScore, type Ctx } from './model/deck.ts';
import { resolveTarget, type Target } from './model/sparks.ts';
import { cardContribution, pAbove, predictDeck, phi, raceScale } from './model/stats.ts';
import { buildSchedule, scheduleSummary, traineeAptitudes, type Aptitudes } from './model/races.ts';
import { skillScore, statScore, thresholdFor } from './model/rank.ts';
import { clampStars, inheritedFromParents, MAX_PARENT_STARS } from './model/inherit.ts';
import meta from '../data/meta.json';

const data = loadData();
const LIGHT_HELLO_IDS = data.cards.filter((c) => c.charName === 'Light Hello').map((c) => c.id);
const GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
const APT_SHOWN: AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long'];

interface PersistedState {
  targets: number[];
  traineeCardId: number | null;
  aptOverrides: Partial<Aptitudes>;
  raceOverrides: Record<string, boolean>;
  pinnedIds: number[];       // support cards forced into the deck, in order
  parentStars: number[][]; // [parent 1, parent 2], five stats each, up to 9 stars per parent
  sortKey: string;
}
const STATE_KEY = 'uma-parent-deck.state';
function loadState(): PersistedState {
  const base: PersistedState = { targets: [], traineeCardId: null, aptOverrides: {}, raceOverrides: {}, pinnedIds: [], parentStars: [[9, 0, 0, 0, 0], [0, 3, 3, 3, 0]], sortKey: 'score' };
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<PersistedState> & { blueStars?: number[]; pinnedId?: number | null };
      const merged = { ...base, ...saved };
      if (!saved.pinnedIds) merged.pinnedIds = saved.pinnedId != null ? [saved.pinnedId] : defaultPins();
      if (!saved.parentStars && saved.blueStars) {
        // migrate the old combined sliders: fill parent 1 first, the rest goes to parent 2
        let left = MAX_PARENT_STARS;
        const p1 = saved.blueStars.map((v) => { const take = Math.min(v, left); left -= take; return take; });
        merged.parentStars = [p1, saved.blueStars.map((v, i) => Math.min(MAX_PARENT_STARS, v - p1[i]!))];
      }
      return merged;
    }
  } catch { /* ignore */ }
  return { ...base, pinnedIds: defaultPins() };
}
/** Light Hello is mandatory in Our Grand Concert, so she starts pinned (SSR if present, else R). */
function defaultPins(): number[] {
  const lh = LIGHT_HELLO_IDS.slice().sort((a, b) => b - a)[0];
  return lh ? [lh] : [];
}
const state = loadState();
let settings: Settings = loadSettings();
let inventory: Inventory = loadInventory();
let query = '';
let traineeQuery = '';
let cardQuery = '';
let showAdvanced = false;
let showAllRaces = false;
let activeInheritedStat = 0;

const persist = () => { localStorage.setItem(STATE_KEY, JSON.stringify(state)); saveSettings(settings); saveInventory(inventory); };

function drawBlueSliderNotches(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#aeb6c1';
  for (let tick = 0; tick <= MAX_PARENT_STARS; tick++) {
    const x = Math.round(tick * (width - 1) / MAX_PARENT_STARS);
    ctx.fillRect(x, 0, 1, height);
  }
}

const notchObserver = new ResizeObserver((entries) => {
  for (const entry of entries) drawBlueSliderNotches(entry.target as HTMLCanvasElement);
});
window.addEventListener('resize', () => {
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.blue-slider-notches')) drawBlueSliderNotches(canvas);
});

// ---------- derived ----------
const skillName = (id: number) => data.skillById.get(id)?.name ?? `#${id}`;
const skillIcon = (s: Skill | undefined) => (s?.iconId ? `/assets/skills/${s.iconId}.png` : '');
const cardImg = (c: Card) => `/assets/supports/${c.id}.png`;
const charImg = (c: Character) => `/assets/characters/${c.cardId}.png`;
const typeTag = (c: Card) => html`<span class="tag type-${c.type}">${c.type}</span>`;

function targetableSkills(): Skill[] {
  return data.skills.filter((s) => !s.unreleasedEn && (s.rarity === 1 || s.rarity === 2) && !s.name.includes('×'));
}

function compute() {
  const trainee = state.traineeCardId != null ? data.charByCardId.get(state.traineeCardId) ?? null : null;
  const apt = traineeAptitudes(trainee, state.aptOverrides);
  const schedule = buildSchedule(data.races, apt, settings.winThreshold, new Map(Object.entries(state.raceOverrides)));
  const sum = scheduleSummary(schedule);
  const totalTurns = settings.totalTurnsOverride ?? data.model.races.totalTurns;
  const ctx: Ctx = { data, settings, races: sum.count, totalTurns, trainee };
  const targets = state.targets.map((id) => resolveTarget(id, data)).filter((t): t is Target => !!t);
  // Every card is owned unless marked otherwise; unmarked cards sit at the rarity's default LB.
  const pool: { card: Card; lb: number }[] = [];
  const unowned = new Set<number>();
  for (const card of data.cards) {
    const lb = effectiveLb(inventory, card, settings.defaultLb);
    if (lb != null) pool.push({ card, lb });
    else { unowned.add(card.id); if (settings.showUnowned) pool.push({ card, lb: settings.defaultLb[card.rarity] }); }
  }
  const existing = traineeCoverage(targets, ctx);
  const ranking = rankCards(pool.filter((p) => !unowned.has(p.card.id) || settings.showUnowned), targets, existing, ctx);
  const deckPool = pool.filter((p) => !unowned.has(p.card.id));
  const pinnedIds = state.pinnedIds.filter((id) => deckPool.some((p) => p.card.id === id));
  const deckResult = buildDeck(deckPool, targets, ctx, pinnedIds);
  const pred = predictDeck(deckResult.deck.map((d) => ({ card: d.card, lb: d.lb })), trainee, sum.count, settings.focus, sum.expectedLosses, data.model, settings);
  const inherited = STATS.map((_, i) => inheritedFromParents(state.parentStars, i, settings));
  const finalMean = pred.finalMean.map((v, i) => v + inherited[i]!.total);
  // rank score: stats + skills (SP based estimate) + unique
  const statPts = finalMean.reduce((a, v) => a + statScore(v), 0);
  const skillPts = pred.sp * settings.skillScorePerSp + (trainee ? 510 : 0)
    + (trainee ? trainee.innateSkills.reduce((a, id) => a + (data.skillById.get(id) ? skillScore(data.skillById.get(id)!, trainee) * 0.5 : 0), 0) : 0);
  const score = statPts + skillPts;
  const dScore = finalMean.map((v, i) => (statScore(v + 10) - statScore(v - 10)) / 20 * pred.sd[i]!);
  const sdScore = Math.sqrt(dScore.reduce((a, d) => a + d * d, 0) + Math.pow(settings.skillScoreSd, 2));
  const ssMin = thresholdFor('SS', data.ranks);
  const pSS = 1 - phi((ssMin - score) / Math.max(1, sdScore));
  const wl = wishlist(deckResult.deck, targets, ctx);
  return { trainee, apt, schedule, sum, ctx, targets, pool, unowned, ranking, deckResult, pred, inherited, finalMean, score, sdScore, pSS, ssMin, wl, existing, pinnedIds };
}
type Computed = ReturnType<typeof compute>;

// ---------- rendering ----------
function renderTargets(c: Computed): Raw {
  const q = query.trim().toLowerCase();
  const suggestions = q.length >= 2
    ? targetableSkills().filter((s) => s.name.toLowerCase().includes(q) || (s.altName ?? '').toLowerCase().includes(q)).slice(0, 12)
    : [];
  return html`
    <section class="panel">
      <h2>Target white sparks</h2>
      <div class="suggest">
        <input id="target-search" type="search" placeholder="Search skill name…" value="${query}" data-input="query" style="max-width:100%;width:100%" autocomplete="off" />
        ${suggestions.length ? html`<ul>${suggestions.map((s) => {
          const fam = resolveTarget(s.id, data);
          return html`<li data-action="add-target" data-id="${s.id}"><img src="${skillIcon(s)}" alt="" />${s.name}<span class="r">${s.rarity === 2 ? 'gold' : 'white'}${fam?.gold && s.rarity === 1 ? ` · gold: ${fam.gold.name}` : ''}</span></li>`;
        })}</ul>` : ''}
      </div>
      <div class="chips">
        ${c.targets.length ? c.targets.map((t) => html`<span class="chip ${t.gold ? 'gold' : ''}" title="${t.gold ? `Gold form: ${t.gold.name}` : 'No gold form'}">
          <img src="${skillIcon(t.white ?? t.gold ?? undefined)}" alt="" />${t.name}${t.gold ? html` <span class="muted small">(${t.gold.name})</span>` : ''}
          <button data-action="remove-target" data-id="${t.id}" title="Remove">✕</button></span>`)
        : html`<span class="muted small">Add the white skills you want to spark. Cards giving the gold version count too.</span>`}
      </div>
      ${c.targets.length ? html`<div class="small muted">Trainee already covers: ${c.targets.filter((t) => (c.existing.get(t.id) ?? []).length).map((t) => t.name).join(', ') || 'nothing'}</div>` : ''}
    </section>`;
}

function renderTrainee(c: Computed): Raw {
  const t = c.trainee;
  const q = traineeQuery.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const matches = words.length
    ? data.characters.filter((ch) => { const hay = `${ch.name} ${ch.title}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
      .sort((a, b) => a.name.localeCompare(b.name) || a.cardId - b.cardId).slice(0, 12)
    : [];
  const overridden = Object.keys(state.aptOverrides).length > 0;
  return html`
    <section class="panel">
      <h2>Trainee</h2>
      ${t ? html`
        <div class="kv" style="align-items:center">
          <img class="thumb" src="${charImg(t)}" alt="" style="width:56px;height:56px" />
          <div><span class="k">${t.title}</span><span class="v">${t.name}</span></div>
          <button class="small" data-action="clear-trainee" style="margin-left:auto">Change</button>
        </div>
        <div class="small muted">Growth: ${STATS.map((s, i) => `${s} ${t.growth[i]! > 0 ? '+' + t.growth[i] + '%' : '–'}`).join(' · ')}</div>
        <h3>Trainee aptitude overrides (match the legacy screen)</h3>
        <div class="apts">${APT_SHOWN.map((k) => html`<label>${k}<select data-apt="${k}">${GRADES.map((g) => html`<option value="${g}" ${c.apt[k] === g ? 'selected' : ''}>${g}</option>`)}</select></label>`)}</div>
        ${overridden ? html`<button class="small" data-action="reset-apts">Reset to base aptitudes</button>` : ''}
        <div class="small muted" style="margin-top:6px">Innate: ${t.innateSkills.map(skillName).join(', ')}<br/>Awakening: ${t.awakeningSkills.map(skillName).join(', ')}</div>
      ` : html`
        <div class="suggest">
          <input id="trainee-search" type="search" placeholder="Search uma name or outfit…" value="${traineeQuery}" data-input="traineeQuery" style="max-width:100%;width:100%" autocomplete="off" />
          ${matches.length ? html`<ul>${matches.map((ch) => html`<li data-action="pick-trainee" data-id="${ch.cardId}"><img src="${charImg(ch)}" alt="" style="width:32px;height:32px" />${ch.name}<span class="r">${ch.title}</span></li>`)}</ul>` : ''}
        </div>
        <div class="small muted">Pick the uma you'll train. Her own support cards are excluded from the deck and her innate skills count as covered.</div>`}
    </section>`;
}

function renderRunSettings(c: Computed): Raw {
  const lhOptions = c.pool.filter((p) => LIGHT_HELLO_IDS.includes(p.card.id) && !c.unowned.has(p.card.id));
  const cq = cardQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const cardMatches = cq.length
    ? data.cards.filter((card) => !state.pinnedIds.includes(card.id) && cq.every((w) => `${card.name} ${card.rarity} ${card.type}`.toLowerCase().includes(w)))
      .sort((a, b) => b.rarity.length - a.rarity.length || a.charName.localeCompare(b.charName) || a.id - b.id)
      .map((card) => ({ card, lb: effectiveLb(inventory, card, settings.defaultLb) ?? settings.defaultLb[card.rarity] })).slice(0, 12)
    : [];
  const activeGain = c.inherited[activeInheritedStat]!;
  return html`
    <section class="panel">
      <h2>Run</h2>
      <label class="row"><span class="k">Scenario</span><span>Our Grand Concert</span></label>
      <h3>Pinned cards</h3>
      <div class="suggest">
        <input id="card-search" type="search" placeholder="Search a support card to pin…" value="${cardQuery}" data-input="cardQuery" style="max-width:100%;width:100%" autocomplete="off" />
        ${cardMatches.length ? html`<ul>${cardMatches.map((p) => html`<li data-action="pin-card" data-id="${p.card.id}"><img src="${cardImg(p.card)}" alt="" />${p.card.name}<span class="r">${p.card.rarity} ${p.card.type} · LB${p.lb}${c.unowned.has(p.card.id) ? ' · not owned' : ''}</span></li>`)}</ul>` : ''}
      </div>
      <div class="chips">
        ${state.pinnedIds.length ? state.pinnedIds.map((id) => { const card = data.cardById.get(id); if (!card) return '';
          const owned = !c.unowned.has(id);
          return html`<span class="chip" title="${owned ? 'Forced into the deck' : 'Marked not owned, so it is skipped'}"><img src="${cardImg(card)}" alt="" />${card.name}${owned ? '' : html` <span class="warn small">not owned</span>`}<button data-action="unpin-card" data-id="${id}" title="Unpin">✕</button></span>`; })
        : html`<span class="muted small">Nothing pinned. Light Hello is mandatory in Grand Concert, so pin one of her cards unless you have a reason not to.</span>`}
      </div>
      ${!lhOptions.length ? html`<div class="small warn">No Light Hello card is marked as owned. She is mandatory in Grand Concert.</div>` : ''}
      <label class="row"><span class="k">Training focus</span>
        <select data-setting="focus">${(['balanced', 'stamina', 'sprint'] as const).map((f) => html`<option value="${f}" ${settings.focus === f ? 'selected' : ''}>${f.charAt(0).toUpperCase() + f.slice(1)}</option>`)}</select></label>
      <label class="row"><span class="k">Win chance threshold</span>
        <span><input type="range" min="0" max="1" step="0.05" value="${settings.winThreshold}" data-setting="winThreshold" /> <output data-setting-output="winThreshold">${pct(settings.winThreshold)}</output></span></label>
      <div class="small muted">Races: ${c.sum.count} G1s selected, ${num(c.sum.expectedWins, 1)} expected wins, ${num(c.sum.expectedLosses, 1)} expected losses.</div>
      <h3>Parent blue sparks</h3>
      <div class="blue-parents">
        ${[0, 1].map((pi) => {
          const stars = state.parentStars[pi]!;
          const total = stars.reduce((a, b) => a + b, 0);
          return html`<section class="blue-parent-card">
            <div class="ph">Parent ${pi + 1} <span class="muted">(<output data-parent-total="${pi}">${total}</output> / ${MAX_PARENT_STARS}★)</span></div>
            ${STATS.map((s, i) => html`<div class="blue-parent-control">
              <div class="blue-parent-heading"><span>${s.charAt(0).toUpperCase() + s.slice(1)}</span><output data-parent-output="${pi}-${i}">${stars[i]}★</output></div>
              <div class="blue-slider">
                <input type="range" min="0" max="${MAX_PARENT_STARS}" step="1" value="${stars[i]}" data-parent="${pi}" data-stat="${i}" aria-label="Parent ${pi + 1} ${s} blue stars" />
                <canvas class="blue-slider-notches" aria-hidden="true"></canvas>
              </div>
            </div>`)}
          </section>`;
        })}
      </div>
      <div class="blue-gain-compact" aria-live="polite">
        <strong>Total gain <output data-inherited-total>+${num(activeGain.total)}</output></strong>
        <span><output data-inherited-start>+${num(activeGain.start)}</output> at start · <output data-inherited-inspiration>+${num(activeGain.inspiration)}</output> from inspiration events</span>
      </div>
      <div class="blue-gain-summary">
        ${STATS.map((s, i) => html`<span class="${i === activeInheritedStat ? 'active' : ''}" data-inherited-stat="${i}">${s.charAt(0).toUpperCase() + s.slice(1)} <output>+${num(c.inherited[i]!.total)}</output></span>`)}
      </div>
      <label class="row"><span class="k">Show cards marked not owned</span><input type="checkbox" data-setting="showUnowned" ${settings.showUnowned ? 'checked' : ''} /></label>
    </section>`;
}

function renderDeck(c: Computed): Raw {
  const d = c.deckResult;
  const p = c.pred;
  return html`
    <section class="panel">
      <h2>Suggested deck</h2>
      ${d.deck.length ? html`<div class="deck">${d.deck.map((cs) => html`
        <div class="slot">
          <img src="${cardImg(cs.card)}" alt="" />
          <div class="name">${cs.card.name}</div>
          <div class="lb">${state.pinnedIds.includes(cs.card.id) ? html`<span class="tag pin">pinned</span>` : ''}${cs.card.rarity} · LB <select data-lb="${cs.card.id}" class="small">${[0, 1, 2, 3, 4].map((l) => html`<option value="${l}" ${cs.lb === l ? 'selected' : ''}>${l}</option>`)}<option value="none">not owned</option></select> ${typeTag(cs.card)}</div>
          <div class="cover">${cs.coverage.filter((x) => x.marginal > 0 || x.spark > 0).map((x) => html`<span class="t" title="${x.sources.map((s) => `${s.detail}: ${pct(s.pObtain)}`).join('\n')}">${x.target.name} ${pill(x.spark)}</span>`)}</div>
        </div>`)}</div>` : html`<div class="muted">No owned cards. Mark cards in the table below.</div>`}
      <h3>Predicted run (deck ${c.sum.count} races, ${settings.focus} focus${c.trainee ? `, ${c.trainee.name}` : ''})</h3>
      <div class="stats">${STATS.map((s, i) => html`
        <div class="stat"><div class="k">${s}</div><div class="v">${num(c.finalMean[i]!)}</div>
          <div class="s">±${num(p.sd[i]!)} · reaches 600 ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, 600))} · 1100 ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, 1100))}</div></div>`)}</div>
      <div class="kv">
        <div><span class="k">Rank score</span><span class="v">${num(c.score)} ± ${num(c.sdScore)}</span></div>
        <div><span class="k">SS or better</span><span class="v">${pill(c.pSS, c.pSS > 0.5 ? 'ok' : 'warn')}</span></div>
        <div><span class="k">Estimated SP</span><span class="v">${num(p.sp)}</span></div>
      </div>
      <details><summary>Where the stats come from</summary>
        ${(() => {
          const scale = raceScale(c.sum.count, data.model, settings);
          const focusMul = data.model.focus[settings.focus] ?? [1, 1, 1, 1, 1];
          const row = (label: Raw | string, vals: number[], cls = '') => html`<tr class="${cls}"><td>${label}</td>${vals.map((v) => html`<td class="num">${num(v)}</td>`)}<td class="num">${num(vals.reduce((a, b) => a + b, 0))}</td></tr>`;
          const cardRows = d.deck.map((cs) => {
            const cc = cardContribution(cs.card, cs.lb, data.model);
            return row(html`<img class="thumb sm" src="${cardImg(cs.card)}" alt="" /> ${cs.card.name} <span class="muted small">(${cc.source === 'model' ? 'model' : `observed${cc.source === 'observed+model' ? ', shifted to LB' + cs.lb : ''}`})</span>`, cc.stats.map((v, i) => v * scale * focusMul[i]!));
          });
          const base = c.trainee?.baseStats ?? [0, 0, 0, 0, 0];
          const penalty = settings.lossPenalty * c.sum.expectedLosses;
          return html`<table class="small"><thead><tr><th>Source</th>${STATS.map((st) => html`<th class="num">${st.slice(0, 3)}</th>`)}<th class="num">total</th></tr></thead><tbody>
            ${cardRows}
            ${row(`Career events and ${c.sum.count} races`, p.eventStats.map((v, i) => v * focusMul[i]!))}
            ${row('Inheritance at the start', c.inherited.map((x) => x.start))}
            ${row('Two inspiration events', c.inherited.map((x) => x.inspiration))}
            ${row(`Base stats${c.trainee ? ` (${c.trainee.name})` : ''}`, base.map((v) => v))}
            ${penalty ? row('Expected race losses', STATS.map(() => -penalty / 5)) : ''}
            ${row(html`<b>Final</b>`, c.finalMean, 'total')}
            ${row('Run-to-run spread (±1 sd)', p.sd)}
          </tbody></table>
          <div class="small muted">Card and career rows include the ${settings.focus} focus multiplier (${focusMul.map((m) => m.toFixed(2)).join(' / ')}) and the race scaling of ×${scale.toFixed(2)} for ${c.sum.count} races vs the 28 the data was measured at. The spread is the standard deviation of total stats between runs of the same trainee and deck in the Loopacord logs; the card model itself has an RMSE of ${data.model.fit.rmse.toFixed(1)} per stat.</div>`;
        })()}
      </details>
      <h3>Target coverage</h3>
      <table><thead><tr><th>Skill</th><th class="num">Ends with gold</th><th class="num">Ends with white</th><th class="num">Spark chance</th><th>Sources</th></tr></thead><tbody>
        ${c.targets.map((t) => {
          const srcs = d.coverage.get(t.id) ?? [];
          let noGold = 1, noAny = 1;
          for (const s of srcs) { noAny *= 1 - s.pObtain; if (s.gold) noGold *= 1 - s.pObtain; }
          const pGold = 1 - noGold, pWhite = Math.max(0, 1 - noAny - pGold);
          const spark = pGold * settings.goldSparkRate + pWhite * settings.whiteSparkRate;
          return html`<tr><td>${t.name}</td><td class="num">${pill(pGold)}</td><td class="num">${pill(pWhite)}</td><td class="num">${pill(spark, spark > 0 ? 'ok' : 'warn')}</td>
            <td class="small" style="white-space:normal">${srcs.length ? srcs.map((s) => `${s.cardName ? s.cardName + ': ' : ''}${skillName(s.skillId)} ${pct(s.pObtain)} (${s.detail})`).join('; ') : html`<span class="warn">no source in deck</span>`}</td></tr>`;
        })}
      </tbody></table>
      <h3>Prioritized skills for the run (up to 10)</h3>
      ${c.wl.length ? html`<ol class="wishlist">${c.wl.map((w) => html`<li>${w.name} ${w.gated ? html`<span class="tag gold">event choice</span>` : html`<span class="tag">filler</span>`} <span class="small muted">${w.reason}</span></li>`)}</ol>` : html`<div class="muted small">Nothing to prioritize yet.</div>`}
      <details><summary>How the deck was built</summary><ol class="small">${d.steps.map((s) => html`<li>${s}</li>`)}</ol></details>
    </section>`;
}

function renderSchedule(c: Computed): Raw {
  const rows = showAllRaces ? c.schedule : c.schedule.filter((s) => s.selected || s.base >= 0.5);
  const YEAR = ['Junior', 'Classic', 'Senior'];
  return html`
    <section class="panel">
      <h2>G1 schedule <span class="small muted">(${c.sum.count} races · threshold ${pct(settings.winThreshold)})</span></h2>
      <div class="scroll" style="max-height:50vh"><table><thead><tr><th>Run</th><th>When</th><th>Race</th><th>Track</th><th class="num">Base win</th><th class="num">Adjusted</th><th>Streak</th></tr></thead><tbody>
        ${rows.map((s) => html`<tr class="${s.selected ? '' : 'dim'}">
          <td><input type="checkbox" data-race="${s.race.calendarId}" ${s.selected ? 'checked' : ''} title="${state.raceOverrides[s.race.calendarId] != null ? 'manual override' : 'automatic'}" /></td>
          <td>${YEAR[s.race.year - 1]} ${s.race.month}/${s.race.half === 1 ? 'early' : 'late'}</td>
          <td>${s.race.name}</td><td>${s.race.surface} ${s.race.category} ${s.race.distance}m</td>
          <td class="num">${pct(s.base)}</td><td class="num">${pct(s.pWin)}</td><td>${s.consecutive > 2 ? html`<span class="warn">${s.consecutive} in a row</span>` : s.consecutive ? `${s.consecutive}` : ''}</td></tr>`)}
      </tbody></table></div>
      <div class="small muted" style="margin-top:6px">
        <button class="small" data-action="toggle-all-races">${showAllRaces ? 'Hide' : 'Show'} low-chance races</button>
        ${Object.keys(state.raceOverrides).length ? html`<button class="small" data-action="reset-races">Clear manual overrides</button>` : ''}
        Win chances from the uma.guide aptitude table with the consecutive-race penalty (3 in a row −10%, 4 −25%, 5 −35%, 6+ −50%).
      </div>
    </section>`;
}

function renderRanking(c: Computed): Raw {
  const keyFns: Record<string, (x: CardScore) => number> = {
    score: (x) => x.marginalValue * 1000 + x.statPower / 1000, spark: (x) => x.sparkValue, stats: (x) => x.statPower, sp: (x) => x.sp,
    speed: (x) => x.stats[0]!, stamina: (x) => x.stats[1]!, power: (x) => x.stats[2]!, guts: (x) => x.stats[3]!, wit: (x) => x.stats[4]!,
  };
  const fn = keyFns[state.sortKey] ?? keyFns.score!;
  const pinRank = (x: CardScore) => { const i = state.pinnedIds.indexOf(x.card.id); return i < 0 ? Infinity : i; };
  const rows = c.ranking.slice().sort((a, b) => pinRank(a) - pinRank(b) || fn(b) - fn(a));
  const th = (k: string, label: string, cls = 'num') => html`<th class="${cls}" data-sort="${k}" style="cursor:pointer">${label}${state.sortKey === k ? ' ▾' : ''}</th>`;
  const marked = Object.keys(inventory).length;
  return html`
    <section class="panel">
      <h2>Card ranking <span class="small muted">(${rows.length} cards · click a header to sort)</span></h2>
      <div class="small muted" style="margin-bottom:6px">Every card counts as owned at the default limit break (R ${settings.defaultLb.R}, SR ${settings.defaultLb.SR}, SSR ${settings.defaultLb.SSR}) until you change it here. ${marked} card${marked === 1 ? '' : 's'} adjusted. Rows in grey are marked not owned.</div>
      <div class="scroll"><table><thead><tr><th></th><th>Card</th><th>LB</th>${th('score', 'Added spark chance')}${th('spark', 'Spark chance alone')}<th>Targets</th>${STATS.map((s) => th(s, s.slice(0, 3)))}${th('stats', 'Total')}${th('sp', 'SP')}<th>Basis</th></tr></thead><tbody>
        ${rows.map((x) => {
          const owned = !c.unowned.has(x.card.id);
          const explicit = inventory[String(x.card.id)] !== undefined;
          return html`<tr class="${owned ? '' : 'dim'}">
            <td><img class="thumb" src="${cardImg(x.card)}" alt="" loading="lazy" /></td>
            <td>${x.card.name}<br/><span class="small">${state.pinnedIds.includes(x.card.id) ? html`<span class="tag pin">pinned</span>` : ''}${x.card.rarity} ${typeTag(x.card)}${c.trainee && c.trainee.charId === x.card.charId ? html`<span class="tag warn">trainee's card</span>` : ''}</span></td>
            <td><select data-lb="${x.card.id}" class="${explicit ? '' : 'muted'}"><option value="none" ${owned ? '' : 'selected'}>not owned</option>${[0, 1, 2, 3, 4].map((l) => html`<option value="${l}" ${owned && x.lb === l ? 'selected' : ''}>${l}${!explicit && x.lb === l ? ' (default)' : ''}</option>`)}</select></td>
            <td class="num"><span class="bar" style="width:${Math.min(60, x.marginalValue * 120)}px"></span> ${pill(x.marginalValue, '', 1)}</td>
            <td class="num">${pill(x.sparkValue, '', 1)}</td>
            <td class="cover">${x.coverage.map((cv) => html`<span class="t" title="${cv.sources.map((s) => `${skillName(s.skillId)} via ${s.detail}: ${pct(s.pObtain)}`).join('\n')}">${cv.target.name} ${pill(cv.spark)}</span>`)}</td>
            ${x.stats.map((v) => html`<td class="num">${num(v)}</td>`)}
            <td class="num"><b>${num(x.statPower)}</b></td><td class="num">${num(x.sp)}</td>
            <td class="small muted">${x.source === 'observed' ? `observed (${x.runs} runs)` : x.source === 'observed+model' ? `observed at another LB` : 'model'}</td>
          </tr>`;
        })}
      </tbody></table></div>
    </section>`;
}

const SETTING_HELP: Partial<Record<keyof Settings, string>> = {
  affinity: 'Legacy affinity score with the parents. Inspiration procs scale by (1 + affinity/100), so 150 (double circle) makes blue sparks proc every time. Default 150 because that is the usual target when picking parents.',
  hintBase: 'Chance per turn that a card standing on a facility shows a hint, before Hint Frequency. Default 0.07 from a 1,024-turn manual-play sample (GameWith measured 6 to 9%).',
  hintScale: 'Multiplier on the whole hint model for independent training, where hint pickup is unmeasured. Default 0.75 so a 0% Hint Frequency card lands near 0.9 hints per run, in line with the 8 hints per deck fujikiseki measured in manual runs.',
  hintTurnsShare: 'Fraction of training turns a given card is on the facility being trained. Default 0.4 as a rough blend of the ~18% appearance rate with the AI favouring facilities where cards are.',
  chainRatesSSR: 'Chance that an SSR card completes chain event 1, 2 and 3 in an independent-training run. Defaults 0.69 / 0.36 / 0.12 from Loopacord counts.',
  chainRatesSR: 'Chance that an SR card completes chain event 1 and 2. Defaults 0.74 / 0.35 from Loopacord counts.',
  randomEventRate: 'Chance a given random event fires during a run. Nobody has measured this, so 0.5 is a placeholder. Cards with more than two random events are scaled so two fire on average.',
  palChainRate: 'Chance a Pal card runs its whole date chain, which hands over the finale skill. Default 0.97: Loopacord saw 100% and See Ya Later! shows up in nearly every logged run.',
  groupOutingRate: 'Chance a Group card member outing happens. Default 0.9, assumed from the Pal chain behaviour; not measured.',
  groupFinaleRate: 'Chance the Group finale (the gold skill) happens. Default 0.85 is a guess; the finale needs every member outing first and nobody has counted it in independent training.',
  specialEventRate: 'Chance of the Pal/Group unlock and New Year events. Default 0 because Loopacord never saw the New Year event in independent training.',
  bigRewardRate: 'When an event outcome splits into a small and a big reward, the chance of the big one. Default 0.3, your estimate.',
  goldSparkRate: 'Chance a skill you own as gold becomes a white spark at run end. Default 0.4 from the mechanics document.',
  whiteSparkRate: 'Chance a skill you own as white becomes a white spark at run end. Default 0.2 from the mechanics document.',
  ssStarOdds: 'White spark 1★ / 2★ / 3★ odds when the run ends SS or better. Defaults 0.2 / 0.7 / 0.1 from the mechanics document and uma.guide.',
  belowSsStarOdds: 'White spark star odds below SS. Defaults 0.45 / 0.5 / 0.05 from uma.guide.',
  lossPenalty: 'Total stat points removed per expected race loss, spread over the five stats. Default 0 because the effect of losses and conditions like Skin Outbreak has not been measured.',
  skillScorePerSp: 'Rank-score points bought per skill point at the end of the run. Default 1.4: a white skill is 217 points for about 150 SP after hint discounts.',
  skillScoreSd: 'Uncertainty (standard deviation) of the skill part of the rank score. Default 400, roughly two skills either way.',
  totalTurnsOverride: 'Total career turns used to scale card stats by races run. Blank uses the fitted 71.7 from decks run at 28 and 23 races.',
};

function renderSettingsPanel(): Raw {
  const help = (key: keyof Settings) => SETTING_HELP[key] ?? '';
  const numField = (key: keyof Settings, label: string, step = 0.01, extra = '') => html`<label class="row" title="${help(key)}"><span class="k">${label}</span><input type="number" step="${step}" value="${String(settings[key] ?? '')}" data-setting="${key}" style="width:90px" placeholder="${extra}" title="${help(key)}" /></label>`;
  const listField = (key: keyof Settings, label: string) => html`<label class="row" title="${help(key)}"><span class="k">${label}</span><input type="text" value="${(settings[key] as number[]).join(', ')}" data-setting-list="${key}" style="width:140px" title="${help(key)}" /></label>`;
  return html`
    <section class="panel">
      <h2>Inventory &amp; settings</h2>
      <div class="kv">
        <button data-action="export">Export inventory.json</button>
        <label><button data-action="import-click">Import inventory.json</button><input type="file" id="import-file" accept="application/json" style="display:none" /></label>
        ${Object.keys(inventory).length ? html`<button data-action="reset-inventory">Reset all to defaults</button>` : ''}
        <span class="small muted">Replace the repo's inventory.json with the export to make it the default.</span>
      </div>
      <details ${showAdvanced ? 'open' : ''} data-details="advanced"><summary>Advanced settings</summary>
        <div class="small muted" style="margin:6px 0">These numbers override the tool's estimates. Each one is a rate or scale the model needs but the game does not tell us; the defaults come from community measurements where they exist and from guesses where they do not. Hover a field for what it does and why the default is what it is.</div>
        <h3>Rates</h3>
        <div class="grid2 settings-grid">
          ${numField('affinity', 'Legacy affinity (inspiration proc scaling)', 1)}
          ${numField('hintBase', 'Hint chance per card-turn (base)')}
          ${numField('hintScale', 'Hint model scale (independent training)')}
          ${numField('hintTurnsShare', 'Share of turns a card is on a facility')}
          ${listField('chainRatesSSR', 'SSR chain 1/2/3 completion')}
          ${listField('chainRatesSR', 'SR chain 1/2 completion')}
          ${numField('randomEventRate', 'Random event fires')}
          ${numField('palChainRate', 'Pal date chain completes')}
          ${numField('groupOutingRate', 'Group member outing happens')}
          ${numField('groupFinaleRate', 'Group finale happens (unverified)')}
          ${numField('specialEventRate', 'Pal/Group unlock and New Year events')}
          ${numField('bigRewardRate', 'Big reward chance (split outcomes)')}
          ${numField('goldSparkRate', 'Spark chance with gold skill')}
          ${numField('whiteSparkRate', 'Spark chance with white skill')}
          ${listField('ssStarOdds', 'White star odds at SS (1/2/3★)')}
          ${listField('belowSsStarOdds', 'White star odds below SS')}
          ${numField('lossPenalty', 'Stat points lost per expected race loss', 1)}
          ${numField('skillScorePerSp', 'Rank points per SP (skills bought)')}
          ${numField('skillScoreSd', 'Rank score sd from skills', 10)}
          ${numField('totalTurnsOverride', 'Total turns (blank = fitted)', 1, String(data.model.races.totalTurns.toFixed(1)))}
        </div>
        <button class="small" data-action="reset-settings">Reset advanced settings</button>
        <div class="small muted" style="margin-top:8px">Model fit: ${data.model.fit.n} card-stat observations, RMSE ${data.model.fit.rmse.toFixed(1)}, R² ${data.model.fit.r2.toFixed(3)}. Floor ${data.model.floor} per stat, ${data.model.observed.length} observed card rows.</div>
      </details>
    </section>`;
}

function render() {
  const c = compute();
  const active = document.activeElement as HTMLInputElement | null;
  const activeId = active?.id; const sel = active?.selectionStart ?? null;
  const app = document.getElementById('app')!;
  app.innerHTML = html`
    <header><h1>Uma parent deck</h1><span class="meta">Independent training deck builder for white-spark farming · data ${String(meta.fetchedAt).slice(0, 10)} from GameTora · ${data.cards.length} Global cards</span></header>
    <main>
      <div>${renderTargets(c)}${renderTrainee(c)}${renderRunSettings(c)}${renderSettingsPanel()}</div>
      <div>${renderDeck(c)}${renderSchedule(c)}${renderRanking(c)}</div>
    </main>
    <div class="footer">Card, skill, character and race data from <a href="https://gametora.com">GameTora</a>. Independent training stat model fitted on the Loopacord research sheet and cross-checked with fujikiseki.xyz. Game assets belong to Cygames; this is a personal tool.</div>`.s;
  notchObserver.disconnect();
  for (const canvas of app.querySelectorAll<HTMLCanvasElement>('.blue-slider-notches')) {
    drawBlueSliderNotches(canvas);
    notchObserver.observe(canvas);
  }
  if (activeId) {
    const el = document.getElementById(activeId) as HTMLInputElement | null;
    if (el) { el.focus(); if (sel != null && el.type === 'search') try { el.setSelectionRange(sel, sel); } catch { /* ignore */ } }
  }
}

// ---------- events ----------
const app = document.getElementById('app')!;
app.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.input === 'query') { query = el.value; render(); return; }
  if (el.dataset.input === 'traineeQuery') { traineeQuery = el.value; render(); return; }
  if (el.dataset.input === 'cardQuery') { cardQuery = el.value; render(); return; }
  if (el.dataset.setting === 'winThreshold') {
    const output = app.querySelector<HTMLOutputElement>('output[data-setting-output="winThreshold"]');
    if (output) output.value = pct(Number(el.value));
    return;
  }
  if (el.dataset.parent != null) { const pi = Number(el.dataset.parent), i = Number(el.dataset.stat); const next = state.parentStars[pi]!.slice(); next[i] = Number(el.value);
    activeInheritedStat = i;
    const preview = clampStars(next, i, MAX_PARENT_STARS);
    el.value = String(preview[i]);
    const output = app.querySelector<HTMLOutputElement>(`output[data-parent-output="${pi}-${i}"]`);
    if (output) output.value = `${preview[i]}★`;
    const total = app.querySelector<HTMLOutputElement>(`output[data-parent-total="${pi}"]`);
    if (total) total.value = String(preview.reduce((sum, stars) => sum + stars, 0));
    const previewParents = state.parentStars.map((parent, parentIndex) => parentIndex === pi ? preview : parent);
    const inherited = inheritedFromParents(previewParents, i, settings);
    for (const summary of app.querySelectorAll<HTMLElement>('[data-inherited-stat]')) summary.classList.toggle('active', Number(summary.dataset.inheritedStat) === i);
    const summaryOutput = app.querySelector<HTMLOutputElement>(`[data-inherited-stat="${i}"] output`);
    if (summaryOutput) summaryOutput.value = `+${num(inherited.total)}`;
    const setGain = (selector: string, value: string) => { const output = app.querySelector<HTMLOutputElement>(`.blue-gain-compact ${selector}`); if (output) output.value = value; };
    setGain('[data-inherited-total]', `+${num(inherited.total)}`);
    setGain('[data-inherited-start]', `+${num(inherited.start)}`);
    setGain('[data-inherited-inspiration]', `+${num(inherited.inspiration)}`);
    return; }
});
app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement & HTMLSelectElement;
  if (el.dataset.parent != null) { const pi = Number(el.dataset.parent), i = Number(el.dataset.stat); const next = state.parentStars[pi]!.slice(); next[i] = Number(el.value);
    state.parentStars = state.parentStars.map((p, j) => (j === pi ? clampStars(next, i, MAX_PARENT_STARS) : p)); persist(); render(); return; }
  if (el.dataset.apt) { const k = el.dataset.apt as AptKey; const t = state.traineeCardId != null ? data.charByCardId.get(state.traineeCardId) : null;
    if (t && t.aptitudes[k] === el.value) delete state.aptOverrides[k]; else state.aptOverrides[k] = el.value as Grade; persist(); render(); return; }
  if (el.dataset.race) { const id = el.dataset.race; const c = compute(); const auto = c.schedule.find((s) => s.race.calendarId === id);
    const autoSel = auto ? auto.pWin >= settings.winThreshold : false;
    if (el.checked === autoSel) delete state.raceOverrides[id]; else state.raceOverrides[id] = el.checked; persist(); render(); return; }
  if (el.dataset.lb != null) { const id = el.dataset.lb; const card = data.cardById.get(Number(id));
    if (el.value === 'none') inventory[id] = null;
    else if (card && Number(el.value) === settings.defaultLb[card.rarity]) delete inventory[id];
    else inventory[id] = Number(el.value);
    persist(); render(); return; }
  if (el.dataset.setting) {
    const key = el.dataset.setting as keyof Settings;
    const cur = settings[key];
    let v: unknown;
    if ((el as HTMLInputElement).type === 'checkbox') v = (el as HTMLInputElement).checked;
    else if (key === 'totalTurnsOverride') v = el.value === '' ? null : Number(el.value);
    else if (typeof cur === 'number' || cur === null) v = Number(el.value);
    else v = el.value;
    (settings as unknown as Record<string, unknown>)[key] = v; persist(); render(); return;
  }
  if (el.dataset.settingList) {
    const key = el.dataset.settingList as keyof Settings;
    const arr = el.value.split(/[,\s]+/).filter(Boolean).map(Number).filter((x) => !Number.isNaN(x));
    (settings as unknown as Record<string, unknown>)[key] = arr; persist(); render(); return;
  }
  if (el.id === 'import-file' && el.files?.[0]) {
    importInventory(el.files[0]).then((inv) => { inventory = inv; persist(); render(); }).catch((e) => alert(`Import failed: ${e}`));
  }
});
app.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-action],[data-sort]');
  if (!t) return;
  if (t.dataset.sort) { state.sortKey = t.dataset.sort; persist(); render(); return; }
  const a = t.dataset.action;
  if (a === 'add-target') { const id = Number(t.dataset.id); const fam = resolveTarget(id, data); const base = fam?.id ?? id;
    if (!state.targets.includes(base)) state.targets.push(base); query = ''; persist(); render(); return; }
  if (a === 'pick-trainee') { state.traineeCardId = Number(t.dataset.id); state.aptOverrides = {}; traineeQuery = ''; persist(); render(); return; }
  if (a === 'pin-card') { const id = Number(t.dataset.id); if (!state.pinnedIds.includes(id)) state.pinnedIds.push(id); cardQuery = ''; persist(); render(); return; }
  if (a === 'unpin-card') { state.pinnedIds = state.pinnedIds.filter((x) => x !== Number(t.dataset.id)); persist(); render(); return; }
  if (a === 'clear-trainee') { state.traineeCardId = null; state.aptOverrides = {}; persist(); render(); return; }
  if (a === 'remove-target') { state.targets = state.targets.filter((x) => x !== Number(t.dataset.id)); persist(); render(); return; }
  if (a === 'reset-apts') { state.aptOverrides = {}; persist(); render(); return; }
  if (a === 'reset-races') { state.raceOverrides = {}; persist(); render(); return; }
  if (a === 'toggle-all-races') { showAllRaces = !showAllRaces; render(); return; }
  if (a === 'export') { exportInventory(inventory, data.cards, settings.defaultLb); return; }
  if (a === 'import-click') { (document.getElementById('import-file') as HTMLInputElement).click(); return; }
  if (a === 'reset-inventory') { if (confirm('Clear every card adjustment and go back to the defaults?')) { inventory = {}; persist(); render(); } return; }
  if (a === 'reset-settings') { const keep = { winThreshold: settings.winThreshold, focus: settings.focus, showUnowned: settings.showUnowned, defaultLb: settings.defaultLb };
    settings = { ...DEFAULT_SETTINGS, ...keep }; persist(); render(); return; }
});
app.addEventListener('toggle', (ev) => { const el = ev.target as HTMLDetailsElement; if (el.dataset.details === 'advanced') showAdvanced = el.open; }, true);

render();
