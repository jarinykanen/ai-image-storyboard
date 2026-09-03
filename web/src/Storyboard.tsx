import { Button, Checkbox, Select, Textarea } from '@mantine/core';
import React, { useEffect, useMemo, useState } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { ImageGenerationModal, type ImageQuality } from './ImageGenerationModal';
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
async function request(path: string, method: string, body?: unknown) { const r = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok)
    throw new Error((await r.json().catch(() => ({}))).error || 'Something went wrong.'); return r.json(); }
async function upload(path: string, file: File) { const f = new FormData(); f.append('image', file); const r = await fetch(`${API}${path}`, { method: 'POST', body: f }); if (!r.ok)
    throw new Error((await r.json().catch(() => ({}))).error || 'Could not upload image.'); return r.json(); }
function Detail({ shot, shots, identity, projectId, defaultQuality, busy, run, go, close }: {
    shot: StoryboardShot;
    shots: StoryboardShot[];
    identity: VisualIdentityData;
    projectId: string;
    defaultQuality: ImageQuality;
    busy: boolean;
    run: (f: () => Promise<unknown>) => Promise<void>;
    go: (id: string) => void;
    close: () => void;
}) { const [editing, setEditing] = useState(false), [compare, setCompare] = useState(false), [deleteGeneration, setDeleteGeneration] = useState<Generation | null>(null), [confirmImageGeneration, setConfirmImageGeneration] = useState(false), [variantDialog, setVariantDialog] = useState(false), [variantCount, setVariantCount] = useState('3'), [refineAssetId, setRefineAssetId] = useState<string | null>(null), [refineInstruction, setRefineInstruction] = useState(''), [version, setVersion] = useState(0), [form, setForm] = useState({ description: shot.description, action: shot.action, shotType: shot.shotType, camera: shot.camera, mood: shot.mood, characterIds: shot.characterIds, locationId: shot.locationId }); useEffect(() => { setEditing(false); setCompare(false); setConfirmImageGeneration(false); setVariantDialog(false); setRefineAssetId(null); setRefineInstruction(''); setVersion(Math.max(0, shot.generations.findIndex(g => g.active))); setForm({ description: shot.description, action: shot.action, shotType: shot.shotType, camera: shot.camera, mood: shot.mood, characterIds: shot.characterIds, locationId: shot.locationId }); }, [shot]); const index = shots.findIndex(s => s.id === shot.id), image = shot.generations[version], generated = shot.generations.filter(g => g.status === 'generated'); const variants = () => setVariantDialog(true); const remove = (g: Generation) => setDeleteGeneration(g); const actions = (g: Generation) => <>{!g.active && <button className="secondary" disabled={busy} onClick={() => void run(() => request(`/projects/${projectId}/shots/${shot.id}/generations/${g.id}/use`, 'POST', {}))}>Set as active</button>}{g.assetId && <a className="button secondary" href={`${API}/assets/${g.assetId}/download`}>Download</a>}<button className="secondary" disabled={busy} onClick={() => remove(g)}>Delete</button>
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
<small>Version {g.version}{g.active ? ' · ACTIVE' : ''}</small>
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
<span>Version {image?.version}{image?.active ? ' · ACTIVE' : ''}{image?.approved ? ' · APPROVED' : ''}</span>{image && actions(image)}</div>
</>}</div>
<div className="review-details">
<small>Shot {shot.order} · {shot.section}</small>
<h2>{shot.title}</h2>{editing ? <div className="shot-form">
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
<label>Characters<select multiple value={form.characterIds} onChange={e => setForm({ ...form, characterIds: Array.from(e.target.selectedOptions, o => o.value) })}>{identity.characters.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
</label>
<label>Location<select value={form.locationId ?? ''} onChange={e => setForm({ ...form, locationId: e.target.value || null })}>
<option value="">No location</option>{identity.locations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
</label>
<div className="card-actions">
<button disabled={busy} onClick={() => { void run(() => request(`/projects/${projectId}/shots/${shot.id}`, 'PUT', form)); setEditing(false); }}>Save changes</button>
<button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
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
<button className="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit shot</button>
<label className="button secondary upload-button">Upload<input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file)
    void run(() => upload(`/projects/${projectId}/shots/${shot.id}/upload`, file)); e.currentTarget.value = ''; }}/>
