# Parent goal evaluator, phase 1

Implemented 2026-09-08. This delivery evaluates the current suggested deck. Goal-driven deck search
is phase 2 and is not implemented. The agreed scope is in [the plan](goal-parent-decks-plan.md).

## Review flow

1. Select a trainee, white targets, inventory, and agenda as before.
2. Select a target chip to open its shared editor. Choose Required or Preferred under **Goals for
   target white spark**. Required families have individual minimum stars; Preferred families are
   optional 2★+ extras. Zero required whites is valid. There is no maximum required count.
3. Enter copies and stars under **White sparks in lineage** in the same editor. Select the active
   chip again to close it. The × on each chip removes the target and its goal and lineage entries.
4. Enable **Evaluate goal** in Parent goal and choose blue and pink goals. Copy all starting aptitude
   grades from the game's Legacy screen after selecting both parents. Open **Pink sparks** beside
   **By stars** in Legacy to enter the six pink lineage sparks for mid-run inspiration estimates.
   Raising a grade above the trainee's base infers a minimum-star set in the available slots.
   The editor labels these entries Estimated; editing an entry makes it manual. Unassigned slots
   remain unknown. The editor starts closed. Closing it keeps the saved inputs active.
5. Read Parent goal estimate. It shows the complete probability, individual spark chances, all
   required skills' availability, SS chance, and 50% / 75% / 95% attempt counts.

Required/Preferred roles and minimum stars do not change selected cards or the prioritized list.
Adding or removing a target chip changes the existing builder's target list. Changing shared run
inputs, such as lineage, inventory, or agenda, can still change the suggested deck.
Unknown pink ancestry and matching pink sparks below starting B withhold the combined estimate.
A fully specified goal with no modeled source or eligibility has zero chance. Preferred extras
are individual 2★-or-better probabilities, not conditional on successful required goals.
With zero required white families, the white contribution is one and success depends on blue/pink.

## Data and ownership

- `src/model/goal-input.ts` defines and normalizes the goal and six pink ancestry entries.
- `src/state.ts` migrates saves to version 11. Pink entries can carry `inferred: true`;
  old entries without the marker stay manual, and the marker survives reloads. Valid pink ancestry
  from older saves survives.
  Saves from version 9 have unknown ancestry because that version removed the data. Entered
  aptitude overrides survive; migration does not infer absent ancestry from them. Older deck targets
  default to Preferred; stored Required entries and their stars survive. The former empty required
  slots disappear. Old goal-only families
  join the unified target list, which can change deck suggestions for saves with separate lists.
  Invalid families and duplicate required entries are removed. The required list defaults to empty.
- `src/model/pink-inherit.ts` infers a minimum-star set when a Legacy grade changes. It preserves
  manual slots, reuses matching inferred slots, and never allocates more than six sparks.
- `src/model/run.ts` exposes `predictRunDeck()` for a supplied deck and calls `evaluateParentGoal()`
  after the existing builder selects cards. It never searches decks from inside the goal evaluator.
- `src/model/goal-skills.ts` calculates a joint distribution over the best obtainable form of each
  required family. `src/model/goal.ts` combines this with stat, rank, pink, and star estimates.
- `src/ui/panels/targets.ts` renders the target chips and shared goal/lineage editor. Its selected
  chip is transient view state. `goal.ts` renders blue/pink controls and results. Legacy owns starting
  grades and pink lineage. Its Pink sparks toggle is transient view state, independent of By stars
  and the goal toggle. All saved edits use the existing persisted store.

Generation constants live in `rules.ts`. Their provenance is the
[Hakuraku note](refs/hakuraku-spark-generation.md), including the explicitly approximate low/UE
white bands. Pink inspiration rates and their scope are in
[aptitude inheritance](refs/aptitude-inheritance.md). The existing measured support-chain settings
remain the defaults. New generation tables are not independent copies of tunable hint settings.

## Calculation

For a shared final outcome, complete success is the chance of the acceptable blue, the specified
pink, and all required white families generating with enough stars. The implementation separates only
terms whose remaining dependence is not modeled:

`P(goal) ≈ E[product_i g_i(form_i)] × E[blue(stats) × product_i stars_i(rank)] × P(pink)`

Here `g` includes the purchased skill form and `1.1^lineageCopies`. This is not a product of the
individual probabilities shown in the table.

### Skill outcomes

Each required family's form is none, normal white, released double-circle upgrade, or gold.
Families sharing an event or chain form connected groups. Independent groups are evaluated
separately, so fifty independent families do not create an exponential joint state table.
Within each group, sources combine by retaining each family's best form. Shared events apply the
decoded rewards together; alternative outcomes and random skill selections stay exclusive.
The existing assumed outcome weights and gold-roll setting apply. A reached late chain stage
implies all preceding stages. Repeated prerequisites still give one family roll.

Small distributions are exact under the source assumptions. Large linked groups use at most
4,096 weighted sample states. Resampling uses a fixed hash order and stratified quantiles; very
large pair products use a fixed permutation of those quantiles. The UI identifies this additional
approximation when used. It bounds state growth without imposing a target-count limit. Very rare
joint acquisition outcomes can be missed. Independent groups still multiply analytically, which
preserves tiny joint chances instead of relying on a sample that obtains every independent skill.

