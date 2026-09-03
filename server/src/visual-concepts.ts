import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { generateImage, getTextClient, type ImageProvider } from './providers.js';
import type { ImageQuality } from './provider-settings.js';
import { buildConceptImagePrompt, buildConceptTextPrompt, buildSingleConceptPrompt } from './visual-concept-prompts.js';
import { createGeneratedAsset, createUploadedAsset, listAssets } from './assets.js';

const ConceptsSchema = z.object({ concepts: z.array(z.object({
  title: z.string().min(1), description: z.string().min(1), mood: z.string().min(1),
  visualStyle: z.string().min(1), colorAndLighting: z.string().min(1), narrativeDirection: z.string().min(1),
})).length(3) });
const ConceptSchema = ConceptsSchema.shape.concepts.element;

export type VisualConcept = {
  id: string; title: string; description: string; mood: string; visualStyle: string;
  colorAndLighting: string; narrativeDirection: string; referenceImageUrl: string | null;
  status: 'generating' | 'generated' | 'selected' | 'failed'; imageStatus: 'pending' | 'generating' | 'generated' | 'failed';
  source: 'ai' | 'manual'; imageOutdated: boolean; imageAssets: ReturnType<typeof listAssets>;
};

export type ConceptInput = z.infer<typeof ConceptSchema>;
const asText = (value: unknown) => typeof value === 'string' ? value : '';
const conceptSignature = (concept: Pick<ConceptInput, 'title' | 'description' | 'mood' | 'visualStyle' | 'colorAndLighting' | 'narrativeDirection'>) =>
  JSON.stringify([concept.title, concept.description, concept.mood, concept.visualStyle, concept.colorAndLighting, concept.narrativeDirection]);

const asConcept = (row: any): VisualConcept => ({
  id: row.id, title: asText(row.title), description: asText(row.description), mood: asText(row.mood), visualStyle: asText(row.visual_style),
  colorAndLighting: asText(row.color_and_lighting), narrativeDirection: asText(row.narrative_direction),
  referenceImageUrl: row.reference_image_url ?? null, status: row.status, imageStatus: row.image_status, source: row.source ?? 'ai',
  imageOutdated: Boolean(row.reference_image_url && row.image_concept_signature !== conceptSignature({ title: asText(row.title), description: asText(row.description), mood: asText(row.mood), visualStyle: asText(row.visual_style), colorAndLighting: asText(row.color_and_lighting), narrativeDirection: asText(row.narrative_direction) })),
  imageAssets: listAssets('concept', row.id),
});

export function getConcepts(projectId: string) {
  return (db.prepare('SELECT * FROM visual_concepts WHERE project_id = ? ORDER BY created_at').all(projectId) as any[]).map(asConcept);
}

export function getSelectedConcept(projectId: string) {
  const row = db.prepare("SELECT * FROM visual_concepts WHERE project_id = ? AND status = 'selected'").get(projectId) as any;
  return row ? asConcept(row) : null;
}

export async function generateConcepts(project: any) {
  const client = getTextClient();
  const response = await client.responses.create({ model: 'gpt-5.6-terra', input: buildConceptTextPrompt({ title: project.title, lyrics: project.lyrics, sunoDescription: project.suno_description, visualDirection: project.visual_style, aspectRatio: project.aspect_ratio }) });
  const text = response.output_text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  const { concepts } = ConceptsSchema.parse(JSON.parse(text));
  const createdAt = new Date().toISOString();
  const ids = concepts.map(() => crypto.randomUUID());
  db.transaction(() => {
    db.prepare("DELETE FROM visual_concepts WHERE project_id = ? AND source = 'ai'").run(project.id);
    const insert = db.prepare(`INSERT INTO visual_concepts (id, project_id, title, description, mood, visual_style, color_and_lighting, narrative_direction, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', ?)`);
    concepts.forEach((concept, index) => insert.run(ids[index], project.id, concept.title, concept.description, concept.mood, concept.visualStyle, concept.colorAndLighting, concept.narrativeDirection, createdAt));
  })();
  return getConcepts(project.id);
}

