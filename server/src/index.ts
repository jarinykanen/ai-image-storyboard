import cors from 'cors';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { db } from './db.js';
import { createStoryboard, regenerateStoryboardShot, shotCountForDensity } from './storyboard.js';
import { reviewStoryboard } from './storyboard-review.js';
import { type StoryboardPlan, type StoryboardShotContent } from './storyboard-prompts.js';
import { activateGeneration, addUploadedShotImage, deleteGeneration, generateSingle, refineSingle, getBatch, listGenerations, startBatch } from './image-generation.js';
import { acknowledgeVisualReferenceImage, activateVisualReferenceAsset, clearVisualReferenceImage, createReference, deleteReference, ensureVisualIdentity, generateVisualReference, getVisualIdentity, setVisualLock, updateReference, updateVisualStyle, uploadVisualReference } from './visual-identity.js';
import { createConcept, deleteConcept, generateConceptImage, generateConcepts, getConcepts, getSelectedConcept, regenerateConcept, selectConcept, updateConcept, uploadConceptImage } from './visual-concepts.js';
import { findAsset, MAX_IMAGE_UPLOAD_BYTES } from './assets.js';
import { buildCanvaExport, canvaExportSummary } from './canva-export.js';
import { allPlatformPresets, platformPresets, type PlatformId } from './platform-presets.js';
import { deleteArtworkAsset, generateArtwork, listArtwork, refineArtwork, updateArtwork, uploadArtwork, useSourceAsArtwork } from './artwork.js';
import { type Provider, type ImageQuality, type ImageResolution, ProviderCapabilityError, ProviderCredentialError, ProviderNotConfiguredError, findImageModel, getProviderRegistry, getProviderSettings, normalizeProviderError, providerErrorMessage, removeProviderKey, resolveImageConfiguration, resolveProvider, saveProviderKey, testProvider } from './provider-settings.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1 } });

app.get('/assets/:assetId', (req, res) => { const asset=findAsset(req.params.assetId); if(!asset || !fs.existsSync(asset.storagePath)) return res.status(404).end(); res.type(asset.mimeType).sendFile(asset.storagePath); });
app.get('/api/assets/:assetId/download', (req, res) => { const asset=findAsset(req.params.assetId); if(!asset || !fs.existsSync(asset.storagePath)) return res.status(404).json({error:'Image file not found.'}); const fallback=`${asset.ownerType}-image.${asset.mimeType.split('/')[1]}`; res.type(asset.mimeType).download(asset.storagePath, asset.originalFilename || fallback); });

const ProjectInput = z.object({
  title: z.string().min(1).max(120),
  lyrics: z.string().max(20000).default(''),
  sunoDescription: z.string().max(20000).optional().default(''),
  visualStyle: z.string().min(1).max(500),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  imageProvider: z.enum(['openai', 'grok']),
  imageQualityPreset: z.enum(['draft', 'standard', 'best']).default('standard'),
});
const ImageQualityOverrideInput = z.object({ qualityPreset: z.enum(['draft', 'standard', 'best']).optional() });

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const providerParam = z.enum(['openai', 'grok']);
const ProviderKeyInput = z.object({ apiKey: z.string().trim().min(1).max(500) });
app.get('/api/settings/providers', (_req, res) => res.json(getProviderRegistry()));
app.put('/api/settings/providers/:provider', (req, res) => {
  const provider = providerParam.parse(req.params.provider) as Provider;
  saveProviderKey(provider, ProviderKeyInput.parse(req.body).apiKey);
  res.json(getProviderSettings(provider));
});
app.delete('/api/settings/providers/:provider', (req, res) => {
  removeProviderKey(providerParam.parse(req.params.provider) as Provider);
  res.status(204).end();
});
app.post('/api/settings/providers/:provider/test', async (req, res, next) => {
  try {
    const provider = providerParam.parse(req.params.provider) as Provider;
    const settings = await testProvider(provider);
    if (settings.status !== 'connected') return res.status(400).json({ ...settings, error: providerErrorMessage(provider, settings.status) });
    res.json(settings);
  } catch (error) { next(error); }
});

app.get('/api/projects', (_req, res) => {
  res.json(db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all());
});

