import Database from 'better-sqlite3';
import crypto from 'node:crypto';
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
  project_type TEXT NOT NULL DEFAULT 'music_video',
  creative_brief TEXT NOT NULL DEFAULT '',
  lyrics TEXT NOT NULL,
  visual_style TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  image_provider TEXT NOT NULL,
  suno_description TEXT,
  selected_concept_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  start_seconds REAL,
  end_seconds REAL,
  duration_seconds REAL,
  description TEXT NOT NULL,
  camera TEXT NOT NULL,
  mood TEXT NOT NULL,
  prompt TEXT NOT NULL,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS visual_identities (
  concept_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  style_description TEXT NOT NULL DEFAULT '',
  style_image_url TEXT,
  style_locked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS visual_references (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
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
  concept_id TEXT NOT NULL,
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
CREATE TABLE IF NOT EXISTS image_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('concept','reference','style','shot','artwork')),
  owner_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('generated','uploaded')),
  storage_path TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  version INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  model TEXT,
  quality TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS image_assets_owner_version ON image_assets(owner_type, owner_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS image_assets_one_active ON image_assets(owner_type, owner_id) WHERE active = 1;
CREATE INDEX IF NOT EXISTS image_generations_shot_version ON image_generations(shot_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS image_generations_one_active ON image_generations(shot_id) WHERE active = 1;

CREATE TABLE IF NOT EXISTS image_generation_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
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
  concept_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, approach TEXT NOT NULL DEFAULT 'mixed', summary TEXT NOT NULL, narrative_arc TEXT NOT NULL,
  opening TEXT NOT NULL, midpoint TEXT NOT NULL, climax TEXT NOT NULL, ending TEXT NOT NULL, motifs TEXT NOT NULL DEFAULT '[]',
  primary_character_ids TEXT NOT NULL DEFAULT '[]', primary_location_ids TEXT NOT NULL DEFAULT '[]', pacing_notes TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS storyboard_reviews (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, concept_id TEXT NOT NULL, created_at TEXT NOT NULL,
  summary TEXT NOT NULL, score INTEGER, context_signature TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS storyboard_review_issues (
  id TEXT PRIMARY KEY, review_id TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('info','warning','important')),
  category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, shot_ids TEXT NOT NULL DEFAULT '[]',
  suggestion TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
  FOREIGN KEY(review_id) REFERENCES storyboard_reviews(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS storyboard_reviews_project_created ON storyboard_reviews(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS storyboard_review_issues_review ON storyboard_review_issues(review_id);
CREATE TABLE IF NOT EXISTS project_artwork (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, concept_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('thumbnail','cover','canvas')),
  platform TEXT NOT NULL, active_asset_id TEXT, source_asset_id TEXT, source TEXT NOT NULL DEFAULT 'project', text_config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
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
const needsConceptWorkspaceMigration = !shotColumns.has('concept_id');
const addShotColumn = (name: string, definition: string) => {
  if (!shotColumns.has(name)) db.exec(`ALTER TABLE shots ADD COLUMN ${name} ${definition}`);
};
addShotColumn('concept_id', 'TEXT');
addShotColumn('section', "TEXT NOT NULL DEFAULT ''");
addShotColumn('title', "TEXT NOT NULL DEFAULT ''");
addShotColumn('action', "TEXT NOT NULL DEFAULT ''");
addShotColumn('shot_type', "TEXT NOT NULL DEFAULT ''");
addShotColumn('character_ids', "TEXT NOT NULL DEFAULT '[]'");
addShotColumn('location_id', 'TEXT');
addShotColumn('generation_status', "TEXT NOT NULL DEFAULT 'pending'");
addShotColumn('approval_status', "TEXT NOT NULL DEFAULT 'unapproved'");
addShotColumn('duration_seconds', 'REAL');

const generationColumns = new Set((db.prepare('PRAGMA table_info(image_generations)').all() as { name: string }[]).map(column => column.name));
if (!generationColumns.has('concept_id')) db.exec('ALTER TABLE image_generations ADD COLUMN concept_id TEXT');
if (!generationColumns.has('approved')) db.exec('ALTER TABLE image_generations ADD COLUMN approved INTEGER NOT NULL DEFAULT 0');
if (!generationColumns.has('quality')) db.exec("ALTER TABLE image_generations ADD COLUMN quality TEXT NOT NULL DEFAULT 'standard'");
if (!generationColumns.has('resolution')) db.exec("ALTER TABLE image_generations ADD COLUMN resolution TEXT NOT NULL DEFAULT '1024x1024'");
if (!generationColumns.has('asset_id')) db.exec('ALTER TABLE image_generations ADD COLUMN asset_id TEXT');
if (!generationColumns.has('source')) db.exec("ALTER TABLE image_generations ADD COLUMN source TEXT NOT NULL DEFAULT 'generated'");
if (!generationColumns.has('original_filename')) db.exec('ALTER TABLE image_generations ADD COLUMN original_filename TEXT');
if (!generationColumns.has('tier')) db.exec('ALTER TABLE image_generations ADD COLUMN tier TEXT');
if (!generationColumns.has('stale')) db.exec('ALTER TABLE image_generations ADD COLUMN stale INTEGER NOT NULL DEFAULT 0');
db.prepare("UPDATE image_generations SET tier=CASE quality WHEN 'draft' THEN 'DRAFT' WHEN 'best' THEN 'FINAL' ELSE 'STANDARD' END WHERE tier IS NULL AND source='generated'").run();
db.prepare("UPDATE image_generations SET approved=1 WHERE active=1 AND shot_id IN (SELECT id FROM shots WHERE approval_status='approved')").run();

const projectColumns = new Set((db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map(column => column.name));
const addProjectColumn = (name: string, definition: string) => { if (!projectColumns.has(name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`); };
addProjectColumn('image_quality_preset', "TEXT NOT NULL DEFAULT 'draft'");
addProjectColumn('image_model_override', 'TEXT');
addProjectColumn('image_resolution_override', 'TEXT');
addProjectColumn('suno_description', 'TEXT');
addProjectColumn('storyboard_approach', "TEXT NOT NULL DEFAULT 'mixed'");
addProjectColumn('publishing_targets', "TEXT NOT NULL DEFAULT '[]'");
addProjectColumn('primary_visual_format', "TEXT NOT NULL DEFAULT 'landscape'");
addProjectColumn('selected_concept_id', 'TEXT');
// Existing projects were created by the music-video-only version. New projects
// explicitly store their type, while this default preserves legacy semantics.
addProjectColumn('project_type', "TEXT NOT NULL DEFAULT 'music_video'");
addProjectColumn('creative_brief', "TEXT NOT NULL DEFAULT ''");
// Every legacy project needs a concept to own its existing creative workspace.
// Prefer the user's selected concept; create a clearly labelled direction only
// when an older project never selected one.
if (needsConceptWorkspaceMigration) {
  for (const project of db.prepare(`SELECT projects.* FROM projects LEFT JOIN visual_concepts selected
    ON selected.project_id=projects.id AND selected.status='selected' WHERE selected.id IS NULL`).all() as any[]) {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO visual_concepts
      (id,project_id,title,description,mood,visual_style,color_and_lighting,narrative_direction,status,image_status,source,created_at)
      VALUES (?,?,?,?,?,?,?,?,'selected','pending','manual',?)`)
      .run(id, project.id, 'Existing visual direction', project.visual_style || 'Existing project direction', 'As previously defined', project.visual_style || 'Cinematic music video', 'As previously defined', 'Continue the existing project direction', project.created_at || new Date().toISOString());
  }
}
db.exec(`UPDATE projects SET selected_concept_id=(SELECT id FROM visual_concepts WHERE visual_concepts.project_id=projects.id AND status='selected' LIMIT 1) WHERE selected_concept_id IS NULL;`);

db.exec(`UPDATE shots SET concept_id=(SELECT id FROM visual_concepts WHERE visual_concepts.project_id=shots.project_id AND status='selected' LIMIT 1) WHERE concept_id IS NULL;
  UPDATE image_generations SET concept_id=(SELECT concept_id FROM shots WHERE shots.id=image_generations.shot_id) WHERE concept_id IS NULL;`);

const referenceColumnsForScope = new Set((db.prepare('PRAGMA table_info(visual_references)').all() as { name:string }[]).map(column=>column.name));
if (!referenceColumnsForScope.has('concept_id')) db.exec('ALTER TABLE visual_references ADD COLUMN concept_id TEXT');
db.exec(`UPDATE visual_references SET concept_id=(SELECT id FROM visual_concepts WHERE visual_concepts.project_id=visual_references.project_id AND status='selected' LIMIT 1) WHERE concept_id IS NULL;`);

const batchColumns = new Set((db.prepare('PRAGMA table_info(image_generation_batches)').all() as { name:string }[]).map(column=>column.name));
if (!batchColumns.has('concept_id')) db.exec('ALTER TABLE image_generation_batches ADD COLUMN concept_id TEXT');
db.exec(`UPDATE image_generation_batches SET concept_id=(SELECT id FROM visual_concepts WHERE visual_concepts.project_id=image_generation_batches.project_id AND status='selected' LIMIT 1) WHERE concept_id IS NULL;`);

const reviewColumnsForScope = new Set((db.prepare('PRAGMA table_info(storyboard_reviews)').all() as { name:string }[]).map(column=>column.name));
if (!reviewColumnsForScope.has('concept_id')) db.exec('ALTER TABLE storyboard_reviews ADD COLUMN concept_id TEXT');
db.exec(`UPDATE storyboard_reviews SET concept_id=(SELECT id FROM visual_concepts WHERE visual_concepts.project_id=storyboard_reviews.project_id AND status='selected' LIMIT 1) WHERE concept_id IS NULL;`);

const artworkColumns = new Set((db.prepare('PRAGMA table_info(project_artwork)').all() as { name:string }[]).map(column=>column.name));
if (!artworkColumns.has('source_asset_id')) db.exec('ALTER TABLE project_artwork ADD COLUMN source_asset_id TEXT');

// Older SQLite files have a restrictive owner_type CHECK. Rebuild only that
// table once, preserving every existing asset and index, to add artwork assets.
const assetSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='image_assets'").get() as { sql?: string } | undefined)?.sql || '';
if (!assetSql.includes("'artwork'")) {
  db.exec(`ALTER TABLE image_assets RENAME TO image_assets_legacy;
    CREATE TABLE image_assets (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, owner_type TEXT NOT NULL CHECK(owner_type IN ('concept','reference','style','shot','artwork')), owner_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('generated','uploaded')), storage_path TEXT NOT NULL, original_filename TEXT, mime_type TEXT NOT NULL, file_size INTEGER NOT NULL,
      version INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0, provider TEXT, model TEXT, quality TEXT, resolution TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
    INSERT INTO image_assets SELECT * FROM image_assets_legacy;
    DROP TABLE image_assets_legacy;
    CREATE INDEX IF NOT EXISTS image_assets_owner_version ON image_assets(owner_type, owner_id, version);
    CREATE UNIQUE INDEX IF NOT EXISTS image_assets_one_active ON image_assets(owner_type, owner_id) WHERE active = 1;`);
}
const currentAssetColumns = new Set((db.prepare('PRAGMA table_info(image_assets)').all() as { name:string }[]).map(column=>column.name));
if (!currentAssetColumns.has('tier')) db.exec('ALTER TABLE image_assets ADD COLUMN tier TEXT');
if (!currentAssetColumns.has('stale')) db.exec('ALTER TABLE image_assets ADD COLUMN stale INTEGER NOT NULL DEFAULT 0');
db.prepare("UPDATE image_assets SET tier=CASE quality WHEN 'draft' THEN 'DRAFT' WHEN 'best' THEN 'FINAL' ELSE 'STANDARD' END WHERE tier IS NULL AND source='generated'").run();

// Reference images are intentionally retained after copy edits. These snapshots
// let the UI indicate when the retained image no longer represents the text.
const visualIdentityColumns = new Set((db.prepare('PRAGMA table_info(visual_identities)').all() as { name: string }[]).map(column => column.name));
// Locking was introduced after the first visual-identity schema. Keep existing
// projects usable by adding the flag before any lock-related query runs.
if (!visualIdentityColumns.has('style_locked')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_locked INTEGER NOT NULL DEFAULT 0');
if (!visualIdentityColumns.has('style_image_signature')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_image_signature TEXT');
const visualReferenceColumns = new Set((db.prepare('PRAGMA table_info(visual_references)').all() as { name: string }[]).map(column => column.name));
if (!visualReferenceColumns.has('locked')) db.exec('ALTER TABLE visual_references ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
if (!visualReferenceColumns.has('image_signature')) db.exec('ALTER TABLE visual_references ADD COLUMN image_signature TEXT');
if (!visualReferenceColumns.has('image_provider')) db.exec('ALTER TABLE visual_references ADD COLUMN image_provider TEXT');
if (!visualReferenceColumns.has('image_model')) db.exec('ALTER TABLE visual_references ADD COLUMN image_model TEXT');
if (!visualReferenceColumns.has('image_quality')) db.exec('ALTER TABLE visual_references ADD COLUMN image_quality TEXT');
if (!visualReferenceColumns.has('image_resolution')) db.exec('ALTER TABLE visual_references ADD COLUMN image_resolution TEXT');
if (!visualIdentityColumns.has('style_image_provider')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_image_provider TEXT');
if (!visualIdentityColumns.has('style_image_model')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_image_model TEXT');
if (!visualIdentityColumns.has('style_image_quality')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_image_quality TEXT');
if (!visualIdentityColumns.has('style_image_resolution')) db.exec('ALTER TABLE visual_identities ADD COLUMN style_image_resolution TEXT');

// Tables that previously used project_id as their identity must be rebuilt to
// allow one independent row per concept. The migration retains every column
// and assigns the old workspace to the project's selected concept.
if (!visualIdentityColumns.has('concept_id')) {
  db.exec(`ALTER TABLE visual_identities RENAME TO visual_identities_legacy;
    CREATE TABLE visual_identities (
      concept_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, style_description TEXT NOT NULL DEFAULT '', style_image_url TEXT,
      style_locked INTEGER NOT NULL DEFAULT 0, style_image_signature TEXT, style_image_provider TEXT, style_image_model TEXT,
      style_image_quality TEXT, style_image_resolution TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(concept_id) REFERENCES visual_concepts(id) ON DELETE CASCADE);
    INSERT INTO visual_identities
      (concept_id,project_id,style_description,style_image_url,style_locked,style_image_signature,style_image_provider,style_image_model,style_image_quality,style_image_resolution)
    SELECT (SELECT id FROM visual_concepts WHERE visual_concepts.project_id=legacy.project_id AND status='selected' LIMIT 1),
      project_id,style_description,style_image_url,style_locked,style_image_signature,style_image_provider,style_image_model,style_image_quality,style_image_resolution
    FROM visual_identities_legacy legacy;
    DROP TABLE visual_identities_legacy;`);
}

const planColumns = new Set((db.prepare('PRAGMA table_info(storyboard_plans)').all() as { name:string }[]).map(column=>column.name));
if (!planColumns.has('concept_id')) {
  db.exec(`ALTER TABLE storyboard_plans RENAME TO storyboard_plans_legacy;
    CREATE TABLE storyboard_plans (
      concept_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, approach TEXT NOT NULL DEFAULT 'mixed', summary TEXT NOT NULL, narrative_arc TEXT NOT NULL,
      opening TEXT NOT NULL, midpoint TEXT NOT NULL, climax TEXT NOT NULL, ending TEXT NOT NULL, motifs TEXT NOT NULL DEFAULT '[]',
      primary_character_ids TEXT NOT NULL DEFAULT '[]', primary_location_ids TEXT NOT NULL DEFAULT '[]', pacing_notes TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(concept_id) REFERENCES visual_concepts(id) ON DELETE CASCADE);
    INSERT INTO storyboard_plans
      (concept_id,project_id,approach,summary,narrative_arc,opening,midpoint,climax,ending,motifs,primary_character_ids,primary_location_ids,pacing_notes,created_at)
    SELECT (SELECT id FROM visual_concepts WHERE visual_concepts.project_id=legacy.project_id AND status='selected' LIMIT 1),
      project_id,approach,summary,narrative_arc,opening,midpoint,climax,ending,motifs,primary_character_ids,primary_location_ids,pacing_notes,created_at
    FROM storyboard_plans_legacy legacy;
    DROP TABLE storyboard_plans_legacy;`);
}

if (!artworkColumns.has('concept_id')) {
  db.exec(`DROP INDEX IF EXISTS project_artwork_one_type_platform;
    ALTER TABLE project_artwork RENAME TO project_artwork_legacy;
    CREATE TABLE project_artwork (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, concept_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('thumbnail','cover','canvas')),
      platform TEXT NOT NULL, active_asset_id TEXT, source_asset_id TEXT, source TEXT NOT NULL DEFAULT 'project', text_config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(concept_id) REFERENCES visual_concepts(id) ON DELETE CASCADE);
    INSERT INTO project_artwork (id,project_id,concept_id,type,platform,active_asset_id,source_asset_id,source,text_config,created_at,updated_at)
    SELECT id,project_id,(SELECT id FROM visual_concepts WHERE visual_concepts.project_id=legacy.project_id AND status='selected' LIMIT 1),
      type,platform,active_asset_id,source_asset_id,source,text_config,created_at,updated_at FROM project_artwork_legacy legacy;
    DROP TABLE project_artwork_legacy;
    CREATE UNIQUE INDEX project_artwork_one_type_platform ON project_artwork(concept_id,type,platform);`);
}

const scopedAssetColumns = new Set((db.prepare('PRAGMA table_info(image_assets)').all() as { name:string }[]).map(column=>column.name));
if (!scopedAssetColumns.has('concept_id')) db.exec('ALTER TABLE image_assets ADD COLUMN concept_id TEXT');
db.exec(`UPDATE image_assets SET concept_id=CASE
    WHEN owner_type='concept' THEN owner_id
    WHEN owner_type='reference' THEN (SELECT concept_id FROM visual_references WHERE visual_references.id=image_assets.owner_id)
    WHEN owner_type='shot' THEN (SELECT concept_id FROM shots WHERE shots.id=image_assets.owner_id)
    WHEN owner_type='artwork' THEN (SELECT concept_id FROM project_artwork WHERE project_artwork.id=image_assets.owner_id)
    ELSE (SELECT id FROM visual_concepts WHERE visual_concepts.project_id=image_assets.project_id AND status='selected' LIMIT 1)
  END WHERE concept_id IS NULL;
  UPDATE image_assets SET concept_id=(SELECT id FROM visual_concepts WHERE visual_concepts.project_id=image_assets.project_id AND status='selected' LIMIT 1) WHERE concept_id IS NULL;
  UPDATE image_assets SET owner_id=concept_id WHERE owner_type='style' AND owner_id=project_id;
  CREATE INDEX IF NOT EXISTS shots_concept_position ON shots(concept_id,position);
  CREATE INDEX IF NOT EXISTS visual_references_concept_type ON visual_references(concept_id,type,created_at);
  CREATE INDEX IF NOT EXISTS image_generations_concept ON image_generations(concept_id);
  CREATE INDEX IF NOT EXISTS image_assets_concept ON image_assets(concept_id);
  CREATE INDEX IF NOT EXISTS image_batches_concept ON image_generation_batches(concept_id);
  CREATE INDEX IF NOT EXISTS storyboard_reviews_concept_created ON storyboard_reviews(concept_id,created_at DESC);`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS project_artwork_one_type_platform ON project_artwork(concept_id,type,platform)');
