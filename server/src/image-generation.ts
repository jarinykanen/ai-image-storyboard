import crypto from 'node:crypto';
import pLimit from 'p-limit';
import { db } from './db.js';
import { generateImage, type ImageGenerationRequest, type ImageProvider } from './providers.js';
import { resolveImageConfiguration, resolveProvider, type ImageQuality, type ImageResolution } from './provider-settings.js';
import { buildImagePrompt } from './storyboard-prompts.js';
import { getSelectedConcept } from './visual-concepts.js';
import { getVisualIdentity, type VisualReference } from './visual-identity.js';

type Project = { id: string; visual_style: string; aspect_ratio: string; image_provider: ImageProvider; image_quality_preset: ImageQuality; image_model_override: string | null; image_resolution_override: ImageResolution | null };
type ShotRow = any;
export type BatchStatus = { id: string; status: string; total: number; completed: number; failed: number; currentlyGenerating: number };

function references(items: VisualReference[]) {
  return items.map(item => ({ id: item.id, name: item.name, description: item.description, imageUrl: item.locked ? item.image_url : null }));
}

export function resolveImageRequest(project: Project, shot: ShotRow, previous?: ShotRow, override?: Partial<Pick<ImageGenerationRequest, 'qualityPreset' | 'modelOverride' | 'resolutionOverride'>>): ImageGenerationRequest {
  const identity = getVisualIdentity(project.id);
  const concept = getSelectedConcept(project.id);
  const characterIds = JSON.parse(shot.character_ids || '[]') as string[];
  const characters = references(identity.characters.filter(item => characterIds.includes(item.id)));
  const location = identity.locations.find(item => item.id === shot.location_id);
  const visualStyle = identity.style.description || project.visual_style;
  const selectedConcept = concept ? { title: concept.title, description: concept.description, mood: concept.mood, visualStyle: concept.visualStyle, colorAndLighting: concept.colorAndLighting } : null;
  const input = {
    projectId: project.id, shotId: shot.id, aspectRatio: project.aspect_ratio, visualStyle, concept: selectedConcept,
    description: shot.description, action: shot.action || '', shotType: shot.shot_type || '', camera: shot.camera, mood: shot.mood,
    characters, location: location ? references([location])[0] : null,
    previousShot: previous ? { description: previous.description, action: previous.action || '', locationId: previous.location_id ?? null } : null,
    generationInstructions: 'Keep character, wardrobe, environment, and visual-style continuity. Compose a clear keyframe suitable for later image-to-video animation.',
  };
  return { ...input, prompt: buildImagePrompt(input), qualityPreset: override?.qualityPreset ?? project.image_quality_preset, modelOverride: override?.modelOverride ?? project.image_model_override, resolutionOverride: override?.resolutionOverride ?? project.image_resolution_override };
}

export function listGenerations(shotId: string) {
  return (db.prepare('SELECT id, shot_id, provider, model, quality, resolution, asset_url, status, version, active, approved, created_at FROM image_generations WHERE shot_id = ? ORDER BY version DESC').all(shotId) as any[])
    .map(row => ({ id: row.id, shotId: row.shot_id, provider: row.provider, model: row.model, quality: row.quality, resolution: row.resolution, assetUrl: row.asset_url, status: row.status, version: row.version, active: Boolean(row.active), approved: Boolean(row.approved), createdAt: row.created_at }));
}