app.delete('/api/projects/:id', (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  // Foreign-key enforcement can vary in existing SQLite files, so remove every
  // project-owned record explicitly before deleting the project itself.
  db.transaction(() => {
    db.prepare('DELETE FROM image_assets WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM image_generations WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM image_generation_batches WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM storyboard_review_issues WHERE review_id IN (SELECT id FROM storyboard_reviews WHERE project_id = ?)').run(req.params.id);
    db.prepare('DELETE FROM storyboard_reviews WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM shots WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM visual_references WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM visual_identities WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM visual_concepts WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  })();
  fs.rmSync(path.resolve('data', 'projects', req.params.id), { recursive: true, force: true });
  res.status(204).end();
});

app.post('/api/projects', (req, res) => {
  const input = ProjectInput.parse(req.body);
  const imageProvider = resolveProvider('imageGeneration', { requested: input.imageProvider, strict: true });
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO projects (id,title,lyrics,suno_description,visual_style,aspect_ratio,image_provider,image_quality_preset,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, input.title, input.lyrics, input.sunoDescription.trim() || null, input.visualStyle, input.aspectRatio, imageProvider, input.imageQualityPreset, createdAt);
  ensureVisualIdentity(id, input.visualStyle);
  res.status(201).json({ id });
});

app.get('/api/projects/:id', (req, res) => {
  const project = requireProject(req.params.id, res); if (!project) return;
  const shots = (db.prepare('SELECT * FROM shots WHERE project_id = ? ORDER BY position').all(req.params.id) as any[]).map(asShot);
  res.json({ project, shots, storyboardPlan: getStoryboardPlan(req.params.id), visualIdentity: getVisualIdentity(req.params.id), concepts: getConcepts(req.params.id), storyboardReview: getLatestStoryboardReview(req.params.id), artwork: listArtwork(req.params.id) });
});
app.get('/api/platform-presets', (_req,res) => res.json(allPlatformPresets));
const PublishingInput = z.object({ publishingTargets:z.array(z.enum(['youtube','youtube-shorts','tiktok','spotify','landscape','vertical','square'])).max(7), primaryVisualFormat:z.enum(['youtube','youtube-shorts','tiktok','spotify','landscape','vertical','square']) });
app.put('/api/projects/:id/publishing', (req,res) => { const project=requireProject(req.params.id,res); if(!project)return; const input=PublishingInput.parse(req.body); if(input.publishingTargets.length && !input.publishingTargets.includes(input.primaryVisualFormat)) return res.status(400).json({error:'Primary visual format must be one of the selected publishing targets.'}); db.prepare('UPDATE projects SET publishing_targets=?,primary_visual_format=? WHERE id=?').run(JSON.stringify(input.publishingTargets),input.primaryVisualFormat,project.id); res.json(requireProject(project.id,res)); });
app.get('/api/projects/:id/artwork', (req,res) => { if(!requireProject(req.params.id,res))return; res.json(listArtwork(req.params.id)); });
const ArtworkTextConfig=z.object({title:z.string().max(80).default(''),subtitle:z.string().max(120).default(''),style:z.enum(['Bold impact','Neon glow','Elegant serif','Handwritten','Clean minimal']).default('Bold impact'),mood:z.enum(['Energetic','Romantic','Dark','Dreamy','Epic']).default('Epic')});
const ArtworkInput=z.object({platform:z.enum(['youtube','youtube-shorts','tiktok','spotify','landscape','vertical','square']),count:z.number().int().min(2).max(4),strategy:z.enum(['Cinematic','Character focused','Dramatic','Minimal','Mysterious','High contrast','Custom']).default('Cinematic'),focus:z.enum(['Automatic','Main character','Story / mystery','Key object / motif','Environment','Custom']).default('Automatic'),customStylePrompt:z.string().trim().max(2000).default(''),text:z.string().max(160).default(''),subtitle:z.string().max(160).default(''),textConfig:ArtworkTextConfig.optional(),qualityPreset:z.enum(['draft','standard','best']).optional()});
app.post('/api/projects/:id/artwork/generate', async(req,res,next)=>{try{const project=requireProject(req.params.id,res);if(!project)return;res.status(201).json(await generateArtwork(project,ArtworkInput.parse(req.body)));}catch(error){next(error);}});
app.post('/api/projects/:id/artwork/upload', upload.single('image'), (req,res,next)=>{try{const projectId=String(req.params.id);if(!requireProject(projectId,res))return;const platform=z.enum(['youtube','youtube-shorts','tiktok','spotify','landscape','vertical','square']).parse(req.body.platform);if(!req.file)return res.status(400).json({error:'Choose an image to upload.'});res.status(201).json(uploadArtwork(projectId,platform,req.file));}catch(error){next(error);}});
app.post('/api/projects/:id/artwork/from-source', (req,res,next)=>{try{if(!requireProject(req.params.id,res))return;const input=z.object({platform:z.enum(['youtube','youtube-shorts','tiktok','spotify','landscape','vertical','square']),assetId:z.string().min(1)}).parse(req.body);res.status(201).json(useSourceAsArtwork(req.params.id,input.platform,input.assetId));}catch(error){next(error);}});
app.put('/api/projects/:id/artwork/:artworkId', (req,res,next)=>{try{if(!requireProject(req.params.id,res))return;const input=z.object({activeAssetId:z.string().optional(),textConfig:z.unknown().optional()}).parse(req.body);const artwork=updateArtwork(req.params.id,req.params.artworkId,input);if(!artwork)return res.status(404).json({error:'Artwork not found.'});res.json(artwork);}catch(error){next(error);}});
app.delete('/api/projects/:id/artwork/:artworkId/assets/:assetId', (req,res)=>{const projectId=String(req.params.id);if(!requireProject(projectId,res))return;const artwork=deleteArtworkAsset(projectId,String(req.params.artworkId),String(req.params.assetId));if(!artwork)return res.status(404).json({error:'Artwork version not found.'});res.json(artwork);});
app.post('/api/projects/:id/artwork/:artworkId/refine', async(req,res,next)=>{try{const project=requireProject(req.params.id,res);if(!project)return;const {instruction}=z.object({instruction:z.string().min(1).max(2000)}).parse(req.body);res.json(await refineArtwork(project,req.params.artworkId,instruction));}catch(error){next(error);}});

app.get('/api/projects/:id/canva-export/summary', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  res.json(canvaExportSummary(req.params.id));
});
const CanvaExportInput = z.object({ images: z.boolean().optional(), guide: z.boolean().optional(), references: z.boolean().optional(), lyrics: z.boolean().optional(), sunoDescription: z.boolean().optional(), alternatives: z.boolean().optional(), platformArtwork:z.boolean().optional(), platformVariants:z.boolean().optional() });
app.post('/api/projects/:id/canva-export', async (req, res, next) => {
  try {
    if (!requireProject(req.params.id, res)) return;
    const archive = await buildCanvaExport(req.params.id, CanvaExportInput.parse(req.body ?? {}));
    res.download(archive.archive, archive.filename, () => archive.cleanup());
  } catch (error) { next(error); }
});

const ImageSettingsInput = z.object({ imageProvider: z.enum(['openai', 'grok']), qualityPreset: z.enum(['draft', 'standard', 'best']), modelOverride: z.string().nullable().optional(), resolutionOverride: z.enum(['1024x1024', '1024x1536', '1536x1024', '1k', '2k']).nullable().optional() });
const ProjectMetadataInput = z.object({ sunoDescription: z.string().max(20000).optional().default('') });
app.put('/api/projects/:id', (req, res) => {
  const project = requireProject(req.params.id, res); if (!project) return;
  const input = ProjectMetadataInput.parse(req.body);
  db.prepare('UPDATE projects SET suno_description=? WHERE id=?').run(input.sunoDescription.trim() || null, project.id);
  res.json(requireProject(project.id, res));
});
const StoryboardSettingsInput = z.object({ approach: z.enum(['narrative', 'performance', 'abstract', 'mixed']) });
app.put('/api/projects/:id/storyboard-settings', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  const input = StoryboardSettingsInput.parse(req.body);
  db.prepare('UPDATE projects SET storyboard_approach=? WHERE id=?').run(input.approach, req.params.id);
  res.json({ approach: input.approach });
});
app.put('/api/projects/:id/image-settings', (req, res) => {
  const project = requireProject(req.params.id, res); if (!project) return;
  const input = ImageSettingsInput.parse(req.body);
  const provider = resolveProvider('imageGeneration', { requested: input.imageProvider, strict: true });
  if (input.modelOverride && !findImageModel(provider, input.modelOverride)) return res.status(400).json({ error: 'That image model is not available for the selected provider.' });
  const config = resolveImageConfiguration({ provider, preset: input.qualityPreset as ImageQuality, modelId: input.modelOverride, resolution: input.resolutionOverride as ImageResolution | null });
  db.prepare('UPDATE projects SET image_provider=?, image_quality_preset=?, image_model_override=?, image_resolution_override=? WHERE id=?').run(provider, input.qualityPreset, input.modelOverride ?? null, input.resolutionOverride ?? null, project.id);
  res.json({ imageProvider: provider, qualityPreset: input.qualityPreset, modelOverride: input.modelOverride ?? null, resolutionOverride: input.resolutionOverride ?? null, effective: { model: config.model.displayName, quality: config.quality, resolution: config.resolution } });
});

function asShot(row: any) {
  const identity = getVisualIdentity(row.project_id); const characterIds = JSON.parse(row.character_ids || '[]'); const locationId = row.location_id ?? null;
  const referencePreview = [...identity.characters.filter(item => characterIds.includes(item.id)), ...identity.locations.filter(item => item.id === locationId), { id: 'visual-style', name: 'Visual Style', description: identity.style.description, image_url: identity.style.image_url }];
  return { id: row.id, order: row.position, startTime: row.start_seconds ?? null, endTime: row.end_seconds ?? null, section: row.section, title: row.title, description: row.description, action: row.action, shotType: row.shot_type, camera: row.camera, mood: row.mood, characterIds, locationId, imageUrl: row.image_url ?? null, generationStatus: row.generation_status || row.status, approvalStatus: row.approval_status || 'unapproved', generations: listGenerations(row.id), referencePreview };
}
function shotContent(row: any): StoryboardShotContent { const shot = asShot(row); return { section: shot.section, title: shot.title, description: shot.description, action: shot.action, shotType: shot.shotType, camera: shot.camera, mood: shot.mood, characterIds: shot.characterIds, locationId: shot.locationId }; }
function getStoryboardPlan(projectId: string): StoryboardPlan | null { const row = db.prepare('SELECT * FROM storyboard_plans WHERE project_id=?').get(projectId) as any; return row ? { approach: row.approach, summary: row.summary, narrativeArc: row.narrative_arc, opening: row.opening, midpoint: row.midpoint, climax: row.climax, ending: row.ending, motifs: JSON.parse(row.motifs), primaryCharacterIds: JSON.parse(row.primary_character_ids), primaryLocationIds: JSON.parse(row.primary_location_ids), pacingNotes: row.pacing_notes } : null; }
function saveStoryboardPlan(projectId: string, plan: StoryboardPlan) { db.prepare(`INSERT INTO storyboard_plans (project_id,approach,summary,narrative_arc,opening,midpoint,climax,ending,motifs,primary_character_ids,primary_location_ids,pacing_notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET approach=excluded.approach,summary=excluded.summary,narrative_arc=excluded.narrative_arc,opening=excluded.opening,midpoint=excluded.midpoint,climax=excluded.climax,ending=excluded.ending,motifs=excluded.motifs,primary_character_ids=excluded.primary_character_ids,primary_location_ids=excluded.primary_location_ids,pacing_notes=excluded.pacing_notes,created_at=excluded.created_at`).run(projectId, plan.approach, plan.summary, plan.narrativeArc, plan.opening, plan.midpoint, plan.climax, plan.ending, JSON.stringify(plan.motifs), JSON.stringify(plan.primaryCharacterIds), JSON.stringify(plan.primaryLocationIds), plan.pacingNotes, new Date().toISOString()); }
function reviewContextSignature(projectId: string) {
  const project = db.prepare('SELECT title,lyrics,suno_description,visual_style FROM projects WHERE id=?').get(projectId);
  const shots = db.prepare('SELECT id,position,section,title,description,action,shot_type,camera,mood,character_ids,location_id,image_url FROM shots WHERE project_id=? ORDER BY position').all(projectId);
  return JSON.stringify({ project, plan: getStoryboardPlan(projectId), identity: getVisualIdentity(projectId), concept: getSelectedConcept(projectId), shots });
}
function getLatestStoryboardReview(projectId: string) {
  const review = db.prepare('SELECT * FROM storyboard_reviews WHERE project_id=? ORDER BY created_at DESC LIMIT 1').get(projectId) as any;
  if (!review) return null;
  const issues = db.prepare('SELECT * FROM storyboard_review_issues WHERE review_id=?').all(review.id).map((issue: any) => ({ id: issue.id, severity: issue.severity, category: issue.category, title: issue.title, description: issue.description, shotIds: JSON.parse(issue.shot_ids), suggestion: issue.suggestion, status: issue.status }));
  return { id: review.id, storyboardId: projectId, createdAt: review.created_at, summary: review.summary, score: review.score, stale: review.context_signature !== reviewContextSignature(projectId), issues };
}

const ReferenceInput = z.object({ name: z.string().min(1).max(120), description: z.string().min(1).max(2000) });
const StyleInput = z.object({ description: z.string().min(1).max(2000) });
const ConceptInput = z.object({ title: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(2000), mood: z.string().trim().min(1).max(500), visualStyle: z.string().trim().min(1).max(1000), colorAndLighting: z.string().trim().min(1).max(1000), narrativeDirection: z.string().trim().min(1).max(2000) });
const referenceType = z.enum(['character', 'location']);

function requireProject(id: string, res: express.Response) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null; }
  const imageProvider = resolveProvider('imageGeneration', { requested: project.image_provider });
  if (imageProvider !== project.image_provider) {
    db.prepare('UPDATE projects SET image_provider=? WHERE id=?').run(imageProvider, id);
    project.image_provider = imageProvider;
  }
  return project;
}

