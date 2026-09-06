import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { generateImage, generateText, type ImageProvider } from './providers.js';
import { getSelectedConcept, requireSelectedConceptId } from './visual-concepts.js';
import { buildSelectedConceptContext } from './visual-concept-prompts.js';
import { buildProjectContext, projectType } from './project-context.js';
import { activateAsset, createGeneratedAsset, createUploadedAsset, listAssets } from './assets.js';
import type { ImageQuality } from './provider-settings.js';
import { buildVisualReferenceImagePrompt, buildVisualReferencePrompt } from './visual-reference-prompts.js';

export type ReferenceType = 'character' | 'location';
export const MAX_VISUAL_REFERENCE_DESCRIPTION_LENGTH = 10_000;

export type VisualStyle = { description: string; image_url: string | null; image_outdated: boolean; locked: boolean; imageAssets: ReturnType<typeof listAssets> };
export type VisualReference = {
  id: string; name: string; description: string; image_url: string | null; image_outdated: boolean; locked: boolean; imageAssets: ReturnType<typeof listAssets>;
};
export type VisualIdentity = { style: VisualStyle; characters: VisualReference[]; locations: VisualReference[] };

const GeneratedReferenceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(MAX_VISUAL_REFERENCE_DESCRIPTION_LENGTH),
});

const referenceSignature = (name: string, description: string) => JSON.stringify({ name: name.trim(), description: description.trim() });
const styleSignature = (description: string) => JSON.stringify({ description: description.trim() });
function markConceptFinalsStale(conceptId:string) {
  db.prepare("UPDATE image_generations SET stale=1 WHERE concept_id=? AND tier='FINAL'").run(conceptId);
  db.prepare("UPDATE image_assets SET stale=1 WHERE id IN (SELECT asset_id FROM image_generations WHERE concept_id=? AND tier='FINAL')").run(conceptId);
}
const asReference = (row: any): VisualReference => ({
  id: row.id, name: row.name, description: row.description, image_url: row.image_url ?? null,
  image_outdated: Boolean(row.image_url && row.image_signature !== referenceSignature(row.name, row.description)), locked: Boolean(row.locked), imageAssets:listAssets('reference',row.id),
});

export function getVisualIdentity(projectId: string, conceptId = getSelectedConcept(projectId)?.id): VisualIdentity {
  const style = conceptId ? db.prepare('SELECT * FROM visual_identities WHERE project_id=? AND concept_id=?').get(projectId,conceptId) as any : null;
  const references = conceptId ? db.prepare('SELECT * FROM visual_references WHERE project_id=? AND concept_id=? ORDER BY created_at').all(projectId,conceptId) as any[] : [];
  return {
    style: {
      description: style?.style_description ?? '', image_url: style?.style_image_url ?? null,
      image_outdated: Boolean(style?.style_image_url && style?.style_image_signature !== styleSignature(style?.style_description ?? '')),
      locked: Boolean(style?.style_locked), imageAssets:conceptId ? listAssets('style',conceptId) : [],
    },
    characters: references.filter(reference => reference.type === 'character').map(asReference),
    locations: references.filter(reference => reference.type === 'location').map(asReference),
  };
}

export function ensureVisualIdentity(projectId: string, styleDescription = '', conceptId = requireSelectedConceptId(projectId)) {
  db.prepare('INSERT OR IGNORE INTO visual_identities (concept_id,project_id,style_description) VALUES (?,?,?)').run(conceptId,projectId,styleDescription);
}

export function updateVisualStyle(projectId: string, description: string) {
  const conceptId=requireSelectedConceptId(projectId); ensureVisualIdentity(projectId,'',conceptId);
  const result = db.prepare('UPDATE visual_identities SET style_description=? WHERE project_id=? AND concept_id=? AND style_locked=0').run(description,projectId,conceptId);
  if (!result.changes) throw new Error('Unlock the style reference before editing it.');
  markConceptFinalsStale(conceptId);
}

