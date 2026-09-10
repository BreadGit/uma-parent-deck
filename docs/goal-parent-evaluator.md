# Parent goal evaluator, phase 1

Implemented 2026-09-08; phase 1 polish updated 2026-09-10. This delivery evaluates the current
suggested deck. Goal-driven deck search is phase 2 and is not implemented. The agreed scope is in
[the plan](goal-parent-decks-plan.md).

## Review flow

1. Select a trainee, inventory, and agenda. Parent goal groups white targets and blue/pink controls.
2. Select a target chip to open its shared editor. Choose Required or Preferred under **Goals for
   target white spark**. Required families have individual minimum stars; Preferred families are
   optional 2★+ extras. Zero required whites is valid. There is no maximum required count.
3. Enter copies and stars under **White sparks in lineage** in the same editor. Select the active
   chip again to close it. The × on each chip removes the target and its goal and lineage entries.
4. Choose blue and pink goals in Parent goal. Evaluation is always active and updates with each edit.
   Pink defaults to Any at 2★ or better. Copy all starting aptitude grades from the game's Legacy screen after selecting both parents. Open **Pink sparks** below
   the stat gains and above the aptitude inputs in Legacy to enter known pink lineage sparks for mid-run inspiration estimates.
   Raising a grade above the trainee's base infers a minimum-star set in the available slots.
   The editor labels these entries Estimated; editing an entry makes it manual. Unassigned slots
   count as zero sparks for the estimate. Both selects show the same blank placeholder as By stars;
   the star select stays disabled until an aptitude is picked, which defaults to 3★. Clearing the
   aptitude empties that row again. Clear pink sparks clears all six entries and restores base aptitudes.
   Blue sparks, white lineage, and goals stay unchanged. The editor starts closed. Closing it keeps the saved inputs active.
5. Read Parent goal estimate. It shows the complete probability, individual spark chances, all
   required skills' availability, SS chance, and 50% / 75% / 95% attempt counts.
   The headline says "Chance per final spark roll". An explanation names unavailable requirements
   or the lowest individual chance, with relevant eligibility, acquisition, or blue-threshold context.
   Individual chances do not establish which deck change would improve complete success the most.
   Missing inputs withhold this explanation; uncertain pink eligibility remains a range.
   A missing source in this deck does not establish impossibility across all legal decks, and a
   sampled zero does not prove impossibility. Goal-driven fallback selection remains phase 2.

Required/Preferred roles and minimum stars do not change selected cards or the prioritized list.
Adding or removing a target chip changes the existing builder's target list. Changing shared run
inputs, such as lineage, inventory, or agenda, can still change the suggested deck.
Partial pink ancestry gives an estimate using starting grades and entered or inferred sparks, with
no missing-entry warning. Matching pink sparks below starting B produce lower and upper probability bounds.
Buttons in the goal controls and warnings open and focus the pink-lineage editor in Legacy.
Any needs no ancestry when a starting A/S aptitude guarantees eligibility.
A fully specified goal with no modeled source or eligibility has zero chance. Preferred extras
are individual 2★-or-better probabilities, not conditional on successful required goals.
With zero required white families, the white contribution is one and success depends on blue/pink.

## Data and ownership

- `src/model/goal-input.ts` defines and normalizes the goal and six pink ancestry entries.
- `src/state.ts` migrates saves to version 15. The retired goal-enabled flag is discarded, so older
  saves also evaluate automatically. Missing, null, or invalid pink targets become `any`;
  existing specific targets and minimum stars survive. New pink goals default to `any` at two stars.
  Saved A-through-G aptitude overrides survive, including grades outside starting inheritance.
  Pink entries can carry `inferred: true`;
  old entries without the marker stay manual, and the marker survives reloads. Valid pink ancestry
  from older saves survives.
  Saves from version 9 default to zero entered sparks because that version removed the data. Entered
  aptitude overrides survive; migration does not infer absent ancestry from them. Older deck targets
  default to Preferred; stored Required entries and their stars survive. The former empty required
  slots disappear. Old goal-only families
  join the unified target list, which can change deck suggestions for saves with separate lists.
  `run.targets` stores `{ id, role, stars }` entries. The evaluator derives Required and Preferred
  lists from it; `run.goal` stores only blue/pink choices. Invalid IDs and
  duplicates are removed. Focus and Gatekept remain distinct despite sharing Concentration.
  Gold-only targets remain visible and searchable with an explicit notice that they have no
  released white spark. Their generation probability is zero. Their saved lineage survives for
  review but contributes no inherited hints. This also covers Risk-Maker, whose white form is
  unreleased on Global. Old gold/circle lineage keys move to the canonical target key. An exact
  white key takes precedence if both exist. Keys without a remaining target are removed.