function createGeneration(project: Project, shotId: string, override?: Partial<Pick<ImageGenerationRequest, 'qualityPreset' | 'modelOverride' | 'resolutionOverride'>>) {
  const provider = resolveProvider('imageGeneration', { requested: project.image_provider });
  const config = resolveImageConfiguration({ provider, preset: override?.qualityPreset ?? project.image_quality_preset, modelId: override?.modelOverride ?? project.image_model_override, resolution: override?.resolutionOverride ?? project.image_resolution_override });
  const version = (db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM image_generations WHERE shot_id = ?').get(shotId) as any).version + 1;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO image_generations (id,project_id,shot_id,provider,model,quality,resolution,status,version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, project.id, shotId, provider, config.model.modelId, config.quality, config.resolution, 'queued', version, new Date().toISOString());
  return id;
}

async function runGeneration(project: Project, shot: ShotRow, generationId: string, previous?: ShotRow, override?: Partial<Pick<ImageGenerationRequest, 'qualityPreset' | 'modelOverride' | 'resolutionOverride'>>) {
  db.prepare("UPDATE image_generations SET status='generating' WHERE id=?").run(generationId);
  db.prepare("UPDATE shots SET status='generating', generation_status='generating' WHERE id=?").run(shot.id);
  try {
    const request = resolveImageRequest(project, shot, previous, override);
    const result = await generateImage(project.image_provider, request);
    const tx = db.transaction(() => {
      db.prepare('UPDATE image_generations SET active=0 WHERE shot_id=?').run(shot.id);
      db.prepare("UPDATE image_generations SET asset_url=?, model=?, quality=?, resolution=?, status='generated', active=1 WHERE id=?").run(result.url, result.model, result.quality, result.resolution, generationId);
      db.prepare("UPDATE shots SET image_url=?, prompt=?, status='ready', generation_status='generated', approval_status='unapproved' WHERE id=?").run(result.url, request.prompt, shot.id);
    }); tx();
  } catch (error) {
    db.prepare("UPDATE image_generations SET status='failed', error_message=? WHERE id=?").run(error instanceof Error ? error.message : 'Generation failed', generationId);
    db.prepare("UPDATE shots SET status='error', generation_status='failed' WHERE id=?").run(shot.id);
    throw error;
  }
}

export async function generateSingle(project: Project, shot: ShotRow, previous?: ShotRow, override?: Partial<Pick<ImageGenerationRequest, 'qualityPreset' | 'modelOverride' | 'resolutionOverride'>>) {
  const id = createGeneration(project, shot.id, override); await runGeneration(project, shot, id, previous, override); return listGenerations(shot.id)[0];
}

export function startBatch(project: Project, shots: ShotRow[]) {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO image_generation_batches (id,project_id,status,total,created_at) VALUES (?,?,'queued',?,?)").run(id, project.id, shots.length, new Date().toISOString());
  const jobs = shots.map(shot => ({ shot, generationId: createGeneration(project, shot.id) }));
  if (jobs.length) void runBatch(id, project, jobs);
  else db.prepare("UPDATE image_generation_batches SET status='completed' WHERE id=?").run(id);
  return getBatch(id)!;
}
async function runBatch(id: string, project: Project, jobs: { shot: ShotRow; generationId: string }[]) {
  db.prepare("UPDATE image_generation_batches SET status='generating' WHERE id=?").run(id);
  const allShots = db.prepare('SELECT * FROM shots WHERE project_id=? ORDER BY position').all(project.id) as ShotRow[];
  const limit = pLimit(project.image_provider === 'grok' ? 4 : 3);
  await Promise.all(jobs.map(({ shot, generationId }) => limit(async () => {
    db.prepare('UPDATE image_generation_batches SET currently_generating=currently_generating+1 WHERE id=?').run(id);
    try { await runGeneration(project, shot, generationId, allShots.find(item => item.position === shot.position - 1)); db.prepare('UPDATE image_generation_batches SET completed=completed+1, currently_generating=currently_generating-1 WHERE id=?').run(id); }
    catch { db.prepare('UPDATE image_generation_batches SET failed=failed+1, currently_generating=currently_generating-1 WHERE id=?').run(id); }
  })));
  const batch = getBatch(id)!;
  db.prepare('UPDATE image_generation_batches SET status=? WHERE id=?').run(batch.completed ? 'completed' : 'failed', id);
}
export function getBatch(id: string): BatchStatus | null { const row = db.prepare('SELECT * FROM image_generation_batches WHERE id=?').get(id) as any; return row ? { id: row.id, status: row.status, total: row.total, completed: row.completed, failed: row.failed, currentlyGenerating: row.currently_generating } : null; }
export function activateGeneration(projectId: string, shotId: string, generationId: string) {
  const generation = db.prepare("SELECT * FROM image_generations WHERE id=? AND shot_id=? AND project_id=? AND status='generated'").get(generationId, shotId, projectId) as any;
  if (!generation) return false;
  const tx = db.transaction(() => { db.prepare('UPDATE image_generations SET active=0 WHERE shot_id=?').run(shotId); db.prepare('UPDATE image_generations SET active=1 WHERE id=?').run(generationId); db.prepare("UPDATE shots SET image_url=?, generation_status='generated', status='ready', approval_status=? WHERE id=?").run(generation.approved ? 'approved' : 'unapproved', shotId); }); tx(); return true;
}
