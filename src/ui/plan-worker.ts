import { loadData } from '../data.ts';
import { planRun, type RunInput, type DeckSelection, type GoalSearchSummary } from '../model/run.ts';
import type { Settings } from '../settings.ts';
import { errorMessage, type Inventory } from '../types.ts';

const data = loadData();
export interface PlanWorkerRequest { id: number; run: RunInput; settings: Settings; inventory: Inventory }
/** One answer per request, after both search stages: the deck found, or why the search failed. */
export type PlanWorkerResponse =
  | { id: number; kind: 'result'; selection: DeckSelection; summary?: GoalSearchSummary }
  | { id: number; kind: 'error'; message: string };
const reply = (response: PlanWorkerResponse) => self.postMessage(response);
self.onmessage = (event: MessageEvent<PlanWorkerRequest>) => {
  const { id, run, settings, inventory } = event.data;
  try {
    const result = planRun(run, settings, inventory, data);
    reply({ id, kind: 'result', selection: result.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed })), summary: result.search ?? undefined });
  } catch (error) {
    reply({ id, kind: 'error', message: errorMessage(error) });
  }
};
