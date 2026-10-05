import { setTimeout as sleep } from 'node:timers/promises';

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
      await wait(1_100 * 2 ** attempt);
      continue;
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt + 1 >= attempts) return response;
    const retryAfter = response.headers.get('retry-after');
    const delay = retryAfter === null ? 0 : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
    // Long server cooldowns belong to a later scheduled run, not another immediate request.
    if (delay > 60_000) return response;
    await response.body?.cancel();
    await wait(Math.max(1_100 * 2 ** attempt, Number.isFinite(delay) ? delay : 0));
  }
}