app.get('/api/projects/:id/concepts', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  res.json(getConcepts(req.params.id));
});
app.post('/api/projects/:id/concepts/generate', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    res.json({ concepts: await generateConcepts(project) });
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/concepts/regenerate', async (req, res, next) => {
  try { const project = requireProject(req.params.id, res); if (!project) return; res.json({ concepts: await generateConcepts(project) }); } catch (error) { next(error); }
});
app.post('/api/projects/:id/concepts', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  res.status(201).json({ concept: createConcept(req.params.id, ConceptInput.parse(req.body)) });
});
app.put('/api/projects/:id/concepts/:conceptId', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  const concept = updateConcept(req.params.id, req.params.conceptId, ConceptInput.parse(req.body));
  if (!concept) return res.status(404).json({ error: 'Visual concept not found' });
  res.json({ concept });
});
app.delete('/api/projects/:id/concepts/:conceptId', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  if (!deleteConcept(req.params.id, req.params.conceptId)) return res.status(404).json({ error: 'Visual concept not found' });
  res.status(204).end();
});
app.post('/api/projects/:id/concepts/:conceptId/select', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  if (!selectConcept(req.params.id, req.params.conceptId)) return res.status(404).json({ error: 'Visual concept not found' });
  res.json({ ok: true });
});
app.post('/api/projects/:id/concepts/:conceptId/regenerate', async (req, res, next) => {
  try { const project = requireProject(req.params.id, res); if (!project) return; res.json({ concept: await regenerateConcept(project, req.params.conceptId) }); } catch (error) { next(error); }
});
app.post('/api/projects/:id/concepts/:conceptId/generate-image', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    const { qualityPreset } = ImageQualityOverrideInput.parse(req.body ?? {});
    res.json({ image_url: await generateConceptImage(project, req.params.conceptId, qualityPreset) });
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/concepts/:conceptId/image', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    const { qualityPreset } = ImageQualityOverrideInput.parse(req.body ?? {});
    res.json({ image_url: await generateConceptImage(project, req.params.conceptId, qualityPreset) });
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/concepts/:conceptId/generate-variants', async (req, res, next) => {
  try { const project=requireProject(req.params.id,res); if(!project)return; const {count,qualityPreset}=ImageQualityOverrideInput.extend({count:z.number().int().min(2).max(4)}).parse(req.body); for(let i=0;i<count;i++) await generateConceptImage(project,req.params.conceptId,qualityPreset); res.json({concept:getConcepts(project.id).find(item=>item.id===req.params.conceptId)}); } catch(error){next(error);}
});
app.post('/api/projects/:id/concepts/:conceptId/upload', upload.single('image'), (req,res) => { const projectId=String(req.params.id),conceptId=String(req.params.conceptId); if(!requireProject(projectId,res)) return; if(!req.file) return res.status(400).json({error:'Choose an image to upload.'}); const asset=uploadConceptImage(projectId,conceptId,req.file); if(!asset)return res.status(404).json({error:'Visual concept not found.'}); res.status(201).json({asset}); });

