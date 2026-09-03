import crypto from 'node:crypto';
import fs from 'node:fs';
import pLimit from 'p-limit';
import { db } from './db.js';
import { generateImage, refineImage, type ImageGenerationRequest, type ImageProvider } from './providers.js';
import { resolveImageConfiguration, resolveProvider, type ImageQuality, type ImageResolution } from './provider-settings.js';
import { buildImagePrompt } from './storyboard-prompts.js';
import { platformPresets, type PlatformId } from './platform-presets.js';
import { getSelectedConcept } from './visual-concepts.js';
import { resolveReferenceContext, type ReferenceContext } from './reference-context.js';
import { activateAsset, createGeneratedAsset, createUploadedAsset, findAsset } from './assets.js';

type Project = { id: string; visual_style: string; aspect_ratio: string; image_provider: ImageProvider; image_quality_preset: ImageQuality; image_model_override: string | null; image_resolution_override: ImageResolution | null };
type ShotRow = any;
export type BatchStatus = { id: string; status: string; total: number; completed: number; failed: number; currentlyGenerating: number };

export function resolveImageRequest(project: Project, shot: ShotRow, previous?: ShotRow, override?: Partial<Pick<ImageGenerationRequest, 'qualityPreset' | 'modelOverride' | 'resolutionOverride'>> & { platform?: PlatformId }): ImageGenerationRequest {
  const concept = getSelectedConcept(project.id);
  const referenceContext = resolveReferenceContext(project, shot, previous);
  const visualStyle = referenceContext.style.description;
  const selectedConcept = concept ? { title: concept.title, description: concept.description, mood: concept.mood, visualStyle: concept.visualStyle, colorAndLighting: concept.colorAndLighting } : null;
  const preset = override?.platform ? platformPresets[override.platform] : null;
  const input = {
    projectId: project.id, shotId: shot.id, aspectRatio: preset?.aspectRatio ?? project.aspect_ratio, visualStyle, concept: selectedConcept,
    description: shot.description, action: shot.action || '', shotType: shot.shot_type || '', camera: shot.camera, mood: shot.mood,
    characters: referenceContext.characters, location: referenceContext.location,
    previousShot: previous ? { description: previous.description, action: previous.action || '', locationId: previous.location_id ?? null } : null,
    generationInstructions: `Keep character, wardrobe, environment, and visual-style continuity. Compose a clear keyframe suitable for later image-to-video animation.${preset ? ` ${preset.compositionGuidance} ${preset.safeArea}` : ''}`,
  };
  return { ...input, referenceContext, prompt: buildImagePrompt(input), qualityPreset: override?.qualityPreset ?? project.image_quality_preset, modelOverride: override?.modelOverride ?? project.image_model_override, resolutionOverride: override?.resolutionOverride ?? preset?.preferredResolution ?? project.image_resolution_override };
}

export function listGenerations(shotId: string) {
  return (db.prepare('SELECT id, shot_id, provider, model, quality, resolution, asset_url, asset_id, source, original_filename, status, version, active, approved, created_at FROM image_generations WHERE shot_id = ? ORDER BY version DESC').all(shotId) as any[])
    .map(row => ({ id: row.id, shotId: row.shot_id, provider: row.provider, model: row.model, quality: row.quality, resolution: row.resolution, assetUrl: row.asset_id ? `${process.env.ASSET_BASE_URL || 'http://localhost:3001'}/assets/${row.asset_id}` : row.asset_url, assetId:row.asset_id ?? null, source:row.source ?? 'generated', originalFilename:row.original_filename ?? null, status: row.status, version: row.version, active: Boolean(row.active), approved: Boolean(row.approved), createdAt: row.created_at }));
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
    const asset = await createGeneratedAsset({ projectId:project.id, ownerType:'shot', ownerId:shot.id, url:result.url, provider:project.image_provider, model:result.model, quality:result.quality, resolution:result.resolution });
    const tx = db.transaction(() => {
      db.prepare('UPDATE image_generations SET active=0 WHERE shot_id=?').run(shot.id);
      db.prepare("UPDATE image_generations SET asset_url=?, asset_id=?, model=?, quality=?, resolution=?, status='generated', active=1 WHERE id=?").run(asset.url, asset.id, result.model, result.quality, result.resolution, generationId);
      db.prepare("UPDATE shots SET image_url=?, prompt=?, status='ready', generation_status='generated', approval_status='unapproved' WHERE id=?").run(asset.url, request.prompt, shot.id);
    }); tx();
  } catch (error) {
    db.prepare("UPDATE image_generations SET status='failed', error_message=? WHERE id=?").run(error instanceof Error ? error.message : 'Generation failed', generationId);
    db.prepare("UPDATE shots SET status='error', generation_status='failed' WHERE id=?").run(shot.id);
    throw error;
  }
}

export async function generateSingle(project: Project, shot: ShotRow, previous?: ShotRow, override?: Partial<Pick<ImageGenerationRequest, 'qualityPreset' | 'modelOverride' | 'resolutionOverride'>> & { platform?: PlatformId }) {
  const id = createGeneration(project, shot.id, override); await runGeneration(project, shot, id, previous, override); return listGenerations(shot.id)[0];
}

