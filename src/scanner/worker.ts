import { recognize, type Pixels, type Reference } from './recognize.ts';

export type WorkerRequest = { kind: 'references'; references: Reference[] } | { kind: 'scan'; image: Pixels };
let references: Reference[] = [];
self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.kind === 'references') { references = data.references; return; }
  try {
    const result = recognize(data.image, references, (done, total) => self.postMessage({ kind: 'progress', done, total }));
    self.postMessage({ kind: 'result', result });
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
