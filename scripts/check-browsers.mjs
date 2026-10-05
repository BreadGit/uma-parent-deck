// Run the checked-in browser suites against this checkout and its production build.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

async function check(mode, port, commands) {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(mode === 'preview' ? ['preview'] : []), '--host', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  const url = `http://localhost:${port}/`;
  try {
    let ready = false, probeError = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(output);
      ready = await fetch(url).then(async response => {
        await response.body?.cancel();
        probeError = `HTTP ${response.status}`;
        return response.ok;
      }, error => { probeError = String(error.cause ?? error); return false; });
      if (ready) break;
      await sleep(100);
    }
    if (!ready) throw new Error(`Server did not answer at ${url}: ${probeError}\n${output}`);
    for (const args of commands) {
      const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, URL: url, SCREENSHOT_PATH: '', BROWSER_TEST_CONCURRENCY: '1' } });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`)));
      });
    }
  } finally {
    server.kill();
    await new Promise(resolve => { if (server.exitCode !== null || server.signalCode !== null) resolve(); else server.once('exit', resolve); });
  }
}
await check('dev', 5190, [['--test', '--test-concurrency=1', 'tests/regressions.mjs', 'tests/scroll-anchor.mjs', 'tests/scanner-snapshot.mjs']]);
await check('preview', 4174, [['--test', '--test-concurrency=1', 'tests/smoke.mjs', 'tests/scanner.mjs', 'tests/scanner-worker.mjs']]);