app.get('/api/projects/:id/visual-identity', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  res.json(getVisualIdentity(req.params.id));
});
app.put('/api/projects/:id/visual-identity/style', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  updateVisualStyle(req.params.id, StyleInput.parse(req.body).description);
  res.json(getVisualIdentity(req.params.id).style);
});
app.post('/api/projects/:id/visual-identity/:type', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  const type = referenceType.parse(req.params.type);
  const input = ReferenceInput.parse(req.body);
  const id = createReference(req.params.id, type, input.name, input.description);
  res.status(201).json({ id });
});
app.put('/api/projects/:id/visual-identity/:type/:referenceId', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  referenceType.parse(req.params.type);
  const input = ReferenceInput.parse(req.body);
  if (!updateReference(req.params.id, req.params.referenceId, input.name, input.description)) return res.status(404).json({ error: 'Visual reference not found' });
  res.json({ ok: true });
});
app.delete('/api/projects/:id/visual-identity/style/image', (req, res, next) => {
  try {
    const projectId = String(req.params.id); if (!requireProject(projectId, res)) return;
    if (!clearVisualReferenceImage(projectId, 'style')) return res.status(404).json({ error: 'Visual style not found.' });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.delete('/api/projects/:id/visual-identity/:type/:referenceId', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  referenceType.parse(req.params.type);
  if (!deleteReference(req.params.id, req.params.referenceId)) return res.status(404).json({ error: 'Visual reference not found' });
  res.status(204).end();
});
app.post('/api/projects/:id/visual-identity/:type/:referenceId/image', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    const type = referenceType.parse(req.params.type);
    const { qualityPreset } = ImageQualityOverrideInput.parse(req.body ?? {});
    const imageUrl = await generateVisualReference(project, type, req.params.referenceId, qualityPreset);
    res.json({ image_url: imageUrl });
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/visual-identity/style/image', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    const { qualityPreset } = ImageQualityOverrideInput.parse(req.body ?? {});
    const imageUrl = await generateVisualReference(project, 'style', undefined, qualityPreset);
    res.json({ image_url: imageUrl });
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/visual-identity/style/generate-variants', async (req,res,next)=>{
  try { const project=requireProject(req.params.id,res);if(!project)return;const {count,qualityPreset}=ImageQualityOverrideInput.extend({count:z.number().int().min(2).max(4)}).parse(req.body);for(let i=0;i<count;i++)await generateVisualReference(project,'style',undefined,qualityPreset);res.json(getVisualIdentity(project.id).style); } catch(error){next(error);}
});
app.post('/api/projects/:id/visual-identity/:type/:referenceId/generate-variants', async (req,res,next)=>{
  try { const project=requireProject(req.params.id,res);if(!project)return;const type=referenceType.parse(req.params.type);const {count,qualityPreset}=ImageQualityOverrideInput.extend({count:z.number().int().min(2).max(4)}).parse(req.body);for(let i=0;i<count;i++)await generateVisualReference(project,type,req.params.referenceId,qualityPreset);res.json(getVisualIdentity(project.id)); } catch(error){next(error);}
});
app.post('/api/projects/:id/visual-identity/style/upload', upload.single('image'), (req,res) => { const projectId=String(req.params.id); if(!requireProject(projectId,res))return; if(!req.file)return res.status(400).json({error:'Choose an image to upload.'}); res.status(201).json({asset:uploadVisualReference(projectId,'style',undefined,req.file)}); });
app.post('/api/projects/:id/visual-identity/:type/:referenceId/upload', upload.single('image'), (req,res) => { const projectId=String(req.params.id),referenceId=String(req.params.referenceId); if(!requireProject(projectId,res))return; if(!req.file)return res.status(400).json({error:'Choose an image to upload.'}); const asset=uploadVisualReference(projectId,referenceType.parse(String(req.params.type)),referenceId,req.file); if(!asset)return res.status(404).json({error:'Visual reference not found.'}); res.status(201).json({asset}); });
app.put('/api/projects/:id/visual-identity/style/assets/:assetId/activate', (req, res) => {
  const projectId = String(req.params.id); if (!requireProject(projectId, res)) return;
  const asset = activateVisualReferenceAsset(projectId, 'style', undefined, String(req.params.assetId));
  if (!asset) return res.status(404).json({ error: 'Style image version not found.' });
  res.json(getVisualIdentity(projectId).style);
});
app.put('/api/projects/:id/visual-identity/:type/:referenceId/assets/:assetId/activate', (req, res) => {
  const projectId = String(req.params.id); if (!requireProject(projectId, res)) return;
  const type = referenceType.parse(String(req.params.type));
  const asset = activateVisualReferenceAsset(projectId, type, String(req.params.referenceId), String(req.params.assetId));
  if (!asset) return res.status(404).json({ error: 'Reference image version not found.' });
  res.json(getVisualIdentity(projectId));
});
app.delete('/api/projects/:id/visual-identity/:type/:referenceId/image', (req, res, next) => {
  try {
    const projectId = String(req.params.id); if (!requireProject(projectId, res)) return;
    const type = referenceType.parse(String(req.params.type));
    if (!clearVisualReferenceImage(projectId, type, String(req.params.referenceId))) return res.status(404).json({ error: 'Visual reference not found.' });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.put('/api/projects/:id/visual-identity/style/image/acknowledge', (req, res) => {
  const projectId = String(req.params.id); if (!requireProject(projectId, res)) return;
  if (!acknowledgeVisualReferenceImage(projectId, 'style')) return res.status(404).json({ error: 'Style image not found.' });
  res.json(getVisualIdentity(projectId).style);
});
app.put('/api/projects/:id/visual-identity/:type/:referenceId/image/acknowledge', (req, res) => {
  const projectId = String(req.params.id); if (!requireProject(projectId, res)) return;
  const type = referenceType.parse(String(req.params.type));
  if (!acknowledgeVisualReferenceImage(projectId, type, String(req.params.referenceId))) return res.status(404).json({ error: 'Reference image not found.' });
  res.json(getVisualIdentity(projectId));
});
app.put('/api/projects/:id/visual-identity/:type/:referenceId/lock', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  const locked = z.object({ locked: z.boolean() }).parse(req.body).locked;
  const type = referenceType.parse(req.params.type);
  if (!setVisualLock(req.params.id, type, locked, req.params.referenceId)) return res.status(404).json({ error: 'Visual reference not found' });
  res.json({ ok: true });
});
app.put('/api/projects/:id/visual-identity/style/lock', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  setVisualLock(req.params.id, 'style', z.object({ locked: z.boolean() }).parse(req.body).locked);
  res.json({ ok: true });
});

app.post('/api/projects/:id/storyboard', async (req, res, next) => {
  try {
    const density = z.enum(['low', 'normal', 'high']).default('normal').parse(req.body?.density);
    const project = requireProject(req.params.id, res); if (!project) return;

    const storyboard = await createStoryboard({
      project,
      shotCount: shotCountForDensity(density, project.duration_seconds),
      visualIdentity: getVisualIdentity(req.params.id),
      selectedConcept: getSelectedConcept(req.params.id),
    });

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM shots WHERE project_id = ?').run(req.params.id);
      saveStoryboardPlan(req.params.id, storyboard.plan);
      const insert = db.prepare(`INSERT INTO shots
        (id,project_id,position,start_seconds,end_seconds,section,title,description,action,shot_type,camera,mood,character_ids,location_id,prompt,status,generation_status,approval_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','pending','unapproved')`);
      storyboard.shots.forEach((shot, index) => {
        insert.run(crypto.randomUUID(), req.params.id, index + 1, shot.startTime, shot.endTime, shot.section, shot.title, shot.description, shot.action, shot.shotType, shot.camera, shot.mood, JSON.stringify(shot.characterIds), shot.locationId, '');
      });
    });
    transaction();
    res.json({ count: storyboard.shots.length });
  } catch (error) { next(error); }
});

