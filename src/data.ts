import type { Card, Character, Data, Race, Rank, ScenarioEvent, Skill, StatModel } from './types.ts';
import cardsJson from '../data/cards.json';
import skillsJson from '../data/skills.json';
import charactersJson from '../data/characters.json';
import racesJson from '../data/races.json';
import ranksJson from '../data/ranks.json';
import scenarioEventsJson from '../data/scenario-events.json';
import modelJson from '../data/stat-model.json';

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
  };
}
