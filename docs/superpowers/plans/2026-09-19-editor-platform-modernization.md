# Editor Platform Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all editor and constructor domain data to a separately deployable editor API/database while introducing versioned furniture documents, immutable revisions, furniture instances, rule/catalog foundations, command history, and incremental scene synchronization.

**Architecture:** Apply a strangler migration. Add a Quart `editor-api` beside the existing Vite frontend, keep legacy readers temporarily, migrate existing rows idempotently with stable UUIDs, then switch editor, constructor, and user-facing pages to the new contracts before removing legacy storage. Domain JSON remains the source of truth; Three.js remains a projection.

**Tech Stack:** Python 3.13, Quart 0.20, Hypercorn, asyncpg/Airqore ORM, PostgreSQL 17, JavaScript ES modules, Three.js 0.179, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-19-editor-platform-modernization-design.md`

## Global Constraints

- Do not create git commits; the user explicitly prohibited all further commits.
- Preserve the user's untracked `base.sql` and `manage_sql.py` files.
- Keep all legacy UUIDs, `user_id`, `kitchen_project_id`, autosaves, timestamps, room data, scene data, and library entries.
- The editor database must be configurable independently and may run on another PostgreSQL server.
- `user-service` remains the only authority for users and sessions.
- Fail closed when authentication cannot be verified.
- Do not invent manufacturer product data or compatibility rules.
- Every production behavior change follows red-green-refactor.
- Existing editor and constructor tests must remain green after every task.

## Review Focus

- An old project with malformed or partial JSON must return a structured migration error without overwriting source data; covered in Task 2 migration tests.
- A repeated database migration must preserve row counts and UUIDs without duplicate revisions; covered in Task 6 migration tests.
- A user must never read or update another user's definitions, kitchens, revisions, or instances; covered in Task 5 API ownership tests.
- Updating an instance to a wider revision must leave the old revision active when placement validation fails; covered in Task 8 instance tests.
- Authentication service timeout must return `503`, while missing/expired sessions return `401`; covered in Task 4 authentication tests.

---

### Task 1: Versioned Furniture Document Foundation

**Files:**
- Create: `services/editor-service/src/domain/document.js`
- Create: `services/editor-service/src/domain/validation.js`
- Create: `services/editor-service/src/domain/identifiers.js`
- Create: `services/editor-service/tests/document.test.js`
- Modify: `services/editor-service/package.json`

**Interfaces:**
- Produces: `createFurnitureDocument({ name, componentType, legacyModel }) -> document`
- Produces: `validateFurnitureDocument(document) -> { valid, violations }`
- Produces: `createEntityId() -> UUID string`

- [ ] **Step 1: Write failing document tests**

```js
test("new document has schema version 2 and exactly one root assembly", () => {
  const document = createFurnitureDocument({ name: "Шкаф", componentType: "base-cabinet" });
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.documentType, "furniture-definition");
  assert.equal(document.entities.assemblies.length, 1);
  assert.equal(document.entities.assemblies[0].id, document.rootAssemblyId);
});

test("validator rejects an orphan panel", () => {
  const document = createFurnitureDocument({ name: "Шкаф" });
  document.entities.panels.push({ id: crypto.randomUUID(), ownerAssemblyId: crypto.randomUUID() });
  assert.equal(validateFurnitureDocument(document).violations[0].code, "ORPHAN_ENTITY");
});
```

- [ ] **Step 2: Run tests and verify expected missing-module failure**

Run: `pnpm --dir services/editor-service test`
Expected: FAIL because `src/domain/document.js` does not exist.

- [ ] **Step 3: Implement minimal document creation and structural validation**

Implement stable arrays for `assemblies`, `panels`, `facades`, `hardwareInstances`, `connections`, and `machiningOperations`; validate one root, ownership, duplicate IDs, missing references, and assembly cycles.

- [ ] **Step 4: Run the complete editor test suite**

Run: `pnpm --dir services/editor-service test`
Expected: all document and existing model tests pass.

### Task 2: Legacy JSON Migration and Serialization Boundary

**Files:**
- Create: `services/editor-service/src/persistence/migrations.js`
- Create: `services/editor-service/src/persistence/serialize.js`
- Create: `services/editor-service/tests/migrations.test.js`
- Modify: `services/editor-service/src/model.js`

**Interfaces:**
- Consumes: `createFurnitureDocument`, `validateFurnitureDocument`
- Produces: `migrateFurnitureDocument(input) -> schemaVersion 2 document`
- Produces: `serializeFurnitureDocument(document) -> plain JSON-safe object`

- [ ] **Step 1: Write failing legacy migration tests**

```js
test("legacy model becomes one rooted revision document", () => {
  const result = migrateFurnitureDocument({ parts: [{ id: "part-1", kind: "part", sizeX: 600, sizeY: 16, sizeZ: 400, xMm: 0, yMm: 0, zMm: 0 }] });
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.entities.panels.length, 1);
  assert.equal(result.entities.panels[0].legacyId, "part-1");
  assert.equal(result.entities.panels[0].ownerAssemblyId, result.rootAssemblyId);
});

