import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db } from './db.js';
import { generateImage, generateText, type ImageProvider } from './providers.js';
import type { ImageQuality } from './provider-settings.js';
import { buildConceptImagePrompt, buildConceptTextPrompt, buildSingleConceptPrompt } from './visual-concept-prompts.js';
import { createGeneratedAsset, createUploadedAsset, listAssets } from './assets.js';

export const ConceptInputSchema = z.object({
  title: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(2000), mood: z.string().trim().min(1).max(500),
  visualStyle: z.string().trim().min(1).max(1000), colorAndLighting: z.string().trim().min(1).max(1000), narrativeDirection: z.string().trim().min(1).max(2000),
});
const ConceptSchema = z.object({
  title: z.string().min(1), description: z.string().min(1), mood: z.string().min(1),
  visualStyle: z.string().min(1), colorAndLighting: z.string().min(1), narrativeDirection: z.string().min(1),
});
const ConceptsSchema = z.object({ concepts: z.array(ConceptSchema).length(3) });

export type VisualConcept = {
  id: string; title: string; description: string; mood: string; visualStyle: string;
  colorAndLighting: string; narrativeDirection: string; referenceImageUrl: string | null;
  status: 'generating' | 'generated' | 'selected' | 'failed'; imageStatus: 'pending' | 'generating' | 'generated' | 'failed';
  source: 'ai' | 'manual'; imageOutdated: boolean; imageAssets: ReturnType<typeof listAssets>; workspaceSummary:{references:number;shots:number;images:number;artwork:number};
};

export type ConceptInput = z.infer<typeof ConceptInputSchema>;
const asText = (value: unknown) => typeof value === 'string' ? value : '';
const conceptSignature = (concept: Pick<ConceptInput, 'title' | 'description' | 'mood' | 'visualStyle' | 'colorAndLighting' | 'narrativeDirection'>) =>
  JSON.stringify([concept.title, concept.description, concept.mood, concept.visualStyle, concept.colorAndLighting, concept.narrativeDirection]);

const asConcept = (row: any): VisualConcept => ({
  id: row.id, title: asText(row.title), description: asText(row.description), mood: asText(row.mood), visualStyle: asText(row.visual_style),
  colorAndLighting: asText(row.color_and_lighting), narrativeDirection: asText(row.narrative_direction),
  referenceImageUrl: row.reference_image_url ?? null, status: row.status, imageStatus: row.image_status, source: row.source ?? 'ai',
  imageOutdated: Boolean(row.reference_image_url && row.image_concept_signature !== conceptSignature({ title: asText(row.title), description: asText(row.description), mood: asText(row.mood), visualStyle: asText(row.visual_style), colorAndLighting: asText(row.color_and_lighting), narrativeDirection: asText(row.narrative_direction) })),
  imageAssets: listAssets('concept', row.id),
  workspaceSummary:{
    references:(db.prepare('SELECT COUNT(*) count FROM visual_references WHERE concept_id=?').get(row.id) as any).count,
    shots:(db.prepare('SELECT COUNT(*) count FROM shots WHERE concept_id=?').get(row.id) as any).count,
    images:(db.prepare("SELECT COUNT(*) count FROM image_assets WHERE concept_id=? AND owner_type!='concept'").get(row.id) as any).count,
    artwork:(db.prepare('SELECT COUNT(*) count FROM project_artwork WHERE concept_id=?').get(row.id) as any).count,
  },
});

export function getConcepts(projectId: string) {
  return (db.prepare('SELECT * FROM visual_concepts WHERE project_id = ? ORDER BY created_at').all(projectId) as any[]).map(asConcept);
}

export function getConcept(projectId:string,conceptId:string) {
  const row=db.prepare('SELECT * FROM visual_concepts WHERE id=? AND project_id=?').get(conceptId,projectId) as any;
  return row ? asConcept(row) : null;
}

export function getSelectedConcept(projectId: string) {
  const row = db.prepare(`SELECT visual_concepts.* FROM projects JOIN visual_concepts
    ON visual_concepts.id=projects.selected_concept_id AND visual_concepts.project_id=projects.id WHERE projects.id=?`).get(projectId) as any;
  return row ? asConcept(row) : null;
}

export function getSelectedConceptId(projectId: string) { return getSelectedConcept(projectId)?.id ?? null; }
export function requireSelectedConceptId(projectId: string) {
  const conceptId = getSelectedConceptId(projectId);
  if (!conceptId) throw new Error('Select a visual concept before working on its visual identity, storyboard, or artwork.');
  return conceptId;
}

export function parseExternalConceptResponse(response: string): { concept: ConceptInput } | { error: string } {
  const fenced = response.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced?.[1] ?? response);
  } catch {
    return { error: 'The response is not valid JSON. Paste the complete JSON object from the AI and try again.' };
  }
  const result = ConceptInputSchema.strict().safeParse(parsed);
  return result.success
    ? { concept: result.data }
    : { error: 'The response must contain only title, description, mood, visualStyle, colorAndLighting, and narrativeDirection, with a value for each field.' };
}

