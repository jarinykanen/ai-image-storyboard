import crypto from 'node:crypto';
import { db } from './db.js';
import { generateImage, type ImageProvider } from './providers.js';
import { getSelectedConcept } from './visual-concepts.js';
import { buildSelectedConceptContext } from './visual-concept-prompts.js';
import { buildSongContext } from './song-context.js';
import { activateAsset, createGeneratedAsset, createUploadedAsset, listAssets } from './assets.js';
import type { ImageQuality } from './provider-settings.js';

export type ReferenceType = 'character' | 'location';

export type VisualStyle = { description: string; image_url: string | null; image_outdated: boolean; locked: boolean; imageAssets: ReturnType<typeof listAssets> };
export type VisualReference = {
  id: string; name: string; description: string; image_url: string | null; image_outdated: boolean; locked: boolean; imageAssets: ReturnType<typeof listAssets>;
};
export type VisualIdentity = { style: VisualStyle; characters: VisualReference[]; locations: VisualReference[] };

const referenceSignature = (name: string, description: string) => JSON.stringify({ name: name.trim(), description: description.trim() });
const styleSignature = (description: string) => JSON.stringify({ description: description.trim() });
const asReference = (row: any): VisualReference => ({
  id: row.id, name: row.name, description: row.description, image_url: row.image_url ?? null,
  image_outdated: Boolean(row.image_url && row.image_signature !== referenceSignature(row.name, row.description)), locked: Boolean(row.locked), imageAssets:listAssets('reference',row.id),
});

export function getVisualIdentity(projectId: string): VisualIdentity {
  const style = db.prepare('SELECT * FROM visual_identities WHERE project_id = ?').get(projectId) as any;
  const references = db.prepare('SELECT * FROM visual_references WHERE project_id = ? ORDER BY created_at').all(projectId) as any[];
  return {
    style: {
      description: style?.style_description ?? '', image_url: style?.style_image_url ?? null,
      image_outdated: Boolean(style?.style_image_url && style?.style_image_signature !== styleSignature(style?.style_description ?? '')),
      locked: Boolean(style?.style_locked), imageAssets:listAssets('style',projectId),
    },
    characters: references.filter(reference => reference.type === 'character').map(asReference),
    locations: references.filter(reference => reference.type === 'location').map(asReference),
  };
}

export function ensureVisualIdentity(projectId: string, styleDescription = '') {
  db.prepare('INSERT OR IGNORE INTO visual_identities (project_id, style_description) VALUES (?, ?)').run(projectId, styleDescription);
}

export function updateVisualStyle(projectId: string, description: string) {
  ensureVisualIdentity(projectId);
  const result = db.prepare('UPDATE visual_identities SET style_description = ? WHERE project_id = ? AND style_locked = 0').run(description, projectId);
  if (!result.changes) throw new Error('Unlock the style reference before editing it.');
}

export function createReference(projectId: string, type: ReferenceType, name: string, description: string) {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO visual_references (id, project_id, type, name, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, projectId, type, name, description, new Date().toISOString());
  return id;
}

export function updateReference(projectId: string, referenceId: string, name: string, description: string) {
  const result = db.prepare('UPDATE visual_references SET name = ?, description = ? WHERE id = ? AND project_id = ? AND locked = 0').run(name, description, referenceId, projectId);
  return result.changes > 0;
}

export function deleteReference(projectId: string, referenceId: string) {
  return db.prepare('DELETE FROM visual_references WHERE id = ? AND project_id = ? AND locked = 0').run(referenceId, projectId).changes > 0;
}

export function setVisualLock(projectId: string, target: 'style' | ReferenceType, locked: boolean, referenceId?: string) {
  if (target === 'style') {
    ensureVisualIdentity(projectId);
    db.prepare('UPDATE visual_identities SET style_locked = ? WHERE project_id = ?').run(Number(locked), projectId);
    return true;
  }
  return db.prepare('UPDATE visual_references SET locked = ? WHERE id = ? AND project_id = ? AND type = ?')
    .run(Number(locked), referenceId, projectId, target).changes > 0;
}

