import { createRecognizer, type Pixels, type Reference } from './recognize.ts';

export type WorkerRequest = { kind: 'references'; references: Reference[] } | { kind: 'scan'; image: Pixels };
let recognize: ReturnType<typeof createRecognizer> | null = null;
self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.kind === 'references') { recognize = createRecognizer(data.references); return; }
    if (!recognize) throw new Error('Scanner references have not loaded');
    const result = recognize(data.image, (done, total) => self.postMessage({ kind: 'progress', done, total }));
    self.postMessage({ kind: 'result', result });
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