app.get('/api/projects/:id/storyboard-review', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  res.json(getLatestStoryboardReview(req.params.id));
});
app.post('/api/projects/:id/storyboard-review', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    const rows = db.prepare('SELECT * FROM shots WHERE project_id=? ORDER BY position').all(project.id) as any[];
    if (!rows.length) return res.status(400).json({ error: 'Generate a storyboard before reviewing consistency.' });
    const signature = reviewContextSignature(project.id);
    const result = await reviewStoryboard({ project, plan: getStoryboardPlan(project.id), identity: getVisualIdentity(project.id), concept: getSelectedConcept(project.id), shots: rows.map(asShot) });
    const id = crypto.randomUUID(), createdAt = new Date().toISOString();
    db.transaction(() => {
      db.prepare('INSERT INTO storyboard_reviews (id,project_id,created_at,summary,score,context_signature) VALUES (?,?,?,?,?,?)').run(id, project.id, createdAt, result.summary, result.score ?? null, signature);
      const insert = db.prepare('INSERT INTO storyboard_review_issues (id,review_id,severity,category,title,description,shot_ids,suggestion,status) VALUES (?,?,?,?,?,?,?,?,\'open\')');
      result.issues.forEach(issue => insert.run(crypto.randomUUID(), id, issue.severity, issue.category, issue.title, issue.description, JSON.stringify(issue.shotIds), issue.suggestion));
    })();
    res.status(201).json(getLatestStoryboardReview(project.id));
  } catch (error) { next(error); }
});
app.put('/api/projects/:id/storyboard-review/issues/:issueId', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  const { status } = z.object({ status: z.enum(['open', 'resolved', 'ignored']) }).parse(req.body);
  const result = db.prepare(`UPDATE storyboard_review_issues SET status=? WHERE id=? AND review_id IN (SELECT id FROM storyboard_reviews WHERE project_id=?)`).run(status, req.params.issueId, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Consistency issue not found.' });
  res.json(getLatestStoryboardReview(req.params.id));
});

