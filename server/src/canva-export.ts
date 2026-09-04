import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { db } from './db.js';
import { getSelectedConcept, requireSelectedConceptId } from './visual-concepts.js';
import { getVisualIdentity } from './visual-identity.js';

const run = promisify(execFile);
const storageRoot = path.resolve('data', 'projects');
const safeName = (value: string, fallback = 'untitled') => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback;
const pad = (number: number) => String(number).padStart(3, '0');
const ext = (mime: string) => mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const time = (value: number | null) => value == null ? '' : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;

type ExportOptions = { images?: boolean; guide?: boolean; references?: boolean; lyrics?: boolean; sunoDescription?: boolean; alternatives?: boolean; platformArtwork?: boolean; platformVariants?: boolean };
type Asset = { id: string; storage_path: string; mime_type: string; version: number; original_filename: string | null };
const activeAsset = (ownerType: string, ownerId: string) => db.prepare('SELECT id,storage_path,mime_type,version,original_filename FROM image_assets WHERE owner_type=? AND owner_id=? AND active=1').get(ownerType, ownerId) as Asset | undefined;
const allAssets = (ownerType: string, ownerId: string) => db.prepare('SELECT id,storage_path,mime_type,version,original_filename FROM image_assets WHERE owner_type=? AND owner_id=? ORDER BY version').all(ownerType, ownerId) as Asset[];
// The storyboard's selected version is the active image generation. Asset.active
// normally mirrors it, but older projects can have retained assets without a
// matching generation row, so the generation selection is the source of truth.
const activeShotAsset = (shotId: string) => db.prepare(`SELECT a.id,a.storage_path,a.mime_type,a.version,a.original_filename
  FROM image_generations g JOIN image_assets a ON a.id=g.asset_id
  WHERE g.shot_id=? AND g.status='generated' AND g.active=1
  LIMIT 1`).get(shotId) as Asset | undefined;
function copyAsset(asset: Asset, target: string) { const source = path.join(storageRoot, asset.storage_path); if (fs.existsSync(source)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); return true; } return false; }

export function canvaExportSummary(projectId: string) {
  const conceptId=requireSelectedConceptId(projectId); const shots = db.prepare('SELECT id,image_url,approval_status FROM shots WHERE project_id=? AND concept_id=? ORDER BY position').all(projectId,conceptId) as any[];
  return { shots: shots.length, images: shots.filter(shot => Boolean(activeShotAsset(shot.id) || activeAsset('shot', shot.id))).length, missing: shots.filter(shot => !activeShotAsset(shot.id) && !activeAsset('shot', shot.id)).length, approved: shots.filter(shot => shot.approval_status === 'approved').length };
}

