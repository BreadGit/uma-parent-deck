# Spark generation measurements

Reviewed 2026-09-08. Curated measurements and probability tables, paraphrased from
[Hakuraku's spark-generation research](https://hakuraku.moe/notes/spark_generation).
The site's [Markdown source](https://hakuraku.moe/notes/spark-generation.md) is readable without
JavaScript. Its manifest dates the note to 2026-03-28; the document includes later additions.

## Source precedence and scope

Hakuraku's measured counts support these estimates where older community tables disagree.
They are empirical estimates, not a claim to have recovered the game's server implementation.

The main study uses deduplicated CM10-CM12 room-match veterans. It includes 107,159 veterans with
rank score at least 1,000 for blue and pink analysis. White analysis uses 83,169 veterans in the
6,500 through 17,499 band and 23,786 in the 17,500+ band. Retained veterans can have selection bias.
Do not use this study to infer independent-training hint pickup or event completion rates.

The original `umaguide-sparks.md` and `umaguide-parenting.md` snapshots put 45% in the middle band's
1-star column and 50% in its 2-star column. The local editions now correct these columns using
Hakuraku's evidence. The middle-band chance
of at least 2 stars is approximately 50%, not 55%, for both blue and white sparks.

## Blue generation

Use an equal 20% chance per stat. Hakuraku observes small deviations but identifies possible
retention bias. Do not introduce an unverified stat-weighted selection formula.

Probabilities below are conditional on that stat being selected. Boundaries are inclusive at
600 and 1,100.

| Final stat | Default 1-star | Default 2-star | Default 3-star | Observed 1/2/3-star counts |
|---|---:|---:|---:|---|
| Below 600 | 0.90 | 0.10 | 0 | 20,507 / 2,356 / 0 |
| 600 through 1,099 | 0.50 | 0.45 | 0.05 | 27,248 / 24,921 / 2,912 |
| 1,100+ | 0.20 | 0.70 | 0.10 | 5,740 / 20,427 / 3,048 |

The [older Umamusu Station study](https://umamusustation.com/blue_factor_analysis.html), dated
2021-05-04, also supports these boundaries and approximately equal stat selection.

## Pink generation

Select uniformly among final A/S aptitudes across surface, distance, and style. Conditional star
probabilities are 0.20 / 0.70 / 0.10. Hakuraku observed 21,414 / 75,103 / 10,642 stars of those
respective levels. The aptitude-selection and star-count hypotheses fit this dataset.

For a specified eligible aptitude and `k` eligible aptitudes, the probability of at least 2 stars
is `0.80 / k`. Exactly 2 stars is `0.70 / k`. Recompute `k` for each modeled final aptitude outcome.
See [aptitude inheritance](aptitude-inheritance.md) for changes during the career.

## White skill generation

Let `n` be the number of the six parents/grandparents carrying the target family as a spark.
Use `base * 1.1^n`, with base 0.20 for normal white, 0.25 for its actual released double-circle
upgrade, or 0.40 for gold. Buying the highest available form creates one opportunity for the
family's basic spark, not separate rolls for each purchased prerequisite.

Selected measurements supporting the exponential formula:

| Form | Lineage copies | Opportunities | Observed generation rate | Exponential estimate |
|---|---:|---:|---:|---:|
| Normal white | 0 | 511,839 | 20.08% | 20.00% |
| Normal white | 2 | 69,808 | 24.15% | 24.20% |
| Normal white | 4 | 11,836 | 29.26% | 29.282% |
| Gold | 0 | 168,666 | 39.96% | 40.00% |
| Gold | 2 | 48,184 | 48.29% | 48.40% |
| Gold | 4 | 8,796 | 58.34% | 58.564% |

Hakuraku reports goodness-of-fit p-values of at least 0.84 for the exponential model across the
three forms. Other fitted formulas also fit; the exponential formula is a simple fit consistent
with these observations. It does not establish a change to Global game rules.

## White star quality

These probabilities apply after the skill spark generates.

| Overall rank score | Default 1-star | Default 2-star | Default 3-star | Observed 1/2/3-star counts |
|---|---:|---:|---:|---|
| 6,500 through 17,499 | 0.50 | 0.45 | 0.05 | 264,997 / 237,399 / 26,241 |
| 17,500+ in this sample | 0.20 | 0.70 | 0.10 | 39,233 / 137,675 / 19,738 |

Do not extrapolate the high band to every later rank. The Crazyfellow snapshot discusses an
additional UE threshold. The main Hakuraku white analysis omits scores below 6,500 for insufficient
samples. Its separate green-spark analysis has much larger samples but must not silently substitute
for missing direct white evidence.

The additional community bands below are approximations outside Hakuraku's main white sample,
not additional Hakuraku findings.

| Overall rank score | Approximate 1-star | Approximate 2-star | Approximate 3-star |
|---|---:|---:|---:|
| Below 6,500 | 0.90 | 0.10 | 0 |
| 28,800+ | 0.175 | 0.70 | 0.125 |

Source: [Crazyfellow snapshot](crazyfellow-parenting-gene-guide.txt), "Chance of Stars for white
genes", and the numeric rank boundaries in the White Sparks section of [Umaguide's table](umaguide-sparks.md).
With the additional UE band, the 17,500 band ends at 28,799. Possible separate low-rank
generation effects discussed in the guide remain unquantified here.

## Modeling implications

The spark-generation tables cannot supply the chance of acquiring a required hint. That comes
from the trainee, deck, lineage, and event model. Apply star rates inside a shared final-rank
outcome. Multiplying separately averaged target probabilities loses their shared dependence on
rank and on skill sources.

The main dataset counts above differ from the approximately 26.5 million Team Trials veterans
cited by Crazyfellow for earlier supporting work. Hakuraku also describes a separate approximately
22-million-veteran green-spark dataset. Preserve these distinctions when citing sample sizes.
