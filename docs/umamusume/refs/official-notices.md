# Official in-game notices

Source: the notice feed behind [umamusume.com/news](https://umamusume.com/news/), retrieved
2026-10-05. The page posts `{"announce_label":0,"limit":10,"offset":0}` to
`https://umamusume.com/api/ajax/pr_info_index?format=json` and receives `information_list`
entries with `announce_id`, `title`, `message` (HTML), `post_at`, `update_at` and
`announce_label` (1 for in-game notices, 3 for site news). `post_at` is UTC: a notice stamped
`2026-10-04 22:00:00` says the event ended at 10:00 p.m., Oct 4 (UTC). The endpoint is not
documented by Cygames; `tests/fixtures/notices.json` keeps the titles and times observed.

Observed cadence, July to October 2026: 88 of the last 100 notices were posted at exactly 22:00
UTC, the daily release slot. Content goes live with a notice at that time ("... Scouts out now!",
"The story event ... is here!", "... now available!", and a site-news "Check out all the latest
updates!" for card and trainee releases). The matching "... coming soon!" notice appears exactly
24 hours earlier and states the start time. Maintenance for a scenario release was announced about
a day ahead with its window (4:00 a.m. to 8:00 a.m., Jul 22, 2026 UTC) and the content still went
live at 22:00 UTC that day. The Steam news feed for app 3224770 repeats the release-day posts at
22:00 UTC and carries nothing in advance.

The data refresh in `scripts/data-refresh.ts` treats a release notice as the signal to re-fetch
GameTora. That is a modeling assumption: GameTora's own update time after a release is not
observed here, which is why the refresh retries the next day.
