# Glossary

Terms as this tool uses them. Game terms follow the Global client's wording; where JP or community
names differ they are noted.

## Umamusume

- **Uma**: a character in the game.
- **Umamusume**: both the name of the game this tool is used for, and also the full name of the term
  "uma". "an uma" and "an umamusume" both refer to "a character", but "uma" is a more common shorthand.
  in japanese this term means "horse girl". not all characters in umamusume are horse girls, some are humans.
- **Trainee**: a playable umamusume. this is selectable in the tool as the umamusume used in a run. One *trainee character* (e.g. Special Week) can have several *outfits*
  (summer version, e.g. [Hopp'n♪Happy Heart]), each its own trainee with its own base stats.
- **Stars** (Trainee): the Trainee's rarity, can vary between 1★ to 5★. Sets base stats. In the tool: the Trainee **Stars** dropdown.
- **Potential level**: 1 to 5, raised with shoes and sashes. Unlocks awakening skills.
  Assumed maxed by the tool.
- **Innate skills**: skills in the Trainee's own kit from the start. **Awakening skills**: the four
  unlocked by potential level. Both count as covered targets.
- **Growth** (growth rates, stat bonuses): the Trainee's percentage bonus per stat (e.g. Stamina +20%).
- **Aptitudes**: letter grades G to S for turf/dirt, sprint/mile/medium/long, and running styles.
  Only surface and distance matter to the tool.
- **Support card**: one of the six cards in a deck. Types: speed, stamina, power, guts, wit, **pal**
  (JP/GameTora "friend"), **group**. Rarity R/SR/SSR. **Limit break (LB)**: 0 to 4 duplicates
  merged; LB4 is **MLB**. Raises the card's level cap and effects. support cards will typically represent a character in the game. the 6 support cards in a deck will influence how a Trainee's career run will go.
- **Borrow** (friend's card, rental): the one deck slot that must hold another player's card, assumed
  MLB in the tool.
- **Hint**: the way a skill is given to a Trainee. if the Trainee has the skill already then the skill lvl will go up to a cap. the higher the skill lvl the less the skill costs in SP to purchase. **Hint Frequency** and **Hint Levels** are card effects.
- **Skill Point (SP)**: the points used to purchase skills after a run is over.
- **Chain events**: a support card's scripted event sequence (SSR: 3, SR: 2, R: 0). **Random
  events**: a list of events that can happen randomly during a run. **Outings** (recreation, dates): pal and group
  cards' own sequence; the last one is the **finale**.
- **Trainee events**: the Trainee's own events. **Story events** play in every career; **choice events** offer
  two or three options; her **outings** happen when the run takes her out; **secret events** (hidden events)
  fire only once their conditions are met, usually winning specific G1s in a given year, and often give a skill.
- **Scenario**: the career mode. This tool models **Our Grand Concert** (Global 2026-07-22).
  **Scenario-linked card**: A card that has a special effect in a scenario, for example giving a special scenario skill during the scenario skil event. **Scenario skill event**: an event that takes place Senior year in early November where each option is tied to a character (Smart Falcon, Mihono Bourbon, Silence Suzuka, Agnes
  Tachyon); picking that option with her in the run (trainee or card) gives the gold skill, otherwise the
  normal version; the unaffiliated option gives Lane Legerdemain.
- **Independent training**: the hands-off career mode. Inputs: deck, parents,
  training focus, agenda, up to 10 **prioritized skills**. Card stat contributions are near
  deterministic.
- **Training focus**: Balanced / Stamina / Sprint, shifts the stat split.
- **Agenda**: the race schedule for the run. **Career goals**: the Trainee's mandatory objective races.
- **Streak** (consecutive races): races in adjacent half-month slots; 3 or more in a row lower the
  win chance in independent training.
- **Rank** (evaluation): G to SS+ and beyond, from a score built from stats and skills. an overall rank of **SS** is the
  threshold that improves white spark star odds. A single stat at 1100+ will also show its own "SS" ranking, though this is a different ranking from the overall ranking.
- **Legacy** (JP parent, inheritance): the two **parents** and four **grandparents** whose sparks pass to the
  trainee. **Affinity**: compatibility between trainee and legacy and boosted by shared G1 wins between a parent and grandparent; it scales inheritance chances.
- **Spark** (JP factor): a trait a finished Trainee carries. **Blue** = stat (1★ +5, 2★ +12, 3★ +21 at
  career start and again per inspiration proc), **pink/red** = aptitude, **green** = unique skill,
  **white** = skill, race, or scenario. **Stars** on a spark: 1 to 3.
- **Legacy screen**: the game's pre-run screen with the trainee's stats after inheritance, a "+XX" above each
  stat per parent side, and her aptitudes. In the tool, the **Legacy screen** panel copies it: the **start
  gain** per parent (one of the 20 sums three sparks can make, +0 to +63) and the surface and distance
  aptitudes after pink sparks.
- **Inspiration events**: early April of Classic and Senior year, when sparks may proc again.
- **White spark generation**: at run end each owned skill may become a white spark: 20% for a white
  skill, 25% for a ◎ skill, 40% for its gold version, times 1.1 per copy already in the lineage.
- **Gold skill**: the upgraded form of a white skill (e.g. Concentration for Focus). **○ / ◎ / ×**:
  normal / stronger / weaker variants of some whites; ◎ is inheritance-only.
- **G1**: top race grade. One win per G1 is enough for the affinity bonus.

## This tool

- **Target** (target white spark): a white skill you want the finished parent to carry as a spark.
- **Source**: a way the run can end up owning a target skill: hint, chain event, random event,
  outing, scenario option, trainee event (story, choice, outing or secret), innate/awakening skill, or
  lineage. Each has an obtain chance. A secret event's chance is the product of its conditions' chances,
  with race wins scored from the agenda and conditions the tool cannot score given the fallback rate.
- **Choice-gated**: a source that only happens if the run picks that option at an event. Only one
  option per event can be taken.
- **Prioritized skills**: the tool's suggested 10-entry list for independent training. Entry types:
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
- **Pinned card**: a card the builder places first, best marginal gain first. An owned pin takes one of
  the five owned slots; a pin not in the inventory asks for the friend's slot at LB4. With six or more
  owned pins, the best five are kept and the rest compete for the friend's slot unless "borrow best
  overall card" is ticked. **Inventory**: your cards' limit breaks; unmarked cards count as owned at the
  default LB.
- **Observed / model** (basis): whether a card's stat contribution comes from logged runs or our estimated fitted
  formula.
- **Event stats**: the deck-independent part of a run's stat gain (training events, races, scenario),
  measured from logs; **card stats**: the per-card contributions from the in-game log.
- **Race scale**: card stats grow as races shrink, by (T − races)/(T − 28) with T fitted (≈72).
- **Advanced settings**: rates the game does not publish and that we made an educated guess on, with their provenance in the tooltip.
