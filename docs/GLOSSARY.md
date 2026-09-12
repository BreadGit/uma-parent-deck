# Tool glossary

Terms for this project. See the [game glossary](umamusume/GLOSSARY.md) for Umamusume terminology.

- **Deck target** (target white spark): a white skill family the deck search tries to spark.
  Each target is Required or Preferred. Its role and minimum stars affect deck selection and goal evaluation.
- **Parent goal**: the blue, pink, and required white spark conditions that one finished parent must
  meet together. Required whites can number zero or more. With none, success depends only on blue
  and pink. The pink goal accepts any one listed aptitude at its own minimum stars. It defaults to Any
  aptitude at 1★ or better. Any accepts every eligible aptitude and cannot coexist with specifics.
  Deck search compares complete-goal chances.
- **Required white spark**: a target family that must appear at its chosen minimum stars. Every
  required family must succeed on the same parent. Gold and normal forms of Corner Recovery are
  one family, not two requirements.
- **Preferred white spark**: an optional family tracked at 2★ or better. Its absence does not make the
  parent goal fail, and it cannot also be a required family. The expected number of preferred sparks
  on successful parents distinguishes decks within the required-goal tie tolerance.
- **Complete-goal chance**: the estimated probability that every required condition holds on the same
  parent. It is not the sum of target chances. Shared event rewards and the final rank affect it.
- **Attempt**: one final spark roll, including the initial result or a reroll. The displayed counts
  assume independent attempts with the same odds, even though a reroll keeps the trained parent.
- **Inferred pink spark**: an estimated pink spark chosen to explain a starting aptitude increase.
  The tool adds the minimum missing stars, keeping existing matching sparks where possible. A grade does not
  identify the actual lineage. Editing an inferred entry makes it manual; unassigned slots count as zero sparks in the estimate.
- **Pink lineage**: the aptitude and star count of each of the six ancestors' pink sparks. Empty
  entries count as zero sparks for the estimate, so users can enter only the sparks they know.
  This is a planning default; each ancestor has a pink spark in the game. Entered and inferred sparks
  determine modeled aptitude increases. The model predicts supported B-to-A increases and gives
  probability bounds for below-B increases with matching sparks.
- **Source**: a way the run can end up with a target skill's hint: hint, chain event, random event,
  outing, scenario option or completion reward, trainee event (story, choice, outing or secret),
  innate/awakening skill, or lineage. Each has an obtain chance. Sources from one option of one event are
  modeled from the same resolved outcomes for coverage and parent goals. Rewards within one outcome can occur together;
  alternative outcomes cannot. A card's chain stages are nested, and unlinked sources are treated as independent. A secret event's chance is the product of its conditions' chances,
  with race wins scored from the agenda and conditions the tool cannot score given the fallback rate.
- **Choice-gated**: a source that only happens if the run picks that option at an event. Only one
  option per event can be taken.
- **Prioritized skills**: the tool's suggested 10-entry list for independent training. Entry tags:
  **target** (choice-gated, leads to a target), **not a target** (choice-gated, doesn't), **target, no
  choice** (given regardless, listed as filler). Only these ten steer event choices; the tool assumes their
  order decides which option wins a conflict, which the game does not confirm.
- **Choice conflict**: two or more targets (or a ranked non-target option) competing for one event's
  single option. The higher entry in the prioritized list takes it.
- **Spark chance**: estimated chance a target becomes a white spark at run end.
  **Target spark chances** in Card ranking use each card's own hint and event sources, current
  skill priorities, and lineage generation bonuses. They exclude trainee, scenario, inherited hints
  and other cards. Star quality assumes rank SS on every run. Required targets use their selected
  minimum stars, and Preferred targets use 2★+. These are not changes to the suggested deck's goal
  estimate. Cards sort by the sum of Required chances, then Preferred chances, then Total stat gain;
  sums are not displayed. Pins follow the selected sort. Only positive chances appear, with Required
  targets first and no role labels. Four targets are initially visible per card; "+N more" expands the rest in the row.
- **Coverage**: which target hints the run can obtain and through which sources. Spark chance assumes the
  player buys the gold form when available, otherwise a released ◎ upgrade if that family has one, otherwise the base skill.
  **Worst-case target SP cost**: the total base cost of those purchases, including every lower form required,
  with each family counted once and no hint discounts. For example, Swinging Maestro costs 170 SP plus
  Corner Recovery ○ at 170 SP, for 340 SP total. Right-Handed ◎ costs 110 SP plus ○ at 90 SP, for 200 SP total.
  This total is compared with the estimated SP; the run itself buys nothing.
- **Lineage** (per target): copies of that white spark already on each parent side (count and star
  total), which raise both hint and generation chances.
- **Pinned card**: a card requested for the deck. Search maximizes the number of compatible pins
  within five owned slots and one borrowed slot. Owned pins take priority for owned slots when pin
  counts tie. A pin not in the inventory asks for the borrowed slot at LB4. Borrow from all controls
  whether leftover owned pins constrain that slot. **Inventory**: your cards' limit breaks; unmarked cards count as owned at the
  default LB.
- **Observed / model** (basis): whether a card's stat contribution comes from logged runs or our estimated fitted
  formula.
- **Event stats**: the deck-independent part of a run's stat gain (training events, races, scenario),
  measured from logs; **card stats**: the per-card contributions from the in-game log.
- **Race scale**: card stats grow as races shrink, by (T − races)/(T − 28) with T fitted (≈72).
- **Advanced settings**: rates the game does not publish and that we made an educated guess on, with their provenance in the tooltip.
