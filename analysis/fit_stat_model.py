"""Fit the independent-training card stat model and write data/stat-model.json.

Inputs
  data/cards.json                       GameTora card passives per limit break
  docs/umamusume/loopacord-card-data.csv          Loopacord per-card, per-LB card stats (28 G1 races, Grand Concert, Light Hello SSR in deck)
  docs/umamusume/loopacord-independent-training-research.xlsx   run totals used for the event-stat baseline, race scaling, focus modes
  docs/umamusume/fujikiseki-card-table.json       fujikiseki per-card medians (mixed LB) used as a second observation source
  data/characters.json                  growth rates of the trainees in the Loopacord runs

Model (per card, per stat s, at R races and a training focus):
  card[s] = (floor + initial[s] + role[s] * max(0, k_type_role + fitted support-effect contributions)) * raceScale(R)
  where role is 'primary' (s == card type), 'secondary' (facility's second stat) or none,
  raceScale(R) = (T - R) / (T - 28), T fitted from the 28 vs 23 race decks.
Event stats (deck independent) = eventBase[s] * (1 + growth[s]/100) * raceScaleEvent(R), scaled per training focus.
"""
import json, csv, re, collections, sys
import numpy as np
import openpyxl
from card_regression import evaluate, records, fit, EFFECTS, STAT_BASE, SP_BASE

ROOT = __import__('pathlib').Path(__file__).resolve().parent.parent
cards = json.load(open(ROOT / 'data/cards.json'))
chars = json.load(open(ROOT / 'data/characters.json'))
rows = list(csv.DictReader(open(ROOT / 'docs/umamusume/loopacord-card-data.csv')))
fuji = json.load(open(ROOT / 'docs/umamusume/fujikiseki-card-table.json'))

STATS = ['speed', 'stamina', 'power', 'guts', 'wit']
LB = {'0LB': 0, '1LB': 1, '2LB': 2, '3LB': 3, 'MLB': 4}
TYPE = {'Friend': 'pal', 'Group': 'group', 'Speed': 'speed', 'Stamina': 'stamina', 'Power': 'power', 'Guts': 'guts', 'Wit': 'wit', 'Pal': 'pal'}
SECONDARY = {'speed': ['power'], 'stamina': ['guts'], 'power': ['stamina'], 'guts': ['speed', 'power'], 'wit': ['speed']}
RACES_REF = 28

ALIAS = {'heirs to the throne': "the throne's assemblage", 'syrius symboli': 'sirius symboli', 'daichi ruby': 'daiichi ruby', 'mr. cb': 'mr. c.b.'}
fuji_titles = collections.defaultdict(set)
for f in fuji: fuji_titles[(f['char'].lower(), f['rarity'], TYPE[f['type']])].add(f['title'])
def find_card(char, rarity, typ):
    name = ALIAS.get(char.lower(), char.lower())
    cs = [c for c in cards if c['charName'].lower() == name and c['rarity'] == rarity and c['type'] == typ]
    if len(cs) > 1:
        # disambiguate with the titles fujikiseki saw in the same period
        titles = fuji_titles.get((name, rarity, typ), set())
        narrowed = [c for c in cs if c['title'].strip('[]') in titles]
        if len(narrowed) == 1: return narrowed
    return cs

# Compound unique effects (types 100 and up) are not in effectsByLb; the same sums as uniqueExtras() in
# src/model/stats.ts, for the types that do not need the deck (docs/umamusume/refs/gametora-unique-effects.md). The share of the
# run a ramping effect counts for is fitted below; the app reads it back from the model as uniqueRampShare.
TRAINING_EFF, FRIENDSHIP = 8, 1
UNIQUE_TOTAL_BOND_CAP, FACILITY_LEVEL_MAX = 600, 5   # mirror src/model/rules.ts
def unique_extras(card, lb, share):
    out = collections.defaultdict(float)
    u = card.get('unique')
    if not u or lb < u['fromLb']: return out
    def add(i, v):
        if i is None or v is None or not np.isfinite(v) or v == 0: return
        out[int(i)] += v
    for e in u['effects']:
        t = e['type']
        if t == 101:
            add(e.get('value_1'), (e.get('value_2') or 0) * share); add(e.get('value_3'), (e.get('value_4') or 0) * share)
        elif t == 104: add(TRAINING_EFF, (e.get('value_1') or 0) * share)   # the app follows the agenda's fan curve instead when it has one
        elif t == 106: add(FRIENDSHIP, e['value'] * (e.get('value_2') or 0) * share)
        elif t == 109: add(TRAINING_EFF, (UNIQUE_TOTAL_BOND_CAP / e['value_1'] if e.get('value_1') else 0) * share)
        elif t == 111: add(TRAINING_EFF, (e.get('value_1') or 0) * FACILITY_LEVEL_MAX * share)
    return out