export function createConcept(projectId: string, input: ConceptInput) {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO visual_concepts (id, project_id, title, description, mood, visual_style, color_and_lighting, narrative_direction, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`)
    .run(id, projectId, input.title, input.description, input.mood, input.visualStyle, input.colorAndLighting, input.narrativeDirection, new Date().toISOString());
  return getConcepts(projectId).find(concept => concept.id === id)!;
}

export function updateConcept(projectId: string, conceptId: string, input: ConceptInput) {
  const result = db.prepare(`UPDATE visual_concepts SET title = ?, description = ?, mood = ?, visual_style = ?, color_and_lighting = ?, narrative_direction = ? WHERE id = ? AND project_id = ?`)
    .run(input.title, input.description, input.mood, input.visualStyle, input.colorAndLighting, input.narrativeDirection, conceptId, projectId);
  if (result.changes && db.prepare("SELECT id FROM visual_concepts WHERE id=? AND status='selected'").get(conceptId)) {
    db.prepare("UPDATE image_generations SET stale=1 WHERE project_id=? AND tier='FINAL'").run(projectId);
    db.prepare("UPDATE image_assets SET stale=1 WHERE id IN (SELECT asset_id FROM image_generations WHERE project_id=? AND tier='FINAL')").run(projectId);
  }
  return result.changes ? getConcepts(projectId).find(concept => concept.id === conceptId)! : null;
}

export function deleteConcept(projectId: string, conceptId: string) {
  return db.prepare('DELETE FROM visual_concepts WHERE id = ? AND project_id = ?').run(conceptId, projectId).changes > 0;
}

export function selectConcept(projectId: string, conceptId: string) {
  const selected = db.transaction(() => {
    const found = db.prepare('SELECT id FROM visual_concepts WHERE id = ? AND project_id = ?').get(conceptId, projectId);
    if (!found) return false;
    db.prepare("UPDATE visual_concepts SET status = 'generated' WHERE project_id = ? AND status = 'selected'").run(projectId);
    db.prepare("UPDATE visual_concepts SET status = 'selected' WHERE id = ? AND project_id = ?").run(conceptId, projectId);
    return true;
  })();
  if (selected) {
    db.prepare("UPDATE image_generations SET stale=1 WHERE project_id=? AND tier='FINAL'").run(projectId);
    db.prepare("UPDATE image_assets SET stale=1 WHERE id IN (SELECT asset_id FROM image_generations WHERE project_id=? AND tier='FINAL')").run(projectId);
  }
  return selected;
}

export async function regenerateConcept(project: any, conceptId: string) {
  const current = db.prepare('SELECT id FROM visual_concepts WHERE id = ? AND project_id = ?').get(conceptId, project.id);
  if (!current) throw new Error('Visual concept not found.');
  const otherTitles = (db.prepare('SELECT title FROM visual_concepts WHERE project_id = ? AND id != ?').all(project.id, conceptId) as any[]).map(row => row.title);
  const response = await getTextClient().responses.create({ model: 'gpt-5.6-terra', input: buildSingleConceptPrompt({ title: project.title, lyrics: project.lyrics, sunoDescription: project.suno_description, visualDirection: project.visual_style, aspectRatio: project.aspect_ratio }, otherTitles) });
  const concept = ConceptSchema.parse(JSON.parse(response.output_text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim()));
  updateConcept(project.id, conceptId, concept);
  return getConcepts(project.id).find(item => item.id === conceptId)!;
}

export async function generateConceptImage(project: { id: string; image_provider: ImageProvider; aspect_ratio: string }, conceptId: string, qualityPreset?: ImageQuality) {
  const row = db.prepare('SELECT * FROM visual_concepts WHERE id = ? AND project_id = ?').get(conceptId, project.id) as any;
  if (!row) throw new Error('Visual concept not found.');
  db.prepare("UPDATE visual_concepts SET image_status = 'generating' WHERE id = ?").run(conceptId);
  try {
    const prompt = buildConceptImagePrompt(row);
    const style = { id: 'concept-style', type: 'style' as const, name: 'Visual Style', description: row.visual_style, imageAsset: null, locked: false, stale: false };
    const result = await generateImage(project.image_provider, { projectId: project.id, shotId: `concept:${conceptId}`, aspectRatio: project.aspect_ratio, visualStyle: row.visual_style, concept: null, description: prompt, action: '', shotType: 'concept reference', camera: '', mood: row.mood, characters: [], location: null, previousShot: null, referenceContext: { style, characters: [], location: null, continuityReference: null }, generationInstructions: '', prompt, qualityPreset: qualityPreset ?? (project as any).image_quality_preset, modelOverride: (project as any).image_model_override, resolutionOverride: (project as any).image_resolution_override });
    const asset = await createGeneratedAsset({ projectId:project.id, ownerType:'concept', ownerId:conceptId, url:result.url, provider:result.provider, model:result.model, quality:result.quality, resolution:result.resolution, tier:result.tier });
    db.prepare("UPDATE visual_concepts SET reference_image_url = ?, image_status = 'generated', image_concept_signature = ?, image_provider=?, image_model=?, image_quality=?, image_resolution=? WHERE id = ?").run(asset.url, conceptSignature({ title: row.title, description: row.description, mood: row.mood, visualStyle: row.visual_style, colorAndLighting: row.color_and_lighting, narrativeDirection: row.narrative_direction }), result.provider, result.model, result.quality, result.resolution, conceptId);
    const imageUrl = asset.url;
    return imageUrl;
  } catch (error) {
    db.prepare("UPDATE visual_concepts SET image_status = 'failed' WHERE id = ?").run(conceptId);
    throw error;
  }
}

export function uploadConceptImage(projectId:string, conceptId:string, file:{buffer:Buffer;mimetype:string;originalname:string}) { if(!db.prepare('SELECT id FROM visual_concepts WHERE id=? AND project_id=?').get(conceptId,projectId)) return null; const asset=createUploadedAsset({projectId,ownerType:'concept',ownerId:conceptId,data:file.buffer,mimeType:file.mimetype,originalFilename:file.originalname}); db.prepare("UPDATE visual_concepts SET reference_image_url=?, image_status='generated' WHERE id=?").run(asset.url,conceptId); return asset; }
