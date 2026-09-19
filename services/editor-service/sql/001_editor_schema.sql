CREATE TABLE IF NOT EXISTS kitchen_projects (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    name VARCHAR(160) NOT NULL,
    room_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    scene_data JSONB NOT NULL DEFAULT '{"placements": []}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS kitchen_projects_user_updated_idx
    ON kitchen_projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS furniture_definitions (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    kitchen_project_id UUID REFERENCES kitchen_projects(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    component_type VARCHAR(80) NOT NULL DEFAULT 'cabinet',
    autosaved BOOLEAN NOT NULL DEFAULT FALSE,
    scope VARCHAR(32) NOT NULL DEFAULT 'library'
        CHECK (scope IN ('library', 'kitchen-project')),
    latest_revision_id UUID,
    legacy_project_id UUID UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE furniture_definitions ADD COLUMN IF NOT EXISTS autosaved BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS furniture_definitions_user_updated_idx
    ON furniture_definitions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS furniture_definitions_kitchen_idx
    ON furniture_definitions(kitchen_project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS furniture_revisions (
    id UUID PRIMARY KEY,
    definition_id UUID NOT NULL REFERENCES furniture_definitions(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    based_on_revision_id UUID REFERENCES furniture_revisions(id) ON DELETE RESTRICT,
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    document JSONB NOT NULL,
    placement_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (definition_id, revision_number)
);
CREATE INDEX IF NOT EXISTS furniture_revisions_definition_idx
    ON furniture_revisions(definition_id, revision_number DESC);

DO $$ BEGIN
  ALTER TABLE furniture_definitions
    ADD CONSTRAINT furniture_definitions_latest_revision_fk
    FOREIGN KEY (latest_revision_id) REFERENCES furniture_revisions(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS furniture_library_entries (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    definition_id UUID NOT NULL REFERENCES furniture_definitions(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    legacy_item_id UUID UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS furniture_library_user_updated_idx
    ON furniture_library_entries(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS editor_drafts (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    definition_id UUID REFERENCES furniture_definitions(id) ON DELETE CASCADE,
    document JSONB NOT NULL,
    editor_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS editor_drafts_user_updated_idx
    ON editor_drafts(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS furniture_instances (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    kitchen_project_id UUID NOT NULL REFERENCES kitchen_projects(id) ON DELETE CASCADE,
    definition_id UUID NOT NULL REFERENCES furniture_definitions(id) ON DELETE RESTRICT,
    revision_id UUID NOT NULL REFERENCES furniture_revisions(id) ON DELETE RESTRICT,
    transform JSONB NOT NULL,
    placement JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS furniture_instances_kitchen_idx
    ON furniture_instances(kitchen_project_id, created_at);
CREATE INDEX IF NOT EXISTS furniture_instances_user_idx
    ON furniture_instances(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS catalog_manufacturers (
    id UUID PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_products (
    id UUID PRIMARY KEY,
    manufacturer_id UUID REFERENCES catalog_manufacturers(id) ON DELETE RESTRICT,
    code VARCHAR(160) NOT NULL UNIQUE,
    family VARCHAR(160) NOT NULL,
    name VARCHAR(240) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_product_versions (
    id UUID PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL,
    article_number VARCHAR(160),
    data JSONB NOT NULL,
    active_for_new_projects BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, version_number)
);

CREATE TABLE IF NOT EXISTS catalog_mounting_patterns (
    id UUID PRIMARY KEY,
    product_version_id UUID REFERENCES catalog_product_versions(id) ON DELETE RESTRICT,
    name VARCHAR(160) NOT NULL,
    operations JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_materials (
    id UUID PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_material_versions (
    id UUID PRIMARY KEY,
    material_id UUID NOT NULL REFERENCES catalog_materials(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL,
    data JSONB NOT NULL,
    active_for_new_projects BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (material_id, version_number)
);

CREATE TABLE IF NOT EXISTS catalog_assets (
    id UUID PRIMARY KEY,
    product_version_id UUID REFERENCES catalog_product_versions(id) ON DELETE CASCADE,
    material_version_id UUID REFERENCES catalog_material_versions(id) ON DELETE CASCADE,
    asset_type VARCHAR(80) NOT NULL,
    uri TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((product_version_id IS NOT NULL)::integer + (material_version_id IS NOT NULL)::integer = 1)
);

CREATE TABLE IF NOT EXISTS catalog_compatibility_rules (
    id UUID PRIMARY KEY,
    code VARCHAR(160) NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    data JSONB NOT NULL,
    active_for_new_projects BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (code, version_number)
);

CREATE TABLE IF NOT EXISTS migration_runs (
    id UUID PRIMARY KEY,
    source_fingerprint VARCHAR(240) NOT NULL,
    status VARCHAR(32) NOT NULL,
    report JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS migrated_records (
    source_table VARCHAR(100) NOT NULL,
    source_id UUID NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id UUID NOT NULL,
    checksum VARCHAR(128) NOT NULL,
    migrated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_table, source_id)
);
