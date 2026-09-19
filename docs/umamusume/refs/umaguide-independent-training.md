<!-- Saved from https://uma.guide/guides/independent-training on 2026-09-05 for reference. Rendered page text, converted to Markdown. -->

# Independent Training | uma.guide | Umamusume Guides & References

Source: https://uma.guide/guides/independent-training

> Project editorial update, 2026-09-18. The race tables below replace the original uma.guide tables with [Shoppo_ura's corrected July 2026 estimates](shoppo-independent-training-race-odds.md). These are fitted independent-training odds, not manual-racing rules. Source-era deck examples and Global/JP feature notes remain dated to the 2026-09-05 snapshot.

# Independent Training ​

Independent Training is a background simulation mode designed by Cygames to eliminate the manual runtime grind for event rewards, standard items, and parent runs.

## How to Use Independent Training ​

- Set up like normal. Pick your Uma, grab your parents for inheritance, and slot in your Support Card Deck.
- Change the tab. Right on that final screen before you hit the start button, look at the top tabs. Switch it from "Normal Career" to "Independent Training."
[image: Switch to the Independent Training tab on the Final Confirmation screen.]
Switch to the Independent Training tab on the Final Confirmation screen.

- Tell the game what to do. A menu will show up asking you for:Prioritized Skills. The game will target those Skill Hints.Training Focus. Choose between Balanced, Stamina, or Sprint mode, and the game will focus on getting more of those stats. Balanced: all stats have the same priority.Stamina: slightly more priority on getting Stamina stats.Sprint: slightly more priority on getting Power stats.Agenda. If you want specific G1 races for your parent runs, you can choose them here.
- Hit start. It takes your TP, and a 50-minute countdown begins.
[image: Confirm your Training Focus, Agenda, and Prioritized Skills, then spend TP to start the run.]
Confirm your Training Focus, Agenda, and Prioritized Skills, then spend TP to start the run.

- Complete. When the remaining time reaches "0:00:00", you will be taken to the training completion confirmation screen, where the Independent Training Log will be displayed. In the Independent Training Log, you can check:The training results.Race record.Acquired Skill Hints.Inheritance results.The process after the Independent Training Log is displayed is the same as normal training.
[image: Race results in the Independent Training Log.]
Race results in the Independent Training Log.

[image: Stat gains and Support Card contributions in the Independent Training Log.]
Stat gains and Support Card contributions in the Independent Training Log.

[image: Skill Hints acquired during the run.]
Skill Hints acquired during the run.

INFO

You will be the one choosing the Skills to learn on the career completion confirmation screen, not the AI.

INFO

You can also acquire fan count, bond level, race rewards, and points from various events in the same way as normal training.

## How Winning Races Are Calculated

Independent training uses a simplified race model. Stats, skills, mood and running-style aptitude do not enter the estimated win chance. Distance aptitude, surface aptitude and consecutive races do. Manual races use different mechanics.

The [Shoppo_ura reference](shoppo-independent-training-race-odds.md) records the corrected penalty tables and the supporting sample sizes. Its 110% A/A base is attributed to Cygames; the penalties are empirical estimates with uneven coverage, especially at low aptitudes.

```text
score = 110% + distance penalty + surface penalty + streak penalty
win chance = clamp(score, 0%, 100%)
```

### Aptitudes

Rows are distance aptitude; columns are surface aptitude. S uses the same value as A. The table retains the 110% raw score because streak penalties apply before the 100% cap. For example, distance B / surface B gives 90% before a streak penalty.

| Distance \ Surface | A/S | B | C | D | E | F | G |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A/S | 110% | 100% | 90% | 80% | 60% | 50% | 20% |
| B | 100% | 90% | 80% | 70% | 50% | 40% | 10% |
| C | 90% | 80% | 70% | 60% | 40% | 30% | 0% |
| D | 80% | 70% | 60% | 50% | 30% | 20% | 0% |
| E | 70% | 60% | 50% | 40% | 20% | 10% | 0% |
| F | 50% | 40% | 30% | 20% | 0% | 0% | 0% |
| G | 20% | 10% | 0% | 0% | 0% | 0% | 0% |

Surface E has a 50-point penalty, while distance E has a 40-point penalty. Swapping distance and surface therefore does not always preserve the odds.

### Consecutive races

Racing in consecutive half-month slots applies the following penalties. A non-racing turn breaks the streak.

| Race in a streak | Penalty in percentage points |
| --- | ---: |
| 1st or 2nd | 0 |
| 3rd | -5 |
| 4th | -20 |
| 5th | -30 |
| 6th and later | -50 |

Apply the penalty to the raw score before capping the probability. An A/A trainee has 100% win chance on the third race (`110 - 5 = 105`), 90% on the fourth, 80% on the fifth and 60% from the sixth onward.

### Placement after a loss

The corrected source gives loss placements by score for a field of 18 runners. Use the score after streak penalties for this approximation; it does not establish every loss outcome or behavior for other field sizes. Scores at or above 100% always win.

| Score after penalties | Placement on a loss |
| --- | ---: |
| 95, 90, 85 or 80 | 2nd |
| 75 or 70 | 3rd |
| 65 or 60 | 4th |
| 55 | 5th |
| 50 | 6th |
| 45 | 7th |
| 40 | 8th |
| 35 | 9th |
| 30 | 10th |
| 25 | 11th |
| 20 | 12th |
| 15 | 14th |
| 10 | 15th |
| 5 | 17th |
| 0 or below | 18th |

### Objective races

An objective race with a placement requirement is always won in independent training. A participation-only objective, such as Haru Urara's Arima Kinen, uses the odds above. This exception comes from the parenting guide's observations, not Shoppo's spreadsheet. See [the objective-race source note](shoppo-independent-training-race-odds.md#objective-races).

## Tips for Getting SS Rating More Consistently ​

These are the source's Grand Concert recommendations as of 2026-09-05, not prerequisites or guarantees of SS rank.

- Use Our Grand Concert for these deck examples.
- The source recommends Light Hello for this scenario. She is not required to start a run, and this advice does not establish that SS is impossible without her.
- Event-stat estimates depend on Race Bonus and the trainee's Growth Bonuses.
- Fewer races leave more opportunities for stat gains. Omitting shared G1 wins can reduce the resulting parent's compatibility with a planned family.
TIP

Support-chain completion is not guaranteed. The saved [Loopacord measurements](../loopacord-independent-training-research.xlsx),
sheet "Chain Finish Rate Data", provide observations for one deck and race schedule.
Do not treat those rates as universal across cards and schedules.

### Example Decks ​

Low Budget
[image: Matikanefukukitaru]
[image: Kitasan Black]
[image: Shinko Windy]
[image: Nishino Flower]
[image: Marvelous Sunday]
[image: Light Hello]
High Budget
[image: Matikanefukukitaru]
[image: Agnes Tachyon]
[image: Nakayama Festa]
[image: Nishino Flower]
[image: Marvelous Sunday]
[image: Light Hello]

## Things to Know About Independent Training ​

- You cannot switch back to manual training mode once an Independent Training run is actively simulating in the background.
- Character-specific Unique Epithets (e.g. Emperor for Symboli Rudolf) cannot be unlocked during Independent Training.
- Independent Training cannot be cut short by failing an objective goal. Umas are also permitted to enter pre-scheduled races even if they fail to win their Debut Race.
- You cannot earn first-time-clear Trophies or Trophy Room rewards for winning races during an Independent Training run.
- All Scenario Story Events and Winning Live Concerts are automatically flagged as unviewed, so they won't be unlocked during Independent Training.
- Limited-time event missions, launch campaigns, or specific daily/weekly missions that track non-logged gameplay elements will not progress during Independent Training.
- A run's final stats, sparks, and rewards are not officially written to the server until you actively open and review the Independent Training Log. Daily rewards are also locked in at the exact timestamp you open this log, rather than when the 50-minute timer finishes.
- The exact limit break and levels of your chosen Support Cards and inheritance parents are snapshotted at the exact second the run begins. If you uncap or level up a Support Card while a background run is active, those updated stats will not retroactively apply to the ongoing Independent Training run.
- The Spark Reroll feature applies to the final screen of an Independent Training run.
INFO

The following were JP-only features in the source's 2026-09-05 snapshot. Check their Global release status before using them:

- For Evolution Skills that require a specific number of Rests as a condition to unlock, Independent Training mode won't unlock them.
- Skills whose final numerical potency scales dynamically based on your final Scenario Performance are automatically calculated and locked to their maximum possible value at the end of the run.
- Spark Lock will apply to the Spark Reroll feature on the final screen of an Independent Training run, same as the manual Spark Reroll.
