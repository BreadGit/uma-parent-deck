// Wording that more than one module shows, defined once so renaming a panel or a control updates every sentence that
// points to it. Text only one module shows lives in that module; tests/copy-usage.test.ts checks both rules.

/** Panel titles, including those other panels' instructions name. */
export const TITLE = {
  details: 'Prediction details', goal: 'Parent goal', legacy: 'Legacy', run: 'Run', deck: 'Suggested deck',
  coverage: 'Target coverage', ranking: 'Card ranking', prediction: 'Predicted run', missions: 'Mission races',
  inventory: 'Card inventory', scanner: 'Import using screenshots', advanced: 'Advanced settings',
} as const;

/** Control labels shown, or named in instructions, by more than one module. */
export const LABEL = {
  scenario: 'Scenario', importFile: 'Import from file', basisColumn: 'Basis', minimumStars: 'Minimum stars', selectCard: 'Choose a card',
  useInventory: 'Use inventory',
  unpin: (name: string) => `Unpin ${name}`,
  unignore: (name: string) => `Stop ignoring ${name}`,
} as const;
