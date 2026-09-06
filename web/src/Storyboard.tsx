import { Alert, Button, Checkbox, Group, Menu, Modal, MultiSelect, NumberInput, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import React, { useEffect, useMemo, useState } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { ImageGenerationModal, type ImageQuality } from './ImageGenerationModal';
import { StoryboardGenerationModal } from './StoryboardGenerationModal';
import { ShotRegenerationModal } from './ShotRegenerationModal';
import type { VisualIdentityData } from './VisualIdentity';
import './storyboard.css';
type Generation = {
    id: string;
    assetId: string | null;
    assetUrl: string | null;
    source: 'generated' | 'uploaded';
    status: string;
    version: number;
    active: boolean;
    approved: boolean;
    provider: string;
    model: string;
    quality: string;
    resolution: string;
    tier: 'DRAFT' | 'STANDARD' | 'FINAL' | null;
    stale: boolean;
};
export type StoryboardShot = {
    id: string;
    order: number;
    startTime: number | null;
    endTime: number | null;
    section: string;
    title: string;
    description: string;
    action: string;
    shotType: string;
    camera: string;
    mood: string;
    characterIds: string[];
    locationId: string | null;
    imageUrl: string | null;
    generationStatus: string;
    approvalStatus: string;
    generations: Generation[];
    referencePreview: {
        id: string;
        name: string;
        description: string;
        image_url: string | null;
    }[];
};
export type StoryboardReview = {
    id: string;
    createdAt: string;
    summary: string;
    score: number | null;
    stale: boolean;
    issues: {
        id: string;
        severity: 'info' | 'warning' | 'important';
        category: string;
        title: string;
        description: string;
        shotIds: string[];
        suggestion: string;
        status: 'open' | 'resolved' | 'ignored';
    }[];
};
type BatchStatus = {
    id: string;
    status: string;
    total: number;
    completed: number;
    failed: number;
    currentlyGenerating: number;
};
const API = 'http://localhost:3001/api';
const qualityFor = (generation?: Generation): ImageQuality => generation?.tier === 'FINAL' ? 'best' : generation?.tier === 'STANDARD' ? 'standard' : 'draft';
const tierLabel = (generation?: Generation) => generation?.source === 'uploaded' ? 'UPLOADED' : `${generation?.tier ?? 'STANDARD'}${generation?.tier === 'FINAL' && generation.stale ? ' · STALE' : ''}`;
async function request(path: string, method: string, body?: unknown) { const r = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok)
    throw new Error((await r.json().catch(() => ({}))).error || 'Something went wrong.'); return r.json(); }
async function upload(path: string, file: File) { const f = new FormData(); f.append('image', file); const r = await fetch(`${API}${path}`, { method: 'POST', body: f }); if (!r.ok)
    throw new Error((await r.json().catch(() => ({}))).error || 'Could not upload image.'); return r.json(); }
