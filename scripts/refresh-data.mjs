import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { refreshDue, snapshotDigest } from './data-refresh.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
async function output(key, value) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
if (process.argv.includes('--help')) {
  console.log('Refresh GameTora data, fit and validate it, then report changed=true only for substantive snapshot changes. --due checks the weekly fallback (Monday UTC) and confirmed releases in docs/umamusume/release-calendar.json, 4–52 hours after release. GITHUB_EVENT_NAME=workflow_dispatch forces a refresh. Outputs also go to GITHUB_OUTPUT when set.');
} else if (process.argv.includes('--due')) {
  const { releases } = JSON.parse(await readFile(new URL('../docs/umamusume/release-calendar.json', import.meta.url), 'utf8'));
  await output('due', process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || refreshDue(new Date(), releases));
} else {
  const before = await snapshotDigest(root);
  const child = spawn('npm', ['run', 'fetch'], { cwd: root, stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Data refresh exited ${code}`)));
  });
  await output('changed', before !== await snapshotDigest(root));
}
