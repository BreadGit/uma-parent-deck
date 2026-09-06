import type { Card, Character, Data, Race, Rank, ScenarioEvent, Skill, StatModel } from './types.ts';
import cardsJson from '../data/cards.json' with { type: 'json' };
import skillsJson from '../data/skills.json' with { type: 'json' };
import charactersJson from '../data/characters.json' with { type: 'json' };
import racesJson from '../data/races.json' with { type: 'json' };
import ranksJson from '../data/ranks.json' with { type: 'json' };
import scenarioEventsJson from '../data/scenario-events.json' with { type: 'json' };
import modelJson from '../data/stat-model.json' with { type: 'json' };

/** The bundled game data with lookup maps. Shared by the app, the tests and the inspect script. */
export function loadData(): Data {
  const cards = cardsJson as unknown as Card[];
  const skills = skillsJson as unknown as Skill[];
  const characters = charactersJson as unknown as Character[];
  const races = racesJson as unknown as Race[];
  const ranks = ranksJson as unknown as Rank[];
  const scenarioEvents = scenarioEventsJson as unknown as ScenarioEvent[];
  const model = modelJson as unknown as StatModel;
  return {
    cards, skills, characters, races, ranks, scenarioEvents, model,
    cardById: new Map(cards.map((c) => [c.id, c])),
    skillById: new Map(skills.map((s) => [s.id, s])),
    charByCardId: new Map(characters.map((c) => [c.cardId, c])),
    charById: firstOutfitById(characters),
  };
}

/** One Character per charId: the first outfit listed, which is the base one. */
function firstOutfitById(characters: Character[]): Map<number, Character> {
  const out = new Map<number, Character>();
  for (const c of characters) if (!out.has(c.charId)) out.set(c.charId, c);
  return out;
}