export function createReference(projectId: string, type: ReferenceType, name: string, description: string) {
  const id = crypto.randomUUID(), conceptId=requireSelectedConceptId(projectId);
  db.prepare(`INSERT INTO visual_references (id,project_id,concept_id,type,name,description,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(id,projectId,conceptId,type,name,description,new Date().toISOString());
  return id;
}

export async function generateReferenceDetails(project: any, type: ReferenceType, idea: string, detailLevel = 50, includeProjectContext = true) {
  const concept = getSelectedConcept(project.id);
  if (!concept) throw new Error('Select a visual concept before creating a visual reference.');
  const identity = getVisualIdentity(project.id, concept.id);
  const planRow = includeProjectContext ? db.prepare('SELECT summary,narrative_arc,motifs FROM storyboard_plans WHERE project_id=? AND concept_id=?').get(project.id, concept.id) as any : null;
  const prompt = buildVisualReferencePrompt({
    type,
    idea,
    detailLevel,
    project: includeProjectContext ? project : undefined,
    identity: includeProjectContext ? identity : undefined,
    concept: includeProjectContext ? concept : undefined,
    storyboard: planRow ? { summary: planRow.summary, narrativeArc: planRow.narrative_arc, motifs: JSON.parse(planRow.motifs || '[]') } : null,
  });
  const response = await generateText({ model: 'gpt-5.6-terra', prompt, operation: `visual-reference.${type}.generate`, projectId: project.id, targetId: concept.id });
  const json = response.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  return GeneratedReferenceSchema.parse(JSON.parse(json));
}

export function updateReference(projectId: string, referenceId: string, name: string, description: string) {
  const conceptId=requireSelectedConceptId(projectId);
  const result = db.prepare('UPDATE visual_references SET name=?,description=? WHERE id=? AND project_id=? AND concept_id=? AND locked=0').run(name,description,referenceId,projectId,conceptId);
  if (result.changes) markConceptFinalsStale(conceptId);
  return result.changes > 0;
}

export function deleteReference(projectId: string, referenceId: string) {
  return db.prepare('DELETE FROM visual_references WHERE id=? AND project_id=? AND concept_id=? AND locked=0').run(referenceId,projectId,requireSelectedConceptId(projectId)).changes > 0;
}

export function setVisualLock(projectId: string, target: 'style' | ReferenceType, locked: boolean, referenceId?: string) {
  const conceptId=requireSelectedConceptId(projectId);
  if (target === 'style') {
    ensureVisualIdentity(projectId);
    db.prepare('UPDATE visual_identities SET style_locked=? WHERE project_id=? AND concept_id=?').run(Number(locked),projectId,conceptId);
    return true;
  }
  return db.prepare('UPDATE visual_references SET locked=? WHERE id=? AND project_id=? AND concept_id=? AND type=?')
    .run(Number(locked),referenceId,projectId,conceptId,target).changes > 0;
}

export async function generateVisualReference(project: { id: string; project_type?: 'general'|'music_video'; creative_brief?: string | null; visual_style?: string; image_provider: ImageProvider; aspect_ratio: string; lyrics?: string; suno_description?: string | null }, target: 'style' | ReferenceType, referenceId?: string, qualityPreset?: ImageQuality) {
  const concept=getSelectedConcept(project.id); if(!concept) throw new Error('Select a visual concept first.'); const conceptId=concept.id;
  const identity = getVisualIdentity(project.id,conceptId);
  const conceptContext = buildSelectedConceptContext(concept);
  const projectContext = buildProjectContext(project);
  let prompt: string;
  if (target === 'style') {
    if (!identity.style.description.trim()) throw new Error('Add a style description before generating a reference image.');
    if (identity.style.locked) throw new Error('Unlock the style reference before regenerating it.');
    prompt = `Create a visual style reference image for a ${projectType(project) === 'music_video' ? 'music video' : 'visual project'}. ${identity.style.description}.${conceptContext} ${projectContext} Do not include text, captions, logos, or watermarks.`;
  } else {
    const reference = (target === 'character' ? identity.characters : identity.locations).find(item => item.id === referenceId);
    if (!reference) throw new Error('Visual reference not found.');
    if (reference.locked) throw new Error('Unlock this reference before regenerating it.');
    prompt = buildVisualReferenceImagePrompt({ type: target, name: reference.name, description: reference.description, visualStyle: identity.style.description });
  }
  // A style image can carry strong subject and scene content into an image-edit
  // request. New character/location references therefore use the style's text
  // description only, keeping their own saved specification authoritative.
  const style = { id: 'visual-style', type: 'style' as const, name: 'Visual Style', description: identity.style.description, imageAsset: target === 'style' ? identity.style.image_url : null, locked: identity.style.locked, stale: identity.style.image_outdated };
  const result = await generateImage(project.image_provider, { projectId: project.id, shotId: `reference:${referenceId || 'style'}`, aspectRatio: project.aspect_ratio, visualStyle: identity.style.description, concept: null, description: prompt, action: '', shotType: 'reference image', camera: '', mood: '', characters: [], location: null, previousShot: null, referenceContext: { style, characters: [], location: null, continuityReference: null }, generationInstructions: '', prompt, qualityPreset: qualityPreset ?? (project as any).image_quality_preset, modelOverride: (project as any).image_model_override, resolutionOverride: (project as any).image_resolution_override });
  const ownerType = target === 'style' ? 'style' as const : 'reference' as const;
  const ownerId = target === 'style' ? conceptId : referenceId!;
  const asset = await createGeneratedAsset({ projectId:project.id, ownerType, ownerId, url:result.url, provider:result.provider, model:result.model, quality:result.quality, resolution:result.resolution, tier:result.tier });
  const imageUrl = asset.url;
  if (target === 'style') {
    db.prepare('UPDATE visual_identities SET style_image_url=?,style_image_signature=?,style_image_provider=?,style_image_model=?,style_image_quality=?,style_image_resolution=? WHERE project_id=? AND concept_id=?')
      .run(imageUrl,styleSignature(identity.style.description),result.provider,result.model,result.quality,result.resolution,project.id,conceptId);
  } else {
    const reference = (target === 'character' ? identity.characters : identity.locations).find(item => item.id === referenceId)!;
    db.prepare('UPDATE visual_references SET image_url=?,image_signature=?,image_provider=?,image_model=?,image_quality=?,image_resolution=? WHERE id=? AND project_id=? AND concept_id=?')
      .run(imageUrl,referenceSignature(reference.name,reference.description),result.provider,result.model,result.quality,result.resolution,referenceId,project.id,conceptId);
  }
  markConceptFinalsStale(conceptId);
  return imageUrl;
}

export function uploadVisualReference(projectId:string,target:'style'|ReferenceType,referenceId:string|undefined,file:{buffer:Buffer;mimetype:string;originalname:string}) {
  const conceptId=requireSelectedConceptId(projectId); const ownerType=target==='style'?'style' as const:'reference' as const; const ownerId=target==='style'?conceptId:referenceId!;
  if(target==='style') ensureVisualIdentity(projectId,'',conceptId); else if(!db.prepare('SELECT id FROM visual_references WHERE id=? AND project_id=? AND concept_id=? AND type=?').get(referenceId,projectId,conceptId,target)) return null;
  const asset=createUploadedAsset({projectId,ownerType,ownerId,data:file.buffer,mimeType:file.mimetype,originalFilename:file.originalname});
  if(target==='style') db.prepare('UPDATE visual_identities SET style_image_url=? WHERE project_id=? AND concept_id=?').run(asset.url,projectId,conceptId); else db.prepare('UPDATE visual_references SET image_url=? WHERE id=? AND project_id=? AND concept_id=?').run(asset.url,referenceId,projectId,conceptId);
  markConceptFinalsStale(conceptId);
  return asset;
}

/** Select a stored identity asset without creating or deleting an image. */
export function activateVisualReferenceAsset(projectId: string, target: 'style' | ReferenceType, referenceId: string | undefined, assetId: string) {
  const conceptId=requireSelectedConceptId(projectId);
  const ownerType = target === 'style' ? 'style' as const : 'reference' as const;
  const ownerId = target === 'style' ? conceptId : referenceId!;
  if (target !== 'style' && !db.prepare('SELECT id FROM visual_references WHERE id=? AND project_id=? AND concept_id=? AND type=?').get(referenceId,projectId,conceptId,target)) return null;
  const asset = activateAsset(projectId, ownerType, ownerId, assetId);
  if (!asset) return null;
  if (target === 'style') {
    db.prepare('UPDATE visual_identities SET style_image_url=? WHERE project_id=? AND concept_id=?').run(asset.url,projectId,conceptId);
  } else {
    db.prepare('UPDATE visual_references SET image_url=? WHERE id=? AND project_id=? AND concept_id=? AND type=?').run(asset.url,referenceId,projectId,conceptId,target);
  }
  markConceptFinalsStale(conceptId);
  return asset;
}

/** Hide the current image while retaining every stored version for later reuse. */
export function clearVisualReferenceImage(projectId: string, target: 'style' | ReferenceType, referenceId?: string) {
  const conceptId=requireSelectedConceptId(projectId);
  const ownerType = target === 'style' ? 'style' as const : 'reference' as const;
  const ownerId = target === 'style' ? conceptId : referenceId!;
  if (target === 'style') {
    const style = db.prepare('SELECT style_locked FROM visual_identities WHERE project_id=? AND concept_id=?').get(projectId,conceptId) as any;
    if (!style) return false;
    if (style.style_locked) throw new Error('Unlock the style reference before clearing its image.');
  } else {
    const reference = db.prepare('SELECT locked FROM visual_references WHERE id=? AND project_id=? AND concept_id=? AND type=?').get(referenceId,projectId,conceptId,target) as any;
    if (!reference) return false;
    if (reference.locked) throw new Error('Unlock this reference before clearing its image.');
  }
  db.transaction(() => {
    db.prepare('UPDATE image_assets SET active=0 WHERE project_id=? AND owner_type=? AND owner_id=?').run(projectId, ownerType, ownerId);
    if (target === 'style') db.prepare('UPDATE visual_identities SET style_image_url=NULL WHERE project_id=? AND concept_id=?').run(projectId,conceptId);
    else db.prepare('UPDATE visual_references SET image_url=NULL WHERE id=? AND project_id=? AND concept_id=? AND type=?').run(referenceId,projectId,conceptId,target);
  })();
  markConceptFinalsStale(conceptId);
  return true;
}

/** Acknowledge that the current image intentionally matches the edited description. */
export function acknowledgeVisualReferenceImage(projectId: string, target: 'style' | ReferenceType, referenceId?: string) {
  const conceptId=requireSelectedConceptId(projectId);
  if (target === 'style') {
    const style = db.prepare('SELECT style_description,style_image_url FROM visual_identities WHERE project_id=? AND concept_id=?').get(projectId,conceptId) as any;
    if (!style || !style.style_image_url) return false;
    db.prepare('UPDATE visual_identities SET style_image_signature=? WHERE project_id=? AND concept_id=?').run(styleSignature(style.style_description),projectId,conceptId);
    return true;
  }
  const reference = db.prepare('SELECT name,description,image_url FROM visual_references WHERE id=? AND project_id=? AND concept_id=? AND type=?').get(referenceId,projectId,conceptId,target) as any;
  if (!reference || !reference.image_url) return false;
  db.prepare('UPDATE visual_references SET image_signature=? WHERE id=? AND project_id=? AND concept_id=? AND type=?').run(referenceSignature(reference.name,reference.description),referenceId,projectId,conceptId,target);
  return true;
}
