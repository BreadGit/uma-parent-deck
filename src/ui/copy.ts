export const TITLE = {
  details: 'Prediction details', goal: 'Parent goal', legacy: 'Legacy', run: 'Run', deck: 'Suggested deck',
  coverage: 'Target coverage', ranking: 'Card ranking', prediction: 'Predicted run', missions: 'Mission races',
  inventory: 'Card inventory', scanner: 'Import using screenshots', advanced: 'Advanced settings',
} as const;

export const LABEL = {
  scenario: 'Scenario', importFile: 'Import from file', basisColumn: 'Basis', minimumStars: 'Minimum stars', selectCard: 'Choose a card',
  useInventory: 'Use inventory',
  unpin: (name: string) => `Unpin ${name}`,
  unignore: (name: string) => `Stop ignoring ${name}`,
} as const;
