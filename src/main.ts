import { loadData } from './data.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings.ts';
import { effectiveLb, exportInventory, importInventory, loadInventory, saveInventory } from './inventory.ts';
import { html, pct, pill, num, type Raw } from './ui/html.ts';
import { STATS, type AptKey, type Card, type Character, type Grade, type Inventory, type Skill } from './types.ts';
import { buildDeck, rankCards, traineeCoverage, wishlist, type CardScore, type Ctx } from './model/deck.ts';
import { resolveTarget, whiteStarOdds, type Target } from './model/sparks.ts';
import { blueStarOdds, pAbove, predictDeck, phi } from './model/stats.ts';
import { buildSchedule, scheduleSummary, traineeAptitudes, type Aptitudes } from './model/races.ts';
import { skillScore, statScore, thresholdFor } from './model/rank.ts';
import { clampStars, inheritedStat, MAX_BLUE_STARS } from './model/inherit.ts';
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
  pinnedId: number | null;
  blueStars: number[];
  sortKey: string;
}
const STATE_KEY = 'uma-parent-deck.state';
function loadState(): PersistedState {
  const base: PersistedState = { targets: [], traineeCardId: null, aptOverrides: {}, raceOverrides: {}, pinnedId: null, blueStars: [9, 3, 3, 3, 0], sortKey: 'score' };
  try { const raw = localStorage.getItem(STATE_KEY); if (raw) return { ...base, ...JSON.parse(raw) }; } catch { /* ignore */ }
  return base;
}
const state = loadState();
let settings: Settings = loadSettings();
let inventory: Inventory = loadInventory();
let query = '';
let showAdvanced = false;
let showAllRaces = false;

