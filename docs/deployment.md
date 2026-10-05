# Deployment

[CI](../.github/workflows/ci.yml) validates pull requests and deploys the tested build from `main` to
Cloudflare Workers Static Assets. [wrangler.jsonc](../wrangler.jsonc) owns the site configuration.
The site needs no application server; screenshots and saved choices stay in the browser.
`main` is protected in the repository settings: a pull request with a passing Validate check, current
with `main`, is the only way in, for the owner too. Merging it is the deploy.

## Cloudflare

GitHub Actions needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
Scope the token's **Edit Cloudflare Workers** permissions to the hosting account. Before the first
deploy, register the account's workers.dev subdomain once in the Cloudflare dashboard; **Workers &
Pages** asks for one on first use. CI deploys to that subdomain.

## Game data updates

[Update game data](../.github/workflows/update-data.yml) opens a reviewable pull request for changed
snapshots; merging it publishes through the same CI checks. Enable **Allow GitHub Actions to create
and approve pull requests** in the repository's Actions settings. A failed refresh leaves the
published snapshot intact. The workflow's manual **Run workflow** button forces a check.

Pull requests opened with the workflow's token do not start CI themselves: GitHub records a failed
`pull_request` run with no jobs, which reports no checks and can be ignored. The workflow dispatches
CI on the data branch instead, and that run reports the required **Validate** as a commit status on
the pull request's head; its details link opens that run.

Run `node scripts/refresh-data.mjs --help` for the scheduling and change-detection policy. The
schedule follows confirmed Global releases. Add them to
[release-calendar.json](umamusume/release-calendar.json) as
`{"at":"2026-10-06T10:00:00Z","source":"https://example.com/official-announcement"}` entries in
`releases`, using the announced time and source URL. Prefer official monthly announcements;
[uma.moe](https://uma.moe/timeline) is an estimate, not a confirmed calendar. No automatic
announcement parser is configured.

GitHub can
[disable scheduled workflows after 60 days without repository activity](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow);
re-enable the update workflow in Actions if the repository has been idle.
