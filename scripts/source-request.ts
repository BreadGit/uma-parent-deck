import { setTimeout as sleep } from 'node:timers/promises';

/** A generic browser user agent: requests to sources carry nothing that identifies this tool or its user. */
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/** GameTora load policy: one request at a time, about 1.1 s apart, with a generic browser user agent and no identifying headers. */
export const GAMETORA = {
  base: 'https://gametora.com',
  userAgent: BROWSER_USER_AGENT,
  delayMs: 1_100,
} as const;

/** Spaces requests at least `delayMs` apart and counts them. Pass `wait` to requestSource. */
export function createThrottle(delayMs: number = GAMETORA.delayMs) {
  let last = 0, count = 0;
  return {
    async wait() {
      // A timer can fire a millisecond early by the clock, so wait until the full delay has passed.
      for (let ms = last + delayMs - Date.now(); ms > 0; ms = last + delayMs - Date.now()) await sleep(ms);
      last = Date.now();
      count++;
    },
    get count() { return count; },
  };
}

/** Retry temporary upstream failures without bypassing the importer's request throttle. */
export async function requestSource(url: string, beforeRequest: () => Promise<void>, userAgent: string,
  { attempts = 3, timeoutMs = 30_000, wait = (ms: number) => sleep(ms) } = {}) {
  for (let attempt = 0; ; attempt++) {
    await beforeRequest();
    let response: Response;
    try {
      response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (attempt + 1 >= attempts) throw error;
      await wait(GAMETORA.delayMs * 2 ** attempt);
      continue;
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt + 1 >= attempts) return response;
    const retryAfter = response.headers.get('retry-after');
    const delay = retryAfter === null ? 0 : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
    // Long server cooldowns belong to a later scheduled run, not another immediate request.
    if (delay > 60_000) return response;
    await response.body?.cancel();
    await wait(Math.max(GAMETORA.delayMs * 2 ** attempt, Number.isFinite(delay) ? delay : 0));
  }
}
