import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { NOTICE_FEED, REFRESH_PATHS, RELEASE_TITLE, RELEASE_WINDOW_HOURS, WEEKLY_CHECK, RECOVER_DATA, beginDataUpdate, completeDataUpdate, dataUpdateIncomplete, requireCompleteData, noticesFrom, refreshDue, snapshotDigest } from './data-refresh.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
async function output(key: string, value: boolean) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
if (process.argv.includes('--help')) {
  console.log(`Refresh GameTora data, fit and validate it, then report changed=true only for substantive snapshot changes. --due reports true when the official notice feed (${NOTICE_FEED.url}) has a notice matching ${RELEASE_TITLE} posted ${RELEASE_WINDOW_HOURS[0]} to ${RELEASE_WINDOW_HOURS[1]} hours ago, and for the weekly fallback (UTC day ${WEEKLY_CHECK.utcDay}, Monday, during hour ${WEEKLY_CHECK.utcHour}). A feed failure is reported and leaves only the fallback. GITHUB_EVENT_NAME=workflow_dispatch forces a refresh. --paths lists the snapshot paths the refresh writes, one per line. Outputs also go to GITHUB_OUTPUT when set.`);
  console.log(`--begin marks a data update incomplete; --complete clears it after successful data validation; --check refuses an incomplete update. Use ${RECOVER_DATA} to rebuild from cached sources, refit and validate without fetching. An incomplete update blocks npm builds; the marker is never part of the published dataset.`);
} else if (process.argv.includes('--begin')) {
  if (await dataUpdateIncomplete(root)) console.warn(`The previous data refresh did not complete. This run will retry it; offline recovery is ${RECOVER_DATA}.`);
  await beginDataUpdate(root);
} else if (process.argv.includes('--complete')) {
  await completeDataUpdate(root);
} else if (process.argv.includes('--check')) {
  await requireCompleteData(root);
} else if (process.argv.includes('--paths')) {
  for (const path of REFRESH_PATHS) console.log(path);
} else if (process.argv.includes('--due')) {
  const notices = await fetch(NOTICE_FEED.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(NOTICE_FEED.request), signal: AbortSignal.timeout(30_000) })
    .then(async response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return noticesFrom(await response.json()); })
    .catch(error => { console.warn(`Notice feed unavailable, only the weekly fallback applies: ${error.message ?? error}`); return []; });
  for (const notice of notices.filter(notice => RELEASE_TITLE.test(notice.title)).slice(0, 5)) console.log(`${notice.postedAt.toISOString()} ${notice.title}`);
  await output('due', process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || refreshDue(new Date(), notices));
} else {
  const before = await snapshotDigest(root);
  const child = spawn('npm', ['run', 'fetch'], { cwd: root, stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Data refresh exited ${code}`)));
  });
  await output('changed', before !== await snapshotDigest(root));
}
