# Backlog

Known issues and cleanups that are real but not tied to the branch that found them. Each entry
says what is wrong, where, and what addressing it means. Remove an entry in the commit that
resolves it.

## Search summary alternatives are computed but never shown

`GoalSearchSummary.alternatives` in `src/model/run.ts` lists other legal borrows that share the
best deck's owned cards. The deck panel showed that list until commit 3e10fe3 removed the Borrow
paragraph. Nothing reads the field now, and `summarize()` still filters and sorts every candidate
to build it on each progress callback and again for the final result.

Either reinstate the display in `src/ui/panels/deck.ts` or delete the field, the filter in
`summarize()`, and the empty fixture in `tests/recommendation.test.ts`.
