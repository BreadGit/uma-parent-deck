import type { Data } from '../types.ts';
import type { WhiteTarget } from './goal-input.ts';
import { PRIORITIZED_SKILLS_MAX } from './rules.ts';
import { resolveTarget } from './sparks.ts';

/** Sufficient conditions for reusing a search, not a detector for every harmless reorder.
 * Required target families always precede non-targets in every candidate deck, before the ten-skill
 * cutoff. A permutation that keeps every target entry fixed cannot change their event choices.
 * Predicted stats and rank currently do not depend on which non-target event option wins. If that
 * model assumption or required-first ordering changes, disable/revisit this rule and its exhaustive
 * deck tests. Preferred targets can lose shared events to non-target choices, so they always search.
 * Require the same saved entries: materializing an implicit order, dropping absent entries, or
 * adding a skill can change target priorities on alternative decks even if this deck looks unchanged.
 */
export function canReusePrioritySearch(before: number[], after: number[], targets: WhiteTarget[], data: Data): boolean {
  if (!before.length || before.length > PRIORITIZED_SKILLS_MAX || before.length !== after.length) return false;
  if (targets.some((t) => t.role !== 'required' || !resolveTarget(t.id, data))) return false;
  const oldIds = new Set(before), newIds = new Set(after);
  if (oldIds.size !== before.length || newIds.size !== after.length || after.some((id) => !oldIds.has(id) || !data.skillById.has(id))) return false;
  const targetIds = new Set(targets.flatMap((t) => [...resolveTarget(t.id, data)!.familyIds]));
  return before.every((id, i) => id === after[i] || (!targetIds.has(id) && !targetIds.has(after[i]!)));
}
