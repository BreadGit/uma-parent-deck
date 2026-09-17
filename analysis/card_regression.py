"""Compare card regression inputs without sharing cards across training and validation.

Only training rows determine the floor, numerical scaling, feature set, ramp share and
ridge strength. Role intercepts remain unpenalized. Metrics give each card equal weight.
"""
from dataclasses import dataclass
import numpy as np

STATS = ['speed', 'stamina', 'power', 'guts', 'wit']
SECONDARY = {'speed': ['power'], 'stamina': ['guts'], 'power': ['stamina'], 'guts': ['speed', 'power'], 'wit': ['speed']}
STAT_BASE = ('fr', 'mo', 'te', 'sb')
SP_BASE = ('spb',)
EFFECTS = {'fr': 1, 'mo': 2, 'te': 8, 'bond': 14, 'hintLevels': 17, 'hintFrequency': 18,
           'specialty': 19, 'eventRecovery': 25, 'eventEffectiveness': 26,
           'failureProtection': 27, 'energyCostReduction': 28, 'minigameEffectiveness': 29,
           'spb': 30, 'witRecovery': 31}
CANDIDATES = ('bond', 'specialty', 'eventRecovery', 'eventEffectiveness',
              'failureProtection', 'energyCostReduction', 'witRecovery',
              'hintLevels', 'hintFrequency', 'minigameEffectiveness')
SHARES = tuple(round(float(s), 2) for s in np.arange(0, 1.0001, 0.05))
ALPHAS = (0.0, 0.1, 1.0, 10.0, 100.0)


def grouped_folds(observations, count=5, seed=2718):
    """Stratify card IDs by support type; every LB of a card stays in one fold."""
    by_type = {}
    for o in observations:
        by_type.setdefault(o['card']['type'], set()).add(o['cardId'])
    rng = np.random.default_rng(seed)
    folds = [set() for _ in range(count)]
    offset = 0
    for typ in sorted(by_type):
        ids = sorted(by_type[typ])
        rng.shuffle(ids)
        for i, card_id in enumerate(ids):
            folds[(i + offset) % count].add(card_id)
        offset = (offset + len(ids)) % count
    return [(np.array([i for i, o in enumerate(observations) if o['cardId'] not in ids], int),
             np.array([i for i, o in enumerate(observations) if o['cardId'] in ids], int))
            for ids in folds if ids]


def records(observations, passives, share, target):
    result = []
    for o in observations:
        p = passives(o['card'], o['lb'], share)
        typ = o['card']['type']
        values = {name: p.get(effect, 0) for name, effect in EFFECTS.items()}
        if target == 'sp':
            role = 'wit' if typ == 'wit' else 'friend' if typ in ('pal', 'group') else 'other'
            result.append(dict(cardId=o['cardId'], role=role, y=o['sp'], initial=0, values=values))
        else:
            for i, stat in enumerate(STATS):
                role = 'primary' if typ == stat else 'secondary' if stat in SECONDARY.get(typ, []) else None
                result.append(dict(cardId=o['cardId'], role=f'{typ}.{role}' if role else None,
                                   y=o['stats'][i], initial=p.get(9 + i, 0),
                                   values={**values, 'sb': p.get(3 + i, 0)}))
    return result


@dataclass
class Fit:
    floor: float
    roles: tuple
    features: tuple
    constants: np.ndarray
    slopes: np.ndarray
    share: float
    alpha: float

    def predict(self, rows):
        const = dict(zip(self.roles, self.constants))
        values = []
        for row in rows:
            gain = const.get(row['role'], 0) + sum(row['values'][name] * coef for name, coef in zip(self.features, self.slopes))
            values.append(self.floor + row['initial'] + (max(0, gain) if row['role'] is not None else 0))
        return np.array(values)


