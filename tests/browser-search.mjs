// Editor tests use the app's real immediate estimates while holding optimizer work pending.
// Smoke releases the latest request to a native worker before checking completed-result layout.
export async function holdSearch(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const active = new Set();
    window.__searchHeld = true;
    window.Worker = class {
      constructor(...args) {
        if (!String(args[0]).includes('/plan-worker')) return new NativeWorker(...args);
        this.args = args; active.add(this);
      }
      postMessage(request) { this.request = structuredClone(request); }
      terminate() { active.delete(this); this.worker?.terminate(); }
      resume() {
        this.worker = new NativeWorker(...this.args);
        this.worker.onmessage = (event) => this.onmessage?.(event);
        this.worker.onerror = (event) => this.onerror?.(event);
        this.worker.postMessage(this.request);
      }
    };
    window.__releaseSearch = () => {
      window.Worker = NativeWorker;
      window.__searchHeld = false;
      for (const worker of active) worker.resume();
      active.clear();
    };
  });
}

export async function releaseSearch(page) {
  await page.evaluate(() => window.__releaseSearch());
}