export async function generateConcepts(project: any) {
  const prompt = buildConceptTextPrompt({ title: project.title, lyrics: project.lyrics, sunoDescription: project.suno_description, visualDirection: project.visual_style, aspectRatio: project.aspect_ratio });
  const response = await generateText({ model: 'gpt-5.6-terra', prompt, operation: 'concepts.generate', projectId: project.id });
  const text = response.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  const { concepts } = ConceptsSchema.parse(JSON.parse(text));
  const createdAt = new Date().toISOString();
  const ids = concepts.map(() => crypto.randomUUID());
  db.transaction(() => {
    const candidates = db.prepare("SELECT id FROM visual_concepts WHERE project_id=? AND source='ai' AND status!='selected'").all(project.id) as {id:string}[];
    const hasWorkspace = db.prepare(`SELECT 1 FROM visual_identities WHERE concept_id=? UNION ALL SELECT 1 FROM visual_references WHERE concept_id=?
      UNION ALL SELECT 1 FROM shots WHERE concept_id=? UNION ALL SELECT 1 FROM project_artwork WHERE concept_id=?
      UNION ALL SELECT 1 FROM image_assets WHERE concept_id=? LIMIT 1`);
    const remove = db.prepare('DELETE FROM visual_concepts WHERE id=?');
    candidates.forEach(({id}) => { if (!hasWorkspace.get(id,id,id,id,id)) remove.run(id); });
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
    db.prepare("UPDATE image_generations SET stale=1 WHERE concept_id=? AND tier='FINAL'").run(conceptId);
    db.prepare("UPDATE image_assets SET stale=1 WHERE id IN (SELECT asset_id FROM image_generations WHERE concept_id=? AND tier='FINAL')").run(conceptId);
  }
  return result.changes ? getConcepts(projectId).find(concept => concept.id === conceptId)! : null;
}

export function deleteConcept(projectId: string, conceptId: string) {
  if (!db.prepare('SELECT id FROM visual_concepts WHERE id=? AND project_id=?').get(conceptId, projectId)) return false;
  const assets = db.prepare('SELECT storage_path FROM image_assets WHERE concept_id=?').all(conceptId) as {storage_path:string}[];
  db.transaction(() => {
    db.prepare('UPDATE projects SET selected_concept_id=NULL WHERE id=? AND selected_concept_id=?').run(projectId,conceptId);
    db.prepare('DELETE FROM storyboard_review_issues WHERE review_id IN (SELECT id FROM storyboard_reviews WHERE concept_id=?)').run(conceptId);
    db.prepare('DELETE FROM storyboard_reviews WHERE concept_id=?').run(conceptId);
    db.prepare('DELETE FROM image_generations WHERE concept_id=?').run(conceptId);
    db.prepare('DELETE FROM image_generation_batches WHERE concept_id=?').run(conceptId);
    db.prepare('DELETE FROM image_assets WHERE concept_id=?').run(conceptId);
    db.prepare('DELETE FROM project_artwork WHERE concept_id=?').run(conceptId);
    db.prepare('DELETE FROM shots WHERE concept_id=?').run(conceptId);
    db.prepare('DELETE FROM storyboard_plans WHERE concept_id=?').run(conceptId);
    db.prepare('DELETE FROM visual_references WHERE concept_id=?').run(conceptId);
    db.prepare('DELETE FROM visual_identities WHERE concept_id=?').run(conceptId);
    db.prepare('DELETE FROM visual_concepts WHERE id=? AND project_id=?').run(conceptId, projectId);
  })();
  const storageRoot = path.resolve('data','projects');
  assets.forEach(asset => { const file=path.join(storageRoot,asset.storage_path); if(fs.existsSync(file)) fs.unlinkSync(file); });
  return true;
}

export function selectConcept(projectId: string, conceptId: string) {
  const selected = db.transaction(() => {
    const found = db.prepare('SELECT id FROM visual_concepts WHERE id = ? AND project_id = ?').get(conceptId, projectId);
    if (!found) return false;
    db.prepare("UPDATE visual_concepts SET status = 'generated' WHERE project_id = ? AND status = 'selected'").run(projectId);
    db.prepare("UPDATE visual_concepts SET status = 'selected' WHERE id = ? AND project_id = ?").run(conceptId, projectId);
    db.prepare('UPDATE projects SET selected_concept_id=? WHERE id=?').run(conceptId,projectId);
    const concept = db.prepare('SELECT visual_style FROM visual_concepts WHERE id=?').get(conceptId) as any;
    db.prepare('INSERT OR IGNORE INTO visual_identities (concept_id,project_id,style_description) VALUES (?,?,?)').run(conceptId, projectId, concept.visual_style || '');
    return true;
  })();
  return selected;
}

export async function regenerateConcept(project: any, conceptId: string) {
  const current = db.prepare('SELECT id FROM visual_concepts WHERE id = ? AND project_id = ?').get(conceptId, project.id);
  if (!current) throw new Error('Visual concept not found.');
  const otherTitles = (db.prepare('SELECT title FROM visual_concepts WHERE project_id = ? AND id != ?').all(project.id, conceptId) as any[]).map(row => row.title);
  const prompt = buildSingleConceptPrompt({ title: project.title, lyrics: project.lyrics, sunoDescription: project.suno_description, visualDirection: project.visual_style, aspectRatio: project.aspect_ratio }, otherTitles);
  const response = await generateText({ model: 'gpt-5.6-terra', prompt, operation: 'concept.regenerate', projectId: project.id, targetId: conceptId });
  const concept = ConceptSchema.parse(JSON.parse(response.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim()));
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