function StoryboardImportModal({ opened, currentShotCount, loading, prompt, promptLoading, onClose, onCopyPrompt, onImport }: { opened: boolean; currentShotCount: number; loading: boolean; prompt: string; promptLoading: boolean; onClose: () => void; onCopyPrompt: () => void; onImport: (source: string) => void }) {
    const [source, setSource] = useState('');
    useEffect(() => { if (opened) setSource(''); }, [opened]);
    const replacing = currentShotCount > 0;
    return <Modal opened={opened} onClose={() => { if (!loading) onClose(); }} title="Import storyboard from another AI" size="xl" centered closeOnClickOutside={!loading} closeOnEscape={!loading}>
      <Stack gap="lg">
        <div><Text fw={600}>1. Copy the ready-made prompt</Text><Text size="sm" c="dimmed">It gives another AI the project context and the exact shot information needed for a clean import.</Text></div>
        <Textarea aria-label="Storyboard prompt" value={prompt} readOnly autosize minRows={8} maxRows={14} placeholder={promptLoading ? 'Preparing prompt…' : 'Prompt unavailable'}/>
        <Group justify="space-between"><Text size="sm" c="dimmed">Copying this prompt does not generate anything in the studio.</Text><Button variant="default" loading={promptLoading} disabled={!prompt || loading} onClick={onCopyPrompt}>Copy prompt</Button></Group>
        <div><Text fw={600}>2. Paste the complete response</Text><Text size="sm" c="dimmed">Paste prose, Markdown, lists, JSON, or mixed AI output. We’ll organize it into editable shots. This does not generate images.</Text></div>
        {replacing && <Alert color="red" title="Your current storyboard will be replaced">Importing will remove {currentShotCount} current shot{currentShotCount === 1 ? '' : 's'}, including their edits, approvals, and image versions. This cannot be undone.</Alert>}
        <Textarea label="AI response" value={source} onChange={event => setSource(event.currentTarget.value)} autosize minRows={10} maxRows={18} placeholder="Paste the complete response from another AI here…" disabled={loading}/>
        <Group justify="flex-end"><Button variant="default" disabled={loading} onClick={onClose}>Cancel</Button><Button color={replacing ? 'red' : undefined} loading={loading} disabled={!source.trim()} onClick={() => onImport(source)}>{loading ? 'Analyzing storyboard…' : replacing ? `Import and replace ${currentShotCount} shots` : 'Import storyboard'}</Button></Group>
      </Stack>
    </Modal>;
}
function Detail({ shot, shots, identity, projectId, defaultQuality, busy, run, go, close }: {
    shot: StoryboardShot;
    shots: StoryboardShot[];
    identity: VisualIdentityData;
    projectId: string;
    defaultQuality: ImageQuality;
    busy: boolean;
    run: (f: () => Promise<unknown>) => Promise<boolean>;
    go: (id: string) => void;
    close: () => void;
}) { const [editing, setEditing] = useState(false), [compare, setCompare] = useState(false), [deleteGeneration, setDeleteGeneration] = useState<Generation | null>(null), [confirmShotDelete, setConfirmShotDelete] = useState(false), [confirmShotRegeneration, setConfirmShotRegeneration] = useState(false), [confirmImageGeneration, setConfirmImageGeneration] = useState(false), [confirmFinal, setConfirmFinal] = useState(false), [variantDialog, setVariantDialog] = useState(false), [variantCount, setVariantCount] = useState('3'), [refineAssetId, setRefineAssetId] = useState<string | null>(null), [refineInstruction, setRefineInstruction] = useState(''), [version, setVersion] = useState(0), [form, setForm] = useState({ title: shot.title, section: shot.section, description: shot.description, action: shot.action, shotType: shot.shotType, camera: shot.camera, mood: shot.mood, characterIds: shot.characterIds, locationId: shot.locationId }); useEffect(() => { setEditing(false); setCompare(false); setConfirmShotDelete(false); setConfirmShotRegeneration(false); setConfirmImageGeneration(false); setConfirmFinal(false); setVariantDialog(false); setRefineAssetId(null); setRefineInstruction(''); setVersion(Math.max(0, shot.generations.findIndex(g => g.active))); setForm({ title: shot.title, section: shot.section, description: shot.description, action: shot.action, shotType: shot.shotType, camera: shot.camera, mood: shot.mood, characterIds: shot.characterIds, locationId: shot.locationId }); }, [shot]); const index = shots.findIndex(s => s.id === shot.id), image = shot.generations[version], activeImage = shot.generations.find(g => g.active), generated = shot.generations.filter(g => g.status === 'generated'), needsFinal = shot.approvalStatus === 'approved' && (!activeImage || activeImage.source === 'uploaded' || activeImage.tier !== 'FINAL' || activeImage.stale); const variants = () => setVariantDialog(true); const remove = (g: Generation) => setDeleteGeneration(g); const actions = (g: Generation) => <>{!g.active && <button className="secondary" disabled={busy} onClick={() => void run(() => request(`/projects/${projectId}/shots/${shot.id}/generations/${g.id}/use`, 'POST', {}))}>Set as active</button>}{g.assetId && <a className="button secondary" href={`${API}/assets/${g.assetId}/download`}>Download</a>}<button className="secondary" disabled={busy} onClick={() => remove(g)}>Delete</button>
</>; return <>
<section className="review-view">
<div className="review-toolbar">
<button className="secondary" onClick={close}>← Overview</button>
<div>
<button className="secondary" disabled={index === 0} onClick={() => go(shots[index - 1].id)}>Previous shot</button> <button className="secondary" disabled={index === shots.length - 1} onClick={() => go(shots[index + 1].id)}>Next shot</button>
</div>
</div>{compare ? <div>
<button className="secondary" onClick={() => setCompare(false)}>← Shot details</button>
<div className="comparison-grid">{generated.map(g => <article className="comparison-image" key={g.id}>
<img src={g.assetUrl || ''} alt={`Version ${g.version}`}/>
<small>Version {g.version} · {tierLabel(g)}{g.active ? ' · ACTIVE' : ''} · {g.model} · {g.resolution}</small>
<div>{actions(g)}</div>
</article>)}</div>
</div> : <div className="review-layout">
<div>
<div className="review-image">{(image?.assetUrl || shot.imageUrl) ? <img src={image?.assetUrl || shot.imageUrl || ''} alt={shot.title}/> : <span>No image yet</span>}</div>{generated.length > 0 && <>
<div className="version-thumbnails">
<strong>Versions ({shot.generations.length})</strong>{generated.map(g => <button key={g.id} className={shot.generations.indexOf(g) === version ? 'selected-version' : 'secondary'} onClick={() => setVersion(shot.generations.indexOf(g))}>
<img src={g.assetUrl || ''} alt={`Version ${g.version}`}/>
</button>)}</div>
<div className="version-picker">
<span>Version {image?.version} · {tierLabel(image)}{image?.active ? ' · ACTIVE' : ''}{image?.approved ? ' · APPROVED' : ''}{image?.source === 'generated' ? ` · ${image.model} · ${image.resolution}` : ''}</span>{image && actions(image)}</div>
</>}</div>
<div className="review-details">
<small>Shot {shot.order} · {shot.section}</small>
<h2>{shot.title}</h2>{editing ? <div className="shot-form">
<div className="row">
<TextInput label="Title" value={form.title} onChange={event => setForm({ ...form, title: event.currentTarget.value })}/>
<TextInput label="Section" value={form.section} onChange={event => setForm({ ...form, section: event.currentTarget.value })}/>
</div>
<label>Description<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/>
</label>
<label>Action<textarea value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}/>
</label>
<div className="row">
<label>Shot type<input value={form.shotType} onChange={e => setForm({ ...form, shotType: e.target.value })}/>
</label>
<label>Camera / framing<input value={form.camera} onChange={e => setForm({ ...form, camera: e.target.value })}/>
</label>
</div>
<label>Mood<input value={form.mood} onChange={e => setForm({ ...form, mood: e.target.value })}/>
</label>
<MultiSelect
label="Characters"
description="Choose every character that appears in this shot. Their references will be used when generating the image."
placeholder="Choose characters"
data={identity.characters.map(item => ({ value: item.id, label: item.name }))}
value={form.characterIds}
onChange={characterIds => setForm({ ...form, characterIds })}
clearable
searchable
/>
<label>Location<select value={form.locationId ?? ''} onChange={e => setForm({ ...form, locationId: e.target.value || null })}>
<option value="">No location</option>{identity.locations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
</label>
<div className="card-actions">
<button disabled={busy} onClick={() => { void run(() => request(`/projects/${projectId}/shots/${shot.id}`, 'PUT', form)); setEditing(false); }}>Save changes</button>
<button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
<Button color="red" variant="light" disabled={busy} onClick={() => setConfirmShotDelete(true)}>Delete shot</Button>
</div>
</div> : <>
<p>{shot.description}</p>
<dl>
<dt>Action</dt>
<dd>{shot.action}</dd>
<dt>Composition</dt>
<dd>{shot.shotType} · {shot.camera}</dd>
<dt>Mood</dt>
<dd>{shot.mood}</dd>
</dl>
<div className="card-actions">
<button className="secondary" disabled={busy} onClick={() => setConfirmImageGeneration(true)}>{shot.imageUrl ? 'Regenerate' : 'Generate'}</button>
<button className="secondary" disabled={busy} onClick={variants}>Generate variants</button>{shot.generations.length > 1 && <button className="secondary" onClick={() => setCompare(true)}>Compare</button>}<button disabled={busy || !shot.imageUrl || shot.approvalStatus === 'approved'} onClick={() => void run(() => request(`/projects/${projectId}/shots/${shot.id}/approve`, 'POST', {}))}>{shot.approvalStatus === 'approved' ? 'Approved' : 'Approve'}</button>
{needsFinal && <button disabled={busy} onClick={() => setConfirmFinal(true)}>Render final</button>}
<button className="secondary" disabled={busy} onClick={() => setConfirmShotRegeneration(true)}>Regenerate shot details</button>
<button className="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit shot</button>
<label className="button secondary upload-button">Upload<input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file)
    void run(() => upload(`/projects/${projectId}/shots/${shot.id}/upload`, file)); e.currentTarget.value = ''; }}/>
