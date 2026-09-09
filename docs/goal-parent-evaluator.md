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
4. Enable **Evaluate goal** in Parent goal and choose blue and pink goals.
   Pink defaults to Any at 2★ or better. Copy all starting aptitude grades from the game's Legacy screen after selecting both parents. Open **Pink sparks** below
   the stat gains and above the aptitude inputs in Legacy to enter the six pink lineage sparks for mid-run inspiration estimates.
   Raising a grade above the trainee's base infers a minimum-star set in the available slots.
   The editor labels these entries Estimated; editing an entry makes it manual. Unassigned slots
   remain unknown. Reset beside Pink sparks clears all six entries and restores base aptitudes.
   Blue sparks, white lineage, and goals stay unchanged. The editor starts closed. Closing it keeps the saved inputs active.
5. Read Parent goal estimate. It shows the complete probability, individual spark chances, all
   required skills' availability, SS chance, and 50% / 75% / 95% attempt counts.

Required/Preferred roles and minimum stars do not change selected cards or the prioritized list.
Adding or removing a target chip changes the existing builder's target list. Changing shared run
inputs, such as lineage, inventory, or agenda, can still change the suggested deck.
Incomplete pink ancestry shows a warning while the combined estimate uses starting grades and
known sparks. Matching pink sparks below starting B still withhold a specific target estimate.
Any needs no ancestry when a starting A/S aptitude guarantees eligibility.
A fully specified goal with no modeled source or eligibility has zero chance. Preferred extras
are individual 2★-or-better probabilities, not conditional on successful required goals.
With zero required white families, the white contribution is one and success depends on blue/pink.

## Data and ownership

- `src/model/goal-input.ts` defines and normalizes the goal and six pink ancestry entries.
- `src/state.ts` migrates saves to version 13. Missing, null, or invalid pink targets become `any`;
  existing specific targets and minimum stars survive. New pink goals default to `any` at two stars.
  Saved aptitude overrides clamp to the selected trainee's base and four-grade starting-inheritance range. Pink entries can carry `inferred: true`;
  old entries without the marker stay manual, and the marker survives reloads. Valid pink ancestry
  from older saves survives.
  Saves from version 9 have unknown ancestry because that version removed the data. Entered
  aptitude overrides survive; migration does not infer absent ancestry from them. Older deck targets
  default to Preferred; stored Required entries and their stars survive. The former empty required
  slots disappear. Old goal-only families
  join the unified target list, which can change deck suggestions for saves with separate lists.
  Invalid families and duplicate required entries are removed. The required list defaults to empty.
- `src/model/pink-inherit.ts` infers a minimum-star set when a Legacy grade changes. It preserves
  matching sparks where possible, reclaims other slots as needed, and derives the resulting grades.
  It never allocates more than six sparks or lowers a grade below base.
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

The aptitude dropdowns offer only the trainee's base grade through four increases, capped at A.
A forced out-of-range change is rejected before saving. Existing saves clamp to this range.
The Pink sparks button and its editor sit after the blue stat gains and before the aptitude table.

Changing a grade reconciles the entered aptitude increases with the six-spark lineage. The chosen
grade gets the final allocation. Existing sparks are kept when their total already gives the
requested grade. Otherwise the model adds the minimum missing stars in 3★ sparks and a remainder,
or rebuilds a smaller total when the grade is lowered. Matching sparks stay on their umas where
possible. If preserving many small sparks would require more than six slots, their stars are
packed into fewer sparks. These are estimates, not claims about the actual parents.

Free slots are used first. If more slots are needed, the model reassigns the weakest other sparks.
Ties use reverse slot order. This can replace manual entries, just as selecting a dimmed blue
gain can take another stat's sparks. Choices that adjust other sparks or grades are dimmed but
remain selectable. After allocation, all starting grades are derived from the resulting lineage
and trainee base. Each remains at least its base grade. The selected grade is honored, while
other grades can decrease as their sparks are reassigned.

For example, C to A needs at least 4 stars. An empty lineage gets 3★ + 1★; an existing 2★ spark
can stay and gain another 2★ spark. Returning that aptitude to its base removes its unnecessary
sparks, including manual entries. Sparks on an already native-A aptitude can remain because
they do not change its starting grade.

Editing an advanced spark removes its Estimated marker. Advanced edits refine the inspiration
inputs; starting grades are reconciled on the next aptitude edit. Changing the trainee clears
inferred entries and starting overrides but preserves manual ancestry. Legacy Reset clears both.
Unassigned slots remain unknown. Partial lineage gives an estimate with a warning instead of blocking it.
Goal notes identify inferred inputs. The model assumes the same affinity for all six slots.

### Pink eligibility

Any accepts every eligible aptitude. With at least one starting A/S, its probability is just the
minimum-star chance (1★+ = 100%, 2★+ = 80%, 3★ = 10%). Competing aptitudes do not dilute it,
and unknown ancestry or unsupported jumps cannot block it. Without a guaranteed eligible aptitude,
the model multiplies the star chance by the probability that at least one aptitude becomes eligible;
unsupported below-B increases still withhold that estimate.

Entered grades already include parent selection. The model adds only mid-run inspiration changes
for final eligibility; it does not change the entered starting grades. Starting A/S aptitudes
remain eligible. A B aptitude becomes eligible when any known matching spark
procs at either inspiration event. Each proc uses its star rate times
`1 + individualAffinity / 100`, capped at one. The existing affinity setting applies to all six.
A small distribution over the number of other eligible aptitudes accounts for dilution when
competing B aptitudes become A. Generation selects uniformly among eligible aptitudes.

A grade below B with matching ancestry needs an unknown aptitude-point distribution. It remains
unestimated, including when it could dilute an already eligible target. No matching spark in
complete ancestry gives zero chance of improvement. A/S versus S does not change selection odds.

Incomplete ancestry uses only known sparks for mid-run increases. Unknown slots contribute no
increases to either the target or its competitors. This approximation can overestimate or
underestimate the true chance; a displayed zero is not proof that unknown ancestry cannot help.
The nonblocking warning reads "Open Pink sparks in Legacy and enter all six lineage sparks to get
a more accurate pink spark probability." It disappears when all six are entered, or when
eligibility is already fixed for the goal. Other blocking issues still withhold the combined estimate.

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