test("unsupported future schema is rejected", () => {
  assert.throws(() => migrateFurnitureDocument({ schemaVersion: 999 }), /unsupported_schema_version/);
});
```

- [ ] **Step 2: Verify tests fail because migration API is missing**

- [ ] **Step 3: Implement deterministic legacy conversion**

Preserve legacy IDs in `legacyId`, generate UUID entity IDs, remap `attachedTo`, `lockedTo`, connection part IDs, and group relationships, and create placement bounds from the migrated model.

- [ ] **Step 4: Add round-trip tests and run the full editor suite**

Assert `serialize -> migrate -> serialize` is stable for schema version 2.

### Task 3: Editor API Skeleton and Independent Configuration

**Files:**
- Create: `services/editor-service/api/server.py`
- Create: `services/editor-service/api/configuration.py`
- Create: `services/editor-service/api/database.py`
- Create: `services/editor-service/api/helpers.py`
- Create: `services/editor-service/api/routes/health.py`
- Create: `services/editor-service/api/tests/test_health.py`
- Modify: `requirements.txt`
- Modify: `.env`
- Modify: `server.py`
- Modify: `services/editor-service/vite.config.js`
- Modify: `services/constructor-service/vite.config.js`
- Modify: `README.md`

**Interfaces:**
- Produces: `GET /api/editor/health -> { status: "ok", service: "editor-api" }`
- Produces: independently configured `editor_orm`

- [ ] **Step 1: Write a failing Quart health endpoint test**

```python
async def test_health_endpoint():
    app = create_app()
    response = await app.test_client().get("/api/editor/health")
    assert response.status_code == 200
    assert await response.get_json() == {"service": "editor-api", "status": "ok"}
```

- [ ] **Step 2: Verify the Python test fails because the API package is absent**

Run: `python -m unittest discover services/editor-service/api/tests -v`

- [ ] **Step 3: Implement the API process and independent env configuration**

Use `EDITOR_DB_*` variables to construct an `ORMConfig` without reusing `DB_*`. Bind Hypercorn to `EDITOR_API_HOST:EDITOR_API_PORT`.

- [ ] **Step 4: Add editor-api to the root orchestrator and proxies**

Proxy `/api/editor` from both Vite services to `http://127.0.0.1:8081` while retaining legacy `/api` proxy temporarily.

- [ ] **Step 5: Run health tests and validate orchestrator definitions**

### Task 4: Cross-Service Authentication

**Files:**
- Create: `services/editor-service/api/auth/client.py`
- Create: `services/editor-service/api/auth/decorators.py`
- Create: `services/editor-service/api/tests/test_auth.py`
- Modify: `services/user-service/modules/auth/controller.py`
- Modify: `services/user-service/modules/auth/service.py`

**Interfaces:**
- Produces: `AuthClient.current_company(cookie_header) -> AuthenticatedCompany`
- Produces: `@require_company` route decorator

- [ ] **Step 1: Write failing tests for 200, 401, 403, and 503 outcomes**

Use an injected async transport rather than network mocks. Assert a disabled user and non-company role are rejected and an unavailable user service maps to `503`.

- [ ] **Step 2: Verify expected failures**

- [ ] **Step 3: Implement cookie forwarding and fail-closed error mapping**

Never log cookie values. Normalize the user response to `{ id: int, category: str }`.

- [ ] **Step 4: Run editor API and existing user-service tests**

### Task 5: Editor Database Schema and Repositories

**Files:**
- Create: `services/editor-service/api/schema.py`
- Create: `services/editor-service/api/repositories/definitions.py`
- Create: `services/editor-service/api/repositories/kitchens.py`
- Create: `services/editor-service/api/repositories/catalog.py`
- Create: `services/editor-service/api/tests/test_repositories.py`
- Create: `services/editor-service/sql/001_editor_schema.sql`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces typed repositories for definitions, revisions, library entries, drafts, kitchens, instances, catalog records, and migration runs.

- [ ] **Step 1: Write failing repository contract tests against a disposable database**

Cover immutable revisions, unique `(definition_id, revision_number)`, owner filtering, kitchen instance references, and catalog version retention.

- [ ] **Step 2: Verify schema/repositories are absent**

- [ ] **Step 3: Implement schema with typed identity columns and JSONB documents**

Do not add cross-database foreign keys for users. Add local foreign keys for definitions/revisions/kitchens/instances and indexes on `user_id`, `kitchen_project_id`, and update timestamps.

- [ ] **Step 4: Add a second PostgreSQL database in local Docker initialization**

