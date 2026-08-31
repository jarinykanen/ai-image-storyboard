import cors from 'cors';
import express from 'express';
import crypto from 'node:crypto';
import { z, ZodError } from 'zod';
import { db } from './db.js';
import { createStoryboard, regenerateStoryboardShot, shotCountForDensity } from './storyboard.js';
import { type StoryboardPlan, type StoryboardShotContent } from './storyboard-prompts.js';
import { activateGeneration, generateSingle, getBatch, listGenerations, startBatch } from './image-generation.js';
import { createReference, deleteReference, ensureVisualIdentity, generateVisualReference, getVisualIdentity, setVisualLock, updateReference, updateVisualStyle } from './visual-identity.js';
import { createConcept, deleteConcept, generateConceptImage, generateConcepts, getConcepts, getSelectedConcept, regenerateConcept, selectConcept, updateConcept } from './visual-concepts.js';
import { type Provider, type ImageQuality, type ImageResolution, ProviderCapabilityError, ProviderCredentialError, ProviderNotConfiguredError, findImageModel, getProviderRegistry, getProviderSettings, normalizeProviderError, providerErrorMessage, removeProviderKey, resolveImageConfiguration, resolveProvider, saveProviderKey, testProvider } from './provider-settings.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const ProjectInput = z.object({
  title: z.string().min(1).max(120),
  lyrics: z.string().max(20000).default(''),
  sunoDescription: z.string().max(20000).optional().default(''),
  visualStyle: z.string().min(1).max(500),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  imageProvider: z.enum(['openai', 'grok']),
  imageQualityPreset: z.enum(['draft', 'standard', 'best']).default('standard'),
});

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
    db.prepare('DELETE FROM image_generations WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM image_generation_batches WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM shots WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM visual_references WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM visual_identities WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM visual_concepts WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  })();
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
  res.json({ project, shots, storyboardPlan: getStoryboardPlan(req.params.id), visualIdentity: getVisualIdentity(req.params.id), concepts: getConcepts(req.params.id) });
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
  return { id: row.id, order: row.position, startTime: row.start_seconds ?? null, endTime: row.end_seconds ?? null, section: row.section, title: row.title, description: row.description, action: row.action, shotType: row.shot_type, camera: row.camera, mood: row.mood, characterIds: JSON.parse(row.character_ids || '[]'), locationId: row.location_id ?? null, imageUrl: row.image_url ?? null, generationStatus: row.generation_status || row.status, approvalStatus: row.approval_status || 'unapproved', generations: listGenerations(row.id) };
}
function shotContent(row: any): StoryboardShotContent { const shot = asShot(row); return { section: shot.section, title: shot.title, description: shot.description, action: shot.action, shotType: shot.shotType, camera: shot.camera, mood: shot.mood, characterIds: shot.characterIds, locationId: shot.locationId }; }
function getStoryboardPlan(projectId: string): StoryboardPlan | null { const row = db.prepare('SELECT * FROM storyboard_plans WHERE project_id=?').get(projectId) as any; return row ? { approach: row.approach, summary: row.summary, narrativeArc: row.narrative_arc, opening: row.opening, midpoint: row.midpoint, climax: row.climax, ending: row.ending, motifs: JSON.parse(row.motifs), primaryCharacterIds: JSON.parse(row.primary_character_ids), primaryLocationIds: JSON.parse(row.primary_location_ids), pacingNotes: row.pacing_notes } : null; }
function saveStoryboardPlan(projectId: string, plan: StoryboardPlan) { db.prepare(`INSERT INTO storyboard_plans (project_id,approach,summary,narrative_arc,opening,midpoint,climax,ending,motifs,primary_character_ids,primary_location_ids,pacing_notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET approach=excluded.approach,summary=excluded.summary,narrative_arc=excluded.narrative_arc,opening=excluded.opening,midpoint=excluded.midpoint,climax=excluded.climax,ending=excluded.ending,motifs=excluded.motifs,primary_character_ids=excluded.primary_character_ids,primary_location_ids=excluded.primary_location_ids,pacing_notes=excluded.pacing_notes,created_at=excluded.created_at`).run(projectId, plan.approach, plan.summary, plan.narrativeArc, plan.opening, plan.midpoint, plan.climax, plan.ending, JSON.stringify(plan.motifs), JSON.stringify(plan.primaryCharacterIds), JSON.stringify(plan.primaryLocationIds), plan.pacingNotes, new Date().toISOString()); }

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
    res.json({ image_url: await generateConceptImage(project, req.params.conceptId) });
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/concepts/:conceptId/image', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    res.json({ image_url: await generateConceptImage(project, req.params.conceptId) });
  } catch (error) { next(error); }
});

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
    const imageUrl = await generateVisualReference(project, type, req.params.referenceId);
    res.json({ image_url: imageUrl });
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/visual-identity/style/image', async (req, res, next) => {
  try {
    const project = requireProject(req.params.id, res); if (!project) return;
    const imageUrl = await generateVisualReference(project, 'style');
    res.json({ image_url: imageUrl });
  } catch (error) { next(error); }
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
    const override = z.object({ qualityPreset: z.enum(['draft', 'standard', 'best']).optional() }).parse(req.body ?? {});
    await generateSingle(project, shots[index], shots[index - 1], override);
    res.json(asShot(db.prepare('SELECT * FROM shots WHERE id=?').get(req.params.shotId)));
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/shots/:shotId/generations/:generationId/use', (req, res) => {
  if (!requireProject(req.params.id, res)) return;
  if (!activateGeneration(req.params.id, req.params.shotId, req.params.generationId)) return res.status(404).json({ error: 'Generated image not found' });
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
    const body = z.object({ shotIds: z.array(z.string()).optional() }).parse(req.body ?? {});
    const project = requireProject(req.params.id, res); if (!project) return;

    const allShots = db.prepare('SELECT * FROM shots WHERE project_id = ? ORDER BY position').all(req.params.id) as any[];
    const selected = body.shotIds?.length ? allShots.filter(s => body.shotIds!.includes(s.id)) : allShots.filter(s => s.generation_status === 'needs_regeneration' || !listGenerations(s.id).some(generation => generation.active && generation.status === 'generated'));
    res.status(202).json(startBatch(project, selected));
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