export async function generateVisualReference(project: { id: string; image_provider: ImageProvider; aspect_ratio: string; lyrics?: string; suno_description?: string | null }, target: 'style' | ReferenceType, referenceId?: string, qualityPreset?: ImageQuality) {
  const identity = getVisualIdentity(project.id);
  const conceptContext = buildSelectedConceptContext(getSelectedConcept(project.id));
  const songContext = buildSongContext(project);
  let prompt: string;
  if (target === 'style') {
    if (!identity.style.description.trim()) throw new Error('Add a style description before generating a reference image.');
    if (identity.style.locked) throw new Error('Unlock the style reference before regenerating it.');
    prompt = `Create a visual style reference image for a music video. ${identity.style.description}.${conceptContext} ${songContext} Do not include text, captions, logos, or watermarks.`;
  } else {
    const reference = (target === 'character' ? identity.characters : identity.locations).find(item => item.id === referenceId);
    if (!reference) throw new Error('Visual reference not found.');
    if (reference.locked) throw new Error('Unlock this reference before regenerating it.');
    prompt = target === 'character'
      ? `Create a consistent character reference image for ${reference.name}. ${reference.description}. Visual style: ${identity.style.description || 'cinematic music video'}.${conceptContext} ${songContext} Do not include text, captions, logos, or watermarks.`
      : `Create a consistent location reference image for ${reference.name}. ${reference.description}. Visual style: ${identity.style.description || 'cinematic music video'}.${conceptContext} ${songContext} Do not include text, captions, logos, or watermarks.`;
  }
  const style = { id: 'visual-style', type: 'style' as const, name: 'Visual Style', description: identity.style.description, imageAsset: identity.style.image_url, locked: identity.style.locked, stale: identity.style.image_outdated };
  const result = await generateImage(project.image_provider, { projectId: project.id, shotId: `reference:${referenceId || 'style'}`, aspectRatio: project.aspect_ratio, visualStyle: identity.style.description, concept: null, description: prompt, action: '', shotType: 'reference image', camera: '', mood: '', characters: [], location: null, previousShot: null, referenceContext: { style, characters: [], location: null, continuityReference: null }, generationInstructions: '', prompt, qualityPreset: qualityPreset ?? (project as any).image_quality_preset, modelOverride: (project as any).image_model_override, resolutionOverride: (project as any).image_resolution_override });
  const ownerType = target === 'style' ? 'style' as const : 'reference' as const;
  const ownerId = target === 'style' ? project.id : referenceId!;
  const asset = await createGeneratedAsset({ projectId:project.id, ownerType, ownerId, url:result.url, provider:project.image_provider, model:result.model, quality:result.quality, resolution:result.resolution });
  const imageUrl = asset.url;
  if (target === 'style') {
    db.prepare('UPDATE visual_identities SET style_image_url = ?, style_image_signature = ?, style_image_provider=?, style_image_model=?, style_image_quality=?, style_image_resolution=? WHERE project_id = ?')
      .run(imageUrl, styleSignature(identity.style.description), project.image_provider, result.model, result.quality, result.resolution, project.id);
  } else {
    const reference = (target === 'character' ? identity.characters : identity.locations).find(item => item.id === referenceId)!;
    db.prepare('UPDATE visual_references SET image_url = ?, image_signature = ?, image_provider=?, image_model=?, image_quality=?, image_resolution=? WHERE id = ? AND project_id = ?')
      .run(imageUrl, referenceSignature(reference.name, reference.description), project.image_provider, result.model, result.quality, result.resolution, referenceId, project.id);
  }
  return imageUrl;
}