Create `mebel_editor` and apply only editor schema there. Keep user schema in `mebel_market`.

- [ ] **Step 5: Run repository tests twice to verify idempotent schema setup**

### Task 6: Idempotent Legacy Data Migration CLI

**Files:**
- Create: `services/editor-service/api/migrations/legacy.py`
- Create: `services/editor-service/api/migrate_legacy.py`
- Create: `services/editor-service/api/tests/test_legacy_migration.py`
- Create: `services/editor-service/api/tests/fixtures/legacy_data.py`
- Modify: `README.md`

**Interfaces:**
- Produces: `migrate_legacy(source_orm, target_orm, dry_run=False) -> MigrationReport`
- Produces CLI flags `--dry-run`, `--verify-only`, and `--source-project-id`

- [ ] **Step 1: Write failing migration tests**

```python
async def test_second_migration_run_creates_no_duplicates(source, target):
    first = await migrate_legacy(source, target)
    second = await migrate_legacy(source, target)
    assert second.inserted == 0
    assert second.unchanged == first.total
    assert await target.fetchval("SELECT count(*) FROM furniture_definitions") == first.definition_count
```

Also assert UUIDs, owners, kitchen links, autosave state, room data, scene data, and library data survive.

- [ ] **Step 2: Verify tests fail due to missing migration**

- [ ] **Step 3: Implement dry-run, transfer, normalized checksum, and verification**

Never delete or mutate source rows. Store migration runs and per-source checksums in the target database.

- [ ] **Step 4: Run migration tests and a dry run against configured local databases**

### Task 7: Definitions, Revisions, Library, and Kitchen APIs

**Files:**
- Create: `services/editor-service/api/routes/definitions.py`
- Create: `services/editor-service/api/routes/library.py`
- Create: `services/editor-service/api/routes/kitchens.py`
- Create: `services/editor-service/api/services/revisions.py`
- Create: `services/editor-service/api/tests/test_definition_api.py`
- Create: `services/editor-service/api/tests/test_kitchen_api.py`
- Modify: `services/editor-service/api/server.py`

**Interfaces:**
- Produces REST endpoints under `/api/editor/definitions`, `/revisions`, `/library`, `/kitchens`, and `/instances`.

- [ ] **Step 1: Write failing API ownership and revision tests**

Assert create returns revision 1, subsequent save creates revision 2, revision 1 remains unchanged, stale `basedOnRevisionId` returns `409`, and another owner receives `404`.

- [ ] **Step 2: Verify expected endpoint failures**

- [ ] **Step 3: Implement services and endpoints using repository interfaces**

Validate schema and single-root integrity before creating a revision.

- [ ] **Step 4: Run full editor-api tests**

### Task 8: Furniture Instances and Safe Revision Updates

**Files:**
- Create: `services/editor-service/src/instances/placement.js`
- Create: `services/editor-service/src/instances/update.js`
- Create: `services/editor-service/tests/instances.test.js`
- Extend: `services/editor-service/api/routes/kitchens.py`
- Extend: `services/editor-service/api/tests/test_kitchen_api.py`

**Interfaces:**
- Produces: `previewRevisionUpdate({ instance, currentRevision, nextRevision, room, neighbors })`
- Produces: `POST /api/editor/kitchens/:id/instances/:instanceId/revision-preview`
- Produces: `PUT /api/editor/kitchens/:id/instances/:instanceId/revision`

- [ ] **Step 1: Write failing placement-anchor and collision rollback tests**

Assert `back-left` stays fixed across width changes and that a collision returns violations without changing `revisionId`.

- [ ] **Step 2: Verify failures**

- [ ] **Step 3: Implement pure preview and transactional apply**

- [ ] **Step 4: Run JS and API suites**

### Task 9: Switch Editor Web to Versioned API

**Files:**
- Create: `services/editor-service/src/application/ProjectService.js`
- Create: `services/editor-service/src/application/EditorController.js`
- Create: `services/editor-service/tests/project-service.test.js`
- Modify: `services/editor-service/src/main.js`
- Modify: `services/editor-service/src/model.js`

**Interfaces:**
- Consumes versioned definition/revision API.
- Preserves local draft fallback and current visible editor behavior.

- [ ] **Step 1: Write failing service tests for load, save revision, conflict, offline draft, and legacy import**

- [ ] **Step 2: Verify failures**

- [ ] **Step 3: Extract HTTP/persistence from `main.js` and adapt the current model to the document boundary**

- [ ] **Step 4: Run editor tests and build**

### Task 10: Switch Constructor to Immutable Furniture Instances

**Files:**
- Create: `services/constructor-service/src/furniture/FurnitureInstanceModel.js`
- Create: `services/constructor-service/src/furniture/FurnitureRepository.js`
- Create: `services/constructor-service/tests/furniture-instances.test.js`
- Modify: `services/constructor-service/src/main.js`
- Modify: `services/constructor-service/src/scene/SceneManager.js`
- Modify: `services/constructor-service/index.html`