def passives(card, lb, share):
    e = card['effectsByLb'][lb]
    x = unique_extras(card, lb, share)
    return {i: e.get(str(i), 0) + e.get(f'u{i}', 0) + x.get(i, 0) for i in range(1, 32)}

# ---------- observations ----------
# The sheet identifies each card by a GameTora image formula in column B (support_card_s_<id>.png),
# which disambiguates characters with two cards of the same rarity and type. Names are the fallback.
wb_f = openpyxl.load_workbook(ROOT / 'docs/umamusume/loopacord-independent-training-research.xlsx', read_only=True, data_only=False)
sheet_ids = []
for row in wb_f['Grand Live Card Data'].iter_rows():
    cells = list(row) + [None] * 20
    name = cells[2].value if cells[2] is not None else None
    if not (isinstance(name, str) and re.search(r' (R|SR|SSR)$', name)): continue
    formula = cells[1].value if cells[1] is not None else None
    m = re.search(r'support_card_s_(\d+)\.png', str(formula or ''))
    sheet_ids.append(int(m.group(1)) if m else None)
if len(sheet_ids) != len(rows):
    print(f'warning: {len(sheet_ids)} image ids vs {len(rows)} csv rows; falling back to names where they disagree')
card_by_id = {c['id']: c for c in cards}
observed = []   # {cardId, lb, source, runs, stats[5], sp}
unmatched = []
for i, r in enumerate(rows):
    m = re.match(r'(.*) (R|SR|SSR)$', r['name'])
    cs = find_card(m.group(1), m.group(2), TYPE[r['type']])
    sid = sheet_ids[i] if i < len(sheet_ids) else None
    if sid in card_by_id and card_by_id[sid]['rarity'] == m.group(2):
        cs = [card_by_id[sid]]
    if len(cs) != 1:
        unmatched.append((r['name'], r['type'], len(cs))); continue
    runs = r['runs']
    n = int(runs.rstrip('+').split('.')[0])
    observed.append(dict(cardId=cs[0]['id'], lb=LB[r['lb']], source='loopacord', runs=n, wellTested=runs.endswith('+'),
                         stats=[float(r[s]) for s in STATS], sp=float(r['sp']), card=cs[0]))
MLB_LEVEL = {'SSR': 50, 'SR': 45, 'R': 40}
fuji_added = 0
for f in fuji:
    cs = find_card(f['char'], f['rarity'], TYPE[f['type']])
    if len(cs) != 1 or f['runs'] < 10 or f['flagged']:
        continue
    if f['level_median'] != MLB_LEVEL[f['rarity']]:
        continue  # only use rows that are clearly MLB
    if any(o['cardId'] == cs[0]['id'] and o['lb'] == 4 and o['wellTested'] for o in observed):
        continue
    observed.append(dict(cardId=cs[0]['id'], lb=4, source='fujikiseki', runs=f['runs'], wellTested=True,
                         stats=[f[s + '_median'] for s in STATS], sp=f['sp_median'], card=cs[0]))
    fuji_added += 1
print(f'observations: {len(observed)} (fujikiseki added {fuji_added}); unmatched loopacord rows: {len(unmatched)}')
for u in unmatched: print('  unmatched', u)

# ---------- grouped evaluation and retained regression inputs ----------
stat_fit, stat_evaluation = evaluate(observed, passives, 'stats')
sp_fit, sp_evaluation = evaluate(observed, passives, 'sp')
assert stat_fit.share == sp_fit.share, 'the app uses one ramp share for both outcomes'
UNIQUE_RAMP_SHARE = stat_fit.share
FLOOR = stat_fit.floor
consts = {key: float(value) for key, value in zip(stat_fit.roles, stat_fit.constants)}
slopes = {key: float(value) for key, value in zip(stat_fit.features, stat_fit.slopes) if key in STAT_BASE}
effect_slopes = {str(EFFECTS[key]): float(value) for key, value in zip(stat_fit.features, stat_fit.slopes)
                 if key not in STAT_BASE and abs(value) > 1e-8}