export function uploadVisualReference(projectId:string,target:'style'|ReferenceType,referenceId:string|undefined,file:{buffer:Buffer;mimetype:string;originalname:string}) {
  const ownerType=target==='style'?'style' as const:'reference' as const; const ownerId=target==='style'?projectId:referenceId!;
  if(target==='style') ensureVisualIdentity(projectId); else if(!db.prepare('SELECT id FROM visual_references WHERE id=? AND project_id=? AND type=?').get(referenceId,projectId,target)) return null;
  const asset=createUploadedAsset({projectId,ownerType,ownerId,data:file.buffer,mimeType:file.mimetype,originalFilename:file.originalname});
  if(target==='style') db.prepare('UPDATE visual_identities SET style_image_url=? WHERE project_id=?').run(asset.url,projectId); else db.prepare('UPDATE visual_references SET image_url=? WHERE id=? AND project_id=?').run(asset.url,referenceId,projectId);
  return asset;
}

/** Select a stored identity asset without creating or deleting an image. */
export function activateVisualReferenceAsset(projectId: string, target: 'style' | ReferenceType, referenceId: string | undefined, assetId: string) {
  const ownerType = target === 'style' ? 'style' as const : 'reference' as const;
  const ownerId = target === 'style' ? projectId : referenceId!;
  if (target !== 'style' && !db.prepare('SELECT id FROM visual_references WHERE id=? AND project_id=? AND type=?').get(referenceId, projectId, target)) return null;
  const asset = activateAsset(projectId, ownerType, ownerId, assetId);
  if (!asset) return null;
  if (target === 'style') {
    db.prepare('UPDATE visual_identities SET style_image_url=? WHERE project_id=?').run(asset.url, projectId);
  } else {
    db.prepare('UPDATE visual_references SET image_url=? WHERE id=? AND project_id=? AND type=?').run(asset.url, referenceId, projectId, target);
  }
  return asset;
}

/** Hide the current image while retaining every stored version for later reuse. */
export function clearVisualReferenceImage(projectId: string, target: 'style' | ReferenceType, referenceId?: string) {
  const ownerType = target === 'style' ? 'style' as const : 'reference' as const;
  const ownerId = target === 'style' ? projectId : referenceId!;
  if (target === 'style') {
    const style = db.prepare('SELECT style_locked FROM visual_identities WHERE project_id=?').get(projectId) as any;
    if (!style) return false;
    if (style.style_locked) throw new Error('Unlock the style reference before clearing its image.');
  } else {
    const reference = db.prepare('SELECT locked FROM visual_references WHERE id=? AND project_id=? AND type=?').get(referenceId, projectId, target) as any;
    if (!reference) return false;
    if (reference.locked) throw new Error('Unlock this reference before clearing its image.');
  }
  db.transaction(() => {
    db.prepare('UPDATE image_assets SET active=0 WHERE project_id=? AND owner_type=? AND owner_id=?').run(projectId, ownerType, ownerId);
    if (target === 'style') db.prepare('UPDATE visual_identities SET style_image_url=NULL WHERE project_id=?').run(projectId);
    else db.prepare('UPDATE visual_references SET image_url=NULL WHERE id=? AND project_id=? AND type=?').run(referenceId, projectId, target);
  })();
  return true;
}

/** Acknowledge that the current image intentionally matches the edited description. */
export function acknowledgeVisualReferenceImage(projectId: string, target: 'style' | ReferenceType, referenceId?: string) {
  if (target === 'style') {
    const style = db.prepare('SELECT style_description,style_image_url FROM visual_identities WHERE project_id=?').get(projectId) as any;
    if (!style || !style.style_image_url) return false;
    db.prepare('UPDATE visual_identities SET style_image_signature=? WHERE project_id=?').run(styleSignature(style.style_description), projectId);
    return true;
  }
  const reference = db.prepare('SELECT name,description,image_url FROM visual_references WHERE id=? AND project_id=? AND type=?').get(referenceId, projectId, target) as any;
  if (!reference || !reference.image_url) return false;
  db.prepare('UPDATE visual_references SET image_signature=? WHERE id=? AND project_id=? AND type=?').run(referenceSignature(reference.name, reference.description), referenceId, projectId, target);
  return true;
}
