// Deploy dist/ to Cloudflare as a Worker version named after the release, so the dashboard's version
// list and `wrangler rollback` show releases by name instead of only a commit hash.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1]; };
if (args.includes('--help')) {
  console.log('Usage: node scripts/deploy.mjs [--tag <label>] [--message <text>]\n'
    + 'Uploads the built site with `wrangler versions upload`, labelled with the tag and message, then promotes that\n'
    + 'version to all traffic with `wrangler versions deploy`. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
  process.exit(0);
}

function wrangler(...command) {
  const result = spawnSync('npx', ['wrangler', ...command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  process.stdout.write(result.stdout);
  if (result.status !== 0) throw new Error(`wrangler ${command[0]} ${command[1]} exited ${result.status}`);
  return result.stdout;
}

const label = [option('--tag') && ['--tag', option('--tag')], option('--message') && ['--message', option('--message')]].flat().filter(Boolean);
const upload = wrangler('versions', 'upload', ...label);
const id = /Worker Version ID:\s*([0-9a-f-]{36})/i.exec(upload)?.[1];
if (!id) throw new Error('wrangler versions upload printed no Worker Version ID.');
wrangler('versions', 'deploy', `${id}@100%`, '--yes', ...(option('--message') ? ['--message', option('--message')] : []));