</label>{image?.assetId && <button className="secondary" disabled={busy} onClick={() => { setRefineInstruction(''); setRefineAssetId(image.assetId); }}>Refine</button>}<Button color="red" variant="light" disabled={busy} onClick={() => setConfirmShotDelete(true)}>Delete shot</Button></div><small>Already have an image from ChatGPT, Grok, or another tool? Upload it here instead.</small>
</>}</div>
</div>}</section>
<ShotRegenerationModal opened={confirmShotRegeneration} shotTitle={shot.title} loading={busy} onCancel={() => setConfirmShotRegeneration(false)} onConfirm={detailLevel => void run(() => request(`/projects/${projectId}/shots/${shot.id}/regenerate`, 'POST', { detailLevel })).finally(() => setConfirmShotRegeneration(false))}/>
<ImageGenerationModal opened={confirmImageGeneration} projectId={projectId} imageCount={1} shotIds={[shot.id]} defaultQuality={shot.imageUrl ? qualityFor(activeImage) : defaultQuality} title={shot.imageUrl ? 'Regenerate shot image?' : 'Generate shot image?'} message="Generate 1 storyboard image? This is a paid generation action." confirmLabel={shot.imageUrl ? 'Regenerate 1 image' : 'Generate 1 image'} loading={busy} onCancel={() => setConfirmImageGeneration(false)} onConfirm={qualityPreset => void run(() => request(`/projects/${projectId}/shots/${shot.id}/generate-image`, 'POST', { qualityPreset })).finally(() => setConfirmImageGeneration(false))}/>
<ImageGenerationModal opened={variantDialog} projectId={projectId} imageCount={Number(variantCount)} shotIds={[shot.id]} defaultQuality="draft" title="Generate shot variants?" message={`Generate ${variantCount} storyboard images? Variants start in Draft to keep iteration inexpensive.`} confirmLabel={`Generate ${variantCount} images`} loading={busy} onCancel={() => setVariantDialog(false)} onConfirm={qualityPreset => void run(() => request(`/projects/${projectId}/shots/${shot.id}/generate-variants`, 'POST', { count: Number(variantCount), qualityPreset })).finally(() => setVariantDialog(false))}>
<Select label="Number of variants" value={variantCount} onChange={value => setVariantCount(value || '3')} data={['2', '3', '4']} allowDeselect={false}/>
</ImageGenerationModal>
<ImageGenerationModal opened={confirmFinal} projectId={projectId} imageCount={1} shotIds={[shot.id]} defaultQuality="best" fixedQuality title="Render final image?" message="Render 1 Final image as a new version? The current version will be preserved." confirmLabel="Render final" loading={busy} onCancel={() => setConfirmFinal(false)} onConfirm={() => void run(() => request(`/projects/${projectId}/shots/${shot.id}/render-final`, 'POST', {})).finally(() => setConfirmFinal(false))}/>
<ImageGenerationModal opened={refineAssetId !== null} projectId={projectId} imageCount={1} shotIds={[shot.id]} defaultQuality={qualityFor(image)} title="Refine image" message="Generate 1 refined version at the current tier? This is a paid generation action." confirmLabel="Generate refined image" loading={busy} confirmDisabled={!refineInstruction.trim()} onCancel={() => setRefineAssetId(null)} onConfirm={qualityPreset => { if (refineAssetId)
    void run(() => request(`/projects/${projectId}/shots/${shot.id}/refine`, 'POST', { assetId: refineAssetId, instruction: refineInstruction.trim(), qualityPreset })).finally(() => setRefineAssetId(null)); }}>