</label>{image?.assetId && <button className="secondary" disabled={busy} onClick={() => { setRefineInstruction(''); setRefineAssetId(image.assetId); }}>Refine</button>}</div>
</>}</div>
</div>}</section>
<ImageGenerationModal opened={confirmImageGeneration} defaultQuality={defaultQuality} title={shot.imageUrl ? 'Regenerate shot image?' : 'Generate shot image?'} message="Generate 1 storyboard image? This is a paid generation action." confirmLabel={shot.imageUrl ? 'Regenerate 1 image' : 'Generate 1 image'} loading={busy} onCancel={() => setConfirmImageGeneration(false)} onConfirm={qualityPreset => void run(() => request(`/projects/${projectId}/shots/${shot.id}/generate-image`, 'POST', { qualityPreset })).finally(() => setConfirmImageGeneration(false))}/>
<ImageGenerationModal opened={variantDialog} defaultQuality={defaultQuality} title="Generate shot variants?" message={`Generate ${variantCount} storyboard images? This is a paid generation action.`} confirmLabel={`Generate ${variantCount} images`} loading={busy} onCancel={() => setVariantDialog(false)} onConfirm={qualityPreset => void run(() => request(`/projects/${projectId}/shots/${shot.id}/generate-variants`, 'POST', { count: Number(variantCount), qualityPreset })).finally(() => setVariantDialog(false))}>
<Select label="Number of variants" value={variantCount} onChange={value => setVariantCount(value || '3')} data={['2', '3', '4']} allowDeselect={false}/>
</ImageGenerationModal>
<ImageGenerationModal opened={refineAssetId !== null} defaultQuality={defaultQuality} title="Refine image" message="Generate 1 refined version from this image? This is a paid generation action." confirmLabel="Generate refined image" loading={busy} confirmDisabled={!refineInstruction.trim()} onCancel={() => setRefineAssetId(null)} onConfirm={qualityPreset => { if (refineAssetId)
    void run(() => request(`/projects/${projectId}/shots/${shot.id}/refine`, 'POST', { assetId: refineAssetId, instruction: refineInstruction.trim(), qualityPreset })).finally(() => setRefineAssetId(null)); }}>
