import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { RECORDED_HASHES, REFRESH_PATHS, changedSources, snapshotDigest } from './data-refresh.ts';
import { GAMETORA, GAMETORA_MANIFEST, requestSource } from './source-request.ts';

const root = resolve(import.meta.dirname, '..');
async function output(key: string, value: boolean) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
if (process.argv.includes('--help')) {
  console.log(`Refresh GameTora data, fit and validate it, then report changed=true only for substantive snapshot changes. --due makes one request, for GameTora's manifest (${GAMETORA_MANIFEST}), and reports true when a source file recorded in ${RECORDED_HASHES} has a different hash there; GITHUB_EVENT_NAME=workflow_dispatch forces a refresh. A failed manifest request fails the command. --paths lists the snapshot paths the refresh writes, one per line. Outputs also go to GITHUB_OUTPUT when set.`);
} else if (process.argv.includes('--paths')) {
  for (const path of REFRESH_PATHS) console.log(path);
} else if (process.argv.includes('--due')) {
  const response = await requestSource(GAMETORA_MANIFEST, async () => {}, GAMETORA.userAgent);
  if (!response.ok) throw new Error(`GameTora manifest request failed: HTTP ${response.status}`);
  const changed = changedSources(await response.json(), JSON.parse(await readFile(resolve(root, RECORDED_HASHES), 'utf8')));
  console.log(changed.length ? `Changed on GameTora: ${changed.join(', ')}` : 'No GameTora source file has changed since the last refresh.');
  await output('due', process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || changed.length > 0);
} else {
  const before = await snapshotDigest(root);
  const child = spawn('npm', ['run', 'fetch'], { cwd: root, stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Data refresh exited ${code}`)));
  });
  await output('changed', before !== await snapshotDigest(root));
}