<Textarea label="What should change?" placeholder="Describe the changes you want" minRows={4} value={refineInstruction} onChange={event => setRefineInstruction(event.target.value)} autoFocus/>
</ImageGenerationModal>
<ConfirmModal opened={!!deleteGeneration} title="Delete image version?" message={deleteGeneration ? "Delete version " + deleteGeneration.version + "? This cannot be undone." : ""} confirmLabel="Delete" confirmColor="red" loading={busy} onCancel={() => setDeleteGeneration(null)} onConfirm={() => { if (deleteGeneration)
    void run(() => request("/projects/" + projectId + "/shots/" + shot.id + "/generations/" + deleteGeneration.id, "DELETE")).finally(() => setDeleteGeneration(null)); }}/>
<ConfirmModal opened={confirmShotDelete} title="Delete shot?" message={`Delete shot ${shot.order}, “${shot.title}”, and all of its image versions? This cannot be undone.`} confirmLabel="Delete shot" confirmColor="red" loading={busy} onCancel={() => setConfirmShotDelete(false)} onConfirm={() => void run(() => request(`/projects/${projectId}/shots/${shot.id}`, 'DELETE')).then(deleted => { if (deleted) close(); })}/>
</>; }
function CanvaExportDialog({ projectId, shots, onClose }: {
    projectId: string;
    shots: StoryboardShot[];
    onClose: () => void;
}) { const [busy, setBusy] = useState(false), [error, setError] = useState(''), [settings, setSettings] = useState({ images: true, guide: true, references: true, lyrics: true, sunoDescription: true, alternatives: false }); const images = shots.filter(s => s.imageUrl).length, missing = shots.length - images, approved = shots.filter(s => s.approvalStatus === 'approved').length; const download = async () => { setBusy(true); try {
    const response = await fetch(`${API}/projects/${projectId}/canva-export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
    if (!response.ok)
        throw new Error((await response.json().catch(() => ({}))).error || 'Could not create the export.');
    const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
    link.href = url;
    link.download = 'canva-export.zip';
    link.click();
    URL.revokeObjectURL(url);
    onClose();
}
catch (e) {
    setError(e instanceof Error ? e.message : 'Could not create the export.');
}
finally {
    setBusy(false);
} }; return <div className="export-backdrop">
<section className="export-dialog">
<h2>Export for Canva</h2>
<p>Shots: {shots.length}<br />Images included: {images}<br />Missing images: {missing}<br />Approved: {approved}</p>{missing > 0 && <div className="export-warning">{missing} shot{missing === 1 ? ' has' : 's have'} no active image. They will be marked clearly in the storyboard guide.</div>}<div className="export-options">{[['images', 'Storyboard images'], ['guide', 'Storyboard guide'], ['references', 'Visual Identity references'], ['lyrics', 'Lyrics'], ['sunoDescription', 'SUNO description'], ['alternatives', 'Include alternative image versions']].map(([key, label]) => <label key={key}>
<input type="checkbox" checked={settings[key as keyof typeof settings]} onChange={e => setSettings({ ...settings, [key]: e.target.checked })}/>{label}</label>)}</div>{error && <div className="inline-error">{error}</div>}<div className="card-actions">
<button className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
<button disabled={busy} onClick={() => void download()}>{busy ? 'Preparing export…' : 'Export'}</button>
</div>
</section>
</div>; }
type ShotPlacement = 'start' | 'end' | 'before' | 'after';
function ShotInsertBar({ count, max, busy, onCountChange, onAdd }: {
    count: number;
    max: number;
    busy: boolean;
    onCountChange: (count: number) => void;
    onAdd: (placement: 'start' | 'end') => void;
}) { return <section className="shot-insert-bar" aria-label="Add shots">
<div>
<strong>Add blank shots</strong>
<small>Add details and generate images when you are ready.</small>
</div>
<NumberInput label="Number of shots" value={count} min={1} max={Math.max(1, max)} allowDecimal={false} allowNegative={false} clampBehavior="strict" disabled={busy || max === 0} onChange={value => onCountChange(typeof value === 'number' ? value : 1)}/>
<Button variant="default" disabled={busy || max === 0} onClick={() => onAdd('start')}>Add to beginning</Button>
<Button variant="default" disabled={busy || max === 0} onClick={() => onAdd('end')}>Add to end</Button>
</section>; }
function StoryboardShotCard({ shot, selected, busy, canAdd, projectId, run, onOpen, onSelect, onAdd }: {
    shot: StoryboardShot;
    selected: boolean;
    busy: boolean;
    canAdd: boolean;
    projectId: string;
    run: (f: () => Promise<unknown>) => Promise<boolean>;
    onOpen: () => void;
    onSelect: (selected: boolean) => void;
    onAdd: (placement: 'before' | 'after', shotId: string) => void;
}) { const [confirmDelete, setConfirmDelete] = useState(false); return <>
<article className={`storyboard-thumbnail${selected ? ' selected-shot' : ''}`} onClick={onOpen}>
<div onClick={event => event.stopPropagation()}><Menu shadow="md" width={190} position="bottom-end" withinPortal>
<Menu.Target><Button className="card-menu" variant="default" size="compact-xs" aria-label={`More actions for shot ${shot.order}`}>•••</Button></Menu.Target>
<Menu.Dropdown onClick={event => event.stopPropagation()}>
<Menu.Label>Add a blank shot</Menu.Label>
<Menu.Item disabled={busy || !canAdd} onClick={() => onAdd('before', shot.id)}>Add before</Menu.Item>
<Menu.Item disabled={busy || !canAdd} onClick={() => onAdd('after', shot.id)}>Add after</Menu.Item>
<Menu.Divider/>
<Menu.Item color="red" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete shot</Menu.Item>
</Menu.Dropdown>
</Menu></div>
<div className="thumbnail-image">{shot.imageUrl ? <img src={shot.imageUrl} alt=""/> : <span className="empty-image-icon">▱</span>}</div>
<div className="thumbnail-content">
<div onClick={event => event.stopPropagation()}><Checkbox label="Select" checked={selected} onChange={event => onSelect(event.currentTarget.checked)}/></div>
<small>Shot {shot.order} · {shot.section}</small>
<h3>{shot.title}</h3>
<p>{shot.description}</p>
</div>
</article>
<ConfirmModal opened={confirmDelete} title="Delete shot?" message={`Delete shot ${shot.order}, “${shot.title}”, and all of its image versions? This cannot be undone.`} confirmLabel="Delete shot" confirmColor="red" loading={busy} onCancel={() => setConfirmDelete(false)} onConfirm={() => void run(() => request(`/projects/${projectId}/shots/${shot.id}`, 'DELETE')).then(deleted => { if (deleted) setConfirmDelete(false); })}/>
</>; }
export function Storyboard({ projectId, shots, identity, review, defaultQuality, onRefresh }: {
    projectId: string;
    shots: StoryboardShot[];
    identity: VisualIdentityData;
    review: StoryboardReview | null;
    defaultQuality: ImageQuality;
    onRefresh: () => Promise<void>;
}) { const [busy, setBusy] = useState(false), [error, setError] = useState(''), [opened, setOpened] = useState<string | null>(null), [reviewOpen, setReviewOpen] = useState(false), [exportOpen, setExportOpen] = useState(false), [importOpen, setImportOpen] = useState(false), [importPrompt, setImportPrompt] = useState(''), [importPromptLoading, setImportPromptLoading] = useState(false), [selected, setSelected] = useState<string[]>([]), [generationSelection, setGenerationSelection] = useState<string[]>([]), [shotInsertCount, setShotInsertCount] = useState(1), [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null), [confirmation, setConfirmation] = useState<'storyboard' | 'review' | 'batch' | 'selected' | 'finals' | null>(null); const missing = useMemo(() => shots.filter(s => s.generationStatus !== 'generating' && !s.generations.some(generation => generation.active && generation.status === 'generated')), [shots]); const finalCandidates = useMemo(() => shots.filter(shot => { const active=shot.generations.find(generation=>generation.active&&generation.status==='generated'); return shot.approvalStatus==='approved' && shot.generationStatus!=='generating' && (!active || active.source==='uploaded' || active.tier!=='FINAL' || active.stale); }), [shots]); const approvedCount=shots.filter(shot=>shot.approvalStatus==='approved').length, currentFinals=shots.filter(shot=>{const active=shot.generations.find(generation=>generation.active&&generation.status==='generated');return active?.tier==='FINAL'&&!active.stale;}).length; const current = shots.find(s => s.id === opened), selectedShots = shots.filter(s => selected.includes(s.id)), generationShots = shots.filter(s => generationSelection.includes(s.id)), selectedWithImages = generationShots.filter(s => s.imageUrl).length, selectedGenerating = selectedShots.some(s => s.generationStatus === 'generating'), generationSelectionBusy = generationShots.some(s => s.generationStatus === 'generating'), allSelected = shots.length > 0 && shots.every(s => selected.includes(s.id)), batchRunning = !!batchStatus && !['completed', 'failed'].includes(batchStatus.status), actionBusy = busy || batchRunning, remainingShotCapacity = Math.max(0, 60 - shots.length), issues = review?.issues.filter(i => i.status === 'open') || [], important = issues.filter(i => i.severity === 'important').length, warnings = issues.filter(i => i.severity === 'warning').length; useEffect(() => setSelected(ids => ids.filter(id => shots.some(shot => shot.id === id))), [shots]); useEffect(() => setShotInsertCount(count => Math.max(1, Math.min(count, Math.max(1, remainingShotCapacity)))), [remainingShotCapacity]); useEffect(() => { if (!batchStatus || ['completed', 'failed'].includes(batchStatus.status)) return; const timer = window.setTimeout(async () => { try {
    const next = await request(`/projects/${projectId}/image-batches/${batchStatus.id}`, 'GET') as BatchStatus;
    setBatchStatus(next);
    await onRefresh();
}
catch (e) {
    setError(e instanceof Error ? e.message : 'Could not check image generation progress.');
} }, 1000); return () => window.clearTimeout(timer); }, [batchStatus, projectId, onRefresh]); const run = async (f: () => Promise<unknown>) => { setBusy(true); setError(''); try {
    await f();
    await onRefresh();
    return true;
}
catch (e) {
    setError(e instanceof Error ? e.message : 'Could not complete that action.');
    return false;
}
finally {
    setBusy(false);
} }; const addShots = (placement: ShotPlacement, referenceShotId?: string) => run(() => request(`/projects/${projectId}/shots`, 'POST', { placement, referenceShotId, count: placement === 'before' || placement === 'after' ? 1 : shotInsertCount })); const openStoryboardImport = async () => { setImportOpen(true); setImportPrompt(''); setImportPromptLoading(true); try { const result = await request(`/projects/${projectId}/storyboard/external-prompt`, 'GET') as { prompt: string }; setImportPrompt(result.prompt); } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare the storyboard prompt.'); } finally { setImportPromptLoading(false); } }; const copyStoryboardPrompt = async () => { try { await navigator.clipboard.writeText(importPrompt); } catch { setError('Could not copy the prompt. Select and copy it manually instead.'); } }; const reviewNow = () => setConfirmation('review'); if (current)
    return <main>
<Detail shot={current} shots={shots} identity={identity} projectId={projectId} defaultQuality={defaultQuality} busy={actionBusy} run={run} go={setOpened} close={() => setOpened(null)}/>{error && <div className="inline-error notice">{error}</div>}</main>; return <main>
<header>
<div>
<h1>Storyboard</h1>
<p>{shots.length ? `${shots.length} shots · Images generated: ${shots.filter(s => s.imageUrl).length} / ${shots.length}` : 'Build a consistent visual sequence.'}</p>{review && <div className="review-summary">
<strong>Consistency review</strong>
<span>{important} important · {warnings} warnings{review.stale ? ' · Storyboard changed' : ''}</span>
<button className="secondary" onClick={() => setReviewOpen(v => !v)}>Review issues</button>
</div>}</div>
<div className="actions">
<button disabled={busy} onClick={() => setConfirmation('storyboard')}>{shots.length ? 'Regenerate storyboard' : 'Generate storyboard'}</button><button className="secondary" disabled={actionBusy} onClick={() => void openStoryboardImport()}>Import storyboard</button>{shots.length > 0 && <button className="secondary" disabled={busy} onClick={reviewNow}>{review?.stale ? 'Run review again' : 'Review consistency'}</button>}{shots.length > 0 && <button className="secondary" onClick={() => setExportOpen(true)}>Export for Canva</button>}{shots.length > 0 && <button disabled={actionBusy || !missing.length} onClick={() => setConfirmation('batch')}>Generate {missing.length} missing</button>}{shots.length > 0 && <button disabled={actionBusy || !finalCandidates.length} onClick={() => setConfirmation('finals')}>Render {finalCandidates.length} finals</button>}</div>
</header>{batchStatus && <div className="notice">{['completed', 'failed'].includes(batchStatus.status) ? `Image generation finished: ${batchStatus.completed} generated${batchStatus.failed ? `, ${batchStatus.failed} failed` : ''}.` : `Generating ${batchStatus.completed + batchStatus.failed} of ${batchStatus.total} images — ${batchStatus.currentlyGenerating} in progress.`}</div>}{error && <div className="inline-error notice">{error}</div>}{exportOpen && <CanvaExportDialog projectId={projectId} shots={shots} onClose={() => setExportOpen(false)}/>}<StoryboardImportModal opened={importOpen} currentShotCount={shots.length} loading={busy} prompt={importPrompt} promptLoading={importPromptLoading} onClose={() => setImportOpen(false)} onCopyPrompt={() => void copyStoryboardPrompt()} onImport={source => void run(() => request(`/projects/${projectId}/storyboard/import`, 'POST', { response: source, replaceExisting: shots.length > 0 })).then(imported => { if (imported) setImportOpen(false); })}/><ShotInsertBar count={shotInsertCount} max={remainingShotCapacity} busy={actionBusy} onCountChange={setShotInsertCount} onAdd={placement => void addShots(placement)}/> {reviewOpen && review && <section className="consistency-panel">
<h2>Consistency review</h2>
<p>{review.summary}</p>{review.issues.map(i => <article className={`consistency-issue ${i.severity}`} key={i.id}>
<small>{i.severity.toUpperCase()} · {i.category}</small>
<h3>{i.title}</h3>
<p>{i.description}</p>
<p>
<strong>Suggestion:</strong> {i.suggestion}</p>{i.shotIds.map(id => <button className="secondary" key={id} onClick={() => setOpened(id)}>Open shot</button>)}</article>)}</section>}{!shots.length ? <section className="panel">
<h2>Start your storyboard</h2>
<p>Generate an ordered sequence, then review it before creating images.</p>
</section> : <><div className="selection-bar">
<Checkbox label="Select all shots" checked={allSelected} indeterminate={selected.length > 0 && !allSelected} onChange={event => setSelected(event.currentTarget.checked ? shots.map(shot => shot.id) : [])}/>
<Button variant="subtle" color="gray" size="compact-sm" disabled={!selected.length} onClick={() => setSelected([])}>Clear</Button>
<span className="selection-count">{selected.length} shot{selected.length === 1 ? '' : 's'} selected</span>
<Button size="compact-sm" disabled={actionBusy || !selected.length || selectedGenerating} onClick={() => { setGenerationSelection(selected); setConfirmation('selected'); }}>Generate selected ({selected.length})</Button>
</div>{selectedGenerating && <div className="notice">Wait for the selected shots that are already generating before starting another batch.</div>}<section className="storyboard-overview">{shots.map(shot => <StoryboardShotCard key={shot.id} shot={shot} selected={selected.includes(shot.id)} busy={actionBusy} canAdd={remainingShotCapacity > 0} projectId={projectId} run={run} onOpen={() => setOpened(shot.id)} onSelect={checked => setSelected(ids => checked ? [...ids, shot.id] : ids.filter(id => id !== shot.id))} onAdd={(placement, shotId) => void addShots(placement, shotId)}/>)}</section></>}<StoryboardGenerationModal opened={confirmation === 'storyboard'} currentShotCount={shots.length} loading={busy} onCancel={() => setConfirmation(null)} onConfirm={settings => void run(() => request(`/projects/${projectId}/storyboard`, 'POST', settings)).finally(() => setConfirmation(null))}/>
<ConfirmModal opened={confirmation === 'review'} title="Review storyboard consistency?" message="This will analyze the storyboard but will not generate new images." confirmLabel={review?.stale ? 'Run review again' : 'Review consistency'} loading={busy} onCancel={() => setConfirmation(null)} onConfirm={() => void run(() => request(`/projects/${projectId}/storyboard-review`, 'POST', {})).finally(() => setConfirmation(null))}/>
<ImageGenerationModal opened={confirmation === 'batch'} projectId={projectId} imageCount={missing.length} shotIds={missing.map(shot=>shot.id)} defaultQuality={defaultQuality} title="Generate missing images?" message={`Generate ${missing.length} genuinely missing image${missing.length === 1 ? '' : 's'}? Existing Draft, Standard, Final, and uploaded images will not be regenerated.${important ? ` ${important} important consistency issue${important === 1 ? ' is' : 's are'} unresolved.` : ''}`} confirmLabel={`Generate ${missing.length} image${missing.length === 1 ? '' : 's'}`} loading={busy} onCancel={() => setConfirmation(null)} onConfirm={qualityPreset => void run(async () => setBatchStatus(await request(`/projects/${projectId}/generate-images`, 'POST', { qualityPreset }) as BatchStatus)).finally(() => setConfirmation(null))}/>
<ImageGenerationModal opened={confirmation === 'selected'} projectId={projectId} imageCount={generationSelection.length} shotIds={generationSelection} defaultQuality={defaultQuality} title="Generate images for selected shots?" message={`Generate ${generationSelection.length} image${generationSelection.length === 1 ? '' : 's'}? This is a paid generation action.${selectedWithImages ? ` ${selectedWithImages} selected shot${selectedWithImages === 1 ? ' already has' : 's already have'} an image; each will receive a new version.` : ''}`} confirmLabel={`Generate ${generationSelection.length} image${generationSelection.length === 1 ? '' : 's'}`} loading={busy} confirmDisabled={!generationSelection.length || generationSelectionBusy} onCancel={() => setConfirmation(null)} onConfirm={qualityPreset => void run(async () => { const batch = await request(`/projects/${projectId}/generate-images`, 'POST', { shotIds: generationSelection, qualityPreset }) as BatchStatus; setBatchStatus(batch); setSelected([]); }).finally(() => setConfirmation(null))}/>
<ImageGenerationModal opened={confirmation === 'finals'} projectId={projectId} imageCount={finalCandidates.length} shotIds={finalCandidates.map(shot=>shot.id)} defaultQuality="best" fixedQuality title="Render approved finals?" message={`${approvedCount} approved · ${currentFinals} already Final · ${finalCandidates.length} need Final. Render exactly ${finalCandidates.length} new Final version${finalCandidates.length === 1 ? '' : 's'}? Existing versions will be preserved.`} confirmLabel={`Render ${finalCandidates.length} finals`} loading={busy} confirmDisabled={!finalCandidates.length} onCancel={() => setConfirmation(null)} onConfirm={() => void run(async () => setBatchStatus(await request(`/projects/${projectId}/render-approved-finals`, 'POST', {}) as BatchStatus)).finally(() => setConfirmation(null))}/>
</main>; }