export async function buildCanvaExport(projectId: string, options: ExportOptions = {}) {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;
  if (!project) throw new Error('Project not found.');
  const include = { images: options.images !== false, guide: options.guide !== false, references: options.references !== false, lyrics: options.lyrics !== false, sunoDescription: options.sunoDescription !== false, alternatives: Boolean(options.alternatives), platformArtwork: options.platformArtwork !== false, platformVariants: Boolean(options.platformVariants) };
  const concept = getSelectedConcept(projectId); if(!concept) throw new Error('Select a visual concept before exporting.'); const conceptId=concept.id, identity = getVisualIdentity(projectId,conceptId);
  const shots = db.prepare('SELECT * FROM shots WHERE project_id=? AND concept_id=? ORDER BY position').all(projectId,conceptId) as any[];
  const characters = new Map(identity.characters.map(item => [item.id, item])); const locations = new Map(identity.locations.map(item => [item.id, item]));
  const summary = canvaExportSummary(projectId), rootName = `${safeName(project.title)}-canva-export`, temp = fs.mkdtempSync(path.join(os.tmpdir(), 'canva-export-'));
  const root = path.join(temp, rootName), imageDir = path.join(root, '01-storyboard-images'), infoDir = path.join(root, '03-project-info'); fs.mkdirSync(root, { recursive: true });
  const imagePaths = new Map<string, string>();
  for (const shot of shots) {
    const asset = activeShotAsset(shot.id) || activeAsset('shot', shot.id); if (!asset) continue;
    const relative = `01-storyboard-images/${pad(shot.position)}-${safeName(shot.title, 'shot')}.${ext(asset.mime_type)}`;
    if (include.images && copyAsset(asset, path.join(root, relative))) imagePaths.set(shot.id, relative);
    if (include.alternatives) for (const alternative of allAssets('shot', shot.id).filter(item => item.id !== asset.id)) copyAsset(alternative, path.join(root, '04-alternatives', `shot-${pad(shot.position)}`, `version-${String(alternative.version).padStart(2, '0')}.${ext(alternative.mime_type)}`));
  }
  // Artwork is exported separately from storyboard masters. Only the active
  // version is included by default, so a standard Canva handoff stays small.
  const artworkRows = db.prepare('SELECT id,platform,active_asset_id FROM project_artwork WHERE project_id=? AND concept_id=?').all(projectId,conceptId) as any[];
  const artworkPaths: any[] = [];
  if (include.platformArtwork) for (const artwork of artworkRows) {
    const asset = artwork.active_asset_id ? (db.prepare('SELECT id,storage_path,mime_type,version,original_filename FROM image_assets WHERE id=?').get(artwork.active_asset_id) as Asset | undefined) : activeAsset('artwork', artwork.id);
    if (!asset) continue;
    const filename = artwork.platform === 'youtube' ? 'thumbnail' : artwork.platform === 'spotify' ? 'canvas-reference' : 'cover';
    const relative = `05-platform-artwork/${artwork.platform}/${filename}.${ext(asset.mime_type)}`;
    if (copyAsset(asset, path.join(root,relative))) artworkPaths.push({ platform:artwork.platform, activeImage:relative });
    if (include.alternatives) for (const alternative of allAssets('artwork', artwork.id).filter(item=>item.id!==asset.id)) copyAsset(alternative,path.join(root,'04-alternatives','artwork-'+artwork.platform,`version-${String(alternative.version).padStart(2,'0')}.${ext(alternative.mime_type)}`));
  }
  const shotData = shots.map(shot => { const characterNames = JSON.parse(shot.character_ids || '[]').map((id: string) => characters.get(id)?.name).filter(Boolean); const location = shot.location_id ? locations.get(shot.location_id) : null; const hasImage = imagePaths.has(shot.id); const status = !hasImage ? 'MISSING' : shot.generation_status === 'needs_regeneration' ? 'NEEDS REGENERATION' : shot.approval_status === 'approved' ? 'APPROVED' : 'PENDING'; return { shot, characterNames, location, image: imagePaths.get(shot.id) ?? null, status }; });
  const visualText = `VISUAL IDENTITY\n\nSTYLE\n${identity.style.description || 'Not specified'}\n${identity.style.image_url ? 'Reference: style/visual-style image' : ''}\n\nCHARACTERS\n\n${identity.characters.map(item => `${item.name}\nDescription:\n${item.description}\n${item.image_url ? `Reference: characters/${safeName(item.name)} image` : ''}`).join('\n\n') || 'None'}\n\nLOCATIONS\n\n${identity.locations.map(item => `${item.name}\nDescription:\n${item.description}\n${item.image_url ? `Reference: locations/${safeName(item.name)} image` : ''}`).join('\n\n') || 'None'}\n`;
  const conceptText = concept ? `CONCEPT\n\nTitle:\n${concept.title}\n\nDescription:\n${concept.description}\n\nMood:\n${concept.mood}\n\nVisual Style:\n${concept.visualStyle}\n\nColor and Lighting:\n${concept.colorAndLighting}\n\nNarrative Direction:\n${concept.narrativeDirection}\n` : '';
  const readme = `${project.title}\nCanva Export\n\nHOW TO USE\n\n1. Open the "01-storyboard-images" folder.\n2. Upload those images to Canva.\n3. The filenames are numbered in storyboard order.\n4. Use storyboard.html or storyboard.csv to see shot descriptions and timing.\n5. Reference images are available in "02-reference-images".\n\nPROJECT\n\nConcept:\n${concept?.title || 'Not selected'}\n\nVisual style:\n${identity.style.description || project.visual_style || 'Not specified'}\n\nStoryboard approach:\n${project.storyboard_approach || 'Mixed'}\n\nShots: ${summary.shots}\nImages: ${summary.images}\nMissing: ${summary.missing}\nApproved: ${summary.approved}\n`;
  fs.writeFileSync(path.join(root, 'README.txt'), readme);
  if (include.guide) {
    const columns = ['shot_number','image_filename','title','start_time','end_time','section','description','action','shot_type','camera','mood','characters','location','status'];
    fs.writeFileSync(path.join(root, 'storyboard.csv'), [columns.join(','), ...shotData.map(({ shot, characterNames, location, image, status }) => [pad(shot.position), image || 'MISSING IMAGE', shot.title, time(shot.start_seconds), time(shot.end_seconds), shot.section, shot.description, shot.action, shot.shot_type, shot.camera, shot.mood, characterNames.join(', '), location?.name || '', status].map(csv).join(','))].join('\n'));
    const cards = shotData.map(({ shot, characterNames, location, image, status }) => `<article class="shot"><h2>SHOT ${pad(shot.position)}</h2>${image ? `<img src="${html(image)}" alt="${html(shot.title)}">` : '<div class="missing">MISSING IMAGE</div>'}<dl><dt>Title</dt><dd>${html(shot.title)}</dd><dt>Timing</dt><dd>${time(shot.start_seconds) && time(shot.end_seconds) ? `${time(shot.start_seconds)}–${time(shot.end_seconds)}` : `Order: ${shot.position}`}</dd><dt>Status</dt><dd class="status">${html(status)}</dd><dt>Description</dt><dd>${html(shot.description)}</dd><dt>Action</dt><dd>${html(shot.action)}</dd><dt>Shot</dt><dd>${html(shot.shot_type)}</dd><dt>Camera</dt><dd>${html(shot.camera)}</dd><dt>Mood</dt><dd>${html(shot.mood)}</dd><dt>Characters</dt><dd>${html(characterNames.join(', ') || 'None')}</dd><dt>Location</dt><dd>${html(location?.name || 'None')}</dd></dl></article>`).join('');
    fs.writeFileSync(path.join(root, 'storyboard.html'), `<!doctype html><html><head><meta charset="utf-8"><title>${html(project.title)} storyboard</title><style>body{font:15px system-ui,sans-serif;color:#202020;margin:28px;background:#fafafa}header{max-width:1200px;margin:auto}h1{margin-bottom:4px}.sub{color:#666}.grid{max-width:1200px;margin:24px auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:18px}.shot{background:#fff;border:1px solid #ddd;border-radius:10px;overflow:hidden;padding:16px;break-inside:avoid}.shot h2{font-size:13px;letter-spacing:.08em;color:#666;margin:0 0 12px}.shot img,.missing{width:100%;aspect-ratio:16/9;object-fit:cover;background:#eee;display:grid;place-items:center;color:#9b3d31;font-weight:700;margin-bottom:14px}.missing{border:1px dashed #b98b84}dl{margin:0;display:grid;gap:4px}dt{font-size:11px;text-transform:uppercase;color:#777;margin-top:8px;font-weight:700}dd{margin:0;line-height:1.45}.status{font-weight:800;color:#22633c}@media print{body{margin:12px}.grid{grid-template-columns:repeat(2,1fr);gap:10px}.shot{padding:10px}}</style></head><body><header><h1>${html(project.title)}</h1><p class="sub">Storyboard · ${summary.shots} shots · ${summary.images} images · ${summary.approved} approved</p></header><section class="grid">${cards}</section></body></html>`);
  }
  fs.mkdirSync(infoDir, { recursive: true }); if (conceptText) fs.writeFileSync(path.join(infoDir, 'concept.txt'), conceptText); fs.writeFileSync(path.join(infoDir, 'visual-identity.txt'), visualText);
  if (include.lyrics && project.lyrics?.trim()) fs.writeFileSync(path.join(infoDir, 'lyrics.txt'), project.lyrics);
  if (include.sunoDescription && project.suno_description?.trim()) fs.writeFileSync(path.join(infoDir, 'suno-description.txt'), project.suno_description);
  const referenceAssets: any[] = [];
  if (include.references) {
    const copyReference = (asset: Asset | undefined, folder: string, name: string, kind: string) => { if (!asset) return null; const relative = `02-reference-images/${folder}/${safeName(name)}.${ext(asset.mime_type)}`; return copyAsset(asset, path.join(root, relative)) ? (referenceAssets.push({ kind, name, path: relative }), relative) : null; };
    copyReference(activeAsset('style',conceptId),'style','visual-style','style'); identity.characters.forEach(item => copyReference(activeAsset('reference', item.id), 'characters', item.name, 'character')); identity.locations.forEach(item => copyReference(activeAsset('reference', item.id), 'locations', item.name, 'location'));
  }
  const manifest = { exportVersion: 1, project: { title: project.title, aspectRatio: project.aspect_ratio, storyboardApproach: project.storyboard_approach, publishingTargets: JSON.parse(project.publishing_targets || '[]'), primaryVisualFormat:project.primary_visual_format }, selectedConcept: concept, visualIdentity: { style: identity.style.description, characters: identity.characters.map(item => ({ id: item.id, name: item.name, description: item.description })), locations: identity.locations.map(item => ({ id: item.id, name: item.name, description: item.description })) }, storyboard: { shots: summary.shots }, platformArtwork: artworkPaths, shots: shotData.map(({ shot, characterNames, location, image, status }) => ({ order: shot.position, title: shot.title, timing: { start: shot.start_seconds, end: shot.end_seconds }, activeImage: image, approvalStatus: shot.approval_status, status, characterNames, characterIds: JSON.parse(shot.character_ids || '[]'), location: location ? { id: location.id, name: location.name } : null, section: shot.section, description: shot.description, action: shot.action, shotType: shot.shot_type, camera: shot.camera, mood: shot.mood })), referenceAssets };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2)); fs.writeFileSync(path.join(infoDir, 'project.json'), JSON.stringify({ project: manifest.project, selectedConcept: concept, visualIdentity: manifest.visualIdentity }, null, 2));
  const archive = path.join(temp, `${rootName}.zip`); await run('zip', ['-qr', archive, rootName], { cwd: temp }); return { archive, filename: `${rootName}.zip`, cleanup: () => fs.rmSync(temp, { recursive: true, force: true }) };
}
