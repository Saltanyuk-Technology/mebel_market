CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    name VARCHAR(160) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS projects_user_updated_idx
    ON projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_rooms (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    room_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    scene_data JSONB NOT NULL DEFAULT '{"placements": []}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS project_rooms_project_updated_idx
    ON project_rooms(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS furniture_definitions (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    component_type VARCHAR(80) NOT NULL DEFAULT 'cabinet',
    latest_revision_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS furniture_definitions_user_updated_idx
    ON furniture_definitions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS furniture_definitions_project_idx
    ON furniture_definitions(project_id, updated_at DESC);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS furniture_library_user_updated_idx
    ON furniture_library_entries(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS furniture_instances (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    room_id UUID NOT NULL REFERENCES project_rooms(id) ON DELETE CASCADE,
    definition_id UUID NOT NULL REFERENCES furniture_definitions(id) ON DELETE RESTRICT,
    revision_id UUID NOT NULL REFERENCES furniture_revisions(id) ON DELETE RESTRICT,
    transform JSONB NOT NULL,
    placement JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS furniture_instances_room_idx
    ON furniture_instances(room_id, created_at);
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

