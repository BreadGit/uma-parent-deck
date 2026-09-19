# Curated game references

These references contain game information only. Use them for game knowledge before browsing. Source dates and modeling scope
matter. Local editorial corrections are dated in the affected documents. Historical measurements
remain historical evidence, and unresolved differences are labeled rather than silently reconciled.
For broad gameplay context, start with [Game basics and mechanics](../GAMEPLAY.md).

## Trusted community projects

Reviewed 2026-09-18. These are preferred references for the topics below. Use their findings
within the stated server, date, and mode. Their original measurements are primary evidence;
their source code establishes what their calculators implement. Imported data and inferred
formulas retain their original attribution and uncertainty. Agreement between projects that
share a dataset or formula is not independent confirmation.

- [UmaSim, mee1080/umasim](https://github.com/mee1080/umasim). Recommended for support-effect
  calculations, scenario mechanics, and original training observations. Its
  [scenario regression tests](https://github.com/mee1080/umasim/blob/ad796f166ad857ebcf93b205a8699122dd711fb4/core/src/commonTest/kotlin/io/github/mee1080/umasim/scenario/mecha/MechaCalculatorTest1.kt)
  check explicit stat/SP expectations across training states. Our [fan rewards](fan-rewards.md)
  and [unique-effect notes](gametora-unique-effects.md) already use it. Treat provisional
  implementations and TODOs as uncertain, including Type 107's incomplete decoding. JP manual
  simulation does not establish Global independent-training behavior.
- [UmaTools, daftuyda/UmaTools](https://github.com/daftuyda/UmaTools). Recommended for rating
  calculations and traceable game-data references. Its
  [data import documentation](https://github.com/daftuyda/UmaTools/blob/c1e00b8b4467fa245365491361cb15ce31da38e9/scripts/data/README.md)
  identifies GameTora and GameWith sources, and its
  [rating tests](https://github.com/daftuyda/UmaTools/blob/c1e00b8b4467fa245365491361cb15ce31da38e9/tests/unit/rating-shared.test.js)
  cover score handling, aptitude groups, and negative skills. Our [rating note](umatools-rating-tables.md)
  already uses it. Imported skill data is secondary evidence; fallback aptitude multipliers
  and optimizer objectives are modeling choices, not new measurements of game behavior.
- [uma.moe, uma-moe/umamoe-frontend](https://github.com/uma-moe/umamoe-frontend). Recommended for
  affinity and inheritance calculations. Its
  [affinity tests](https://github.com/uma-moe/umamoe-frontend/blob/27f058e2450c3309c8aca86434a550b447a03c66/src/app/services/affinity.service.spec.ts)
  cover duplicate race identifiers, shared G1 wins, and parent-source accounting. Our
  [aptitude note](aptitude-inheritance.md) already cites its implementation. The public frontend
  does not expose the entire backend collection pipeline, so it cannot by itself validate every
  hosted statistic. Its activation estimates do not establish hidden aptitude-increase sizes.
- [Hakuraku, ayaliz/hakuraku](https://github.com/ayaliz/hakuraku). This is the repository for
  hakuraku.moe, descended from [SSHZ-ORG's original project](https://github.com/SSHZ-ORG/hakuraku).
  Recommended for original statistical research and race-data analysis. Its
  [spark-generation study](https://github.com/ayaliz/hakuraku/blob/c3bd3af347bd49934885d6af91ed484b8b7166da/public/notes/spark-generation.md)
  publishes counts, exclusions, goodness-of-fit results, and alternative hypotheses; our
  [spark note](hakuraku-spark-generation.md) summarizes it. The room-match sample is not a random
  sample of all careers. Good fit does not prove a server formula. Its separate green-spark
  study uses Tunnelblick's uma.moe dataset, so those two sources are not independent there.

This assessment sampled source attribution, implementations, tests, and research methods. It is
not a full audit or an upstream test-suite certification. Prefer commit-pinned links for specific
claims and keep existing local caveats. Repository copies are not needed to use these references.

## Local research notes

For goal-parent probabilities, start with:

- [Hakuraku spark generation](hakuraku-spark-generation.md). Audited numeric tables, sample counts,
  and the evidence used to correct the middle-band star columns in the local uma.guide editions.
- [Aptitude inheritance](aptitude-inheritance.md). Crazyfellow's mechanics and a commit-pinned
  audit of uma.moe's activation calculator. Separates activation odds from hidden increase sizes.
- [Independent-training race odds](shoppo-independent-training-race-odds.md). Corrected
  measurements now used by the local uma.guide independent-training table.
- [Fan rewards](fan-rewards.md). Race placing rewards, support effects by level, and vendored
  primary concert measurements. Identifies gaps in the independent-training evidence.
- [Skill evaluation](skill-evaluation.md). Individual rating values, hint discounts and prerequisite costs.
- [Crazyfellow's guide](crazyfellow-parenting-gene-guide.txt). Broad mechanics and original-source
  links. Check whether each section applies to Global or a later JP feature.

Support-chain measurements are in `../loopacord-independent-training-research.xlsx`, sheet
"Chain Finish Rate Data".

GameTora's [scenario guide](gametora-our-grand-concert.md) and the [JP research memo](umasim-grand-live-memo.md)
omit manual skill-event timing and final-concert unlock instructions that this independent-training
project does not use. Older SP observations are not current Global training values.
