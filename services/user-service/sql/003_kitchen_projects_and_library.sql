CREATE TABLE IF NOT EXISTS kitchen_projects (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    room_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    scene_data JSONB NOT NULL DEFAULT '{"placements": []}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS kitchen_projects_user_updated_idx
    ON kitchen_projects(user_id, updated_at DESC);

ALTER TABLE furniture_projects
    ADD COLUMN IF NOT EXISTS kitchen_project_id UUID;

DO $$ BEGIN
    ALTER TABLE furniture_projects
        ADD CONSTRAINT furniture_projects_kitchen_project_fk
        FOREIGN KEY (kitchen_project_id) REFERENCES kitchen_projects(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS furniture_projects_kitchen_project_idx
    ON furniture_projects(kitchen_project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS furniture_library_items (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_project_id UUID REFERENCES furniture_projects(id) ON DELETE SET NULL,
    name VARCHAR(160) NOT NULL,
    item_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS furniture_library_user_updated_idx
    ON furniture_library_items(user_id, updated_at DESC);