- `src/model/pink-inherit.ts` infers a minimum-star set when a Legacy grade changes. It preserves
  matching sparks where possible, reclaims other slots as needed, and derives the resulting grades.
  It never allocates more than six sparks. Unrelated manual sparks remain unchanged unless the
  selected grade needs their slots. Planning overrides do not allocate or remove sparks.
- `src/model/run.ts` exposes `predictRunDeck()` for a supplied deck and calls `evaluateParentGoal()`
  after the existing builder selects cards. The evaluator reuses the resolved deck coverage and
  context. It does not rebuild sources, resolve choices again, or search for decks.
- `src/model/goal-skills.ts` calculates a joint distribution over the best obtainable form of each
  required family. `src/model/goal.ts` combines this with stat, rank, pink, and star estimates.
- `src/ui/panels/targets.ts` renders the target chips and shared goal/lineage editor. Its selected
  chip is transient view state. `goal.ts` renders blue/pink controls and results. Legacy owns starting
  grades and pink lineage. Its Pink sparks toggle is transient view state, independent of By stars.
  Goal evaluation is always active. All saved edits use the existing persisted store.

Measured generation bands live in `rules.ts`. Their provenance is the
[Hakuraku note](refs/hakuraku-spark-generation.md). The approximate below-B and UE white-star
rates and pink inspiration rates are editable in `settings.ts`, with validation and user-facing
source notes. White-star distributions must sum to one. Pink inspiration provenance is in
[aptitude inheritance](refs/aptitude-inheritance.md). Blue band thresholds are shared with the deck
panel. The SS threshold comes from the same ranking data as the rank panel.

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
The existing assumed outcome weights and gold-roll setting apply. Both estimators decode skill
reward shares through `outcomeSkillShares`; duplicate rewards count once. A reached late chain stage
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

The evaluator integrates each rounded normal stat distribution into integer outcomes, bounded at
zero and clamped to the inherited scenario caps. Outcomes above the rating table's maximum share
one outcome because they have the same rating and blue band. Blue probabilities use the full mass
of each band. Upper-tail calculations use the normal survival function, so rare outcomes remain
represented even when a fixed sample would miss every value above 600 or 1,100. A cap below the
required threshold still gives zero chance.

For rank marginals, the evaluator draws 2,048 fixed Halton samples from the stat distributions.
For the combined goal, it samples separately within each accepted stat's blue bands and weights
each result by that band's probability and blue-star rate. The selected stat's conditional value
also contributes to rank. This preserves blue/rank dependence without requiring an unconditional
sample to reach a rare blue threshold. Goals with no white-star quality requirement use the
analytic blue probability directly. Rank integration remains a sample approximation.

The existing predicted skill-rating mean and normal spread complete the rank distribution;
skill uncertainty is integrated analytically across rank bands. Zero stat spread uses one exact
outcome. Fixed samples make repeated evaluations and future deck comparisons deterministic.
A local 25-evaluation check after the blue-tail fix, with Special Week, two required families,
and Any pink, measured about 15 ms median and 19 ms at the 95th percentile for the warm evaluator
alone. This excludes deck search and rendering.

All required white star rolls use the same rank outcome. This retains blue/SS and white/white dependence.
For example, separately averaging two 50%/80% white-star regimes and multiplying loses their
shared rank dependence. The goal's sampled SS estimate can differ slightly from the existing
Predicted run panel's linearized rank estimate, especially near caps.

### Starting pink inference

The starting thresholds are 1, 4, 7, and 10 total matching stars for one through four grade
increases. Starting inheritance cannot reach S or increase more than four grades. The table is
vendored in `docs/refs/umaguide-sparks.md` and summarized in `refs/aptitude-inheritance.md`.

