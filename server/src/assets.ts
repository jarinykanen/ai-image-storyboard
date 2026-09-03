import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';

export const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;
const storageRoot = path.resolve('data', 'projects');
const supported = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);

export type AssetOwnerType = 'concept' | 'reference' | 'style' | 'shot' | 'artwork';
export type AssetSource = 'generated' | 'uploaded';
export type ImageAsset = { id:string; projectId:string; ownerType:AssetOwnerType; ownerId:string; source:AssetSource; url:string; originalFilename:string|null; mimeType:string; fileSize:number; version:number; active:boolean; provider:string|null; model:string|null; quality:string|null; resolution:string|null; tier:string|null; stale:boolean; createdAt:string };

function safeName(value: string) { return value.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'image'; }
function extensionFor(mime: string, filename?: string) {
  const configured = supported.get(mime); if (!configured) return null;
  const supplied = filename?.split('.').pop()?.toLowerCase();
  return supplied && ['jpg', 'jpeg', 'png', 'webp'].includes(supplied) ? supplied : configured;
}
function detectedMime(data: Buffer) { if(data.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))) return 'image/jpeg'; if(data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png'; if(data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WEBP') return 'image/webp'; return null; }
function folder(ownerType: AssetOwnerType) { return ({ concept: 'concepts', reference: 'references', style: 'style', shot: 'storyboard', artwork: 'artwork' } as const)[ownerType]; }
const assetUrl = (id:string) => `${process.env.ASSET_BASE_URL || 'http://localhost:3001'}/assets/${id}`;
function asAsset(row: any): ImageAsset { return { id:row.id, projectId:row.project_id, ownerType:row.owner_type, ownerId:row.owner_id, source:row.source, url:assetUrl(row.id), originalFilename:row.original_filename ?? null, mimeType:row.mime_type, fileSize:row.file_size, version:row.version, active:Boolean(row.active), provider:row.provider ?? null, model:row.model ?? null, quality:row.quality ?? null, resolution:row.resolution ?? null, tier:row.source === 'uploaded' ? null : row.tier ?? (row.quality === 'best' ? 'FINAL' : row.quality === 'draft' ? 'DRAFT' : 'STANDARD'), stale:Boolean(row.stale), createdAt:row.created_at }; }
export function listAssets(ownerType: AssetOwnerType, ownerId: string) { return (db.prepare('SELECT * FROM image_assets WHERE owner_type=? AND owner_id=? ORDER BY version DESC').all(ownerType, ownerId) as any[]).map(asAsset); }
export function activeAsset(ownerType: AssetOwnerType, ownerId: string) { const row = db.prepare('SELECT * FROM image_assets WHERE owner_type=? AND owner_id=? AND active=1').get(ownerType, ownerId) as any; return row ? asAsset(row) : null; }

function addAsset(input: { projectId:string; ownerType:AssetOwnerType; ownerId:string; source:AssetSource; data:Buffer; mimeType:string; originalFilename?:string; provider?:string; model?:string; quality?:string; resolution?:string; tier?:string }) {
  const actualMime = detectedMime(input.data); if (!actualMime || !supported.has(input.mimeType)) throw new Error('Upload a valid JPEG, PNG, or WebP image.');
  const extension = extensionFor(actualMime, input.originalFilename)!;
  if (!input.data.length || input.data.length > MAX_IMAGE_UPLOAD_BYTES) throw new Error(`Images must be no larger than ${MAX_IMAGE_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const id = crypto.randomUUID(); const version = (db.prepare('SELECT COALESCE(MAX(version),0)+1 version FROM image_assets WHERE owner_type=? AND owner_id=?').get(input.ownerType, input.ownerId) as any).version;
  const relativePath = path.join(input.projectId, folder(input.ownerType), `${id}.${extension}`); const destination = path.join(storageRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive:true }); fs.writeFileSync(destination, input.data, { flag:'wx' });
  try { db.transaction(() => { db.prepare('UPDATE image_assets SET active=0 WHERE owner_type=? AND owner_id=?').run(input.ownerType, input.ownerId); db.prepare(`INSERT INTO image_assets (id,project_id,owner_type,owner_id,source,storage_path,original_filename,mime_type,file_size,version,active,provider,model,quality,resolution,tier,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,input.projectId,input.ownerType,input.ownerId,input.source,relativePath,input.originalFilename ? safeName(input.originalFilename) : null,input.mimeType,input.data.length,version,1,input.provider ?? null,input.model ?? null,input.quality ?? null,input.resolution ?? null,input.source === 'uploaded' ? null : input.tier ?? null,new Date().toISOString()); })(); }
  catch (error) { fs.unlinkSync(destination); throw error; }
  return activeAsset(input.ownerType, input.ownerId)!;
}
export function createUploadedAsset(input: Omit<Parameters<typeof addAsset>[0], 'source'>) { return addAsset({ ...input, source:'uploaded' }); }
export async function createGeneratedAsset(input: Omit<Parameters<typeof addAsset>[0], 'source'|'data'|'mimeType'> & { url:string }) {
  let data: Buffer; let mimeType = 'image/png';
  if (input.url.startsWith('data:image/')) { const match = /^data:([^;]+);base64,(.+)$/s.exec(input.url); if (!match) throw new Error('The image provider returned an invalid image.'); mimeType=match[1]; data=Buffer.from(match[2], 'base64'); }
  else { const response = await fetch(input.url); if (!response.ok) throw new Error('Could not save the generated image.'); mimeType=response.headers.get('content-type')?.split(';')[0] || mimeType; data=Buffer.from(await response.arrayBuffer()); }
  return addAsset({ ...input, source:'generated', data, mimeType, originalFilename: input.originalFilename || 'generated-image.png' });
}
export function activateAsset(projectId:string, ownerType:AssetOwnerType, ownerId:string, assetId:string) { const asset=db.prepare('SELECT * FROM image_assets WHERE id=? AND project_id=? AND owner_type=? AND owner_id=?').get(assetId,projectId,ownerType,ownerId) as any; if(!asset)return null; db.transaction(()=>{db.prepare('UPDATE image_assets SET active=0 WHERE owner_type=? AND owner_id=?').run(ownerType,ownerId);db.prepare('UPDATE image_assets SET active=1 WHERE id=?').run(assetId);})(); return asAsset(asset); }
export function findAsset(id:string) { const row=db.prepare('SELECT * FROM image_assets WHERE id=?').get(id) as any; return row ? { ...asAsset(row), storagePath:path.join(storageRoot,row.storage_path) } : null; }
