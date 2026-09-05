# Glossary

Terms as this tool uses them. Game terms follow the Global client's wording; where JP or community
names differ they are noted.

## Umamusume

- **Uma**: a trainable character. One *character* (e.g. Special Week) can have several *outfits*
  (character cards, e.g. [Special Dreamer]), each its own trainee with its own base stats.
- **Stars** (uma): the character card's rarity, 1★ to 5★, raised with pieces. Sets base stats; 3★ also
  unlocks the unique outfit and lets the unique skill be inherited. In the tool: the **Stars** dropdown.
- **Potential level** (JP 才能開花): 1 to 5, raised with shoes and sashes. Unlocks awakening skills.
  Assumed maxed by the tool.
- **Innate skills**: skills in the uma's own kit from the start. **Awakening skills**: the four
  unlocked by potential level. Both count as covered targets.
- **Growth** (growth rates, stat bonuses): the uma's percentage bonus per stat (e.g. Stamina +20%).
- **Aptitudes**: letter grades G to S for turf/dirt, sprint/mile/medium/long, and running styles.
  Only surface and distance matter to the tool.
- **Support card**: one of the six cards in a deck. Types: speed, stamina, power, guts, wit, **pal**
  (JP/GameTora "friend"), **group**. Rarity R/SR/SSR. **Limit break (LB)**: 0 to 4 duplicates
  merged; LB4 is **MLB**. Raises the card's level cap and effects.
- **Borrow** (friend's card, rental): the one deck slot that must hold another player's card, assumed
  MLB.
- **Hint**: an event on a training facility that gives a skill from the card's hint list at a
  discount. **Hint Frequency** and **Hint Levels** are card effects.
- **Chain events**: a support card's scripted event sequence (SSR: 3, SR: 2, R: 0). **Random
  events**: two per character, shared by her cards. **Outings** (recreation, dates): pal and group
  cards' own sequence; the last one is the **finale**.
- **Event skill**: a skill a card gives through an event rather than a hint (GameTora
  `event_skills`).
- **Scenario**: the career mode. This tool models **Our Grand Concert** (Global 2026-07-22).
  **Scenario-linked card**: Light Hello, mandatory there. **Scenario skill event**: the Senior November
  live where each option is tied to a character (Smart Falcon, Mihono Bourbon, Silence Suzuka, Agnes
  Tachyon); picking that option with her in the run (trainee or card) gives the gold skill, otherwise the
  normal version; the unaffiliated option gives Lane Legerdemain.
- **Independent training** (JP 自主トレ育成): the hands-off career mode. Inputs: deck, parents,
  training focus, agenda, up to 10 **prioritized skills**. Card stat contributions are near
  deterministic.
- **Training focus**: Balanced / Stamina / Sprint, shifts the stat split.
- **Agenda**: the race schedule for the run. **Career goals**: the uma's mandatory objective races.
- **Streak** (consecutive races): races in adjacent half-month slots; 3 or more in a row lower the
  win chance in independent training.
- **Rank** (evaluation): G to SS+ and beyond, from a score built from stats and skills. **SS** is the
  threshold that improves white spark star odds. A single stat at 1100+ is also rated SS on its own.
- **Legacy** (JP inheritance): the two **parents** and four **grandparents** whose sparks pass to the
  trainee. **Affinity**: compatibility between trainee and legacy; scales inheritance chances.
- **Spark** (JP factor): a trait a finished uma carries. **Blue** = stat (1★ +5, 2★ +12, 3★ +21 at
  career start and again per inspiration proc), **pink** = aptitude, **green** = unique skill,
  **white** = skill, race, or scenario. **Stars** on a spark: 1 to 3.
- **Inspiration events**: early April of Classic and Senior year, when sparks may proc again.
- **White spark generation**: at run end each owned skill may become a white spark: 20% for a white
  skill, 25% for a ◎ skill, 40% for its gold version, times 1.1 per copy already in the lineage.
- **Gold skill**: the upgraded form of a white skill (e.g. Concentration for Focus). **○ / ◎ / ×**:
  normal / stronger / weaker variants of some whites; ◎ is inheritance-only.
- **G1**: top race grade. One win per G1 is enough for the affinity bonus.

## This tool

- **Target** (target white spark): a white skill you want the finished parent to carry as a spark.
  Resolved to its **family**: the white, ◎, and gold forms.
- **Source**: a way the run can end up owning a target skill: hint, chain event, random event,
  outing, scenario option, innate/awakening skill, character event, or lineage. Each has an obtain
  chance.
- **Choice-gated**: a source that only happens if the run picks that option at an event. Only one
  option per event can be taken.
- **Prioritized skills**: the tool's suggested 10-entry list for independent training. Entry kinds:
  **target skill** (choice-gated, leads to a target), **not a target** (choice-gated, doesn't), **target
  but not a choice** (given regardless). Its order decides which option wins a conflict.
- **Choice conflict**: two or more targets (or a ranked non-target option) competing for one event's
  single option. The higher entry in the prioritized list takes it.
- **Spark chance**: expected chance a target becomes a white spark at run end. **Added spark chance**
  (marginal): how much a card raises the total over what the trainee and deck already cover.
  **Spark chance alone**: the card by itself.
- **Coverage**: which targets the run can obtain and through which sources.
- **Lineage** (per target): copies of that white spark already on each parent side (count and star
  total), which raise both hint and generation chances.
- **Pinned card**: forced into the deck. **Inventory**: your cards' limit breaks; unmarked cards count
  as owned at the default LB.
- **Observed / model** (basis): whether a card's stat contribution comes from logged runs or the fitted
  formula.
- **Event stats**: the deck-independent part of a run's stat gain (training events, races, scenario),
  measured from logs; **card stats**: the per-card contributions from the in-game log.
- **Race scale**: card stats grow as races shrink, by (T − races)/(T − 28) with T fitted (≈72).
- **Advanced settings**: rates the game does not publish, with their provenance in the tooltip.
