import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'studio.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  lyrics TEXT NOT NULL,
  visual_style TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  image_provider TEXT NOT NULL,
  suno_description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  start_seconds REAL,
  end_seconds REAL,
  description TEXT NOT NULL,
  camera TEXT NOT NULL,
  mood TEXT NOT NULL,
  prompt TEXT NOT NULL,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS visual_identities (
  project_id TEXT PRIMARY KEY,
  style_description TEXT NOT NULL DEFAULT '',
  style_image_url TEXT,
  style_locked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS visual_references (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('character', 'location')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS visual_references_project_type ON visual_references(project_id, type, created_at);

CREATE TABLE IF NOT EXISTS visual_concepts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  mood TEXT NOT NULL,
  visual_style TEXT NOT NULL,
  color_and_lighting TEXT NOT NULL,
  narrative_direction TEXT NOT NULL,
  reference_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generating', 'generated', 'selected', 'failed')),
  image_status TEXT NOT NULL DEFAULT 'pending' CHECK(image_status IN ('pending', 'generating', 'generated', 'failed')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS visual_concepts_project_created ON visual_concepts(project_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS visual_concepts_one_selected ON visual_concepts(project_id) WHERE status = 'selected';

CREATE TABLE IF NOT EXISTS image_generations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  shot_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  asset_url TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued', 'generating', 'generated', 'failed')),
  version INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  error_message TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(shot_id) REFERENCES shots(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS image_generations_shot_version ON image_generations(shot_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS image_generations_one_active ON image_generations(shot_id) WHERE active = 1;

CREATE TABLE IF NOT EXISTS image_generation_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'generating', 'completed', 'failed')),
  total INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  currently_generating INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_settings (
  provider TEXT PRIMARY KEY CHECK(provider IN ('openai', 'grok')),
  api_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configured',
  last_successful_test_at TEXT
);
CREATE TABLE IF NOT EXISTS storyboard_plans (
  project_id TEXT PRIMARY KEY, approach TEXT NOT NULL DEFAULT 'mixed', summary TEXT NOT NULL, narrative_arc TEXT NOT NULL,
  opening TEXT NOT NULL, midpoint TEXT NOT NULL, climax TEXT NOT NULL, ending TEXT NOT NULL, motifs TEXT NOT NULL DEFAULT '[]',
  primary_character_ids TEXT NOT NULL DEFAULT '[]', primary_location_ids TEXT NOT NULL DEFAULT '[]', pacing_notes TEXT NOT NULL, created_at TEXT NOT NULL
);
`);

// Lightweight migrations for databases created before concepts could be edited
// independently from their reference images.
const conceptColumns = db.prepare('PRAGMA table_info(visual_concepts)').all() as { name: string }[];
if (!conceptColumns.some(column => column.name === 'source')) {
  db.exec("ALTER TABLE visual_concepts ADD COLUMN source TEXT NOT NULL DEFAULT 'ai' CHECK(source IN ('ai', 'manual'))");
}
if (!conceptColumns.some(column => column.name === 'image_concept_signature')) {
  db.exec('ALTER TABLE visual_concepts ADD COLUMN image_concept_signature TEXT');
}
if (!conceptColumns.some(column => column.name === 'image_provider')) db.exec('ALTER TABLE visual_concepts ADD COLUMN image_provider TEXT');
if (!conceptColumns.some(column => column.name === 'image_model')) db.exec('ALTER TABLE visual_concepts ADD COLUMN image_model TEXT');
if (!conceptColumns.some(column => column.name === 'image_quality')) db.exec('ALTER TABLE visual_concepts ADD COLUMN image_quality TEXT');
if (!conceptColumns.some(column => column.name === 'image_resolution')) db.exec('ALTER TABLE visual_concepts ADD COLUMN image_resolution TEXT');

// SQLite's CREATE TABLE IF NOT EXISTS does not evolve databases created by an
// earlier version of the studio. Keep these additions small and additive.
const shotColumns = new Set((db.prepare('PRAGMA table_info(shots)').all() as { name: string }[]).map(column => column.name));
const addShotColumn = (name: string, definition: string) => {
  if (!shotColumns.has(name)) db.exec(`ALTER TABLE shots ADD COLUMN ${name} ${definition}`);
};
addShotColumn('section', "TEXT NOT NULL DEFAULT ''");
addShotColumn('title', "TEXT NOT NULL DEFAULT ''");
addShotColumn('action', "TEXT NOT NULL DEFAULT ''");
addShotColumn('shot_type', "TEXT NOT NULL DEFAULT ''");
addShotColumn('character_ids', "TEXT NOT NULL DEFAULT '[]'");
addShotColumn('location_id', 'TEXT');
addShotColumn('generation_status', "TEXT NOT NULL DEFAULT 'pending'");
addShotColumn('approval_status', "TEXT NOT NULL DEFAULT 'unapproved'");

const generationColumns = new Set((db.prepare('PRAGMA table_info(image_generations)').all() as { name: string }[]).map(column => column.name));
if (!generationColumns.has('approved')) db.exec('ALTER TABLE image_generations ADD COLUMN approved INTEGER NOT NULL DEFAULT 0');
if (!generationColumns.has('quality')) db.exec("ALTER TABLE image_generations ADD COLUMN quality TEXT NOT NULL DEFAULT 'standard'");
if (!generationColumns.has('resolution')) db.exec("ALTER TABLE image_generations ADD COLUMN resolution TEXT NOT NULL DEFAULT '1024x1024'");
db.prepare("UPDATE image_generations SET approved=1 WHERE active=1 AND shot_id IN (SELECT id FROM shots WHERE approval_status='approved')").run();

const projectColumns = new Set((db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map(column => column.name));
const addProjectColumn = (name: string, definition: string) => { if (!projectColumns.has(name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`); };
addProjectColumn('image_quality_preset', "TEXT NOT NULL DEFAULT 'standard'");
addProjectColumn('image_model_override', 'TEXT');
addProjectColumn('image_resolution_override', 'TEXT');
addProjectColumn('suno_description', 'TEXT');
addProjectColumn('storyboard_approach', "TEXT NOT NULL DEFAULT 'mixed'");

// Reference images are intentionally retained after copy edits. These snapshots
// let the UI indicate when the retained image no longer represents the text.
const visualIdentityColumns = new Set((db.prepare('PRAGMA table_info(visual_identities)').all() as { name: string }[]).map(column => column.name));
if (!visualIdentityColumns.has('style_image_signature')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_image_signature TEXT');
const visualReferenceColumns = new Set((db.prepare('PRAGMA table_info(visual_references)').all() as { name: string }[]).map(column => column.name));
if (!visualReferenceColumns.has('image_signature')) db.exec('ALTER TABLE visual_references ADD COLUMN image_signature TEXT');
if (!visualReferenceColumns.has('image_provider')) db.exec('ALTER TABLE visual_references ADD COLUMN image_provider TEXT');
if (!visualReferenceColumns.has('image_model')) db.exec('ALTER TABLE visual_references ADD COLUMN image_model TEXT');
if (!visualReferenceColumns.has('image_quality')) db.exec('ALTER TABLE visual_references ADD COLUMN image_quality TEXT');
if (!visualReferenceColumns.has('image_resolution')) db.exec('ALTER TABLE visual_references ADD COLUMN image_resolution TEXT');
if (!visualIdentityColumns.has('style_image_provider')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_image_provider TEXT');
if (!visualIdentityColumns.has('style_image_model')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_image_model TEXT');
if (!visualIdentityColumns.has('style_image_quality')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_image_quality TEXT');
if (!visualIdentityColumns.has('style_image_resolution')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_image_resolution TEXT');
