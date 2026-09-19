# Game basics and mechanics

Reviewed for Global on 2026-09-18. This overview keeps the broad game context from the former
Global Reference Document beginner and mechanics PDF/text pairs. It replaces their launch-era
roster advice, shop prices, fixed stat targets, and superseded inheritance rules. Detailed numerical
claims belong in the linked research notes, where their evidence and limits can be checked.

## Account, trainee, and veteran

An unlocked trainee is a reusable starting character, not a completed racer. A career creates a
new veteran with that run's final stats, learned skills, aptitudes, race record, and sparks.
You can train the same trainee repeatedly and keep different veterans for racing or inheritance.
Account upgrades affect future careers; they do not retrain an existing veteran.

Trainee stars raise her starting capabilities. Potential levels unlock more awakening skills for
purchase during careers. Alternate outfits are distinct trainee cards of the same character.
Support cards are separate account items used to help train a trainee, not veterans or parents.
Their rarity, level, limit breaks, and unique-effect unlocks determine their available effects.

Carats and scout tickets acquire trainees or supports. Money and support points level supports;
pieces raise trainee stars; awakening materials raise potential levels. Uncap crystals and duplicate
supports can raise support limit breaks. TP spent to start a career, energy within a career,
the Stamina stat, and remaining HP within a race are different quantities.
Check the current Global client for banner pools, prices, reward schedules, and exchange limits.