const ShotEditInput = z.object({ description: z.string().min(1).max(4000), action: z.string().min(1).max(2000), shotType: z.string().min(1).max(200), camera: z.string().min(1).max(500), mood: z.string().min(1).max(500), characterIds: z.array(z.string()).max(20), locationId: z.string().nullable() });
app.put('/api/projects/:id/shots/:shotId', (req, res) => {
  const project = requireProject(req.params.id, res); if (!project) return;
  const input = ShotEditInput.parse(req.body);
  const shot = db.prepare('SELECT * FROM shots WHERE id = ? AND project_id = ?').get(req.params.shotId, req.params.id) as any;
  if (!shot) return res.status(404).json({ error: 'Storyboard shot not found' });
  const identity = getVisualIdentity(req.params.id); const characters = new Set(identity.characters.map(item => item.id)); const locations = new Set(identity.locations.map(item => item.id));
  if (input.characterIds.some(id => !characters.has(id)) || (input.locationId && !locations.has(input.locationId))) return res.status(400).json({ error: 'Choose characters and locations from this project.' });
  const changed = shot.description !== input.description || shot.action !== input.action || shot.shot_type !== input.shotType || shot.camera !== input.camera || shot.mood !== input.mood || shot.character_ids !== JSON.stringify(input.characterIds) || (shot.location_id ?? null) !== input.locationId;
  db.prepare(`UPDATE shots SET description=?, action=?, shot_type=?, camera=?, mood=?, character_ids=?, location_id=?, generation_status=?, status=? WHERE id=?`).run(input.description, input.action, input.shotType, input.camera, input.mood, JSON.stringify(input.characterIds), input.locationId, changed && shot.image_url ? 'needs_regeneration' : shot.generation_status, changed && shot.image_url ? 'stale' : shot.status, shot.id);
  res.json(asShot(db.prepare('SELECT * FROM shots WHERE id = ?').get(shot.id)));
});

