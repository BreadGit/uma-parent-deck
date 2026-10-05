import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { requestSource } from '../scripts/source-request.ts';

test('source requests retry temporary errors, throttle every attempt and bound failures', async (t) => {
  let calls = 0, throttled = 0;
  const server = createServer((req, res) => {
    calls++;
    if (req.url === '/hang') return;
    res.writeHead(req.url === '/missing' ? 404 : calls === 1 ? 503 : 200);
    res.end('source');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const throttle = async () => { throttled++; };
  const waits: number[] = [];
  const options = { wait: async (ms: number) => { waits.push(ms); } };
  assert.equal(await (await requestSource(url, throttle, 'test', options)).text(), 'source');
  assert.equal(calls, 2);
  assert.equal(throttled, 2);
  assert.deepEqual(waits, [1100]);
  assert.equal((await requestSource(`${url}/missing`, throttle, 'test', options)).status, 404);
  assert.equal(calls, 3);
  await assert.rejects(requestSource(`${url}/hang`, throttle, 'test', { ...options, attempts: 2, timeoutMs: 50 }));
  assert.equal(throttled, 5);
});