Sources: GameTora's [beginner guide](https://gametora.com/umamusume/beginners-guide) and
[Global quickstart](https://gametora.com/umamusume/guides/global-quickstart-guide).
Both contain dated beginner recommendations; use them for the named systems, not a current tier list.

## A career

Choose a scenario, trainee, two parent veterans, and six supports. The deck has five owned cards
and one borrowed card. A trainee cannot use a support of herself, and a deck cannot contain two
supports of the same character. Parent borrowing is separate from support borrowing.

The calendar progresses through Junior, Classic, and Senior years. In a manual career, turns
are spent training, resting, taking outings, treating negative conditions, or racing. Training
raises stats and SP. Energy, mood, support bond, events, career goals, and scenario rules affect
which actions are useful. Buying skills does not consume a turn.

Events can grant stats, SP, hints, bond, or conditions. One event choice can forfeit another
reward. A support's chain completion is different from receiving its gold skill after completion.
Career goals can require entering a race, finishing within a specified place, or earning fans.
Scenario finales and rewards come in addition to the regular race calendar.

## Ordinary races and independent training

Ordinary career races and races using completed veterans depend on stats, skills, aptitudes,
strategy, course conditions, and interactions with the other runners.

| Stat | Main ordinary-race roles |
|---|---|
| Speed | Target speed in the late race and last spurt |
| Stamina | Race HP and the ability to sustain the last spurt |
| Power | Acceleration, lane changes, and handling uphill sections |
| Guts | Late-race HP consumption and competitive late-race mechanics |
| Wit | Skill activation, rushing, positioning, and downhill behavior |

Surface aptitude, distance aptitude, and running-style aptitude affect different ordinary-race
calculations. Front Runner, Pace Chaser, Late Surger, and End Closer describe positioning strategies.
Speed, acceleration, recovery, debuff, and passive skills solve different race problems. Their
activation conditions and timing matter; a large evaluation score alone does not establish usefulness.
See GameTora's [race handbook](https://gametora.com/umamusume/race-mechanics) for the concepts.
Its JP mechanics and patch-specific formulas require a Global applicability check.

Independent training completes a career in the background from the selected deck, lineage,
training focus, agenda, and prioritized skills. Its race odds use a separate simplified model;
do not apply the ordinary-race stat formulas to them. Conversely, do not use independent-training
win percentages for PvP. The player purchases skills after independent training finishes.
[Independent-training guidance](refs/umaguide-independent-training.md) and
[race measurements](refs/shoppo-independent-training-race-odds.md) explain the supported rules.
Auto-Train, also called Auto-kun in JP research, is a different automation feature.

## Supports and skills

Stat-type supports help at training facilities. Friendship training requires sufficient bond and
the appropriate facility; support placement and event outcomes introduce uncertainty. Pal and
Group supports have different event and outing structures. A card's skill sources and its stat
contribution are separate reasons to choose it.

Training Effectiveness, Mood Effect, Friendship Bonus, stat bonuses, starting stats and bond,
Specialty Priority, and recovery effects influence different parts of a manual career.
Race Bonus and Fan Bonus are distinct effects. Fan Bonus affects race fans, while Race Bonus
affects race stat and SP rewards. Do not assume every scenario reward receives either bonus.
See [fan rewards](refs/fan-rewards.md) and [conditional uniques](refs/gametora-unique-effects.md).

A hint makes a skill available and can reduce its SP cost; it does not buy the skill. Innate and
awakening skills also need SP. A white spark passes the basic skill hint, not a purchased gold
upgrade. Actual skill families determine whether a circle upgrade exists and which prerequisites
must be bought. Skill rarity and icon color are different classifications.
See [skill evaluation and costs](refs/skill-evaluation.md) and the [glossary](GLOSSARY.md).

### Legacy mechanics table for conditional gold rewards

The former Global Reference Document's Mechanics chapter, "Gold Skill Rates", supplied the
following community table for a stat-dependent gold-versus-white support-chain outcome.
It is retained here as provenance for that specific assumption, not as a universal probability
for every gold event or a measured independent-training chain-completion rate.

| Matching stat when the event occurs | Below 400 | 400–599 | 600–699 | 700–799 | 800–999 | 1,000+ |
|---|---:|---:|---:|---:|---:|---:|
| Gold outcome | 30% | 60% | 65% | 75% | 80% | 90% |

Other events can guarantee the gold reward or use different conditions. Use the specific event's
decoded rewards before applying this table. The source PDF remains recoverable from repository
history; its broader stat recommendations are not carried forward.

## Inheritance and parent farming

Parents and their parents form six ancestor slots. Each ancestor has one blue stat spark and one
pink aptitude spark, plus any green or white sparks. Inheritance changes starting stats and
aptitudes, and inspiration events can grant further gains and hints. Parent stats are not copied
directly into the trainee. Sparks and compatibility determine inheritance benefits.

Blue sparks concern stats; pink sparks concern aptitudes; green sparks concern unique skills;
white sparks concern skills, races, and scenarios. Generating a spark at career end and activating
an ancestor's spark during a later career are different random events.
Shared G1 wins contribute to compatibility, so a parent-farming agenda can differ from an agenda
chosen only to maximize final stats. Each applicable relationship gets the shared-race contribution;
the displayed compatibility symbol summarizes the lineage rather than giving every ancestor's score.

Use [spark generation](refs/hakuraku-spark-generation.md) for generation estimates and
[aptitude inheritance](refs/aptitude-inheritance.md) for starting grades and inspiration activation.
Higher final rank improves some star-quality probabilities; it does not guarantee the desired sparks.

## Scenarios, fans, and competitions

Scenarios add systems to the career, such as Our Grand Concert's lessons, tokens, and concerts.
They can change training rewards, stat caps, available skills, and the value of support cards.
[Our Grand Concert](refs/gametora-our-grand-concert.md) gives its song and event requirements.

Fans are earned during careers and can satisfy entry requirements, career goals, and unique-skill
level checks. They are not stat points or SP. Timing matters when a check occurs before later rewards.

Veterans race in Team Trials, event competitions, Daily Races, and Legend Races. Team Trials uses
multiple distance/surface categories and awards points for race performance. Its weekly class cutoff
changes. Event competitions can specify a particular course and entry restrictions. The course and
mode determine which skills and stats matter; a parent-farming veteran is not automatically a strong
competition entry. Check current event rules instead of treating a saved roster or cutoff as current.

For longer research and historical or JP comparisons, keep using
[Crazyfellow's guide](refs/crazyfellow-parenting-gene-guide.txt) with its section-level scope notes.