<Textarea label="What should change?" placeholder="Describe the changes you want" minRows={4} value={refineInstruction} onChange={event => setRefineInstruction(event.target.value)} autoFocus/>
</ImageGenerationModal>
<ConfirmModal opened={!!deleteGeneration} title="Delete image version?" message={deleteGeneration ? "Delete version " + deleteGeneration.version + "? This cannot be undone." : ""} confirmLabel="Delete" confirmColor="red" loading={busy} onCancel={() => setDeleteGeneration(null)} onConfirm={() => { if (deleteGeneration)
    void run(() => request("/projects/" + projectId + "/shots/" + shot.id + "/generations/" + deleteGeneration.id, "DELETE")).finally(() => setDeleteGeneration(null)); }}/>
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
export function Storyboard({ projectId, shots, identity, review, defaultQuality, onRefresh }: {
    projectId: string;
    shots: StoryboardShot[];
    identity: VisualIdentityData;
    review: StoryboardReview | null;
    defaultQuality: ImageQuality;
    onRefresh: () => Promise<void>;
}) { const [busy, setBusy] = useState(false), [error, setError] = useState(''), [opened, setOpened] = useState<string | null>(null), [reviewOpen, setReviewOpen] = useState(false), [exportOpen, setExportOpen] = useState(false), [selected, setSelected] = useState<string[]>([]), [generationSelection, setGenerationSelection] = useState<string[]>([]), [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null), [confirmation, setConfirmation] = useState<'storyboard' | 'review' | 'batch' | 'selected' | null>(null); const missing = useMemo(() => shots.filter(s => s.generationStatus !== 'generating' && (!s.imageUrl || s.generationStatus === 'needs_regeneration' || s.generationStatus === 'failed')), [shots]); const current = shots.find(s => s.id === opened), selectedShots = shots.filter(s => selected.includes(s.id)), generationShots = shots.filter(s => generationSelection.includes(s.id)), selectedWithImages = generationShots.filter(s => s.imageUrl).length, selectedGenerating = selectedShots.some(s => s.generationStatus === 'generating'), generationSelectionBusy = generationShots.some(s => s.generationStatus === 'generating'), allSelected = shots.length > 0 && shots.every(s => selected.includes(s.id)), batchRunning = !!batchStatus && !['completed', 'failed'].includes(batchStatus.status), actionBusy = busy || batchRunning, issues = review?.issues.filter(i => i.status === 'open') || [], important = issues.filter(i => i.severity === 'important').length, warnings = issues.filter(i => i.severity === 'warning').length; useEffect(() => setSelected(ids => ids.filter(id => shots.some(shot => shot.id === id))), [shots]); useEffect(() => { if (!batchStatus || ['completed', 'failed'].includes(batchStatus.status)) return; const timer = window.setTimeout(async () => { try {
    const next = await request(`/projects/${projectId}/image-batches/${batchStatus.id}`, 'GET') as BatchStatus;
    setBatchStatus(next);
    await onRefresh();
}
catch (e) {
    setError(e instanceof Error ? e.message : 'Could not check image generation progress.');
} }, 1000); return () => window.clearTimeout(timer); }, [batchStatus, projectId, onRefresh]); const run = async (f: () => Promise<unknown>) => { setBusy(true); setError(''); try {
    await f();
    await onRefresh();
}
catch (e) {
    setError(e instanceof Error ? e.message : 'Could not complete that action.');
}
finally {
    setBusy(false);
} }; const reviewNow = () => setConfirmation('review'); if (current)
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
<button disabled={busy} onClick={() => setConfirmation('storyboard')}>{shots.length ? 'Regenerate storyboard' : 'Generate storyboard'}</button>{shots.length > 0 && <button className="secondary" disabled={busy} onClick={reviewNow}>{review?.stale ? 'Run review again' : 'Review consistency'}</button>}{shots.length > 0 && <button className="secondary" onClick={() => setExportOpen(true)}>Export for Canva</button>}{shots.length > 0 && <button disabled={actionBusy || !missing.length} onClick={() => setConfirmation('batch')}>Generate {missing.length} missing / marked</button>}</div>
</header>{batchStatus && <div className="notice">{['completed', 'failed'].includes(batchStatus.status) ? `Image generation finished: ${batchStatus.completed} generated${batchStatus.failed ? `, ${batchStatus.failed} failed` : ''}.` : `Generating ${batchStatus.completed + batchStatus.failed} of ${batchStatus.total} images — ${batchStatus.currentlyGenerating} in progress.`}</div>}{error && <div className="inline-error notice">{error}</div>}{exportOpen && <CanvaExportDialog projectId={projectId} shots={shots} onClose={() => setExportOpen(false)}/>} {reviewOpen && review && <section className="consistency-panel">
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
</div>{selectedGenerating && <div className="notice">Wait for the selected shots that are already generating before starting another batch.</div>}<section className="storyboard-overview">{shots.map(s => <article className={`storyboard-thumbnail${selected.includes(s.id) ? ' selected-shot' : ''}`} key={s.id} onClick={() => setOpened(s.id)}>
<div className="thumbnail-image">{s.imageUrl ? <img src={s.imageUrl} alt=""/> : <span className="empty-image-icon">▱</span>}</div>
<div className="thumbnail-content">
<div onClick={event => event.stopPropagation()}><Checkbox label="Select" checked={selected.includes(s.id)} onChange={event => { const checked = event.currentTarget.checked; setSelected(ids => checked ? [...ids, s.id] : ids.filter(id => id !== s.id)); }}/></div>
<small>Shot {s.order} · {s.section}</small>
<h3>{s.title}</h3>
<p>{s.description}</p>
</div>
</article>)}</section></>}<ConfirmModal opened={confirmation === 'storyboard'} title={shots.length ? 'Regenerate storyboard?' : 'Generate storyboard?'} message="Generate a new storyboard? This creates text shot plans only and does not generate images." confirmLabel={shots.length ? 'Regenerate storyboard' : 'Generate storyboard'} loading={busy} onCancel={() => setConfirmation(null)} onConfirm={() => void run(() => request(`/projects/${projectId}/storyboard`, 'POST', { density: 'normal' })).finally(() => setConfirmation(null))}/>
<ConfirmModal opened={confirmation === 'review'} title="Review storyboard consistency?" message="This will analyze the storyboard but will not generate new images." confirmLabel={review?.stale ? 'Run review again' : 'Review consistency'} loading={busy} onCancel={() => setConfirmation(null)} onConfirm={() => void run(() => request(`/projects/${projectId}/storyboard-review`, 'POST', {})).finally(() => setConfirmation(null))}/>
<ImageGenerationModal opened={confirmation === 'batch'} defaultQuality={defaultQuality} title="Generate missing and marked images?" message={`Generate ${missing.length} image${missing.length === 1 ? '' : 's'}? This is a paid generation action.${important ? ` ${important} important consistency issue${important === 1 ? ' is' : 's are'} unresolved.` : ''}`} confirmLabel={`Generate ${missing.length} image${missing.length === 1 ? '' : 's'}`} loading={busy} onCancel={() => setConfirmation(null)} onConfirm={qualityPreset => void run(async () => setBatchStatus(await request(`/projects/${projectId}/generate-images`, 'POST', { qualityPreset }) as BatchStatus)).finally(() => setConfirmation(null))}/>
<ImageGenerationModal opened={confirmation === 'selected'} defaultQuality={defaultQuality} title="Generate images for selected shots?" message={`Generate ${generationSelection.length} image${generationSelection.length === 1 ? '' : 's'}? This is a paid generation action.${selectedWithImages ? ` ${selectedWithImages} selected shot${selectedWithImages === 1 ? ' already has' : 's already have'} an image; each will receive a new variant.` : ''}`} confirmLabel={`Generate ${generationSelection.length} image${generationSelection.length === 1 ? '' : 's'}`} loading={busy} confirmDisabled={!generationSelection.length || generationSelectionBusy} onCancel={() => setConfirmation(null)} onConfirm={qualityPreset => void run(async () => { const batch = await request(`/projects/${projectId}/generate-images`, 'POST', { shotIds: generationSelection, qualityPreset }) as BatchStatus; setBatchStatus(batch); setSelected([]); }).finally(() => setConfirmation(null))}/>
</main>; }
