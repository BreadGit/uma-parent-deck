"""Check validation boundaries and regression behavior on independent examples."""
import unittest
import numpy as np
from card_regression import fit, grouped_folds, card_errors


class CardRegressionTests(unittest.TestCase):
    def test_grouped_folds_keep_limit_breaks_together(self):
        observations = [dict(cardId=card_id, lb=lb, card={'type': 'speed' if card_id % 2 else 'wit'})
                        for card_id in range(20) for lb in range(5)]
        seen = []
        for train, test in grouped_folds(observations):
            training_cards = {observations[i]['cardId'] for i in train}
            testing_cards = {observations[i]['cardId'] for i in test}
            self.assertFalse(training_cards & testing_cards)
            self.assertEqual(len(test), len(testing_cards) * 5)
            seen.extend(testing_cards)
        self.assertEqual(sorted(seen), list(range(20)))
        # Outcomes and LB ordering cannot change the split.
        changed = [{**o, 'stats': [100000] * 5, 'lb': 4 - o['lb']} for o in observations]
        for (_, a), (_, b) in zip(grouped_folds(observations), grouped_folds(changed)):
            np.testing.assert_array_equal(a, b)

    def test_fit_recovers_known_bond_effect_and_uses_only_training_floor(self):
        # Independent expected relationship: base floor 3, role gain 10 + 2*bond.
        training = [dict(cardId=i, role='speed.primary', initial=5, y=18 + 2 * bond,
                         values={'bond': bond}) for i, bond in enumerate([0, 10, 20, 30])]
        training.append(dict(cardId=0, role=None, initial=7, y=10, values={'bond': 0}))
        fitted = fit(training, ('bond',))
        self.assertAlmostEqual(fitted.floor, 3)
        self.assertAlmostEqual(fitted.slopes[0], 2)
        unseen = dict(cardId=99, role='speed.primary', initial=5, y=99999, values={'bond': 40})
        self.assertAlmostEqual(fitted.predict([unseen])[0], 98)
        self.assertAlmostEqual(fitted.predict([{**unseen, 'y': -99999}])[0], 98)

    def test_role_constant_attributes_do_not_get_spurious_slopes(self):
        rows = [dict(cardId=i, role='wit' if i < 3 else 'other', initial=0,
                     y=100 if i < 3 else 80, values={'recovery': 5 if i < 3 else 0}) for i in range(6)]
        fitted = fit(rows, ('recovery',), alpha=1)
        self.assertEqual(fitted.slopes[0], 0)
        np.testing.assert_allclose(fitted.predict(rows), [100, 100, 100, 80, 80, 80])

    def test_error_metric_gives_each_card_one_weight(self):
        rows = [dict(cardId=1, role='primary', y=10)] * 5 + [dict(cardId=2, role='primary', y=10)]
        errors = card_errors(rows, [12] * 5 + [14])
        self.assertEqual(errors, {1: 4, 2: 16})


if __name__ == '__main__':
    unittest.main()
