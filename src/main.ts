import { loadData } from './data.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings.ts';
import { effectiveLb, exportInventory, importInventory, loadInventory, saveInventory } from './inventory.ts';
import { html, pct, pill, num, type Raw } from './ui/html.ts';
import { STATS, type AptKey, type Card, type Character, type Grade, type Inventory, type Skill } from './types.ts';
import { buildDeck, rankCards, traineeCoverage, wishlistCandidates, type CardScore, type Ctx, type WishlistEntry } from './model/deck.ts';
import { resolveTarget, sparkChance, type Lineage, type Target } from './model/sparks.ts';
import { cardContribution, pAbove, predictDeck, phi, raceScale } from './model/stats.ts';
import { buildSchedule, racePopularity, scheduleSummary, traineeAptitudes, SLOT_COUNT, type Aptitudes, type ScheduledRace } from './model/races.ts';
import { skillScore, statScore, thresholdFor } from './model/rank.ts';
import { clampStars, inheritedFromParents, MAX_PARENT_STARS } from './model/inherit.ts';
import meta from '../data/meta.json';

const data = loadData();
const LIGHT_HELLO_IDS = data.cards.filter((c) => c.charName === 'Light Hello').map((c) => c.id);
const GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
const RACE_POPULARITY = new Map(data.races.map((r) => [r.raceId, racePopularity(r, data.characters)]));
const APT_SHOWN: AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long'];

