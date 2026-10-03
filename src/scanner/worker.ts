import { createRecognizer, type Pixels, type Reference, type ScanResult } from './recognize.ts';

/** What the page asks: load the references once, then read screenshots one at a time. */
export type WorkerRequest = { kind: 'references'; references: Reference[] } | { kind: 'scan'; image: Pixels };
/** What the worker answers: `ready` to references, `progress` then `result` to a scan, `error` to either. */
export type WorkerResponse =
  | { kind: 'ready' }
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'result'; result: ScanResult }
  | { kind: 'error'; message: string };

const reply = (message: WorkerResponse) => self.postMessage(message);
let recognize: ReturnType<typeof createRecognizer> | null = null;
self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.kind === 'references') {
      recognize = createRecognizer(data.references);
      reply({ kind: 'ready' });
      return;
    }
    if (!recognize) throw new Error('Scanner references have not loaded');
    const result = recognize(data.image, (done, total) => reply({ kind: 'progress', done, total }));
    reply({ kind: 'result', result });
  } catch (error) {
    reply({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