const persist = () => { localStorage.setItem(STATE_KEY, JSON.stringify(state)); saveSettings(settings); saveInventory(inventory); };

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
  let pinnedId = state.pinnedId != null && deckPool.some((p) => p.card.id === state.pinnedId) ? state.pinnedId : null;
  if (pinnedId == null) {
    const lh = deckPool.filter((p) => LIGHT_HELLO_IDS.includes(p.card.id)).sort((a, b) => b.card.rarity.length - a.card.rarity.length || b.lb - a.lb)[0];
    pinnedId = lh?.card.id ?? null;
  }
  const deckResult = buildDeck(deckPool, targets, ctx, pinnedId != null ? [pinnedId] : []);
  const pred = predictDeck(deckResult.deck.map((d) => ({ card: d.card, lb: d.lb })), trainee, sum.count, settings.focus, sum.expectedLosses, data.model, settings);
  const inherited = state.blueStars.map((st) => inheritedStat(st, settings));
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
  return { trainee, apt, schedule, sum, ctx, targets, pool, unowned, ranking, deckResult, pred, inherited, finalMean, score, sdScore, pSS, ssMin, wl, existing, pinnedId };
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
  const chars = data.characters.slice().sort((a, b) => a.name.localeCompare(b.name) || a.cardId - b.cardId);
  const t = c.trainee;
  const overridden = Object.keys(state.aptOverrides).length > 0;
  return html`
    <section class="panel">
      <h2>Trainee</h2>
      <label class="row"><span class="k">Uma</span>
        <select data-select="trainee" style="max-width:240px">
          <option value="">— none —</option>
          ${chars.map((ch) => html`<option value="${ch.cardId}" ${ch.cardId === state.traineeCardId ? 'selected' : ''}>${ch.name} ${ch.title}</option>`)}
        </select></label>
      ${t ? html`
        <div class="kv">
          <img class="thumb" src="${charImg(t)}" alt="" style="width:48px;height:48px" />
          <div><span class="k">Growth</span><span class="v small">${STATS.map((s, i) => `${s} ${t.growth[i]! > 0 ? '+' + t.growth[i] + '%' : '–'}`).join(' · ')}</span></div>
        </div>
        <div class="small muted">Aptitudes: ${APT_SHOWN.map((k) => `${k} ${c.apt[k]}`).join(' · ')}${overridden ? ' (overridden in advanced settings)' : ''}</div>
        <div class="small muted" style="margin-top:6px">Innate: ${t.innateSkills.map(skillName).join(', ')}<br/>Awakening: ${t.awakeningSkills.map(skillName).join(', ')}</div>
      ` : html`<div class="small muted">Pick the uma you'll train. Her own support cards are excluded from the deck and her innate skills count as covered.</div>`}
    </section>`;
}

function renderRunSettings(c: Computed): Raw {
  const lhOptions = c.pool.filter((p) => LIGHT_HELLO_IDS.includes(p.card.id) && !c.unowned.has(p.card.id));
  const totalStars = state.blueStars.reduce((a, b) => a + b, 0);
  return html`
    <section class="panel">
      <h2>Run</h2>
      <label class="row"><span class="k">Scenario</span><span>Our Grand Concert</span></label>
      <label class="row"><span class="k">Pinned scenario card</span>
        <select data-select="pinned">
          <option value="">— auto —</option>
          ${lhOptions.map((p) => html`<option value="${p.card.id}" ${p.card.id === c.pinnedId ? 'selected' : ''}>${p.card.name} ${p.card.rarity} (LB${p.lb})</option>`)}
        </select></label>
      ${!lhOptions.length ? html`<div class="small warn">No Light Hello card is marked as owned. She is mandatory in Grand Concert.</div>` : ''}
      <label class="row"><span class="k">Training focus</span>
        <select data-setting="focus">${(['balanced', 'stamina', 'sprint'] as const).map((f) => html`<option value="${f}" ${settings.focus === f ? 'selected' : ''}>${f}</option>`)}</select></label>
      <label class="row"><span class="k">Win chance threshold</span>
        <span><input type="range" min="0" max="1" step="0.05" value="${settings.winThreshold}" data-setting="winThreshold" /> <output data-setting-output="winThreshold">${pct(settings.winThreshold)}</output></span></label>
      <div class="small muted">Races: ${c.sum.count} G1s selected, ${num(c.sum.expectedWins, 1)} expected wins, ${num(c.sum.expectedLosses, 1)} expected losses.</div>
      <h3>Parent blue sparks <span class="muted" style="text-transform:none">(<output data-blue-total>${totalStars}</output> / ${MAX_BLUE_STARS} stars)</span></h3>
      ${STATS.map((s, i) => html`<div class="spark-row"><span class="muted">${s}</span>
        <input type="range" min="0" max="${MAX_BLUE_STARS}" step="1" value="${state.blueStars[i]}" data-blue="${i}" /><output data-blue-output="${i}">${state.blueStars[i]}★</output>
        <span class="g">+${num(c.inherited[i]!.start)} at start, +${num(c.inherited[i]!.inspiration)} from inspiration events</span></div>`)}
      <div class="small muted">Stars across the two parents and four grandparents, capped at ${MAX_BLUE_STARS}. Each 3★ spark gives +21 at the start (2★ +12, 1★ +5) and the same again at each of the two inspiration events when it procs (70/80/90% by stars, scaled by affinity ${settings.affinity}).</div>
      <label class="row"><span class="k">Show cards marked not owned</span><input type="checkbox" data-setting="showUnowned" ${settings.showUnowned ? 'checked' : ''} /></label>
    </section>`;
}

function renderDeck(c: Computed): Raw {
  const d = c.deckResult;
  const p = c.pred;
  const starsBlue = STATS.map((_, i) => blueStarOdds(c.finalMean[i]!, p.sd[i]!));
  const starsWhite = whiteStarOdds(c.pSS, settings);
  const inheritedTotal = c.inherited.reduce((a, x) => a + x.total, 0);
  return html`
    <section class="panel">
      <h2>Suggested deck</h2>
      ${d.deck.length ? html`<div class="deck">${d.deck.map((cs) => html`
        <div class="slot">
          <img src="${cardImg(cs.card)}" alt="" />
          <div class="name">${cs.card.name}</div>
          <div class="lb">${cs.card.rarity} · LB <select data-lb="${cs.card.id}" class="small">${[0, 1, 2, 3, 4].map((l) => html`<option value="${l}" ${cs.lb === l ? 'selected' : ''}>${l}</option>`)}<option value="none">not owned</option></select> ${typeTag(cs.card)}</div>
          <div class="cover">${cs.coverage.filter((x) => x.marginal > 0 || x.spark > 0).map((x) => html`<span class="t" title="${x.sources.map((s) => `${s.detail}: ${pct(s.pObtain)}`).join('\n')}">${x.target.name} ${pill(x.spark, x.own.pGold > 0 ? 'gold' : '')}</span>`)}</div>
        </div>`)}</div>` : html`<div class="muted">No owned cards. Mark cards in the table below.</div>`}
      <h3>Predicted run (deck ${c.sum.count} races, ${settings.focus} focus${c.trainee ? `, ${c.trainee.name}` : ''})</h3>
      <div class="stats">${STATS.map((s, i) => html`
        <div class="stat"><div class="k">${s}</div><div class="v">${num(c.finalMean[i]!)}</div>
          <div class="s">±${num(p.sd[i]!)} · reaches 600 ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, 600))} · 1100 ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, 1100))}</div>
          <div class="s">blue spark 1★ ${pill(starsBlue[i]![0]!)} 2★ ${pill(starsBlue[i]![1]!)} 3★ ${pill(starsBlue[i]![2]!)}</div></div>`)}</div>
      <div class="kv">
        <div><span class="k">Rank score</span><span class="v">${num(c.score)} ± ${num(c.sdScore)}</span></div>
        <div><span class="k">SS or better</span><span class="v">${pill(c.pSS, c.pSS > 0.5 ? 'ok' : 'warn')}</span></div>
        <div><span class="k">White spark stars</span><span class="v">1★ ${pill(starsWhite[0]!)} 2★ ${pill(starsWhite[1]!)} 3★ ${pill(starsWhite[2]!)}</span></div>
        <div><span class="k">Estimated SP</span><span class="v">${num(p.sp)}</span></div>
        <div><span class="k">Card / event / inherited stats</span><span class="v">${num(p.cardStats.reduce((a, b) => a + b, 0))} / ${num(p.eventStats.reduce((a, b) => a + b, 0))} / ${num(inheritedTotal)}</span></div>
      </div>
      <div class="small muted">Blue spark stars depend on each stat's final value (a stat at 1100+ is rated SS on its own). White spark stars depend on the overall SS rank. Gold-tinted chances mean a gold version of the skill is in reach. Final stats include base stats and parent blue sparks with both inspiration events.</div>
      <h3>Target coverage</h3>
      <table><thead><tr><th>Skill</th><th class="num">Ends with gold</th><th class="num">Ends with white</th><th class="num">Spark chance</th><th>Sources</th></tr></thead><tbody>
        ${c.targets.map((t) => {
          const srcs = d.coverage.get(t.id) ?? [];
          let noGold = 1, noAny = 1;
          for (const s of srcs) { noAny *= 1 - s.pObtain; if (s.gold) noGold *= 1 - s.pObtain; }
          const pGold = 1 - noGold, pWhite = Math.max(0, 1 - noAny - pGold);
          const spark = pGold * settings.goldSparkRate + pWhite * settings.whiteSparkRate;
          return html`<tr><td>${t.name}</td><td class="num">${pill(pGold, pGold > 0 ? 'gold' : '')}</td><td class="num">${pill(pWhite)}</td><td class="num">${pill(spark, spark > 0 ? 'ok' : 'warn')}</td>
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
  const rows = c.ranking.slice().sort((a, b) => fn(b) - fn(a));
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
            <td>${x.card.name}<br/><span class="small">${x.card.rarity} ${typeTag(x.card)}${c.trainee && c.trainee.charId === x.card.charId ? html`<span class="tag warn">trainee's card</span>` : ''}</span></td>
            <td><select data-lb="${x.card.id}" class="${explicit ? '' : 'muted'}"><option value="none" ${owned ? '' : 'selected'}>not owned</option>${[0, 1, 2, 3, 4].map((l) => html`<option value="${l}" ${owned && x.lb === l ? 'selected' : ''}>${l}${!explicit && x.lb === l ? ' (default)' : ''}</option>`)}</select></td>
            <td class="num"><span class="bar" style="width:${Math.min(60, x.marginalValue * 120)}px"></span> ${pill(x.marginalValue, '', 1)}</td>
            <td class="num">${pill(x.sparkValue, '', 1)}</td>
            <td class="cover">${x.coverage.map((cv) => html`<span class="t" title="${cv.sources.map((s) => `${skillName(s.skillId)} via ${s.detail}: ${pct(s.pObtain)}`).join('\n')}">${cv.target.name} ${pill(cv.spark, cv.own.pGold > 0 ? 'gold' : '')}</span>`)}</td>
            ${x.stats.map((v) => html`<td class="num">${num(v)}</td>`)}
            <td class="num"><b>${num(x.statPower)}</b></td><td class="num">${num(x.sp)}</td>
            <td class="small muted">${x.source === 'observed' ? `observed (${x.runs} runs)` : x.source === 'observed+model' ? `observed at another LB` : 'model'}</td>
          </tr>`;
        })}
      </tbody></table></div>
    </section>`;
}

function renderSettingsPanel(c: Computed): Raw {
  const numField = (key: keyof Settings, label: string, step = 0.01, extra = '') => html`<label class="row"><span class="k">${label}</span><input type="number" step="${step}" value="${String(settings[key] ?? '')}" data-setting="${key}" style="width:90px" placeholder="${extra}" /></label>`;
  const listField = (key: keyof Settings, label: string) => html`<label class="row"><span class="k">${label}</span><input type="text" value="${(settings[key] as number[]).join(', ')}" data-setting-list="${key}" style="width:140px" /></label>`;
  const t = c.trainee;
  return html`
    <section class="panel">
      <h2>Inventory &amp; settings</h2>
      <div class="kv">
        <button data-action="export">Export inventory.json</button>
        <label><button data-action="import-click">Import inventory.json</button><input type="file" id="import-file" accept="application/json" style="display:none" /></label>
        ${Object.keys(inventory).length ? html`<button data-action="reset-inventory">Reset all to defaults</button>` : ''}
        <span class="small muted">Replace the repo's inventory.json with the export to make it the default.</span>
      </div>
      <h3>Default limit break for unmarked cards</h3>
      <div class="grid2">${(['R', 'SR', 'SSR'] as const).map((r) => html`<label class="row"><span class="k">${r}</span><select data-default-lb="${r}">${[0, 1, 2, 3, 4].map((l) => html`<option value="${l}" ${settings.defaultLb[r] === l ? 'selected' : ''}>${l}</option>`)}</select></label>`)}</div>
      <details ${showAdvanced ? 'open' : ''} data-details="advanced"><summary>Advanced estimates</summary>
        ${t ? html`<h3>Trainee aptitude overrides (match the legacy screen)</h3>
          <div class="apts">${APT_SHOWN.map((k) => html`<label>${k}<select data-apt="${k}">${GRADES.map((g) => html`<option value="${g}" ${c.apt[k] === g ? 'selected' : ''}>${g}</option>`)}</select></label>`)}</div>
          ${Object.keys(state.aptOverrides).length ? html`<button class="small" data-action="reset-apts">Reset to base aptitudes</button>` : ''}` : ''}
        <h3>Rates</h3>
        <div class="grid2">
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
      <div>${renderTargets(c)}${renderTrainee(c)}${renderRunSettings(c)}${renderSettingsPanel(c)}</div>
      <div>${renderDeck(c)}${renderSchedule(c)}${renderRanking(c)}</div>
    </main>
    <div class="footer">Card, skill, character and race data from <a href="https://gametora.com">GameTora</a>. Independent training stat model fitted on the Loopacord research sheet and cross-checked with fujikiseki.xyz. Game assets belong to Cygames; this is a personal tool.</div>`.s;
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
  if (el.dataset.setting === 'winThreshold') {
    const output = app.querySelector<HTMLOutputElement>('output[data-setting-output="winThreshold"]');
    if (output) output.value = pct(Number(el.value));
    return;
  }
  if (el.dataset.blue != null) { const i = Number(el.dataset.blue); const next = state.blueStars.slice(); next[i] = Number(el.value);
    const preview = clampStars(next, i);
    el.value = String(preview[i]);
    const output = app.querySelector<HTMLOutputElement>(`output[data-blue-output="${i}"]`);
    if (output) output.value = `${preview[i]}★`;
    const total = app.querySelector<HTMLOutputElement>('output[data-blue-total]');
    if (total) total.value = String(preview.reduce((sum, stars) => sum + stars, 0));
    return; }
});
app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement & HTMLSelectElement;
  if (el.dataset.blue != null) { const i = Number(el.dataset.blue); const next = state.blueStars.slice(); next[i] = Number(el.value);
    state.blueStars = clampStars(next, i); persist(); render(); return; }
  if (el.dataset.select === 'trainee') { state.traineeCardId = el.value ? Number(el.value) : null; state.aptOverrides = {}; persist(); render(); return; }
  if (el.dataset.select === 'pinned') { state.pinnedId = el.value ? Number(el.value) : null; persist(); render(); return; }
  if (el.dataset.apt) { const k = el.dataset.apt as AptKey; const t = state.traineeCardId != null ? data.charByCardId.get(state.traineeCardId) : null;
    if (t && t.aptitudes[k] === el.value) delete state.aptOverrides[k]; else state.aptOverrides[k] = el.value as Grade; showAdvanced = true; persist(); render(); return; }
  if (el.dataset.race) { const id = el.dataset.race; const c = compute(); const auto = c.schedule.find((s) => s.race.calendarId === id);
    const autoSel = auto ? auto.pWin >= settings.winThreshold : false;
    if (el.checked === autoSel) delete state.raceOverrides[id]; else state.raceOverrides[id] = el.checked; persist(); render(); return; }
  if (el.dataset.lb != null) { const id = el.dataset.lb; const card = data.cardById.get(Number(id));
    if (el.value === 'none') inventory[id] = null;
    else if (card && Number(el.value) === settings.defaultLb[card.rarity]) delete inventory[id];
    else inventory[id] = Number(el.value);
    persist(); render(); return; }
  if (el.dataset.defaultLb) { settings.defaultLb = { ...settings.defaultLb, [el.dataset.defaultLb]: Number(el.value) }; persist(); render(); return; }
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