app.post('/api/projects/:id/shots/:shotId/regenerate', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    const shots = db.prepare('SELECT * FROM shots WHERE project_id = ? ORDER BY position').all(req.params.id) as any[];
    const index = shots.findIndex(shot => shot.id === req.params.shotId); if (index < 0) return res.status(404).json({ error: 'Storyboard shot not found' });
    const current = shots[index]; const plan = getStoryboardPlan(req.params.id);
    if (!plan) return res.status(400).json({ error: 'Generate the storyboard before regenerating an individual shot.' });
    const generated = await regenerateStoryboardShot({ project, visualIdentity: getVisualIdentity(req.params.id), selectedConcept: getSelectedConcept(req.params.id), plan, previous: index ? shotContent(shots[index - 1]) : undefined, current: shotContent(current), next: shots[index + 1] ? shotContent(shots[index + 1]) : undefined });
    db.prepare(`UPDATE shots SET section=?, title=?, description=?, action=?, shot_type=?, camera=?, mood=?, character_ids=?, location_id=?, generation_status=?, status=? WHERE id=?`).run(generated.section, generated.title, generated.description, generated.action, generated.shotType, generated.camera, generated.mood, JSON.stringify(generated.characterIds), generated.locationId, current.image_url ? 'needs_regeneration' : 'pending', current.image_url ? 'stale' : 'pending', current.id);
    res.json(asShot(db.prepare('SELECT * FROM shots WHERE id = ?').get(current.id)));
  } catch (error) { next(error); }
});

app.get('/api/projects/:id/image-batches/:batchId', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  const batch = getBatch(req.params.batchId);
  if (!batch || (db.prepare('SELECT project_id FROM image_generation_batches WHERE id=?').get(req.params.batchId) as any)?.project_id !== req.params.id) return res.status(404).json({ error: 'Image batch not found' });
  res.json(batch);
});
app.post('/api/projects/:id/shots/:shotId/generate-image', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    const shots = db.prepare('SELECT * FROM shots WHERE project_id=? ORDER BY position').all(project.id) as any[];
    const index = shots.findIndex(shot => shot.id === req.params.shotId);
    if (index < 0) return res.status(404).json({ error: 'Storyboard shot not found' });
    const override = z.object({ qualityPreset: z.enum(['draft', 'standard', 'best']).optional(), platform:z.enum(['youtube','youtube-shorts','tiktok','spotify','landscape','vertical','square']).optional() }).parse(req.body ?? {});
    await generateSingle(project, shots[index], shots[index - 1], override);
    res.json(asShot(db.prepare('SELECT * FROM shots WHERE id=?').get(req.params.shotId)));
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/shots/:shotId/generate-variants', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    const { count, qualityPreset } = ImageQualityOverrideInput.extend({ count: z.number().int().min(2).max(4) }).parse(req.body);
    const shots = db.prepare('SELECT * FROM shots WHERE project_id=? ORDER BY position').all(project.id) as any[];
    const index = shots.findIndex(shot => shot.id === req.params.shotId); if (index < 0) return res.status(404).json({ error: 'Storyboard shot not found' });
    for (let i=0;i<count;i++) await generateSingle(project, shots[index], shots[index - 1], { qualityPreset });
    res.json(asShot(db.prepare('SELECT * FROM shots WHERE id=?').get(req.params.shotId)));
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/shots/:shotId/refine', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    const { assetId, instruction, qualityPreset } = ImageQualityOverrideInput.extend({ assetId:z.string().min(1), instruction:z.string().min(1).max(2000) }).parse(req.body);
    const shot = db.prepare('SELECT * FROM shots WHERE id=? AND project_id=?').get(req.params.shotId, project.id) as any;
    if (!shot) return res.status(404).json({ error:'Storyboard shot not found' });
    await refineSingle(project, shot, assetId, instruction, { qualityPreset });
    res.json(asShot(db.prepare('SELECT * FROM shots WHERE id=?').get(req.params.shotId)));
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/shots/:shotId/upload', upload.single('image'), (req,res) => {
  const projectId=String(req.params.id),shotId=String(req.params.shotId); if (!requireProject(projectId,res)) return;
  if (!req.file) return res.status(400).json({error:'Choose an image to upload.'});
  const asset=addUploadedShotImage(projectId,shotId,req.file);
  if(!asset) return res.status(404).json({error:'Storyboard shot not found.'});
  res.status(201).json({asset});
});
app.post('/api/projects/:id/shots/:shotId/generations/:generationId/use', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  if (!activateGeneration(req.params.id, req.params.shotId, req.params.generationId)) return res.status(404).json({ error: 'Generated image not found' });
  res.json(asShot(db.prepare('SELECT * FROM shots WHERE id=?').get(req.params.shotId)));
});
app.delete('/api/projects/:id/shots/:shotId/generations/:generationId', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  const deletion = deleteGeneration(req.params.id, req.params.shotId, req.params.generationId);
  if (deletion.result === 'not_found') return res.status(404).json({ error: 'Image version not found.' });
  if (deletion.result === 'used_by_artwork') return res.status(409).json({ error: 'This image is used as platform artwork. Choose another artwork source before deleting it.' });
  res.json(asShot(db.prepare('SELECT * FROM shots WHERE id=?').get(req.params.shotId)));
});
app.post('/api/projects/:id/shots/:shotId/approve', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  const active = db.prepare("SELECT id FROM image_generations WHERE shot_id=? AND project_id=? AND active=1 AND status='generated'").get(req.params.shotId, req.params.id) as any;
  if (!active) return res.status(400).json({ error: 'Generate an image before approving this shot.' });
  const result = db.transaction(() => {
    db.prepare('UPDATE image_generations SET approved=1 WHERE id=?').run(active.id);
    return db.prepare("UPDATE shots SET approval_status='approved', generation_status='generated', status='ready' WHERE id=? AND project_id=?").run(req.params.shotId, req.params.id);
  })();
  if (!result.changes) return res.status(400).json({ error: 'Generate an image before approving this shot.' });
  res.json(asShot(db.prepare('SELECT * FROM shots WHERE id=?').get(req.params.shotId)));
});
app.post('/api/projects/:id/shots/:shotId/needs-regeneration', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  const result = db.prepare("UPDATE shots SET generation_status='needs_regeneration', status='stale' WHERE id=? AND project_id=? AND image_url IS NOT NULL").run(req.params.shotId, req.params.id);
  if (!result.changes) return res.status(400).json({ error: 'Generate an image before marking this shot for regeneration.' });
  res.json(asShot(db.prepare('SELECT * FROM shots WHERE id=?').get(req.params.shotId)));
});
app.post('/api/projects/:id/shots/bulk-review', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  const input = z.object({ shotIds: z.array(z.string()).min(1), action: z.enum(['approve', 'needs_regeneration']) }).parse(req.body);
  const shots = db.prepare(`SELECT * FROM shots WHERE project_id=? AND id IN (${input.shotIds.map(() => '?').join(',')})`).all(req.params.id, ...input.shotIds) as any[];
  if (input.action === 'approve') {
    const valid = shots.filter(shot => shot.generation_status !== 'generating' && listGenerations(shot.id).some(generation => generation.active && generation.status === 'generated'));
    if (valid.length !== input.shotIds.length) return res.status(400).json({ error: 'Every selected shot needs a finished active image before approval.' });
    const transaction = db.transaction(() => valid.forEach(shot => {
      db.prepare("UPDATE image_generations SET approved=1 WHERE shot_id=? AND active=1 AND status='generated'").run(shot.id);
      db.prepare("UPDATE shots SET approval_status='approved', generation_status='generated', status='ready' WHERE id=?").run(shot.id);
    })); transaction();
  } else {
    db.transaction(() => shots.filter(shot => shot.image_url).forEach(shot => db.prepare("UPDATE shots SET generation_status='needs_regeneration', status='stale' WHERE id=?").run(shot.id)))();
  }
  res.json({ updated: shots.length });
});
app.post('/api/projects/:id/generate-images', async (req, res, next) => {
  try {
    const body = ImageQualityOverrideInput.extend({ shotIds: z.array(z.string().min(1)).optional() }).parse(req.body ?? {});
    const project = requireProject(req.params.id, res); if (!project) return;

    const allShots = db.prepare('SELECT * FROM shots WHERE project_id = ? ORDER BY position').all(req.params.id) as any[];
    const hasExplicitSelection = Boolean(body.shotIds?.length);
    if (hasExplicitSelection && new Set(body.shotIds).size !== body.shotIds!.length) return res.status(400).json({ error: 'Each selected shot can only be included once.' });
    const selected = hasExplicitSelection ? allShots.filter(s => body.shotIds!.includes(s.id)) : allShots.filter(s => s.generation_status !== 'generating' && (s.generation_status === 'needs_regeneration' || !listGenerations(s.id).some(generation => generation.active && generation.status === 'generated')));
    if (hasExplicitSelection && selected.length !== body.shotIds!.length) return res.status(400).json({ error: 'One or more selected shots were not found in this project.' });
    if (selected.some(shot => shot.generation_status === 'generating')) return res.status(409).json({ error: 'Wait for the selected shots that are already generating, then try again.' });
    res.status(202).json(startBatch(project, selected, { qualityPreset: body.qualityPreset }));
  } catch (error) { next(error); }
});

