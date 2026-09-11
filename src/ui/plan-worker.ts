import { loadData } from '../data.ts';
import { planRun, type RunInput, type DeckSelection, type GoalSearchSummary } from '../model/run.ts';
import type { Settings } from '../settings.ts';
import type { Inventory } from '../types.ts';

const data = loadData();
export interface PlanWorkerRequest { id: number; run: RunInput; settings: Settings; inventory: Inventory; previous?: DeckSelection }
export interface PlanWorkerResponse { id: number; complete: boolean; selection?: DeckSelection; summary?: GoalSearchSummary; error?: string }
self.onmessage = (event: MessageEvent<PlanWorkerRequest>) => {
  const { id, run, settings, inventory, previous } = event.data;
  const publish = (selection: DeckSelection, summary: GoalSearchSummary) => self.postMessage({ id, selection, summary, complete: false } satisfies PlanWorkerResponse);
  try {
    const result = planRun(run, settings, inventory, data, { previous, onProgress: publish });
    self.postMessage({ id, complete: true, selection: result.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed })), summary: result.search ?? undefined } satisfies PlanWorkerResponse);
  } catch (error) {
    self.postMessage({ id, complete: true, error: error instanceof Error ? error.message : String(error) } satisfies PlanWorkerResponse);
  }
};
