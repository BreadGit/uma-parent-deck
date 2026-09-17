"""Fit the independent-training card stat model and write data/stat-model.json.

Inputs
  data/cards.json                       GameTora card passives per limit break
  docs/umamusume/loopacord-card-data.csv          Loopacord per-card, per-LB card stats (28 G1 races, Grand Concert, Light Hello SSR in deck)
  docs/umamusume/loopacord-independent-training-research.xlsx   run totals used for the event-stat baseline, race scaling, focus modes
  docs/umamusume/fujikiseki-card-table.json       fujikiseki mixed aggregates, retained for inspection but not eligible as known-LB observations
  data/characters.json                  growth rates of the trainees in the Loopacord runs

Model (per card, per stat s, at R races and a training focus):
  card[s] = (floor + initial[s] + role[s] * max(0, k_type_role + fitted support-effect contributions)) * raceScale(R)
  where role is 'primary' (s == card type), 'secondary' (facility's second stat) or none,
  raceScale(R) = (T - R) / (T - 28), T fitted from the 28 vs 23 race decks.
Event stats (deck independent) = eventBase[s] * (1 + growth[s]/100) * raceScaleEvent(R), scaled per training focus.
"""
import json, collections, hashlib
import numpy as np
import openpyxl
from measurement_sources import extract_sources, parse_race_card_blocks, parse_race_runs, parse_focus, LB, require
from card_effects import unique_extras, passives
from card_regression import evaluate, records, fit, EFFECTS, STAT_BASE, SP_BASE

ROOT = __import__('pathlib').Path(__file__).resolve().parent.parent
cards = json.load(open(ROOT / 'data/cards.json'))
chars = json.load(open(ROOT / 'data/characters.json'))
rows, fuji, source_audit = extract_sources(cards, write=True)
source_audit['inputs'] = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in [ROOT / name for name in [
                            'data/cards.json', 'data/characters.json',
                            'docs/umamusume/loopacord-independent-training-research.xlsx',
                            'docs/umamusume/fujikiseki-insights-2026-09-04.html',
                            'analysis/fit_stat_model.py', 'analysis/card_regression.py',
                            'analysis/card_effects.py', 'analysis/measurement_sources.py']]}
STATS = ['speed', 'stamina', 'power', 'guts', 'wit']
SECONDARY = {'speed': ['power'], 'stamina': ['guts'], 'power': ['stamina'], 'guts': ['speed', 'power'], 'wit': ['speed']}
RACES_REF = 28
card_by_id = {c['id']: c for c in cards}
# The source has one calibrated LB per row. Mixed Fuji aggregates remain in the
# extracted source files; a median level does not establish a known-LB observation.
observed = [dict(cardId=r['card'], lb=LB[r['lb']], source='loopacord', runs=int(r['runs'].rstrip('+')),
                 wellTested=True, stats=[r[stat] for stat in STATS], sp=r['sp'],
                 sourceRef=r['source_ref'], raceReference=RACES_REF, card=card_by_id[r['card']])
            for r in rows if r['eligible']]
print(f'observations: {len(observed)} eligible of {len(rows)} Loopacord rows; '
      f'{len(fuji)} mixed Fuji aggregates preserved but excluded')

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
card_runs = parse_race_card_blocks(wb)
# card-level scaling: pair block means for 28 vs 23 by block order (same decks listed in the same order)
by_r = {races: [np.mean(list(card.values()), axis=0) for card in entries] for races, entries in card_runs.items()}
ratios = []
for a, c in zip(by_r[28], by_r[23]):
    for i in range(5):
        if a[i] > 30: ratios.append(c[i] / a[i])
ratio = float(np.median(ratios))
T = (23 - ratio * 28) / (1 - ratio)
print(f'race scaling: median 23/28 ratio {ratio:.4f} over {len(ratios)} stat pairs -> total turns T = {T:.1f}')
sp_ratio = float(np.median([c[5] / a[5] for a, c in zip(by_r[28], by_r[23])]))
print(f'  card SP 23/28 ratio {sp_ratio:.3f}')

# Explicit source headers and run IDs join the event, card, total and trainee blocks.
per_run = parse_race_runs(wb, card_runs, chars)
source_audit['workbookRuns'] = {str(r): len(runs) for r, runs in per_run.items()}
# growth effect on event stats: event[s] = base[s] * (1 + k * g[s]/100); estimate k by comparing trainees within a block
evs = []
for R, runs in per_run.items():
    for run, d in runs.items():
        evs.append((R, np.array(d['event']), np.array(d['growth'], float), d['uma']))
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
# Header-identified total/event/card tables describe the same runs. Use only totals.
focus = parse_focus(wb)
print('  focus multipliers', focus)

model = dict(
    version=3,
    description='Independent training card model fitted on updated, well-tested Loopacord default-condition rows (Grand Concert, approximately 28 races, Light Hello SSR in deck).',
    sourceAudit=source_audit,
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
    observed=[dict(cardId=o['cardId'], lb=o['lb'], source=o['source'], runs=o['runs'], wellTested=o['wellTested'], stats=o['stats'], sp=o['sp'], sourceRef=o['sourceRef'], raceReference=o['raceReference']) for o in observed],
)
json.dump(model, open(ROOT / 'data/stat-model.json', 'w'), indent=1)
print('wrote data/stat-model.json')
# what this script added for every compound unique effect, at every limit break, without a deck or an agenda: the
# data test checks that uniqueExtras() in src/model/stats.ts reproduces it, so the two implementations cannot drift
fixture = [dict(cardId=c['id'], lb=lb, extras={str(k): v for k, v in sorted(unique_extras(c, lb, UNIQUE_RAMP_SHARE).items())})
           for c in cards if c.get('unique') and any(e['type'] >= 100 for e in c['unique']['effects']) for lb in range(5)]
json.dump(dict(uniqueRampShare=UNIQUE_RAMP_SHARE, rows=fixture), open(ROOT / 'data/unique-extras-fixture.json', 'w'), indent=1)
print(f'wrote data/unique-extras-fixture.json ({len(fixture)} rows)')