qualifying = [o for o in observed if o['source'] == 'loopacord' and o['wellTested']]
stat_rows = records(qualifying, passives, UNIQUE_RAMP_SHARE, 'stats')
floors = [r['y'] - r['initial'] for r in stat_rows if r['role'] is None]
active = [r for r in stat_rows if r['role'] is not None]
pred = stat_fit.predict(active)
y = np.array([r['y'] for r in active])
rmse = float(np.sqrt(np.mean((pred - y) ** 2)))
r2 = float(1 - np.sum((pred - y) ** 2) / np.sum((y - y.mean()) ** 2))
sp_constants = dict(zip(sp_fit.roles, sp_fit.constants))
sp_slopes = dict(zip(sp_fit.features, sp_fit.slopes))
SP = dict(base=float(sp_constants['other']), wit=float(sp_constants['wit'] - sp_constants['other']),
          friend=float(sp_constants['friend'] - sp_constants['other']), skillPointBonus=float(sp_slopes['spb']),
          effectSlopes={str(EFFECTS[key]): float(value) for key, value in sp_slopes.items()
                        if key not in SP_BASE and abs(value) > 1e-8})
# Sparse pal/group data does not support deploying the broader SP formula there.
# Keep the previous formula as a conservative restriction after model evaluation.
sp_baseline = fit(records(qualifying, passives, UNIQUE_RAMP_SHARE, 'sp'), SP_BASE, UNIQUE_RAMP_SHARE)
sp_baseline_constants = dict(zip(sp_baseline.roles, sp_baseline.constants))
SP['fittedTypes'] = STATS
SP['fallback'] = dict(base=float(sp_baseline_constants['other']),
                      wit=float(sp_baseline_constants['wit'] - sp_baseline_constants['other']),
                      friend=float(sp_baseline_constants['friend'] - sp_baseline_constants['other']),
                      skillPointBonus=float(sp_baseline.slopes[0]))
for target, result in [('stats', stat_evaluation), ('SP', sp_evaluation)]:
    print(f"{target}: held-out RMSE {result['baselineRmse']:.3f} -> {result['expandedRmse']:.3f}; "
          f"retained {result['selectedFeatures']}, ridge {result['alpha']}")
print(f'floor {FLOOR}; in-sample stat RMSE {rmse:.3f}; shared unique ramp {UNIQUE_RAMP_SHARE}')

# ---------- race scaling, event baseline, focus, sigma (from the research workbook) ----------
wb = openpyxl.load_workbook(ROOT / 'docs/umamusume/loopacord-independent-training-research.xlsx', read_only=True, data_only=True)
ws = wb['Race Schedule Data']
blocks = []  # per (races, block) list of per-run [speed..wit, sp]
races = None
for row in ws.iter_rows(values_only=True):
    cells = list(row)
    for j, v in enumerate(cells):
        if isinstance(v, str) and 'Balanced G1s' in v:
            races = int(v.split()[0])
    if races and any(isinstance(v, str) and v == 'Run Number' for v in cells):
        starts = [j for j, v in enumerate(cells) if v == 'Run Number']
        blocks.append(dict(races=races, cols=starts, rows=[]))
        continue
    if blocks and isinstance(cells[blocks[-1]['cols'][0]], (int, float)):
        b = blocks[-1]
        vals = []
        for st in b['cols']:
            seg = cells[st + 1:st + 7]
            if all(isinstance(x, (int, float)) for x in seg): vals.append([float(x) for x in seg])
        if vals: b['rows'].append(vals)
# card-level scaling: pair block means for 28 vs 23 by block order (same decks listed in the same order)
by_r = collections.defaultdict(list)
for b in blocks:
    for col in range(len(b['cols'])):
        arr = np.array([r[col] for r in b['rows'] if len(r) > col])
        if len(arr): by_r[b['races']].append(arr.mean(axis=0))
ratios = []
for a, c in zip(by_r[28], by_r[23]):
    for i in range(5):
        if a[i] > 30: ratios.append(c[i] / a[i])
ratio = float(np.median(ratios))
T = (23 - ratio * 28) / (1 - ratio)
print(f'race scaling: median 23/28 ratio {ratio:.4f} over {len(ratios)} stat pairs -> total turns T = {T:.1f}')
sp_ratio = float(np.median([c[5] / a[5] for a, c in zip(by_r[28], by_r[23])]))
print(f'  card SP 23/28 ratio {sp_ratio:.3f}')

