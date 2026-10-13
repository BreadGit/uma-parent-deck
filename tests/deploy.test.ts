import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// Every remote is a temporary local repository; npx records calls instead of contacting Cloudflare.
async function fixture(t: TestContext, tags: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'uma-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout'), origin = join(root, 'origin.git'), bin = join(root, 'bin');
  await mkdir(join(checkout, 'scripts'), { recursive: true });
  await mkdir(bin);
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: checkout, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet', '--bare', '--initial-branch=main', origin);
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  await writeFile(join(checkout, 'scripts/deploy.mjs'), 'throw new Error("Historical release helper must not run");\n');
  git('add', 'scripts/deploy.mjs');
  git('commit', '--quiet', '-m', 'Fixture release');
  const commit = git('rev-parse', 'HEAD');
  git('remote', 'add', 'origin', origin);
  for (const tag of tags) git('tag', '-a', tag, '-m', tag);
  git('push', '--quiet', 'origin', 'main', '--tags');
  // A local-only future tag must not block a released build.
  git('tag', 'v2099.12.99');
  if (tags.length) git('checkout', '--quiet', tags[0]!);

  // As in update-data.yml, keep the current helper outside the checkout of historical release code.
  const helper = join(root, 'uma-deploy.mts');
  await writeFile(helper, await readFile(new URL('../scripts/deploy.ts', import.meta.url)));
  await writeFile(join(bin, 'npx'), `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
appendFileSync(process.env.MOCK_CALLS, JSON.stringify(args) + '\\n');
if (args[0] !== 'wrangler' || args[1] !== 'versions') throw new Error('Unexpected command');
if (args[2] === 'upload') {
  if (process.env.MOCK_NEW_TAG) {
    const result = spawnSync('git', ['--git-dir', process.env.MOCK_ORIGIN, 'update-ref', 'refs/tags/' + process.env.MOCK_NEW_TAG, process.env.MOCK_COMMIT]);
    if (result.status !== 0) process.exit(1);
  }
  if (process.env.MOCK_LOSE_ORIGIN) {
    const result = spawnSync('git', ['remote', 'remove', 'origin']);
    if (result.status !== 0) process.exit(1);
  }
  console.log('Worker Version ID: 12345678-1234-1234-1234-123456789abc');
} else if (args[2] !== 'deploy') throw new Error('Unexpected versions command');
`, { mode: 0o755 });
  const calls = join(root, 'calls.jsonl'), output = join(root, 'output'), summary = join(root, 'summary');
  const contents = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
  return {
    git,
    run: (args: string[], extra: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [helper, ...args], {
      cwd: checkout, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, MOCK_ORIGIN: origin, MOCK_COMMIT: commit,
        MOCK_CALLS: calls, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...extra },
    }),
    calls: () => contents(calls).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]),
    output: () => contents(output),
    summary: () => contents(summary),
  };
}

test('release selection uses remote version order and ignores local-only and non-release tags', async (t) => {
  const f = await fixture(t, ['v2026.10.2', 'v2026.10.10', 'unrelated']);
  const result = f.run(['--latest-tag']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'v2026.10.10');
  assert.deepEqual(f.calls(), []);
  assert.equal(f.output(), '');
});

test('a superseded release finishing last skips upload and promotion with an explicit summary', async (t) => {
  const f = await fixture(t, ['v2026.10.2', 'v2026.10.3']);
  const result = f.run(['--require-latest', '--tag', 'v2026.10.2']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls(), []);
  assert.equal(f.output(), 'deployed=false\n');
  assert.match(f.summary(), /Skipped v2026\.10\.2: superseded by v2026\.10\.3/);
});

test('the current helper promotes a current historical release with the uploaded version and labels', async (t) => {
  const f = await fixture(t, ['v2026.10.2']);
  const result = f.run(['--require-latest', '--tag', 'v2026.10.2', '--message', 'Data refresh fixture']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls(), [
    ['wrangler', 'versions', 'upload', '--tag', 'v2026.10.2', '--message', 'Data refresh fixture'],
    ['wrangler', 'versions', 'deploy', '12345678-1234-1234-1234-123456789abc@100%', '--yes', '--message', 'Data refresh fixture'],
  ]);
  assert.equal(f.output(), 'deployed=true\n');
  assert.equal(f.summary(), '');
});

test('a newer tag appearing during upload prevents the uploaded version from being promoted', async (t) => {
  const f = await fixture(t, ['v2026.10.2']);
  const result = f.run(['--require-latest', '--tag', 'v2026.10.2'], { MOCK_NEW_TAG: 'v2026.10.3' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls().map((args) => args.slice(0, 3)), [['wrangler', 'versions', 'upload']]);
  assert.equal(f.output(), 'deployed=false\n');
  assert.match(f.summary(), /superseded by v2026\.10\.3/);
});

test('an unreadable origin before upload fails without calling wrangler', async (t) => {
  const f = await fixture(t, ['v2026.10.2']);
  f.git('remote', 'remove', 'origin');
  const result = f.run(['--require-latest', '--tag', 'v2026.10.2']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not read release tags from origin/);
  assert.deepEqual(f.calls(), []);
  assert.equal(f.output(), '');
});

test('losing origin after upload fails without promoting or reporting success', async (t) => {
  const f = await fixture(t, ['v2026.10.2']);
  const result = f.run(['--require-latest', '--tag', 'v2026.10.2'], { MOCK_LOSE_ORIGIN: 'true' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not read release tags from origin/);
  assert.equal(f.calls().length, 1);
  assert.equal(f.output(), '');
});

test('no release is a read-only blank selection but cannot authorize a guarded deployment', async (t) => {
  const f = await fixture(t, []);
  const latest = f.run(['--latest-tag']);
  assert.equal(latest.status, 0, latest.stderr);
  assert.equal(latest.stdout.trim(), '');
  const result = f.run(['--require-latest', '--tag', 'v2026.10.2']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no v\* release tags/);
  assert.deepEqual(f.calls(), []);
});

test('guarded deployment requires a release tag before performing any external command', async (t) => {
  const f = await fixture(t, ['v2026.10.2']);
  const result = f.run(['--require-latest']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs --tag/);
  assert.deepEqual(f.calls(), []);
});
