"""Support passives used by the fit, checked against runtime fixtures."""
import collections
import math
import re

UNIQUE_FIELDS = {101: {'value_1', 'value_2', 'value_3', 'value_4'}, 104: {'value_1'},
                 106: {'value_1', 'value_2'}, 109: {'value_1'}, 111: {'value_1'}}


def unique_extras(card, lb, share):
    out = collections.defaultdict(float)
    unique = card.get('unique')
    if not unique or lb < unique['fromLb']:
        return out

    def add(effect, value):
        if effect is not None and value is not None and math.isfinite(value) and value != 0:
            out[int(effect)] += value

    for effect in unique['effects']:
        typ = effect['type']
        fields = UNIQUE_FIELDS.get(typ)
        if fields is None:
            continue
        unknown = [key for key, value in effect.items() if key not in {'type', 'value', *fields}
                   and not (re.fullmatch(r'(?:name|desc|description|text|title)(?:_[a-z_]+)?', key) and isinstance(value, str))]
        if unknown:
            continue
        if typ == 101:
            add(effect.get('value_1'), (effect.get('value_2') or 0) * share)
            add(effect.get('value_3'), (effect.get('value_4') or 0) * share)
        elif typ == 104:
            add(8, (effect.get('value_1') or 0) * share)
        elif typ == 106:
            add(1, effect.get('value', 0) * (effect.get('value_2') or 0) * share)
        elif typ == 109:
            add(8, (600 / effect['value_1'] if effect.get('value_1') else 0) * share)
        elif typ == 111:
            add(8, (effect.get('value_1') or 0) * 5 * share)
    return out


def passives(card, lb, share):
    effects = card['effectsByLb'][lb]
    extra = unique_extras(card, lb, share)
    return {i: effects.get(str(i), 0) + effects.get(f'u{i}', 0) + extra.get(i, 0) for i in range(1, 32)}
