# Fan rewards

Sources checked 2026-09-11. These distinguish measured manual-training rewards from assumptions
about independent training. A completed run's displayed fans are not enough to identify every reward.

## Concert measurements

[mee1080/umasim's Grand Live notes](https://github.com/mee1080/umasim/blob/018546efe2e555c87128d3962603117904910337/data/grand_live_memo.md)
are primary manual JP observations. The [vendored original](umasim-grand-live-memo.md) is unchanged,
from commit `018546efe2e555c87128d3962603117904910337`, retrieved 2026-09-11.
The repository's [AGPL-3.0 license](umasim-LICENSE) is included. See the sections
`ステータスアップ` and `ライブ上昇量` for the reward summary and individual observations.

| Concert | Calendar timing | Success | Great success |
|---|---|---:|---:|
| First promotion | Junior late December | 100 | 1,000 |
| Second promotion | Classic late June | 200 | 2,000 |
| Third promotion | Classic late December | 550 | 5,500 |
| Fourth promotion | Senior late June | 650 | 6,500 |
| Ordinary final | Senior late December | 200 | 2,000 |
| Special final | Senior late December | N/A | 9,000 |

The notes require at least 18 total songs and two new songs in the final period for the special
concert. The special concert always achieves great success. Four great promotional concerts
and a special final award 24,000 fans in total. The ordinary final replaces the special final.
Rewards become available after the concert turn, not at the start of that turn.

These measurements do not establish independent-training concert outcome probabilities or whether
the deck's Fan Bonus multiplies concert rewards in independent training. Applying that multiplier
fits the two reported Fuji runs more closely, but this is a hypothesis, not a verified mechanic.

## Race rewards

The vendored [mechanics guide](../mechanics.txt), under Fan Bonus, describes the deck effect on fans.
[GameWith's own 38-trial measurement](https://gamewith.jp/uma-musume/article/show/261535) reports
base fans multiplied by the additive deck Fan Bonus and a random multiplier. The measured mean is
1.053, with observed values from 1.00 to 1.09. This sample does not prove the distribution or its limits
in independent training.

[TMA's fan calculator](https://tma.main.jp/uma/fan_calc.php) lists the URA finale win rewards as
7,000, 10,000 and 30,000. These races occur after the regular calendar. In independent training,
the [objective-race rule](shoppo-independent-training-race-odds.md#objective-races) guarantees wins
for objectives that require a placing. These rewards describe a completed run.

The [community race-program table](https://wikiwiki.jp/sppenpen/レープロ) gives the placing ratios
below. This is secondary evidence; it is not an official specification. No separate post-race event
fan increase is included in these ratios.

| Place | Share of first-place fans |
|---|---:|
| 1 | 100% |
| 2 | 40% |
| 3 | 25% |
| 4 | 15% |
| 5 | 10% |
| Below 5 | No placing reward |

[Shoppo's empirical loss-place table](shoppo-independent-training-race-odds.md#finishing-place-on-a-loss-18-runners-no-streak)
uses 18 runners. Applying it to the win chance after streak penalties is an approximation.
Runner counts and all possible loss outcomes are not known for every agenda race.

## Support effects by level

[Umasim's support data](https://github.com/mee1080/umasim/blob/018546efe2e555c87128d3962603117904910337/data/support_card.txt)
provides an independent comparison for the cached GameTora level anchors. Interpolate linearly
between explicit anchors, round down, keep zero before the first unlock, and hold the last value
after the final anchor. Unique effects have their own unlock level.

Light Hello SSR has Fan Bonus 5/6/8/10/10 and Race Bonus 1/2/3/5/5 at LB0 through LB4.
Her LB2 level is 40. The six-card deck in the [Fuji observations](../fuji-independent-training-runs.json)
has 68% Fan Bonus at the level caps corresponding to the reported LBs.
