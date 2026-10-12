// Deploy dist/ to Cloudflare as a Worker version named after the release, so the dashboard's version
// list and `wrangler rollback` show releases by name instead of only a commit hash.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
/** @param {string} name */
const option = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1]; };
if (args.includes('--help')) {
  console.log('Usage: node scripts/deploy.mjs [--tag <label>] [--message <text>] [--require-latest]\n'
    + 'Uploads the built site with `wrangler versions upload`, labelled with the tag and message, then promotes that\n'
    + 'version to all traffic with `wrangler versions deploy`. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.\n'
    + '--require-latest requires --tag and checks origin before upload and promotion, skipping superseded releases.\n'
    + '--latest-tag prints the newest v* tag on origin without deploying (blank when no release exists).\n'
    + 'Release ordering uses Git version sorting. Guarded deployments refuse an unreadable or empty release list.\n'
    + 'GITHUB_OUTPUT receives deployed=true/false; skipped releases are explained in GITHUB_STEP_SUMMARY.');
  process.exit(0);
}

/** Read origin rather than checkout tags, which may be stale or include local-only releases. */
function latestRelease() {
  const result = spawnSync('git', ['ls-remote', '--tags', '--refs', '--sort=-version:refname', 'origin', 'refs/tags/v*'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error('Could not read release tags from origin; refusing deployment.', { cause: result.error });
  return result.stdout.trim().split('\n')[0]?.split('\t')[1]?.replace(/^refs\/tags\//, '') ?? '';
}
if (args.includes('--latest-tag')) {
  console.log(latestRelease());
  process.exit(0);
}

const tag = option('--tag');
const requireLatest = args.includes('--require-latest');
if (requireLatest && !tag?.startsWith('v')) throw new Error('--require-latest needs --tag <v* release>.');

/** @param {boolean} deployed */
function output(deployed) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `deployed=${deployed}\n`);
}
function currentRelease() {
  if (!requireLatest) return true;
  const latest = latestRelease();
  if (!latest) throw new Error('Origin has no v* release tags; refusing deployment.');
  if (tag === latest) return true;
  const message = `Skipped ${tag}: superseded by ${latest}. No promotion performed.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  output(false);
  return false;
}

/** @param {string[]} command */
function wrangler(...command) {
  const result = spawnSync('npx', ['wrangler', ...command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  process.stdout.write(result.stdout ?? '');
  if (result.status !== 0) throw new Error(`wrangler ${command[0]} ${command[1]} exited ${result.status}`);
  return result.stdout ?? '';
}

const label = [];
for (const name of ['--tag', '--message']) {
  const value = option(name);
  if (value) label.push(name, value);
}
if (!currentRelease()) process.exit(0);
const upload = wrangler('versions', 'upload', ...label);
const id = /Worker Version ID:\s*([0-9a-f-]{36})/i.exec(upload)?.[1];
if (!id) throw new Error('wrangler versions upload printed no Worker Version ID.');
// A new release can appear during upload. The workflows retain the production lock through this check and promotion.
if (!currentRelease()) process.exit(0);
const message = option('--message');
wrangler('versions', 'deploy', `${id}@100%`, '--yes', ...(message ? ['--message', message] : []));
output(true);
