# Aptitude increases at inspiration events

Reviewed 2026-09-08. This is a curated research note for predicting final pink-spark eligibility.

## Sources

- [Crazyfellow snapshot](crazyfellow-parenting-gene-guide.txt), Chapter 3, "Red Gene mechanics"
  and "Hidden Red Gene values"; the later "Base proc rates (without compatibility)" table.
- [uma.moe affinity service](https://github.com/uma-moe/umamoe-frontend/blob/8b7cd11b8288cc2d303c2ebb51f68fcc930a5fd5/src/app/services/affinity.service.ts#L732),
  `SPARK_BASE_CHANCES`, `sparkProcChance`, `sparkRunChance`, and `getSparkMetrics`.
- [uma.moe lineage planner](https://github.com/uma-moe/umamoe-frontend/blob/8b7cd11b8288cc2d303c2ebb51f68fcc930a5fd5/src/app/pages/lineage-planner/lineage-planner.component.ts#L155)
  supplies each source's individual affinity to that service.

The code was inspected at commit `8b7cd11b8288cc2d303c2ebb51f68fcc930a5fd5`.
These notes describe the inspected calculations; they are not a copy of the implementation.

## Starting grade increases

Source: [vendored uma.guide spark guide](umaguide-sparks.md), Pink Sparks, Starting Aptitude table.
The Crazyfellow snapshot's Chapter 3 also gives G to C with at least 10 total matching stars.

| Grade increases before the run | Minimum matching stars across all six ancestors |
|---|---:|
| 1 | 1 |
| 2 | 4 |
| 3 | 7 |
| 4 | 10 |

Starting inheritance caps at four increases and at A. Thus G can reach C before the run;
C can reach A with at least 4 stars. Further increases require mid-run inspiration.
A starting grade does not uniquely identify a star total, its distribution, or the ancestor slots.
For example, 3★ + 1★ and 2★ + 2★ both provide the four stars needed for C to A,
but those distributions have different mid-run activation odds.

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
affinity; their lower affinity already accounts for the distinction.

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

## Final pink-spark selection

A B-to-A increase adds another eligible pink type, so even an increase in a competing aptitude
changes the desired type's selection chance. For at least 2 stars, the desired eligible type has
chance `0.80 / eligible_count` for each final eligibility combination. Averaging these combinations
preserves the effect of competing aptitudes; dividing by an expected count does not.

The two inspiration events happen during one career. Final spark generation occurs at its end.
