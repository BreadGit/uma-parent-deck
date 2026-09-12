# Spark goal templates

Minimum stars are written as `N*`. For preferred white sparks, `p=N` means priority N.
Godly templates default skills without support-card sources to 3 copies totaling 7★ on each parent side.
Existing lineage entries are kept. These defaults cover Ignited Spirit WIT, Racing Spirit: Stamina,
Racing Spirit: Power, Firm Resolve, Restraint, and Pedal to the Metal where included in a godly template.

The application catalog is maintained in [goal-templates.ts](../src/model/goal-templates.ts).

- Front runner parent (lite)
	- required: groundwork 2*
	- preferred: prudent positioning p=0, dodging danger p=0, right-handed p=0, left-handed p=0, tail held high p=0, Front Runner Corners p=0, Front Runner Straightaways p=0, Front Runner Savvy p=1, fall runner p=1, winter runner p=1, spring runner p=1, firm conditions p=1, wet conditions p=1, standard distance p=1, non-standard distance p=1
	- blue sparks: any 2*
	- pink sparks: any 1*
- Front runner parent (decent)
	- required: groundwork 2*, ignited spirit wit 2*
	- preferred: prudent positioning p=0, dodging danger p=0, right-handed p=0, left-handed p=0, tail held high p=0, firm resolve p=0, Front Runner Corners p=0, Front Runner Straightaways p=0, Front Runner Savvy p=1, fall runner p=1, winter runner p=1, spring runner p=1, firm conditions p=1, wet conditions p=1, standard distance p=1, non-standard distance p=1
	- blue sparks: speed, stamina, power, wit 2*
	- pink sparks: any 2*
- Front runner parent (godly)
	- required: groundwork 2*, ignited spirit wit 2*, racing spirit: stamina 2*, prudent positioning 2*, dodging danger 2*, tail held high 2*, firm resolve 2*
	- preferred: right-handed p=0, left-handed p=0, Front Runner Corners p=0, Front Runner Straightaways p=0, Front Runner Savvy p=1, fall runner p=1, winter runner p=1, spring runner p=1, firm conditions p=1, wet conditions p=1, standard distance p=1, non-standard distance p=1
	- blue sparks: speed, stamina, power 3*
	- pink sparks: turf 2*
	- optional description: dont take this build too seriously, its more just to show the probability of getting a parent with this many spark goals. turf 2* is used here as a stand-in for whatever track distance you want to target. you could of course make this even crazier with more 3*s and more required white sparks, but at that point it enters the realm being outright impossible.
- Pace chaser parent (lite)
	- required: nimble navigator 2*
	- preferred: groundwork p=0, uma stan p=0, tail held high p=0, shrewd step p=0, right-handed p=0, left-handed p=0, ramp up p=0, playtime's over! p=0, slipstream p=0, pace chaser Corners p=0, pace chaser Straightaways p=0, pace chaser Savvy p=1, fall runner p=1, winter runner p=1, spring runner p=1, firm conditions p=1, wet conditions p=1, standard distance p=1, non-standard distance p=1
	- blue sparks: any 2*
	- pink sparks: any 1*
- Pace chaser parent (decent)
	- required: groundwork 2*, nimble navigator 2*
	- preferred: racing spirit: stamina p=0, racing spirit: power p=0, uma stan p=0, tail held high p=0, shrewd step p=0, right-handed p=0, left-handed p=0, ramp up p=0, playtime's over! p=0, slipstream p=0, pace chaser Corners p=0, pace chaser Straightaways p=0, pace chaser Savvy p=1, fall runner p=1, winter runner p=1, spring runner p=1, firm conditions p=1, wet conditions p=1, standard distance p=1, non-standard distance p=1
	- blue sparks: speed, stamina, power, wit 2*
	- pink sparks: any 2*
- Pace chaser parent (godly)
	- required: groundwork 2*, nimble navigator 2*, racing spirit: stamina 2*, racing spirit: power 2*, uma stan 2*, tail held high 2*, shrewd step 2*
	- preferred: right-handed p=0, left-handed p=0, ramp up p=0, playtime's over! p=0, slipstream p=0, pace chaser Corners p=0, pace chaser Straightaways p=0, pace chaser Savvy p=1, fall runner p=1, winter runner p=1, spring runner p=1, firm conditions p=1, wet conditions p=1, standard distance p=1, non-standard distance p=1
	- blue sparks: speed, stamina, power 3*
	- pink sparks: turf 2*
	- optional description: dont take this build too seriously, its more just to show the probability of getting a parent with this many spark goals. turf 2* is used here as a stand-in for whatever track distance you want to target. you could of course make this even crazier with more 3*s and more required white sparks, but at that point it enters the realm being outright impossible.
- Late surger parent (lite)
	- required: uma stan 2*
	- preferred: tail held high p=0, nimble navigator p=0, late surger Corners p=0, late surger Straightaways p=0, ramp up p=0, playtime's over p=0, slipstream p=0
	- blue sparks: any 2*
	- pink sparks: any 1*
- Late surger parent (decent)
	- required: uma stan 2*
	- preferred: restraint p=0, racing spirit: stamina p=0, pedal to the metal p=0, racing spirit: power p=0, tail held high p=0, nimble navigator p=0, late surger Corners p=0, late surger Straightaways p=0, ramp up p=0, playtime's over p=0, slipstream p=0
	- blue sparks: speed, stamina, power, wit 2*
	- pink sparks: any 2*
- Late surger parent (godly)
	- required: uma stan 2*, restraint 2*, racing spirit: stamina 2*, pedal to the metal 2*, racing spirit: power 2*, tail held high 2*, nimble navigator 2*, slick surge 2*
	- preferred: late surger Corners p=0, late surger Straightaways p=0, ramp up p=0, playtime's over p=0, slipstream p=0
	- blue sparks: speed, stamina, power 3*
	- pink sparks: turf 2*
	- optional description: dont take this build too seriously, its more just to show the probability of getting a parent with this many spark goals. turf 2* is used here as a stand-in for whatever track distance you want to target. you could of course make this even crazier with more 3*s and more required white sparks, but at that point it enters the realm being outright impossible.
- End closer parent (lite)
	- required: uma stan 2*
	- preferred: tail held high p=0, nimble navigator p=0, end closer Corners p=0, end closer Straightaways p=0, ramp up p=0, playtime's over p=0, slipstream p=0, straightaway spurt p=0
	- blue sparks: any 2*
	- pink sparks: any 1*
- End closer parent (decent)
	- required: uma stan 2*
	- preferred: restraint p=0, racing spirit: stamina p=0, racing spirit: power p=0, tail held high p=0, nimble navigator p=0, straightaway spurt p=0, end closer Corners p=0, end closer Straightaways p=0, ramp up p=0, playtime's over p=0, slipstream p=0
	- blue sparks: speed, stamina, power, wit 2*
	- pink sparks: any 2*
- End closer parent (godly)
	- required: uma stan 2*, restraint 2*, racing spirit: stamina 2*, racing spirit: power 2*, tail held high 2*, nimble navigator 2*, straightaway spurt 2*
	- preferred: end closer Corners p=0, end closer Straightaways p=0, ramp up p=0, playtime's over p=0, slipstream p=0
	- blue sparks: speed, stamina, power 3*
	- pink sparks: turf 2*
	- optional description: dont take this build too seriously, its more just to show the probability of getting a parent with this many spark goals. turf 2* is used here as a stand-in for whatever track distance you want to target. you could of course make this even crazier with more 3*s and more required white sparks, but at that point it enters the realm being outright impossible.