def fit(rows, features, share=0.7, alpha=0.0):
    off_role = [r['y'] - r['initial'] for r in rows if r['role'] is None]
    floor = float(np.median(off_role)) if off_role else 0.0
    active = [r for r in rows if r['role'] is not None]
    roles = tuple(sorted({r['role'] for r in active}))
    intercepts = np.array([[r['role'] == role for role in roles] for r in active], float)
    raw = np.array([[r['values'][f] for f in features] for r in active], float)
    # Center within each role, so a feature constant within roles is not mistaken for
    # an independently learnable effect. This also leaves intercepts unpenalized.
    role_means = np.linalg.lstsq(intercepts, raw, rcond=None)[0]
    centered = raw - intercepts @ role_means
    scales = np.sqrt(np.mean(centered ** 2, axis=0))
    supported = scales > 1e-8
    safe_scales = np.where(supported, scales, 1)
    normalized = centered / safe_scales
    normalized[:, ~supported] = 0
    x = np.column_stack([intercepts, normalized])
    y = np.array([r['y'] - floor - r['initial'] for r in active])
    if alpha:
        penalty = np.zeros((len(features), x.shape[1]))
        penalty[:, len(roles):] = np.eye(len(features)) * np.sqrt(alpha)
        x = np.vstack([x, penalty])
        y = np.concatenate([y, np.zeros(len(features))])
    coef = np.linalg.lstsq(x, y, rcond=None)[0]
    slopes = coef[len(roles):] / safe_scales
    slopes[~supported] = 0
    constants = coef[:len(roles)] - role_means @ slopes
    return Fit(floor, roles, tuple(features), constants, slopes, share, alpha)


def card_errors(rows, prediction):
    errors = {}
    for row, value in zip(rows, prediction):
        if row['role'] is not None:
            errors.setdefault(row['cardId'], []).append((value - row['y']) ** 2)
    return {card_id: float(np.mean(values)) for card_id, values in errors.items()}


def rmse(errors):
    return float(np.sqrt(np.mean(list(errors.values()))))


def candidate_sets(target):
    base = STAT_BASE if target == 'stats' else SP_BASE
    extras = CANDIDATES if target == 'stats' else (*CANDIDATES, 'fr', 'mo', 'te')
    return [base, *(base + (name,) for name in extras), base + extras]


def baseline_stat_fit(cached_stats):
    options = []
    for share in SHARES:
        rows = cached_stats[share]
        fitted = fit(rows, STAT_BASE, share)
        squared = [(a - r['y']) ** 2 for r, a in zip(rows, fitted.predict(rows)) if r['role'] is not None]
        options.append((float(np.mean(squared)), -share, fitted))
    return min(options, key=lambda item: item[:2])[2]


def tune(observations, cached, cached_stats, target, expanded):
    base = STAT_BASE if target == 'stats' else SP_BASE
    # Keep one ramp share for both outcomes, learned from training stats using the
    # existing fit. Each inner fold repeats this before choosing inputs or ridge.
    share = baseline_stat_fit(cached_stats).share
    if not expanded:
        return fit(cached[share], base, share)
    splits = []
    for train, test in grouped_folds(observations, 4, 3141):
        train_ids = {observations[i]['cardId'] for i in train}
        test_ids = {observations[i]['cardId'] for i in test}
        inner_stats = {s: [r for r in rows if r['cardId'] in train_ids] for s, rows in cached_stats.items()}
        inner_share = baseline_stat_fit(inner_stats).share
        splits.append(([r for r in cached[inner_share] if r['cardId'] in train_ids],
                       [r for r in cached[inner_share] if r['cardId'] in test_ids], inner_share))
    best = None
    for features in candidate_sets(target):
        for alpha in ALPHAS:
            errors = {}
            for train_rows, test_rows, inner_share in splits:
                fitted = fit(train_rows, features, inner_share, alpha)
                errors.update(card_errors(test_rows, fitted.predict(test_rows)))
            score = (rmse(errors), len(features), -alpha)
            if best is None or score < best[0]:
                best = (score, features, alpha)
    _, features, alpha = best
    return fit(cached[share], features, share, alpha)