**Interfaces:**
- Constructor selects and transforms whole instances only.
- Produces explicit `edit in editor`, `update available`, `preview update`, and `apply update` flows.

- [ ] **Step 1: Write failing tests that child-part clicks select the parent instance and internal edits are unavailable**

- [ ] **Step 2: Verify failures**

- [ ] **Step 3: Implement repository/instance model and adapt rendering to parent `THREE.Group`**

- [ ] **Step 4: Add explicit edit/update UI with collision-preview errors**

- [ ] **Step 5: Run constructor tests and build**

### Task 11: Catalog, Rule Engine, and Manufacturing Operations Foundation

**Files:**
- Create: `services/editor-service/src/rules/RuleEngine.js`
- Create: `services/editor-service/src/rules/coreRules.js`
- Create: `services/editor-service/src/catalog/types.js`
- Create: `services/editor-service/src/manufacturing/operations.js`
- Create: `services/editor-service/tests/rules.test.js`
- Create: `services/editor-service/tests/manufacturing.test.js`
- Extend: editor-api catalog routes and repository tests

**Interfaces:**
- Produces: `ruleEngine.validate({ document, operation, affectedEntityIds })`
- Produces manufacturing operation factories with local panel coordinates and source provenance.

- [ ] **Step 1: Write failing rule severity, catalog-version, and operation provenance tests**

- [ ] **Step 2: Verify failures**

- [ ] **Step 3: Implement core structural/material rules and versioned catalog CRUD**

Only migrate existing panels, HDF, legs, and confirmats. Do not add unverified manufacturer products.

- [ ] **Step 4: Run JS and API suites**

### Task 12: Command History and Incremental Scene Synchronization

**Files:**
- Create: `services/editor-service/src/commands/CommandManager.js`
- Create: `services/editor-service/src/commands/commands.js`
- Create: `services/editor-service/src/scene/SceneSynchronizer.js`
- Create: `services/editor-service/tests/commands.test.js`
- Create: `services/editor-service/tests/scene-synchronizer.test.js`
- Modify: `services/editor-service/src/main.js`
- Modify: `services/editor-service/src/scene.js`

**Interfaces:**
- Produces bounded `execute/undo/redo` command history.
- Produces entity-level scene changes: added, removed, transform, geometry, selection.

- [ ] **Step 1: Write failing atomic command, history limit, and event-coalescing tests**

- [ ] **Step 2: Verify failures**

- [ ] **Step 3: Implement commands with snapshot compatibility adapter**

- [ ] **Step 4: Implement incremental scene updates and retain full sync fallback**

- [ ] **Step 5: Run editor tests, build, and large-scene fixture**

### Task 13: Switch User Pages and Retire Legacy Storage

**Files:**
- Create: `services/user-service/editor_client.py`
- Create: `services/user-service/tests/test_editor_client.py`
- Modify: `services/user-service/modules/company_profile/service.py`
- Modify: `services/user-service/modules/kitchen_projects/service.py`
- Modify: `services/user-service/server.py`
- Modify: `services/user-service/templates/company.html`
- Remove only after verification: legacy furniture project/library controllers and schema hooks

**Interfaces:**
- User pages consume editor-api summaries server-to-server.
- Legacy endpoints become read-only before removal.

- [ ] **Step 1: Write failing client tests for success, auth forwarding, and editor-api outage**

- [ ] **Step 2: Verify failures**

- [ ] **Step 3: Implement editor client and switch page data sources**

- [ ] **Step 4: Run migration verification and compare counts/checksums**

- [ ] **Step 5: Disable legacy writes and run full end-to-end verification**

- [ ] **Step 6: Remove legacy registration only after all verification gates pass**

### Task 14: Final Verification and Documentation

**Files:**
- Modify: `README.md`
- Create: `docs/editor-api.md`
- Create: `docs/data-migration.md`
- Create: `docs/catalog-extension.md`

- [ ] **Step 1: Run all JS tests**

```powershell
pnpm --dir services/editor-service test
pnpm --dir services/constructor-service test
```

- [ ] **Step 2: Run all Python tests**

```powershell
python -m unittest discover services/editor-service/api/tests -v
python -m unittest discover services/user-service/tests -v
```

- [ ] **Step 3: Build both frontends**

```powershell
pnpm --dir services/editor-service build
pnpm --dir services/constructor-service build
```

- [ ] **Step 4: Run migration dry-run, transfer, and verify-only against disposable database copies**

- [ ] **Step 5: Start all four services and exercise health/auth/create/save/place/edit/update flows**

- [ ] **Step 6: Confirm no legacy writes occur and document rollback commands**