# run totals, deck card sums, event stats and trainee per run from the 'Race Schedule' sheet
ws = wb['Race Schedule']
per_run = {28: {}, 23: {}}   # run -> dict(card, event, total, uma)
cur = 28
for row in ws.iter_rows(values_only=True):
    cells = list(row) + [None] * 40
    if any(isinstance(v, str) and '23 Balanced' in v for v in cells): cur = 23
    if not isinstance(cells[9], (int, float)): continue
    run = int(cells[9]); d = per_run[cur].setdefault(run, {})
    v10 = cells[10:15]; v19 = cells[19:24]
    if all(isinstance(x, (int, float)) for x in v10):
        if cells[10] < 900 and all(isinstance(x, (int, float)) for x in v19) and cells[19] > 100:
            # cols 10-14: event stats incl. race rewards (trainee dependent); cols 19-23: sum of the six cards' log contributions
            d['event'] = [float(x) for x in v10]; d['card'] = [float(x) for x in v19]; d['eventSp'] = float(cells[15]); d['cardSp'] = float(cells[24])
        elif cells[10] > 900 and isinstance(cells[16], (int, float)):
            d['total'] = [float(x) for x in v10]; d['totalSp'] = float(cells[15])
        elif cells[10] > 900 and isinstance(cells[29], str):
            d['uma'] = cells[29]
growth_by_name = {c['name']: c['growth'] for c in chars}
alias = {'Oguri': 'Oguri Cap', 'Biwa': 'Biwa Hayahide', 'XBiwa': 'Biwa Hayahide', 'Ines Fujin': 'Ines Fujin', 'NYOpera': 'T.M. Opera O'}
# growth effect on event stats: event[s] = base[s] * (1 + k * g[s]/100); estimate k by comparing trainees within a block
evs = []
for R, runs in per_run.items():
    for run, d in runs.items():
        if 'event' in d and 'uma' in d and alias.get(d['uma'], d['uma']) in growth_by_name:
            evs.append((R, np.array(d['event']), np.array(growth_by_name[alias.get(d['uma'], d['uma'])], float), d['uma']))
print('per-run rows with event stats + trainee:', len(evs), collections.Counter((r, u) for r, _, _, u in evs))
# least squares on log(event) = log(base_R[s]) + log(1 + k g/100); small k -> linearize: event ~ base_R[s] + base_R[s]*k*g/100
best = None
for k in np.linspace(0, 2.0, 201):
    sse = 0
    for R in (28, 23):
        rows_R = [(e, g) for r, e, g, _ in evs if r == R]
        if not rows_R: continue
        E = np.array([e / (1 + k * g / 100) for e, g in rows_R])
        sse += ((E - E.mean(axis=0)) ** 2).sum()
    if best is None or sse < best[1]: best = (k, sse)
GROWTH_EFFECT = float(round(best[0], 2))
print(f'  growth effect on event stats k = {GROWTH_EFFECT} (1.0 = full growth %, 0 = none)')
# how much the fit prefers that k: the pooled within-race-count variance of event stats at k = 0, the best k and k = 1
def sse_at(k):
    sse = 0
    for R in (28, 23):
        rows_R = [(e, g) for r, e, g, _ in evs if r == R]
        if not rows_R: continue
        E = np.array([e / (1 + k * g / 100) for e, g in rows_R])
        sse += ((E - E.mean(axis=0)) ** 2).sum()
    return sse
print('  event-stat variance at k=0: %.0f, at best k: %.0f, at k=1: %.0f (n=%d runs; a flat curve means the data cannot tell)' % (sse_at(0), sse_at(best[0]), sse_at(1.0), len(evs)))
event_base = {}; event_sp = {}; sigma_res = []
for R in (28, 23):
    rows_R = [(e, g) for r, e, g, _ in evs if r == R]
    if rows_R:
        event_base[R] = np.mean([e / (1 + GROWTH_EFFECT * g / 100) for e, g in rows_R], axis=0).tolist()
    else:
        event_base[R] = np.mean([d['event'] for d in per_run[R].values() if 'event' in d], axis=0).tolist()
    event_sp[R] = float(np.mean([d['eventSp'] for d in per_run[R].values() if 'eventSp' in d]))
    print(f'  event stats base at {R} races: {np.round(event_base[R]).tolist()}, event SP {event_sp[R]:.0f}')
    # within-trainee residuals of total gains for sigma
    by_uma = collections.defaultdict(list)
    for d in per_run[R].values():
        if 'total' in d and 'uma' in d: by_uma[d['uma']].append(d['total'])
    for u, ts in by_uma.items():
        if len(ts) >= 2:
            a = np.array(ts); sigma_res.extend((a - a.mean(axis=0)).tolist())