def evaluate(observations, passives, target='stats'):
    """Nested grouped CV compares a training-only feature selector to the old fit."""
    observations = [o for o in observations if o['source'] == 'loopacord' and o['wellTested']]
    cached = {s: records(observations, passives, s, target) for s in SHARES}
    cached_stats = cached if target == 'stats' else {s: records(observations, passives, s, 'stats') for s in SHARES}
    baseline_errors, expanded_errors, fold_results = {}, {}, []
    for fold, (train, test) in enumerate(grouped_folds(observations)):
        train_obs = [observations[i] for i in train]
        train_ids = {o['cardId'] for o in train_obs}
        test_ids = {observations[i]['cardId'] for i in test}
        train_cache = {s: [r for r in rows if r['cardId'] in train_ids] for s, rows in cached.items()}
        train_stats = {s: [r for r in rows if r['cardId'] in train_ids] for s, rows in cached_stats.items()}
        baseline = tune(train_obs, train_cache, train_stats, target, False)
        expanded = tune(train_obs, train_cache, train_stats, target, True)
        be = card_errors([r for r in cached[baseline.share] if r['cardId'] in test_ids],
                         baseline.predict([r for r in cached[baseline.share] if r['cardId'] in test_ids]))
        ee = card_errors([r for r in cached[expanded.share] if r['cardId'] in test_ids],
                         expanded.predict([r for r in cached[expanded.share] if r['cardId'] in test_ids]))
        baseline_errors.update(be)
        expanded_errors.update(ee)
        fold_results.append(dict(cards=sorted(test_ids), baselineRmse=rmse(be), expandedRmse=rmse(ee),
                                 features=list(expanded.features), alpha=expanded.alpha, share=expanded.share))
        print(f'  {target} held-out fold {fold + 1}: baseline {rmse(be):.3f}, expanded {rmse(ee):.3f}; {expanded.features}', flush=True)
    # Require a predeclared 2% improvement and a majority of improved folds.
    retained = rmse(expanded_errors) <= 0.98 * rmse(baseline_errors) and sum(r['expandedRmse'] < r['baselineRmse'] for r in fold_results) >= 3
    fitted = tune(observations, cached, cached_stats, target, retained)
    inputs = []
    rows = cached[fitted.share]
    base = STAT_BASE if target == 'stats' else SP_BASE
    for name in candidate_sets(target)[-1]:
        if name in base:
            continue
        nonzero = {r['cardId'] for r in rows if r['role'] is not None and r['values'][name] != 0}
        status = 'retained' if retained and name in fitted.features and abs(fitted.slopes[fitted.features.index(name)]) > 1e-8 else 'tested-not-retained' if len(nonzero) >= 2 else 'insufficient-data'
        inputs.append(dict(name=name, effectId=EFFECTS[name], cardsWithEffect=len(nonzero), status=status))
    by_type = {}
    for typ in sorted({o['card']['type'] for o in observations}):
        ids = {o['cardId'] for o in observations if o['card']['type'] == typ and o['cardId'] in baseline_errors}
        if ids:
            by_type[typ] = dict(cards=len(ids), baselineRmse=rmse({i: baseline_errors[i] for i in ids}),
                                expandedRmse=rmse({i: expanded_errors[i] for i in ids}))
    result = dict(method='nested-grouped-by-card', outerFolds=5, innerFolds=4,
                  metric='RMSE of primary/secondary stats, equal weight per card' if target == 'stats' else 'SP RMSE, equal weight per card',
                  cards=len(baseline_errors), baselineRmse=rmse(baseline_errors), expandedRmse=rmse(expanded_errors),
                  retained=retained, selectedFeatures=list(fitted.features), alpha=fitted.alpha,
                  share=fitted.share, inputs=inputs, byType=by_type, folds=fold_results)
    return fitted, result
