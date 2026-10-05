# Deployment

[CI](../.github/workflows/ci.yml) runs the unit tests and the build on every push to `main`, adds
the browser suites for pull requests, manual runs and `v*` tags, and deploys a release when a `v*`
tag is pushed: the tagged build goes to Cloudflare Workers Static Assets.
[wrangler.jsonc](../wrangler.jsonc) owns the site configuration. The site needs no application server; screenshots and saved choices stay in the
browser.

## Releases

`main` is the working branch; pushing it publishes nothing. A release is a calendar version
`YYYY.MM.N`, where `N` counts that month's releases from 1: `2026.10.1`, `2026.10.2`, `2026.11.1`.
The release version carries no compatibility meaning; the share-link format and the saved-state
migration carry their own versions ([sharing](sharing.md)). Cut a release from a validated `main`
commit:

```sh
npm version 2026.10.1   # writes package.json, commits, and tags v2026.10.1
git push --follow-tags
```

CI validates the tag again and deploys it. The deploy refuses a tag whose commit is not on `main`.
The tag list is the release history; no GitHub release or release notes are written. To redeploy a release, run the CI workflow manually on its tag. `npx wrangler rollback` returns the
site to an earlier upload without a new tag.

Repository rulesets keep `main` and `v*` tags from being force-pushed, moved or deleted, and the
`production` environment accepts deployments only from `v*` tags. Both are repository settings, not
files in this checkout.

## Cloudflare

GitHub Actions needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
Scope the token's **Edit Cloudflare Workers** permissions to the hosting account. Before the first
deploy, register the account's workers.dev subdomain once in the Cloudflare dashboard; **Workers &
Pages** asks for one on first use. CI deploys to that subdomain.

## Game data updates

[Update game data](../.github/workflows/update-data.yml) opens a reviewable pull request for changed
snapshots; merging it lands them on `main`, and the next release publishes them. Enable **Allow GitHub Actions to create
and approve pull requests** in the repository's Actions settings. A failed refresh leaves the
published snapshot intact. The workflow's manual **Run workflow** button forces a check.

Pull requests opened with the workflow's token do not start CI themselves: GitHub records a failed
`pull_request` run with no jobs, which reports no checks and can be ignored. The workflow dispatches
CI on the data branch instead, and that run reports **Validate** as a commit status on the pull
request's head; its details link opens that run.

Run `node scripts/refresh-data.mjs --help` for the scheduling and change-detection policy. The
schedule follows the game's own release notices ([official notices](umamusume/refs/official-notices.md)),
so nothing needs to be entered by hand. If the feed changes shape, the run logs a warning and only
the weekly fallback refreshes until `scripts/data-refresh.ts` is updated.

GitHub can
[disable scheduled workflows after 60 days without repository activity](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow);
re-enable the update workflow in Actions if the repository has been idle.
