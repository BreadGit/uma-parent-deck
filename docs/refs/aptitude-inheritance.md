# Aptitude increases at inspiration events

Reviewed 2026-09-08. This is a curated research note for predicting final pink-spark eligibility.
Current scope uses the post-parent-selection grades entered in Legacy and omits later aptitude
increases. The original proposal below is retained as research, not implementation guidance.
See [the current evaluator](../goal-parent-evaluator.md#pink-eligibility).

## Sources

- [Crazyfellow snapshot](crazyfellow-parenting-gene-guide.txt), Chapter 3, "Red Gene mechanics"
  and "Hidden Red Gene values"; the later "Base proc rates (without compatibility)" table.
- [uma.moe affinity service](https://github.com/uma-moe/umamoe-frontend/blob/8b7cd11b8288cc2d303c2ebb51f68fcc930a5fd5/src/app/services/affinity.service.ts#L732),
  `SPARK_BASE_CHANCES`, `sparkProcChance`, `sparkRunChance`, and `getSparkMetrics`.
- [uma.moe lineage planner](https://github.com/uma-moe/umamoe-frontend/blob/8b7cd11b8288cc2d303c2ebb51f68fcc930a5fd5/src/app/pages/lineage-planner/lineage-planner.component.ts#L155)
  supplies each source's individual affinity to that service.

The code was inspected at commit `8b7cd11b8288cc2d303c2ebb51f68fcc930a5fd5`.
These notes describe the inspected calculations; they are not a copy of the implementation.

## Activation probability

Both sources use these pink-spark activation rates before affinity:

| Spark stars | Chance per inspiration event at zero individual affinity |
|---|---:|
| 1 | 0.01 |
| 2 | 0.03 |
| 3 | 0.05 |

For source `i`, use `p_i = clamp(base_i * (1 + affinity_i / 100), 0, 1)`.
With two inspiration events and independent activations, the chance that at least one spark
of a particular aptitude activates is `1 - product((1 - p_i)^2)` over its sources.

Individual affinity belongs to the uma carrying the spark. The overall displayed compatibility
symbol is not that score. Do not halve grandparents' probabilities after applying their individual
affinity; their lower affinity already accounts for the distinction. This app currently assumes
the same individual score for all six umas through `settings.affinity`. Reusing that assumption
is sufficient for the first implementation; a complete compatibility calculator is separate work.

At assumed individual affinity 150, one 3-star pink spark has a 12.5% chance per event and a
23.4375% chance over both. Six matching 3-star sparks at that same assumed affinity give
`1 - 0.875^12`, approximately 79.8583%, for at least one activation. These are calculated examples,
not measured probabilities for a typical lineage.

## Activation versus final grade

The inspected uma.moe calculation reports activation odds. It does not supply a distribution of
hidden aptitude-increase points or a complete final-grade transition calculation.

Crazyfellow describes at least one hidden point per activation, a possible range of 1 through 5,
and higher-star bias toward larger values. The guide explicitly says it has no statistics for
the hidden-value distribution. One point is sufficient for B to A. Thus, for a starting B
aptitude, the chance of becoming eligible for a final pink spark is the chance of at least one
matching activation. A possible jump directly to S does not change eligibility.

Starting A is already eligible, whether or not it becomes S. Below B, the chance of any activation
is not generally the chance of reaching A. For example, the guide describes C to A with one
large activation, or C to B at the first event followed by B to A at the second. Computing an
exact probability for these paths needs the missing point distribution.

## Original scope proposal

- Read post-parent-selection grades from the Legacy panel, including all four running styles.
- Record the pink aptitude and stars of each of the six lineage umas. Unknown entries must remain
  distinguishable from confirmed entries that do not match a target.
- Include B-to-A increases for every aptitude with a matching source. An unwanted B-to-A increase
  also matters because it adds another eligible pink type and dilutes the desired type's chance.
- Evaluate the desired type's `0.80 / eligible_count` for each final eligibility combination when
  the goal is at least 2 stars. Do not divide by an expected, fractional eligibility count.
- For below-B grades with matching lineage sparks, expose the limitation or accept an explicitly
  assumed final grade. Do not label the goal impossible or invent a hidden-point distribution.
- Initially use these transitions for final pink eligibility. Retain the chosen agenda and its
  current start-grade race estimates; propagating aptitude changes into race results is later work.

The two inspiration events are part of one career. They are separate from the proposed goal
display's "attempts", which count final spark rolls under a deliberately simplified model.
