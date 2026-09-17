import { test } from 'node:test';
import { runAnalysisTests } from './python.ts';

test('card evaluation keeps held-out cards separate and fits known numeric relationships', (t) => {
  runAnalysisTests(t, 'test_card_regression.py');
});