export async function refineSingle(project: Project, shot: ShotRow, assetId: string, instruction: string) {
  const source = findAsset(assetId);
  if (!source || source.projectId !== project.id || source.ownerType !== 'shot' || source.ownerId !== shot.id) throw new Error('Image version not found.');
  const id = createGeneration(project, shot.id);
  db.prepare("UPDATE image_generations SET status='generating' WHERE id=?").run(id);
  try {
    const request = resolveImageRequest(project, shot);
    request.prompt = `${request.prompt}\n\nRefine the supplied image: ${instruction.trim()}. Keep the rest of the image as consistent as possible.`;
    const result = await refineImage(project.image_provider, request, fs.readFileSync(source.storagePath), source.originalFilename || 'source.png');
    const asset = await createGeneratedAsset({ projectId:project.id, ownerType:'shot', ownerId:shot.id, url:result.url, provider:project.image_provider, model:result.model, quality:result.quality, resolution:result.resolution });
    db.transaction(() => { db.prepare('UPDATE image_generations SET active=0 WHERE shot_id=?').run(shot.id); db.prepare("UPDATE image_generations SET asset_url=?, asset_id=?, model=?, quality=?, resolution=?, status='generated', active=1 WHERE id=?").run(asset.url,asset.id,result.model,result.quality,result.resolution,id); db.prepare("UPDATE shots SET image_url=?, status='ready', generation_status='generated', approval_status='unapproved' WHERE id=?").run(asset.url,shot.id); })();
    return listGenerations(shot.id)[0];
  } catch (error) { db.prepare("UPDATE image_generations SET status='failed', error_message=? WHERE id=?").run(error instanceof Error ? error.message : 'Refinement failed',id); throw error; }
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
  const asset = generation.asset_id ? activateAsset(projectId, 'shot', shotId, generation.asset_id) : null;
  const tx = db.transaction(() => { db.prepare('UPDATE image_generations SET active=0 WHERE shot_id=?').run(shotId); db.prepare('UPDATE image_generations SET active=1 WHERE id=?').run(generationId); db.prepare("UPDATE shots SET image_url=?, generation_status='generated', status='ready', approval_status='unapproved' WHERE id=?").run(asset?.url ?? generation.asset_url, shotId); }); tx(); return true;
}

export function deleteGeneration(projectId: string, shotId: string, generationId: string) {
  const generation = db.prepare("SELECT * FROM image_generations WHERE id=? AND shot_id=? AND project_id=? AND status='generated'").get(generationId, shotId, projectId) as any;
  if (!generation) return { result: 'not_found' as const };

  if (generation.asset_id) {
    const usedByArtwork = db.prepare('SELECT id FROM project_artwork WHERE project_id=? AND source_asset_id=?').get(projectId, generation.asset_id);
    if (usedByArtwork) return { result: 'used_by_artwork' as const };
  }

  const asset = generation.asset_id ? findAsset(generation.asset_id) : null;
  if (asset && fs.existsSync(asset.storagePath)) fs.unlinkSync(asset.storagePath);

  db.transaction(() => {
    db.prepare('DELETE FROM image_generations WHERE id=?').run(generationId);
    if (generation.asset_id) db.prepare('DELETE FROM image_assets WHERE id=?').run(generation.asset_id);

    const replacement = db.prepare("SELECT * FROM image_generations WHERE shot_id=? AND status='generated' ORDER BY version DESC LIMIT 1").get(shotId) as any;
    if (!replacement) {
      db.prepare("UPDATE shots SET image_url=NULL, status='pending', generation_status='pending', approval_status='unapproved' WHERE id=?").run(shotId);
      return;
    }

    if (replacement.asset_id) activateAsset(projectId, 'shot', shotId, replacement.asset_id);
    db.prepare('UPDATE image_generations SET active=0 WHERE shot_id=?').run(shotId);
    db.prepare('UPDATE image_generations SET active=1 WHERE id=?').run(replacement.id);
    db.prepare("UPDATE shots SET image_url=?, status='ready', generation_status='generated', approval_status=? WHERE id=?").run(replacement.asset_url, replacement.approved ? 'approved' : 'unapproved', shotId);
  })();

  return { result: 'deleted' as const };
}

export function addUploadedShotImage(projectId:string, shotId:string, file:{ buffer:Buffer; mimetype:string; originalname:string }) {
  if (!db.prepare('SELECT id FROM shots WHERE id=? AND project_id=?').get(shotId,projectId)) return null;
  const asset=createUploadedAsset({ projectId, ownerType:'shot', ownerId:shotId, data:file.buffer, mimeType:file.mimetype, originalFilename:file.originalname });
  const version=(db.prepare('SELECT COALESCE(MAX(version),0)+1 version FROM image_generations WHERE shot_id=?').get(shotId) as any).version;
  db.transaction(()=>{ db.prepare('UPDATE image_generations SET active=0 WHERE shot_id=?').run(shotId); db.prepare("INSERT INTO image_generations (id,project_id,shot_id,provider,model,quality,resolution,asset_url,asset_id,source,original_filename,status,version,active,approved,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'generated',?,?,0,?)").run(crypto.randomUUID(),projectId,shotId,'uploaded','Uploaded','standard','original',asset.url,asset.id,'uploaded',asset.originalFilename,version,1,new Date().toISOString()); db.prepare("UPDATE shots SET image_url=?,status='ready',generation_status='generated',approval_status='unapproved' WHERE id=?").run(asset.url,shotId); })();
  return asset;
}