The aptitude dropdowns offer A through G. Grades outside the trainee's starting-inheritance
range are explicit planning overrides. They survive reloads and continue to control the agenda.
They leave pink lineage unchanged, and the Legacy panel identifies them. S remains unavailable.
The Pink sparks button and its editor sit after the blue stat gains and before the aptitude table.

Changing a supported grade allocates only that aptitude. Other aptitudes derive their grades
from known lineage; the model does not rebuild their sparks to match stale entered grades.
Grade-only inputs without matching sparks remain available as fallback planning inputs. Existing sparks are kept when their total already gives the
requested grade. Otherwise the model adds the minimum missing stars in 3★ sparks and a remainder,
or rebuilds a smaller total when the grade is lowered. Matching sparks stay on their umas where
possible. If preserving many small sparks would require more than six slots, their stars are
packed into fewer sparks. These are estimates, not claims about the actual parents.

Free slots are used first. If more slots are needed, the model reassigns the weakest other sparks.
Ties use reverse slot order. This can replace manual entries, just as selecting a dimmed blue
gain can take another stat's sparks. Choices that adjust other sparks or grades are dimmed but
remain selectable. The currently selected grade is never dimmed. After allocation, affected
starting grades follow the resulting lineage and trainee base. Planning overrides stay explicit.
The selected grade is honored; other grades can decrease if their slots are reassigned.

For example, C to A needs at least 4 stars. An empty lineage gets 3★ + 1★; an existing 2★ spark
can stay and gain another 2★ spark. Returning that aptitude to its base removes its unnecessary
sparks, including manual entries. Sparks on an already native-A aptitude can remain because
they do not change its starting grade.

Editing a pink spark removes its Estimated marker and immediately updates the starting grade.
Removing the last spark for an aptitude restores its base unless it has a planning override. Changing the trainee clears
inferred entries and starting overrides but preserves manual ancestry. Legacy Reset clears both.
Unassigned slots count as zero sparks. Partial lineage gives an estimate without a missing-entry warning.
Goal notes identify inferred inputs. The model assumes the same affinity for all six slots.

### Pink eligibility

Any accepts every eligible aptitude. With at least one starting A/S, its probability is just the
minimum-star chance (1★+ = 100%, 2★+ = 80%, 3★ = 10%). Competing aptitudes do not dilute it,
and empty ancestry or unsupported jumps cannot block it. Without a guaranteed eligible aptitude,
the model multiplies the star chance by the probability that at least one aptitude becomes eligible;
unsupported below-B increases produce bounds for that estimate.

Starting grades use the deterministic lineage-star table where lineage is known. The model then
adds mid-run inspiration changes for final eligibility. Planning overrides remain explicit. Starting A/S aptitudes
remain eligible. A B aptitude becomes eligible when any known matching spark
procs at either inspiration event. Each proc uses its star rate times
`1 + individualAffinity / 100`, capped at one. The existing affinity setting applies to all six.
A small distribution over the number of other eligible aptitudes accounts for dilution when
competing B aptitudes become A. Generation selects uniformly among eligible aptitudes.

A grade below B with matching ancestry needs an unknown aptitude-point distribution. Its final
eligibility is bounded between zero and one. For a specific target, the lower bound assumes all
uncertain competitors qualify and an uncertain target does not. The upper bound reverses those
assumptions. Any pink instead bounds the probability that at least one aptitude qualifies.
Both endpoints propagate into the complete goal and attempt counts. A zero lower bound with a
positive upper bound is not labeled impossible. No matching spark in complete ancestry gives
zero chance of improvement. A/S versus S does not change selection odds.

Empty lineage slots count as zero sparks and contribute no increases to either the target or its
competitors. This planning default lets users get an estimate with any number of entered sparks,
including zero, even though each ancestor has a pink spark in the game. A note in the assumptions
explains the default without asking users to complete all six entries. Omitting sparks can raise or
lower the estimate relative to the full lineage. Other blocking issues still withhold the combined estimate.

### Attempts

Counts use `ceil(log1p(-confidence) / log1p(-p))`, with explicit zero and certain-success handling.
Probability bounds produce attempt ranges. A zero lower probability has no finite upper attempt bound.
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
regressions cover reloads, old saves, manual lineage preservation, planning overrides, uncertain
versus impossible goals, and dimmed/disabled controls in both themes.
