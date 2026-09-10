import { loadData } from '../data.ts';
import { planRun, type RunInput } from '../model/run.ts';
import type { Settings } from '../settings.ts';
import type { Inventory } from '../types.ts';

const data = loadData();
self.onmessage = (event: MessageEvent<{ id: number; run: RunInput; settings: Settings; inventory: Inventory }>) => {
  const { id, run, settings, inventory } = event.data;
  try {
    const result = planRun(run, settings, inventory, data);
    self.postMessage({ id, selection: result.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed })), summary: result.search });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