sigma = np.sqrt(np.mean(np.array(sigma_res) ** 2, axis=0)).tolist() if sigma_res else [40, 60, 50, 50, 50]
print('  run-to-run sd per stat (pooled within trainee, n=%d):' % len(sigma_res), np.round(sigma, 1).tolist())
# sanity: the six per-card blocks should sum to the deck-level card stats
for R in (28, 23):
    deck_card = np.mean([d['card'] for d in per_run[R].values() if 'card' in d], axis=0)
    if len(by_r[R]) >= 6:
        s6 = np.sum([b[:5] for b in by_r[R][:6]], axis=0)
        print(f'  check {R} races: deck card stats {deck_card.round(0).tolist()} vs six-card sum {s6.round(0).tolist()}')

# focus multipliers from the 'Race Mode' sheet (two decks: rows with Mode/Speed..)
ws = wb['Race Mode']
modes = collections.defaultdict(list)
for row in ws.iter_rows(values_only=True):
    cells = list(row) + [None] * 40
    if cells[6] in ('Balanced', 'Stamina', 'Sprint') and all(isinstance(x, (int, float)) for x in cells[7:12]):
        modes[cells[6]].append([float(x) for x in cells[7:12]])
focus = {}
for m in ('Balanced', 'Stamina', 'Sprint'):
    rs = []
    for i in range(min(len(modes['Balanced']), len(modes[m]))):
        rs.append((np.array(modes[m][i]) / np.array(modes['Balanced'][i])).tolist())
    focus[m.lower()] = np.mean(rs, axis=0).round(4).tolist() if rs else [1, 1, 1, 1, 1]
print('  focus multipliers', focus)

model = dict(
    version=2,
    description='Independent training card stat model fitted on Loopacord card data (Grand Concert, 28 G1 races, Light Hello SSR in deck).',
    stats=STATS,
    secondary=SECONDARY,
    floor=FLOOR,
    roleConstants=consts,
    slopes=slopes,
    effectSlopes=effect_slopes,
    fit=dict(n=len(y), rmse=rmse, r2=float(r2), floorSd=float(np.std(floors))),
    evaluation=dict(stats=stat_evaluation, sp=sp_evaluation,
                    raceBonus=dict(status='insufficient-data',
                                   reason='The event baseline uses one sample deck at 23 and 28 races. It cannot isolate deck Race Bonus from the deck baseline.')),
    races=dict(reference=RACES_REF, totalTurns=float(T), spRatio23=sp_ratio),
    sp=SP,
    eventBase={str(k): v for k, v in event_base.items()},
    eventSp={str(k): v for k, v in event_sp.items()},
    growthEffect=GROWTH_EFFECT,
    uniqueRampShare=UNIQUE_RAMP_SHARE,
    sigma=sigma,
    focus=focus,
    observed=[dict(cardId=o['cardId'], lb=o['lb'], source=o['source'], runs=o['runs'], wellTested=o['wellTested'], stats=o['stats'], sp=o['sp']) for o in observed],
)
json.dump(model, open(ROOT / 'data/stat-model.json', 'w'), indent=1)
print('wrote data/stat-model.json')
# what this script added for every compound unique effect, at every limit break, without a deck or an agenda: the
# data test checks that uniqueExtras() in src/model/stats.ts reproduces it, so the two implementations cannot drift
fixture = [dict(cardId=c['id'], lb=lb, extras={str(k): v for k, v in sorted(unique_extras(c, lb, UNIQUE_RAMP_SHARE).items())})
           for c in cards if c.get('unique') and any(e['type'] >= 100 for e in c['unique']['effects']) for lb in range(5)]
json.dump(dict(uniqueRampShare=UNIQUE_RAMP_SHARE, rows=fixture), open(ROOT / 'data/unique-extras-fixture.json', 'w'), indent=1)
print(f'wrote data/unique-extras-fixture.json ({len(fixture)} rows)')