The evaluator resolves event choices once for all required and preferred families using the
current prioritized-skill order and its non-target blockers. It does not rewrite that list for
the goal. Fallback choices for unprioritized skills retain the existing model's choice policy.
Available target skills and relevant upgrades are assumed purchased. SP contributes to the
existing rank estimate; it does not impose a goal budget constraint.

### Stats and rank

The evaluator uses 2,048 fixed Halton samples transformed to independent normal stat deviations.
Each sample is rounded, bounded at zero, and clamped to the inherited scenario caps. That same
statline determines its blue band and stat rating. The existing predicted skill-rating mean and
normal spread complete the rank distribution; skill uncertainty is integrated analytically across
rank bands. Zero stat spread uses one exact outcome. Fixed samples make repeated evaluations
and future deck comparisons deterministic. In the initial two-family implementation, a local
25-evaluation check with Special Week, two
required families, and complete pink ancestry measured about 5 ms median and 7.5 ms at the 95th
percentile for the warm evaluator alone. This excludes deck search and rendering.

All required white star rolls use the same rank outcome. This retains blue/SS and white/white dependence.
For example, separately averaging two 50%/80% white-star regimes and multiplying loses their
shared rank dependence. The goal's sampled SS estimate can differ slightly from the existing
Predicted run panel's linearized rank estimate, especially near caps.

### Starting pink inference

The starting thresholds are 1, 4, 7, and 10 total matching stars for one through four grade
increases. Starting inheritance cannot reach S or increase more than four grades. The table is
vendored in `docs/refs/umaguide-sparks.md` and summarized in `refs/aptitude-inheritance.md`.

When the user changes any starting grade, inference considers all grades above the trainee's base.
It subtracts manually entered stars from each minimum, then packs missing stars into 3★ sparks
and one remainder. Manual sparks keep their slots. Matching inferred sparks keep theirs where
possible; other estimates use free slots in lineage order. These positions are placeholders, not
claims about which parent carried a spark. The model uses the same assumed affinity for all six.

For example, C to A requires at least 4 stars, so an empty lineage receives 3★ and 1★. A manually
entered 2★ spark reduces the estimate to one additional 2★ spark. If manually entered stars already
satisfy the minimum, none are added. This does not establish that the manually entered lineage
matches every starting grade; grades remain the user's input for the run.

Lowering a grade rebuilds only inferred entries. Editing a spark's aptitude or stars removes its
inferred marker. Changing the trainee clears inferred entries and starting overrides but preserves
manual ancestry. Legacy Reset clears both. Existing saves are not inferred automatically on load.

Unsupported increases produce a visible message. If all inferable increases cannot fit alongside
manual entries in six slots, no partial set is inferred and the panel reports the shortage.
Unassigned slots remain unknown, so partial inference alone does not complete the pink estimate.
Goal notes identify inferred inputs. Manual ancestry edits refine the inspiration model and do
not automatically change the starting grades copied from the game.

### Pink eligibility

Entered grades already include parent selection. The model adds only mid-run inspiration changes
for final eligibility; it does not change the entered starting grades. Starting A/S aptitudes
remain eligible. With complete ancestry, a B aptitude becomes eligible when any matching spark
procs at either inspiration event. Each proc uses its star rate times
`1 + individualAffinity / 100`, capped at one. The existing affinity setting applies to all six.
A small distribution over the number of other eligible aptitudes accounts for dilution when
competing B aptitudes become A. Generation selects uniformly among eligible aptitudes.

A grade below B with matching ancestry needs an unknown aptitude-point distribution. It remains
unestimated, including when it could dilute an already eligible target. No matching spark in
complete ancestry gives zero chance of improvement. A/S versus S does not change selection odds.

### Attempts

Counts use `ceil(log1p(-confidence) / log1p(-p))`, with explicit zero and certain-success handling.
One attempt is one final spark roll. By the agreed simplification, all attempts have the same
independent chance. There is no attempts-per-career setting or selective-reroll model.

## Remaining approximations

- Hint pickups across families are independent pooled estimates. Shared hints competing over a
  limited number of training turns are not simulated.
- Unlinked events, different chain outcomes conditional on reach, and distinct pink proc rolls are
  independent estimates. Race-conditioned rewards inherit the existing race model.
- Skill acquisition is independent of the sampled stat/rank outcome. Gold-roll odds use the
  existing assumed stat at the event. Buying the required skills does not change the rank budget.
- Blue inspiration contributions use their existing mean. This delivery adds no inheritance
  variance or correlation between blue, pink, and white inspiration outcomes.
- Skill rating and agenda race odds use starting aptitudes. Pink increases affect final spark
  eligibility only. Skill rating, stat spreads, and unmeasured event rates remain estimates.
- White families generate and roll their stars independently conditional on skill forms and rank.
  Race, scenario, green unique, and negative skill spark goals are outside this delivery.

`tests/goal.test.ts` covers numeric boundaries, complete-goal arithmetic, shared events and chains,
rank dependence, pink eligibility, migration, and unchanged deck selection. Browser smoke checks
all goal controls against saved state and tests responsive layouts in both themes. Browser
regressions cover reloads, old saves, and unsupported versus impossible goals.