interface PersistedState {
  targets: number[];
  targetLineage: Record<string, Lineage>; // target id -> existing lineage sparks
  wishlistOrder: number[];    // skill ids the user arranged, in order
  wishlistExcluded: number[]; // skill ids the user removed from the list
  traineeCardId: number | null;
  aptOverrides: Partial<Aptitudes>;
  raceOverrides: Record<string, boolean>;
  pinnedIds: number[];       // support cards forced into the deck, in order
  parentStars: number[][]; // [parent 1, parent 2], five stats each, up to 9 stars per parent
  sortKey: string;
}
const STATE_KEY = 'uma-parent-deck.state';
function loadState(): PersistedState {
  const base: PersistedState = { targets: [], targetLineage: {}, wishlistOrder: [], wishlistExcluded: [], traineeCardId: null, aptOverrides: {}, raceOverrides: {}, pinnedIds: [], parentStars: [[9, 0, 0, 0, 0], [0, 3, 3, 3, 0]], sortKey: 'score' };
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<PersistedState> & { blueStars?: number[]; pinnedId?: number | null };
      const merged = { ...base, ...saved };
      if (!saved.pinnedIds) merged.pinnedIds = saved.pinnedId != null ? [saved.pinnedId] : defaultPins();
      // lineage used to be {n, stars}; now {n, p1, p2} star totals per parent side
      for (const [k, v] of Object.entries(merged.targetLineage ?? {})) {
        const old = v as unknown as { n: number; stars?: number; p1?: number; p2?: number };
        if (old.p1 == null) merged.targetLineage[k] = { n: old.n, p1: Math.min(9, (old.stars ?? 3) * Math.ceil(old.n / 2)), p2: Math.min(9, (old.stars ?? 3) * Math.floor(old.n / 2)) };
      }
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
type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'uma-parent-deck.theme';
let theme: Theme = (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'system';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = theme === 'dark' || (theme === 'system' && systemDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
systemDark.addEventListener('change', applyTheme);
applyTheme();
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
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#aeb6c1';
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
/** Info icon that opens a custom tooltip on hover or focus. */
const tip = (text: string) => html`<span class="tip" tabindex="0" data-tip="${text}" aria-label="${text}">i</span>`;
const cardUrl = (c: Card) => `https://gametora.com/umamusume/supports/${c.urlName}`;
const cardLink = (c: Card) => html`<a class="card-link" href="${cardUrl(c)}" target="_blank" rel="noopener">${c.name}</a>`;
const cardThumb = (c: Card, cls = 'thumb') => html`<a href="${cardUrl(c)}" target="_blank" rel="noopener"><img class="${cls}" src="${cardImg(c)}" alt="" loading="lazy" /></a>`;
const TYPE_ICON: Record<string, { bg: string; path: string }> = {
  speed:   { bg: '#4a8ef0', path: 'M7 4h5v6l4 2v3H6v-3l1-2z' },                              // boot
  stamina: { bg: '#f0564e', path: 'M10 17l-5.5-5.5a3.2 3.2 0 0 1 4.5-4.5l1 1 1-1a3.2 3.2 0 0 1 4.5 4.5z' }, // heart
  power:   { bg: '#f09a2e', path: 'M4 12c2-4 5-6 8-6 2 0 4 1 4 3s-2 3-4 3l-1 3H7z' },        // flexed arm
  guts:    { bg: '#f05d9c', path: 'M10 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-7z' }, // flame
  wit:     { bg: '#2eb86e', path: 'M10 5l7 3-7 3-7-3zm-4 4.5v3c0 1.5 2 2.5 4 2.5s4-1 4-2.5v-3l-4 1.7z' }, // cap
  pal:     { bg: '#f2b53a', path: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-2.5 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM6.5 12h7c-.5 1.5-2 2.5-3.5 2.5S7 13.5 6.5 12z' }, // smiley
  group:   { bg: '#5fbf7a', path: 'M7 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm6 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2 17c0-2.5 2.5-4 5-4s5 1.5 5 4zm8.5 0c.3-1.5 1.5-2.6 2.5-3 1.8 0 4 1.3 4 3z' }, // two heads
};
const typeIcon = (c: Card) => { const t = TYPE_ICON[c.type] ?? TYPE_ICON.pal!; return html`<svg class="type-icon" viewBox="0 0 20 20" role="img" aria-label="${c.type}"><title>${c.type}</title><rect width="20" height="20" rx="5" fill="${t.bg}"/><path d="${t.path}" fill="#fff"/></svg>`; };
const typeTag = (c: Card) => html`<span class="tag type-${c.type}">${c.type}</span>`;

function targetableSkills(): Skill[] {
  return data.skills.filter((s) => !s.unreleasedEn && (s.rarity === 1 || s.rarity === 2) && !s.name.includes('×'));
}

function compute() {
  const trainee = state.traineeCardId != null ? data.charByCardId.get(state.traineeCardId) ?? null : null;
  const apt = traineeAptitudes(trainee, state.aptOverrides);
  const schedule = buildSchedule(data.races, apt, settings.winThreshold, new Map(Object.entries(state.raceOverrides)), RACE_POPULARITY);
  const sum = scheduleSummary(schedule);
  const totalTurns = settings.totalTurnsOverride ?? data.model.races.totalTurns;
  const targets = state.targets.map((id) => resolveTarget(id, data)).filter((t): t is Target => !!t);
  const lineage = new Map<number, Lineage>();
  for (const t of targets) { const l = state.targetLineage[String(t.id)]; if (l && l.n > 0) lineage.set(t.id, l); }
  const ctx: Ctx = { data, settings, races: sum.count, totalTurns, trainee, lineage };
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
  // Any Global card can be borrowed from a friend, assumed at LB4.
  const borrowPool = data.cards.map((card) => ({ card, lb: 4 }));
  const deckResult = buildDeck(deckPool, targets, ctx, pinnedIds, 6, borrowPool);
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
  const wlAll = wishlistCandidates(deckResult.deck, targets, ctx).filter((w) => !state.wishlistExcluded.includes(w.skillId));
  const orderIndex = (w: WishlistEntry) => { const i = state.wishlistOrder.indexOf(w.skillId); return i < 0 ? Infinity : i; };
  const ordered = wlAll.slice().sort((a, b) => orderIndex(a) - orderIndex(b) || (b.weight - a.weight));
  const wl = ordered.slice(0, 10);
  const wlRest = ordered.slice(10);
  const wlExcluded = wishlistCandidates(deckResult.deck, targets, ctx).filter((w) => state.wishlistExcluded.includes(w.skillId));
  return { trainee, apt, schedule, sum, ctx, targets, pool, unowned, ranking, deckResult, pred, inherited, finalMean, score, sdScore, pSS, ssMin, wl, wlRest, wlExcluded, existing, pinnedIds };
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
        ${c.targets.length ? c.targets.map((t) => { const l = state.targetLineage[String(t.id)] ?? { n: 0, p1: 0, p2: 0 }; const k1 = Math.min(3, Math.ceil(l.n / 2)), k2 = Math.min(3, l.n - k1);
          return html`<span class="chip target-row ${t.gold ? 'gold' : ''}">
          <img src="${skillIcon(t.white ?? t.gold ?? undefined)}" alt="" /><span class="tname">${t.name}</span>${tip(t.gold ? `Gold form: ${t.gold.name}. Cards that give the gold count for this target, at the higher spark rate.` : 'This skill has no gold form.')}
          <select data-lineage-n="${t.id}">${[0, 1, 2, 3, 4, 5, 6].map((n) => html`<option value="${n}" ${l.n === n ? 'selected' : ''}>${n === 0 ? 'not in lineage' : `${n}× in lineage`}</option>`)}</select>
          <button data-action="remove-target" data-id="${t.id}" title="Remove">✕</button>
          ${l.n > 0 ? html`<span class="row2">
            <span>P1 <select data-lineage-p="${t.id}" data-side="p1" ${k1 ? '' : 'disabled'}>${Array.from({ length: 3 * k1 + 1 }, (_, i) => i).filter((i) => i === 0 || i >= k1).map((i) => html`<option value="${i}" ${l.p1 === i ? 'selected' : ''}>${i}★</option>`)}</select></span>
            <span>P2 <select data-lineage-p="${t.id}" data-side="p2" ${k2 ? '' : 'disabled'}>${Array.from({ length: 3 * k2 + 1 }, (_, i) => i).filter((i) => i === 0 || i >= k2).map((i) => html`<option value="${i}" ${l.p2 === i ? 'selected' : ''}>${i}★</option>`)}</select></span>
            <span class="muted">${k1} on parent 1${k2 ? `, ${k2} on parent 2` : ''}</span></span>` : ''}
        </span>`; })
        : html`<span class="muted small">Add the white skills you want to spark. Cards giving the gold version count too.</span>`}
      </div>
      ${c.targets.length ? html`<div class="small muted">Trainee already covers: ${c.targets.filter((t) => (c.existing.get(t.id) ?? []).some((s) => s.kind !== 'lineage')).map((t) => t.name).join(', ') || 'nothing'}. Lineage sparks raise both the chance of getting the hint (inspiration events) and the spark generation chance (×${settings.lineageSparkMultiplier} per occurrence).</div>` : ''}
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
        <div class="small muted">Growth bonuses: ${t.growth.some((g) => g > 0) ? STATS.map((s, i) => t.growth[i]! > 0 ? `${s.charAt(0).toUpperCase() + s.slice(1)} +${t.growth[i]}%` : '').filter(Boolean).join(' · ') : 'none'}</div>
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
  const allGain = c.inherited.reduce((a, x) => ({ start: a.start + x.start, inspiration: a.inspiration + x.inspiration, total: a.total + x.total }), { start: 0, inspiration: 0, total: 0 });
  return html`
    <section class="panel">
      <h2>Run</h2>
      <label class="row"><span class="k">Scenario</span><span>Our Grand Concert</span></label>
      <h3>Pinned cards</h3>
      <div class="suggest">
        <input id="card-search" type="search" placeholder="Search a support card to pin…" value="${cardQuery}" data-input="cardQuery" style="max-width:100%;width:100%" autocomplete="off" />
        ${cardMatches.length ? html`<ul>${cardMatches.map((p) => html`<li data-action="pin-card" data-id="${p.card.id}"><img src="${cardImg(p.card)}" alt="" /><span class="two-line"><span>${p.card.charName} <span class="muted">(${p.card.rarity} ${p.card.type.charAt(0).toUpperCase() + p.card.type.slice(1)})</span></span><span class="muted small">${p.card.title}</span></span><span class="r">${c.unowned.has(p.card.id) ? 'not owned' : `LB${p.lb}`}</span></li>`)}</ul>` : ''}
      </div>
      <div class="chips">
        ${state.pinnedIds.length ? state.pinnedIds.map((id) => { const card = data.cardById.get(id); if (!card) return '';
          const owned = !c.unowned.has(id);
          return html`<span class="chip">${cardThumb(card, 'chip-art')}${cardLink(card)}${owned ? '' : html` <span class="warn small">not owned</span>${tip('Marked not owned in the card table, so it is skipped when building the deck.')}`}<button data-action="unpin-card" data-id="${id}" title="Unpin">✕</button></span>`; })
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
        <strong>Total gain across all stats <output data-inherited-total>+${num(allGain.total)}</output></strong>
        <span><output data-inherited-start>+${num(allGain.start)}</output> at start · <output data-inherited-inspiration>+${num(allGain.inspiration)}</output> from inspiration events</span>
      </div>
      <div class="blue-gain-summary">
        ${STATS.map((s, i) => html`<span class="${i === activeInheritedStat ? 'active' : ''}" data-inherited-stat="${i}">${s.charAt(0).toUpperCase() + s.slice(1)} <output>+${num(c.inherited[i]!.total)}</output>${tip(`+${num(c.inherited[i]!.start)} at the start, +${num(c.inherited[i]!.inspiration)} from the two inspiration events`)}</span>`)}
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
          ${cs.borrowed ? html`<span class="tag borrow pin-corner">borrow</span>` : state.pinnedIds.includes(cs.card.id) ? html`<span class="tag pin pin-corner">pinned</span>` : ''}
          ${cardThumb(cs.card, 'slot-art')}
          <div class="name">${cardLink(cs.card)}</div>
          <div class="lb">${cs.borrowed ? html`${cs.card.rarity} · LB4 (friend's)` : html`${cs.card.rarity} · LB <select data-lb="${cs.card.id}" class="small">${[0, 1, 2, 3, 4].map((l) => html`<option value="${l}" ${cs.lb === l ? 'selected' : ''}>${l}</option>`)}<option value="none">not owned</option></select>`} ${typeTag(cs.card)}</div>
          <div class="cover">${cs.coverage.filter((x) => x.marginal > 0 || x.spark > 0).map((x) => html`<span class="t">${x.target.name} ${pill(x.spark)}${tip(x.sources.map((s) => `${s.detail}: ${pct(s.pObtain)}`).join('\n'))}</span>`)}</div>
        </div>`)}</div>` : html`<div class="muted">No owned cards. Mark cards in the table below.</div>`}
      ${d.borrow ? html`<div class="small" style="margin-top:8px"><b>Borrow:</b> ${cardLink(d.borrow.card)} at LB4${d.borrow.gain > 1e-9 ? html` in place of your ${d.borrow.replaces?.name ?? ''} (${d.borrow.replaces?.id === d.borrow.card.id ? 'same card at a lower LB' : 'different card'}): +${(d.borrow.gain * 100).toFixed(1)}% expected sparks` : html` <span class="muted">(your own six are already the best; any of them can be the friend's card)</span>`}.
        ${d.borrowAlternatives.length > 1 ? html`<span class="muted">Other borrows: ${d.borrowAlternatives.slice(1).map((o) => `${o.card.name} (+${(o.gain * 100).toFixed(1)}%)`).join(', ')}.</span>` : ''}</div>` : ''}
      <h3>Predicted run (deck ${c.sum.count} races, ${settings.focus} focus${c.trainee ? `, ${c.trainee.name}` : ''})</h3>
      <div class="stats">${STATS.map((s, i) => html`
        <div class="stat"><div class="k">${s}</div><div class="v">${num(c.finalMean[i]!)} <span class="sd">±${num(p.sd[i]!)}</span></div>
          <div class="s">≥600 ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, 600))} · ≥1100 ${pill(pAbove(c.finalMean[i]!, p.sd[i]!, 1100))}</div></div>`)}
        <div class="stat outcome" style="order:-1">
          <div class="outcome-item"><div class="k">SS or better</div><div class="v">${pill(c.pSS, c.pSS > 0.5 ? 'ok' : 'warn')}</div></div>
          <div class="outcome-item"><div class="k">Rank score</div><div class="v">${num(c.score)} <span class="sd">±${num(c.sdScore)}</span></div></div>
          <div class="outcome-item"><div class="k">Estimated SP</div><div class="v">${num(p.sp)}</div></div>
        </div>
      </div>
      <details><summary>Where the stats come from</summary>
        ${(() => {
          const scale = raceScale(c.sum.count, data.model, settings);
          const focusMul = data.model.focus[settings.focus] ?? [1, 1, 1, 1, 1];
          const row = (label: Raw | string, vals: number[], cls = '') => html`<tr class="${cls}"><td>${label}</td>${vals.map((v) => html`<td class="num">${num(v)}</td>`)}<td class="num">${num(vals.reduce((a, b) => a + b, 0))}</td></tr>`;
          const cardRows = d.deck.map((cs) => {
            const cc = cardContribution(cs.card, cs.lb, data.model);
            return row(html`${cardThumb(cs.card, 'thumb sm')} ${cardLink(cs.card)} <span class="muted small">(${cc.source === 'model' ? 'model' : `observed${cc.source === 'observed+model' ? ', shifted to LB' + cs.lb : ''}`})</span>`, cc.stats.map((v, i) => v * scale * focusMul[i]!));
          });
          const base = c.trainee?.baseStats ?? [0, 0, 0, 0, 0];
          const penalty = settings.lossPenalty * c.sum.expectedLosses;
          return html`<table class="small"><thead><tr><th>Source</th>${STATS.map((st) => html`<th class="num">${st}</th>`)}<th class="num">total</th></tr></thead><tbody>
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
          const spark = sparkChance({ pGold, pWhite }, settings, c.ctx.lineage?.get(t.id)?.n ?? 0);
          return html`<tr><td>${t.name}</td><td class="num">${pill(pGold)}</td><td class="num">${pill(pWhite)}</td><td class="num">${pill(spark, spark > 0 ? 'ok' : 'warn')}</td>
            <td class="small" style="white-space:normal">${srcs.length ? srcs.map((s) => `${s.cardName ? s.cardName + ': ' : ''}${skillName(s.skillId)} ${pct(s.pObtain)} (${s.detail})`).join('; ') : html`<span class="warn">no source in deck</span>`}</td></tr>`;
        })}
      </tbody></table>
      <h3>Independent training prioritized skills (up to 10)</h3>
      ${c.wl.length ? html`<ol class="wishlist">${c.wl.map((w, i) => html`<li>
          <span class="wl-ctl"><button class="small" data-action="wl-up" data-id="${w.skillId}" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button><button class="small" data-action="wl-down" data-id="${w.skillId}" ${i === c.wl.length - 1 ? 'disabled' : ''} title="Move down">▼</button></span>
          ${w.gated && w.isTarget ? html`<span class="tag gold wl-kind">target skill</span>` : w.gated ? html`<span class="tag wl-kind">not a target</span>` : html`<span class="tag warn wl-kind">target but not a choice</span>`}${w.name} <span class="small muted">${w.reason}</span>
          <button class="small wl-x" data-action="wl-exclude" data-id="${w.skillId}" title="Remove from the list">✕</button></li>`)}</ol>` : html`<div class="muted small">Nothing to prioritize yet.</div>`}
      ${c.wlRest.length || c.wlExcluded.length ? html`<div class="small muted">
        ${c.wlRest.length ? html`Not listed: ${c.wlRest.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-add" data-id="${w.skillId}" title="Add to the list">+</button></span>`)} ` : ''}
        ${c.wlExcluded.length ? html`Removed: ${c.wlExcluded.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-restore" data-id="${w.skillId}" title="Put back">+</button></span>`)} ` : ''}
        ${state.wishlistOrder.length || state.wishlistExcluded.length ? html`<button class="small" data-action="wl-reset">Reset order</button>` : ''}
      </div>` : (state.wishlistOrder.length ? html`<div class="small muted"><button class="small" data-action="wl-reset">Reset order</button></div>` : '')}
      <details><summary>How the deck was built</summary><ol class="small">${d.steps.map((s) => html`<li>${s}</li>`)}</ol></details>
    </section>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const slotLabel = (slot: number) => `${slot % 2 === 0 ? 'Early' : 'Late'} ${MONTHS[Math.floor((slot % 24) / 2)]}`;

function renderSchedule(c: Computed): Raw {
  const bySlot = new Map<number, ScheduledRace[]>();
  for (const r of c.schedule) bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), r]);
  const overridden = Object.keys(state.raceOverrides).length > 0;
  const cell = (slot: number) => {
    const entries = bySlot.get(slot) ?? [];
    const sel = entries.find((e) => e.selected);
    if (!entries.length) return html`<div class="agenda-cell empty"><div class="agenda-body"></div><div class="agenda-label">${slotLabel(slot)}</div></div>`;
    const info = sel
      ? html`<div class="agenda-race ${sel.race.surface}">${sel.race.name}</div>
             <div class="agenda-meta">${sel.race.surface} ${sel.race.category} ${sel.race.distance}m</div>
             <div class="agenda-meta">win ${pill(sel.base)}${sel.pWin < sel.base ? html` → ${pill(sel.pWin, 'warn')}` : ''}${sel.consecutive > 2 ? html` <span class="tag warn">${sel.consecutive} in a row</span>` : ''}</div>`
      : html`<div class="agenda-meta muted agenda-avail">${entries.map((e) => `${e.race.name} ${pct(e.base)}`).join(' · ')}</div>`;
    const manual = entries.some((e) => state.raceOverrides[e.race.calendarId] != null);
    return html`<div class="agenda-cell ${sel ? 'sel' : 'avail'}">
      <div class="agenda-body">${info}</div>
      <div class="agenda-pick"><select data-slot="${slot}">
        <option value="" ${sel ? '' : 'selected'}>— skip —</option>
        ${entries.map((e) => html`<option value="${e.race.calendarId}" ${e.selected ? 'selected' : ''}>${e.race.name} (${pct(e.base)}${e.selected ? '' : `, ${e.reason.toLowerCase()}`})</option>`)}
      </select>${manual ? tip('Manual pick for this slot. "Clear manual picks" returns it to the automatic rule.') : ''}</div>
      <div class="agenda-label">${slotLabel(slot)}</div>
    </div>`;
  };
  const YEARS = ['Junior year', 'Classic year', 'Senior year'];
  return html`
    <section class="panel">
      <h2>G1 agenda <span class="small muted">(${c.sum.count} races, ${c.sum.unique} unique G1s · threshold ${pct(settings.winThreshold)} · ${num(c.sum.expectedWins, 1)} expected wins, ${num(c.sum.expectedLosses, 1)} expected losses${c.sum.longestStreak > 2 ? ` · longest streak ${c.sum.longestStreak}` : ''})</span></h2>
      <div class="agenda">
        ${YEARS.map((y, yi) => html`<div class="agenda-year"><div class="agenda-year-head">${y}</div><div class="agenda-grid">${Array.from({ length: 24 }, (_, i) => cell(yi * 24 + i))}</div></div>`)}
      </div>
      <div class="small muted" style="margin-top:8px">
        ${overridden ? html`<button class="small" data-action="reset-races">Clear manual picks</button> ` : ''}
        Each G1 is scheduled once (a win only has to happen once for affinity) in the year that costs fewer expected losses. Where two G1s share a slot the one more umas can run comfortably wins the tie (B or better on both surface and distance across the ${data.characters.length} Global umas), a stand-in for how common the race is on parents. Win chances from the uma.guide aptitude table with the consecutive-race penalty (3 in a row −10%, 4 −25%, 5 −35%, 6+ −50%).
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
  const th = (k: string, label: string | Raw, cls = 'num') => html`<th class="${cls}" data-sort="${k}" style="cursor:pointer">${label}${state.sortKey === k ? ' ▾' : ''}</th>`;
  return html`
    <section class="panel">
      <h2>Card ranking <span class="small muted">(${rows.length} cards · click a header to sort)</span></h2>
      <div class="scroll"><table><thead><tr><th></th><th>Card</th><th>LB</th>${th('score', html`Added spark chance${tip('How much this card would raise the total expected white sparks over your targets if added to what is already covered by the trainee and the cards picked so far. Overlap with existing sources counts for less, so two cards giving the same skill do not both score full value.')}`)}${th('spark', html`Spark chance alone${tip('Expected white sparks over your targets from this card on its own: the chance it hands over each skill (hint, event, or outing) times the spark rate for the gold or white form.')}`)}<th>Targets</th>${STATS.map((s) => th(s, s))}${th('stats', 'Total')}${th('sp', 'SP')}<th>Basis${tip('Where the stat numbers come from. "Observed" means the Loopacord logs have this card at this limit break, "observed at another LB" shifts a logged limit break by the model, and "model" is the fitted formula from the card passives.')}</th></tr></thead><tbody>
        ${rows.map((x) => {
          const owned = !c.unowned.has(x.card.id);
          const explicit = inventory[String(x.card.id)] !== undefined;
          return html`<tr class="${owned ? '' : 'dim'}">
            <td>${cardThumb(x.card)}</td>
            <td>${state.pinnedIds.includes(x.card.id) ? html`<span class="tag pin">pinned</span>` : ''}<a class="card-link" href="${cardUrl(x.card)}" target="_blank" rel="noopener">${x.card.charName}</a>${typeIcon(x.card)}${c.trainee && c.trainee.charId === x.card.charId ? html` <span class="tag warn">trainee's card</span>` : ''}<br/><span class="small muted">${x.card.title}</span></td>
            <td><select data-lb="${x.card.id}" class="${explicit ? '' : 'muted'}"><option value="none" ${owned ? '' : 'selected'}>not owned</option>${[0, 1, 2, 3, 4].map((l) => html`<option value="${l}" ${owned && x.lb === l ? 'selected' : ''}>${l}${!explicit && x.lb === l ? ' (default)' : ''}</option>`)}</select></td>
            <td class="num"><span class="bar" style="width:${Math.min(60, x.marginalValue * 120)}px"></span> ${pill(x.marginalValue, '', 1)}</td>
            <td class="num">${pill(x.sparkValue, '', 1)}</td>
            <td class="cover">${x.coverage.map((cv) => html`<span class="t">${cv.target.name} ${pill(cv.spark)}${tip(cv.sources.map((s) => `${skillName(s.skillId)} via ${s.detail}: ${pct(s.pObtain)}`).join('\n'))}</span>`)}</td>
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
  whiteSparkInheritRates: 'Chance, per inspiration event, that a 1/2/3★ white spark already in the lineage gives you its hint, at 0 affinity; scaled by (1 + affinity/100). Defaults 3/6/9% from the mechanics document.',
  lineageSparkMultiplier: 'Each time the same white spark already appears in the lineage, the chance of generating it again is multiplied by this. Default 1.1 from uma.guide (20% → 22% → 24.2% …).',
  ssStarOdds: 'White spark 1★ / 2★ / 3★ odds when the run ends SS or better. Defaults 0.2 / 0.7 / 0.1 from the mechanics document and uma.guide.',
  belowSsStarOdds: 'White spark star odds below SS. Defaults 0.45 / 0.5 / 0.05 from uma.guide.',
  lossPenalty: 'Total stat points removed per expected race loss, spread over the five stats. Default 0 because the effect of losses and conditions like Skin Outbreak has not been measured.',
  skillScorePerSp: 'Rank-score points bought per skill point at the end of the run. Default 1.4: a white skill is 217 points for about 150 SP after hint discounts.',
  skillScoreSd: 'Uncertainty (standard deviation) of the skill part of the rank score. Default 400, roughly two skills either way.',
  totalTurnsOverride: 'Total career turns used to scale card stats by races run. Blank uses the fitted 71.7 from decks run at 28 and 23 races.',
};

function renderSettingsPanel(): Raw {
  const help = (key: keyof Settings) => SETTING_HELP[key] ?? '';
  const numField = (key: keyof Settings, label: string, step = 0.01, extra = '') => html`<label class="row"><span class="k">${label}${tip(help(key))}</span><input type="number" step="${step}" value="${String(settings[key] ?? '')}" data-setting="${key}" style="width:90px" placeholder="${extra}" /></label>`;
  const listField = (key: keyof Settings, label: string) => html`<label class="row"><span class="k">${label}${tip(help(key))}</span><input type="text" value="${(settings[key] as number[]).join(', ')}" data-setting-list="${key}" style="width:140px" /></label>`;
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
        <div class="small muted" style="margin:6px 0">These numbers override the tool's estimates. Each one is a rate or scale the model needs but the game does not tell us; the defaults come from community measurements where they exist and from guesses where they do not. Hover the ⓘ next to a field for what it does and why the default is what it is.</div>
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
          ${listField('whiteSparkInheritRates', 'Lineage white spark hint rate (1/2/3★)')}
          ${numField('lineageSparkMultiplier', 'Spark chance multiplier per lineage occurrence')}
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
    <header><h1>Uma parent deck</h1><span class="meta">Independent training deck builder for white-spark farming · data ${String(meta.fetchedAt).slice(0, 10)} from GameTora · ${data.cards.length} Global cards</span>
      <span class="theme-toggle">Theme ${(['system', 'light', 'dark'] as Theme[]).map((t) => html`<button class="${theme === t ? 'active' : ''}" data-theme-pick="${t}">${t === 'system' ? 'OS' : t}</button>`)}</span></header>
    <main>
      <div>${renderTargets(c)}${renderTrainee(c)}${renderRunSettings(c)}${renderSettingsPanel()}</div>
      <div>${renderDeck(c)}${renderSchedule(c)}${renderRanking(c)}</div>
    </main>
    <div id="tooltip" role="tooltip"></div>
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
    const all = STATS.map((_, k) => inheritedFromParents(previewParents, k, settings)).reduce((a, x) => ({ start: a.start + x.start, inspiration: a.inspiration + x.inspiration, total: a.total + x.total }), { start: 0, inspiration: 0, total: 0 });
    for (const summary of app.querySelectorAll<HTMLElement>('[data-inherited-stat]')) summary.classList.toggle('active', Number(summary.dataset.inheritedStat) === i);
    const summaryOutput = app.querySelector<HTMLOutputElement>(`[data-inherited-stat="${i}"] output`);
    if (summaryOutput) summaryOutput.value = `+${num(inherited.total)}`;
    const setGain = (selector: string, value: string) => { const output = app.querySelector<HTMLOutputElement>(`.blue-gain-compact ${selector}`); if (output) output.value = value; };
    setGain('[data-inherited-total]', `+${num(all.total)}`);
    setGain('[data-inherited-start]', `+${num(all.start)}`);
    setGain('[data-inherited-inspiration]', `+${num(all.inspiration)}`);
    return; }
});
app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement & HTMLSelectElement;
  if (el.dataset.lineageN != null) { const id = el.dataset.lineageN; const n = Number(el.value);
    if (n <= 0) { delete state.targetLineage[id]; }
    else { const k1 = Math.min(3, Math.ceil(n / 2)), k2 = Math.min(3, n - k1); const cur = state.targetLineage[id];
      state.targetLineage[id] = { n, p1: Math.min(3 * k1, Math.max(k1, cur?.p1 ?? 3 * k1)), p2: k2 ? Math.min(3 * k2, Math.max(k2, cur?.p2 ?? 3 * k2)) : 0 }; }
    persist(); render(); return; }
  if (el.dataset.lineageP != null) { const id = el.dataset.lineageP; const cur = state.targetLineage[id]; if (cur) state.targetLineage[id] = { ...cur, [el.dataset.side as 'p1' | 'p2']: Number(el.value) }; persist(); render(); return; }
  if (el.dataset.parent != null) { const pi = Number(el.dataset.parent), i = Number(el.dataset.stat); const next = state.parentStars[pi]!.slice(); next[i] = Number(el.value);
    state.parentStars = state.parentStars.map((p, j) => (j === pi ? clampStars(next, i, MAX_PARENT_STARS) : p)); persist(); render(); return; }
  if (el.dataset.apt) { const k = el.dataset.apt as AptKey; const t = state.traineeCardId != null ? data.charByCardId.get(state.traineeCardId) : null;
    if (t && t.aptitudes[k] === el.value) delete state.aptOverrides[k]; else state.aptOverrides[k] = el.value as Grade; persist(); render(); return; }
  if (el.dataset.slot != null) {
    const slot = Number(el.dataset.slot);
    const inSlot = data.races.filter((r) => !r.unreleasedEn && (r.year - 1) * 24 + (r.month - 1) * 2 + (r.half - 1) === slot);
    // what the automatic rule would pick for this slot with no manual picks in it
    const auto = new Map(Object.entries(state.raceOverrides));
    for (const r of inSlot) auto.delete(r.calendarId);
    const autoPick = buildSchedule(data.races, compute().apt, settings.winThreshold, auto, RACE_POPULARITY).find((x) => x.slot === slot && x.selected)?.race.calendarId ?? '';
    for (const r of inSlot) delete state.raceOverrides[r.calendarId];
    if (el.value !== autoPick) for (const r of inSlot) state.raceOverrides[r.calendarId] = r.calendarId === el.value;
    persist(); render(); return;
  }
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
  const pick = (ev.target as HTMLElement).closest<HTMLElement>('[data-theme-pick]');
  if (pick) { theme = pick.dataset.themePick as Theme; localStorage.setItem(THEME_KEY, theme); applyTheme(); render(); return; }
  const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-action],[data-sort]');
  if (!t) return;
  if (t.dataset.sort) { state.sortKey = t.dataset.sort; persist(); render(); return; }
  const a = t.dataset.action;
  if (a === 'add-target') { const id = Number(t.dataset.id); const fam = resolveTarget(id, data); const base = fam?.id ?? id;
    if (!state.targets.includes(base)) state.targets.push(base); query = ''; persist(); render(); return; }
  if (a === 'pick-trainee') { state.traineeCardId = Number(t.dataset.id); state.aptOverrides = {}; traineeQuery = ''; persist(); render(); return; }
  if (a === 'pin-card') { const id = Number(t.dataset.id); if (!state.pinnedIds.includes(id)) state.pinnedIds.push(id); cardQuery = ''; persist(); render(); return; }
  if (a === 'unpin-card') { state.pinnedIds = state.pinnedIds.filter((x) => x !== Number(t.dataset.id)); persist(); render(); return; }
  if (a === 'wl-up' || a === 'wl-down') {
    const cur = compute().wl.map((w) => w.skillId); const id = Number(t.dataset.id); const i = cur.indexOf(id);
    const j = a === 'wl-up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < cur.length) { cur.splice(i, 1); cur.splice(j, 0, id); state.wishlistOrder = cur; persist(); render(); }
    return; }
  if (a === 'wl-exclude') { const id = Number(t.dataset.id); state.wishlistExcluded = [...new Set([...state.wishlistExcluded, id])]; state.wishlistOrder = state.wishlistOrder.filter((x) => x !== id); persist(); render(); return; }
  if (a === 'wl-restore') { const id = Number(t.dataset.id); state.wishlistExcluded = state.wishlistExcluded.filter((x) => x !== id); persist(); render(); return; }
  if (a === 'wl-add') { const id = Number(t.dataset.id); const cur = compute().wl.map((w) => w.skillId).filter((x) => x !== id); cur.splice(9, cur.length, id); state.wishlistOrder = cur; persist(); render(); return; }
  if (a === 'wl-reset') { state.wishlistOrder = []; state.wishlistExcluded = []; persist(); render(); return; }
  if (a === 'clear-trainee') { state.traineeCardId = null; state.aptOverrides = {}; persist(); render(); return; }
  if (a === 'remove-target') { state.targets = state.targets.filter((x) => x !== Number(t.dataset.id)); delete state.targetLineage[String(t.dataset.id)]; persist(); render(); return; }
  if (a === 'reset-apts') { state.aptOverrides = {}; persist(); render(); return; }
  if (a === 'reset-races') { state.raceOverrides = {}; persist(); render(); return; }
  if (a === 'export') { exportInventory(inventory, data.cards, settings.defaultLb); return; }
  if (a === 'import-click') { (document.getElementById('import-file') as HTMLInputElement).click(); return; }
  if (a === 'reset-inventory') { if (confirm('Clear every card adjustment and go back to the defaults?')) { inventory = {}; persist(); render(); } return; }
  if (a === 'reset-settings') { const keep = { winThreshold: settings.winThreshold, focus: settings.focus, showUnowned: settings.showUnowned, defaultLb: settings.defaultLb };
    settings = { ...DEFAULT_SETTINGS, ...keep }; persist(); render(); return; }
});
// custom tooltips: one floating box, positioned next to the hovered or focused ⓘ
function showTip(el: HTMLElement) {
  const box = document.getElementById('tooltip');
  if (!box) return;
  box.textContent = el.dataset.tip ?? '';
  box.classList.add('show');
  const r = el.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = r.top - h - 6;
  box.style.left = `${left}px`; box.style.top = `${top}px`;
}
function hideTip() { document.getElementById('tooltip')?.classList.remove('show'); }
app.addEventListener('mouseover', (ev) => { const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-tip]'); if (el) showTip(el); });
app.addEventListener('mouseout', (ev) => { if ((ev.target as HTMLElement).closest('[data-tip]')) hideTip(); });
app.addEventListener('focusin', (ev) => { const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-tip]'); if (el) showTip(el); });
app.addEventListener('focusout', (ev) => { if ((ev.target as HTMLElement).closest('[data-tip]')) hideTip(); });
app.addEventListener('toggle', (ev) => { const el = ev.target as HTMLDetailsElement; if (el.dataset.details === 'advanced') showAdvanced = el.open; }, true);

render();