function logRequestError(requestId: string, req: express.Request, error: unknown) {
  const details = error instanceof ZodError ? error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) : undefined;
  const entry = {
    requestId, method: req.method, path: req.originalUrl, projectId: req.params.id,
    errorName: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : 'Unknown application error',
    details, stack: error instanceof Error ? error.stack : undefined,
  };
  // Do not log request bodies: they can contain lyrics or provider credentials.
  console.error('[api-error]', JSON.stringify(entry));
}

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', requestId);
  logRequestError(requestId, req, error);
  if (error instanceof ZodError) return res.status(400).json({ error: 'Check the information entered and try again.', code: 'INVALID_REQUEST', requestId });
  if (error instanceof ProviderCapabilityError) return res.status(400).json({ error: error.message, code: 'PROVIDER_CAPABILITY_UNAVAILABLE', provider: error.provider, requestId });
  if (error instanceof ProviderNotConfiguredError) return res.status(400).json({ error: error.message, code: 'PROVIDER_NOT_CONFIGURED', provider: error.provider, requestId });
  if (error instanceof ProviderCredentialError) return res.status(400).json({ error: providerErrorMessage(error.provider, error.status), code: error.status, provider: error.provider, requestId });
  const providerStatus = normalizeProviderError(error);
  if (providerStatus !== 'error') {
    const project = req.params.id ? db.prepare('SELECT image_provider FROM projects WHERE id=?').get(req.params.id) as { image_provider?: Provider } | undefined : undefined;
    const provider: Provider = project?.image_provider === 'grok' ? 'grok' : 'openai';
    return res.status(providerStatus === 'invalid_key' ? 400 : 503).json({ error: providerErrorMessage(provider, providerStatus), code: providerStatus, requestId });
  }
  const message = error instanceof Error && /^(Add a style|Unlock the|Visual reference not found)/.test(error.message) ? error.message : 'We could not complete that action. Please try again.';
  res.status(500).json({ error: message, requestId });
});

app.listen(3001, () => console.log('API running on http://localhost:3001'));
