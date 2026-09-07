# Independent training race odds (Shoppo_ura, July 2026)

Source: https://docs.google.com/spreadsheets/d/1e6KPdIXPM7-8e9So3Bd3Pl3arO0aTeFdjI0P_1-4iFo/edit?gid=1621158841
(sheet 「自主トレ育成＆継承専用ウマ娘」レース勝率), linked from Crazyfellow's Parenting & Gene guide
(`docs/refs/crazyfellow-parenting-gene-guide.txt`, "Special race win chance mechanics"). Exported 2026-09-06 as CSV.
The 110% base for A/A is a Cygames statement; the penalties are Shoppo_ura's fitted values, corrected on
2026-07-26 after earlier interpolation of E and F. The empirical sample below is from Shoppo_ura's tweets as quoted
in the guide.

Used by `src/model/races.ts` (`rawWinScore`, `winChance`) and `src/model/rules.ts` with tests in `tests/model.test.ts`.

## Model

```text
score = 110% + surface penalty + distance penalty + streak penalty
win chance = clamp(score, 0%, 100%)
```

Stats, skills, mood and running style do not enter. S aptitude behaves as A. The streak penalty applies to the
unclamped score, so A/A absorbs the third race's penalty (105% shows as 100%).

| Surface grade | Penalty | Distance grade | Penalty | Race in a streak | Penalty |
|---|---:|---|---:|---|---:|
| A (or S) | 0 | A (or S) | 0 | 1st | 0 |
| B | −10 | B | −10 | 2nd | 0 |
| C | −20 | C | −20 | 3rd | −5 |
| D | −30 | D | −30 | 4th | −20 |
| E | −50 | E | −40 | 5th | −30 |
| F | −60 | F | −60 | 6th and later | −50 |
| G | −90 | G | −90 | | |

Note the asymmetry: surface E is −50 while distance E is −40.

## Win chance by aptitude pair, no streak

Rows are distance aptitude, columns surface aptitude.

| | Surface A | B | C | D | E | F | G |
|---|---:|---:|---:|---:|---:|---:|---:|
| Distance A | 110% | 100% | 90% | 80% | 60% | 50% | 20% |
| B | 100% | 90% | 80% | 70% | 50% | 40% | 10% |
| C | 90% | 80% | 70% | 60% | 40% | 30% | 0% |
| D | 80% | 70% | 60% | 50% | 30% | 20% | 0% |
| E | 70% | 60% | 50% | 40% | 20% | 10% | 0% |
| F | 50% | 40% | 30% | 20% | 0% | 0% | 0% |
| G | 20% | 10% | 0% | 0% | 0% | 0% | 0% |

Values above 100% are the raw score; the displayed probability is 100%.

## Win chance by streak position (score columns)

| Streak | 110 | 100 | 90 | 80 | 70 | 60 | 50 | 40 | 30 | 20 | 10 | 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1st, 2nd | 110 | 100 | 90 | 80 | 70 | 60 | 50 | 40 | 30 | 20 | 10 | 0 |
| 3rd | 105 | 95 | 85 | 75 | 65 | 55 | 45 | 35 | 25 | 15 | 5 | 0 |
| 4th | 90 | 80 | 70 | 60 | 50 | 40 | 30 | 20 | 10 | 0 | 0 | 0 |
| 5th | 80 | 70 | 60 | 50 | 40 | 30 | 20 | 10 | 0 | 0 | 0 | 0 |
| 6th and later | 60 | 50 | 40 | 30 | 20 | 10 | 0 | 0 | 0 | 0 | 0 | 0 |

## Finishing place on a loss (18 runners), no streak

The sheet also lists the expected finishing place when the roll fails, by score: 100% and above always win; 95 and
90 give 2nd; 85 and 80 give 2nd; 75 and 70 give 3rd; 65 and 60 give 4th; 55 gives 5th; 50 gives 6th; 45 gives 7th;
40 gives 8th; 35 gives 9th; 30 gives 10th; 25 gives 11th; 20 gives 12th; 15 gives 14th; 10 gives 15th; 5 gives 17th;
0 gives 18th. Not used by this project.

## Empirical sample (Shoppo_ura's tweets, quoted in the guide)

| Surface | Distance | Consecutive | Wins | Trials | Win rate | 95% CI |
|---|---|---|---:|---:|---:|---:|
| A | A | under 3 | 1404 | 1404 | 100.0% | 0.0% |
| A | A | 3 | 420 | 420 | 100.0% | 0.0% |
| A | A | 4 | 180 | 210 | 85.7% | 4.7% |
| A | A | 5 | 79 | 105 | 75.2% | 8.3% |
| A | A | over 5 | 309 | 525 | 58.9% | 4.2% |
| A | B | under 3 | 741 | 741 | 100.0% | 0.0% |
| A | B | 3 | 194 | 210 | 92.4% | 3.6% |
| A | B | 4 | 161 | 210 | 76.7% | 5.7% |
| A | B | 5 | 227 | 315 | 72.1% | 5.0% |
| A | B | over 5 | 230 | 420 | 54.8% | 4.8% |
| A | C | under 3 | 18 | 20 | 90.0% | 13.2% |
| A | C | 3 | 7 | 10 | 70.0% | 28.4% |
| A | C | 4 | 6 | 10 | 60.0% | 30.4% |
| A | C | 5 | 5 | 10 | 50.0% | 31.0% |
| A | C | over 5 | 186 | 510 | 36.5% | 4.2% |
| A | D | under 3 | 55 | 68 | 80.9% | 9.4% |
| A | D | 3 | 20 | 32 | 62.5% | 16.8% |
| A | D | 4 | 11 | 20 | 55.0% | 21.8% |
| A | D | 5 | 9 | 16 | 56.3% | 24.3% |
| A | D | over 5 | 33 | 88 | 37.5% | 10.1% |
| G | A | under 3 | 32 | 121 | 26.4% | 7.9% |
| G | A | 3 | 4 | 10 | 40.0% | 30.4% |
| G | A | 4 | 0 | 25 | 0.0% | 0.0% |
| G | A | 5 | 0 | 5 | 0.0% | 0.0% |
| G | A | over 5 | 0 | 10 | 0.0% | 0.0% |
| G | B | under 3 | 16 | 105 | 15.2% | 6.9% |

The model's 90 / 80 / 60 for A/A at the 4th, 5th and later races sit inside these intervals. The G/A rows (model
20%) and the small A/C and A/D samples are the loosest fits.

## Objective races

From the guide, not the sheet: an objective race the run would end on losing (any placement requirement) is always
won in independent training. A participation-only objective (Haru Urara's Arima Kinen) rolls the odds above.
GameTora's objective data carries this as `cond_value` (1 = win, 3 = top three, 5 = top five, 0 = take part).
