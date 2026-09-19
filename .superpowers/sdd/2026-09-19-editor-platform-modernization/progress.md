# SDD ledger — plan: docs/superpowers/plans/2026-09-19-editor-platform-modernization.md

Execution mode: inline, no subagents, no commits by explicit user instruction.
Ruling: implement in the current `main` working directory — the user explicitly requested all work here and prohibited commits; cost if wrong: changes are not isolated and must be reviewed from the working tree.
Ruling: the bundled SDD shell helpers are unavailable because this Windows environment has no Bash; maintain the equivalent task ledger and briefs directly — cost if wrong: no automatic range bookkeeping, mitigated by per-task test evidence in this ledger.

Pre-flight Task 1 → Task 2: `createFurnitureDocument` and `validateFurnitureDocument` names match the migration consumer.
Pre-flight Task 2 → Task 9: schema-v2 document and legacy migration are the editor web persistence boundary.
Pre-flight Task 3 → Tasks 4-7: `editor-api` application and independently configured ORM are shared by auth, repositories, migration, and routes.
Pre-flight Task 5 → Tasks 6-8: repository identities and immutable revision semantics are consumed by migration and API services.
Pre-flight Task 7 → Tasks 8-10: definitions/revisions/kitchens/instances REST resources supply safe updates and both web clients.
Pre-flight Task 8 → Task 10: revision preview/apply contract supplies constructor update UI.
Pre-flight Task 11 → Task 12: RuleEngine and manufacturing entities emit domain changes consumed by commands and scene synchronization.
Pre-flight Task 7 → Task 13: editor-api summaries replace user-service direct table reads.

Task 1: complete (no commits by user instruction; tests: editor-service `pnpm test` → 41/41 pass).
Task 2: complete (no commits; tests: editor-service `pnpm test` → 45/45 pass).
Task 3: complete (no commits; tests: editor-api unittest → 2/2 pass; compileall pass; orchestrator lists user/editor-api/constructor/editor).
Task 4: complete (no commits; tests: editor-api unittest → 6/6 pass).
Task 5: complete (no commits; created local `mebel_editor`; repository integration suite → 9/9 pass).
Task 6: complete (no commits; idempotent migration integration tests → 2/2 pass; CLI supports dry-run/verify/project filter).
Task 7: complete (no commits; definitions/revisions/library/kitchens/instances routes; ownership and immutable revision API tests → 4/4 pass).
Task 8: complete (no commits; pure placement preview plus API apply guard; editor JS 47/47 and kitchen API 2/2 pass).
Task 9: complete (no commits; ProjectService/EditorController, revision API integration, local drafts, library switch; tests 51/51 and production build pass).
Task 10: complete (no commits; constructor now uses immutable instance references, parent-group selection, edit/update preview/apply UI; tests 26/26 and production build pass).
Task 11: complete (no commits; composable rules, versioned catalog CRUD foundation, manufacturing provenance; editor tests 54/54 and catalog integration test pass).
Task 12: complete (no commits; bounded command history, snapshot adapter, coalesced entity scene updates with full-sync fallback; editor tests 58/58 pass).
Task 13: complete (no commits; user pages and compatibility kitchen routes use editor-api; legacy furniture/library routes and schema hooks retired; real migration 3/3 verified and repeat run inserted 0).
Task 14: complete (no commits; editor JS 59/59, constructor JS 26/26, editor-api Python 18/18, user-service Python 3/3; both production builds pass; all four services return 200 and protected data returns 401 without a session).
