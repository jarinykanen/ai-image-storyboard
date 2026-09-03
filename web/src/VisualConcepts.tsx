import React, { useState } from 'react';
import './concepts.css';
import { WorkspaceHeader } from './AppLayout';
import { Alert, Badge, Button, FileButton, Group, Paper, Select, Stack, Text, Textarea } from '@mantine/core';
import { ConfirmModal } from './ConfirmModal';

export type VisualConcept = { id: string; title: string; description: string; mood: string; visualStyle: string; colorAndLighting: string; narrativeDirection: string; referenceImageUrl: string | null; status: 'generating' | 'generated' | 'selected' | 'failed'; imageStatus: 'pending' | 'generating' | 'generated' | 'failed'; source: 'ai' | 'manual'; imageOutdated: boolean; imageAssets:{id:string;active:boolean}[] };
type ConceptFields = Pick<VisualConcept, 'title' | 'description' | 'mood' | 'visualStyle' | 'colorAndLighting' | 'narrativeDirection'>;
type Props = { projectId: string; concepts: VisualConcept[]; onRefresh: () => Promise<void> };
const API = 'http://localhost:3001/api';
const emptyConcept: ConceptFields = { title: '', description: '', mood: '', visualStyle: '', colorAndLighting: '', narrativeDirection: '' };

async function request(path: string, method = 'POST', body?: unknown) {
  const response = await fetch(`${API}${path}`, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Something went wrong. Please try again.');
  return response.status === 204 ? undefined : response.json();
}

async function upload(path:string,file:File) {
  const form = new FormData();
  form.append('image', file);
  const response = await fetch(`${API}${path}`, { method:'POST', body:form });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not upload image.');
  return response.json();
}

const conceptFields = (concept: VisualConcept): ConceptFields => ({
  title: concept.title,
  description: concept.description,
  mood: concept.mood,
  visualStyle: concept.visualStyle,
  colorAndLighting: concept.colorAndLighting,
  narrativeDirection: concept.narrativeDirection,
});

function ConceptForm({ value, onChange }: { value: ConceptFields; onChange: (value: ConceptFields) => void }) {
  const field = (key: keyof ConceptFields, label: string, minRows = 3) => <Textarea label={label} autosize minRows={minRows} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} />;
  return <div className="concept-form">{field('title', 'Title', 2)}{field('description', 'Description', 4)}{field('mood', 'Mood')}{field('visualStyle', 'Visual style')}{field('colorAndLighting', 'Color and lighting')}{field('narrativeDirection', 'Narrative direction', 4)}</div>;
}

function EmptyConceptPreview({ concept, busy, onUpload }: { concept: VisualConcept; busy: boolean; onUpload: (file: File) => void }) {
  const generating = concept.imageStatus === 'generating';
  return <div className="empty-concept-preview">
    <span className="empty-preview-icon" aria-hidden="true">▧</span>
    <Text size="sm" c="dimmed">{generating ? 'Creating preview image…' : concept.imageStatus === 'failed' ? 'Preview image could not be created' : 'No preview image yet'}</Text>
    <FileButton accept="image/jpeg,image/png,image/webp" disabled={busy || generating} onChange={file => { if (file) onUpload(file); }}>
      {props => <Button variant="default" size="sm" {...props}>Upload preview image</Button>}
    </FileButton>
  </div>;
}

function ConceptCard({ projectId, concept, onRefresh, onEdit }: { projectId: string; concept: VisualConcept; onRefresh: () => Promise<void>; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/projects/${projectId}/concepts/${concept.id}`;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try { await action(); await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not complete that action.'); }
    finally { setBusy(false); }
  };

  return <article className={`concept-card ${concept.status === 'selected' ? 'selected' : ''}`}>
    <div className="concept-image">{concept.referenceImageUrl ? <img src={concept.referenceImageUrl} alt={concept.title} /> : <EmptyConceptPreview concept={concept} busy={busy} onUpload={file => void run(() => upload(`${base}/upload`, file))} />}</div>
    <div className="concept-content">
      <div className="concept-heading"><h2>{concept.title}</h2>{concept.status === 'selected' && <Badge color="studio">Selected</Badge>}</div>
      <p>{concept.description}</p>
      <dl>
        <div><dt>Mood</dt><dd>{concept.mood}</dd></div>
        <div><dt>Visual style</dt><dd>{concept.visualStyle}</dd></div>
        <div><dt>Color and lighting</dt><dd>{concept.colorAndLighting}</dd></div>
        <div><dt>Narrative direction</dt><dd>{concept.narrativeDirection}</dd></div>
      </dl>
      {concept.imageOutdated && <p className="outdated-image">Concept changed since this image was created.</p>}
      {error && <div className="inline-error">{error}</div>}
      <Group className="concept-card-actions" gap="sm" grow>
        <Button loading={busy} disabled={concept.status === 'selected'} onClick={() => void run(() => request(`${base}/select`))}>Select</Button>
        <Button variant="default" disabled={busy} onClick={onEdit}>Edit</Button>
      </Group>
    </div>
  </article>;
}

function ConceptEditView({ projectId, concept, onRefresh, onBack }: { projectId: string; concept: VisualConcept; onRefresh: () => Promise<void>; onBack: () => void }) {
  const [form, setForm] = useState<ConceptFields>(() => conceptFields(concept));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'image' | 'variants' | 'delete' | null>(null);
  const [variantCount, setVariantCount] = useState('3');
  const base = `/projects/${projectId}/concepts/${concept.id}`;
  const valid = Object.values(form).every(value => value.trim());
  const dirty = (Object.keys(form) as (keyof ConceptFields)[]).some(key => form[key] !== concept[key]);
  const activeAsset = concept.imageAssets.find(asset => asset.active);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try { await action(); await onRefresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not complete that action.'); return false; }
    finally { setBusy(false); }
  };

  const save = () => void run(async () => {
    const result = await request(base, 'PUT', form) as { concept: VisualConcept };
    setForm(conceptFields(result.concept));
  });
  const regenerateText = () => void run(async () => {
    const result = await request(`${base}/regenerate`) as { concept: VisualConcept };
    setForm(conceptFields(result.concept));
  });
  const generateImage = () => void run(() => request(`${base}/image`)).finally(() => setConfirmAction(null));
  const generateVariants = () => void run(() => request(`${base}/generate-variants`, 'POST', { count: Number(variantCount) })).finally(() => setConfirmAction(null));
  const deleteConcept = () => void run(() => request(base, 'DELETE')).then(success => { if (success) onBack(); }).finally(() => setConfirmAction(null));

  return <>
    <WorkspaceHeader title={`Edit ${concept.title}`} description="Update the concept and manage its preview image." actions={<Button variant="default" onClick={onBack}>← Back to concepts</Button>} />
    <div className="concept-edit-layout">
      <Paper className="concept-edit-preview" p="md">
        <div className="concept-edit-image">{concept.referenceImageUrl ? <img src={concept.referenceImageUrl} alt={concept.title} /> : <EmptyConceptPreview concept={concept} busy={busy} onUpload={file => void run(() => upload(`${base}/upload`, file))} />}</div>
        {concept.imageOutdated && <Alert color="yellow">The concept has changed since this preview image was created.</Alert>}
        {concept.imageStatus === 'failed' && <Alert color="red">The preview image could not be created. You can try again or upload your own.</Alert>}
        <Stack gap="sm">
          <div><Text fw={600}>Preview image</Text><Text size="sm" c="dimmed">Generate one image, create variants, or upload your own reference.</Text></div>
          <Group gap="sm">
            <Button variant="default" disabled={busy || concept.imageStatus === 'generating'} onClick={() => setConfirmAction('image')}>{concept.referenceImageUrl ? 'Regenerate image' : 'Generate preview image'}</Button>
            <FileButton accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={file => { if (file) void run(() => upload(`${base}/upload`, file)); }}>
              {props => <Button variant="default" {...props}>Upload image</Button>}
            </FileButton>
            {activeAsset && <Button component="a" variant="default" href={`${API}/assets/${activeAsset.id}/download`}>Download</Button>}
          </Group>
          <Group align="end" gap="sm">
            <Select label="Number of variants" value={variantCount} onChange={value => setVariantCount(value || '3')} data={[{ value:'2', label:'2 images' }, { value:'3', label:'3 images' }, { value:'4', label:'4 images' }]} allowDeselect={false} className="variant-count" />
            <Button variant="default" disabled={busy} onClick={() => setConfirmAction('variants')}>Generate variants</Button>
          </Group>
        </Stack>
      </Paper>

      <Paper className="concept-edit-content" p="lg">
        <Stack gap="md">
          <div><Text fw={600} size="lg">Concept details</Text><Text size="sm" c="dimmed">These details guide the visual identity and storyboard.</Text></div>
          <ConceptForm value={form} onChange={setForm} />
          {error && <Alert color="red">{error}</Alert>}
          <Group gap="sm">
            <Button loading={busy} disabled={!valid || !dirty} onClick={save}>Save changes</Button>
            <Button variant="default" disabled={busy || !dirty} onClick={() => setForm(conceptFields(concept))}>Cancel changes</Button>
          </Group>
          <div className="concept-edit-secondary-actions">
            {concept.source === 'ai' && <Button variant="default" disabled={busy} onClick={regenerateText}>Regenerate concept text</Button>}
            <Button color="red" variant="light" disabled={busy} onClick={() => setConfirmAction('delete')}>Delete concept</Button>
          </div>
        </Stack>
      </Paper>
    </div>

    <ConfirmModal opened={confirmAction === 'image'} title={concept.referenceImageUrl ? 'Regenerate preview image?' : 'Generate preview image?'} message="Generate 1 preview image? This is a paid generation action." confirmLabel="Generate 1 image" loading={busy} onCancel={() => setConfirmAction(null)} onConfirm={generateImage} />
    <ConfirmModal opened={confirmAction === 'variants'} title="Generate preview variants?" message={`Generate ${variantCount} preview images? This is a paid generation action.`} confirmLabel={`Generate ${variantCount} images`} loading={busy} onCancel={() => setConfirmAction(null)} onConfirm={generateVariants} />
    <ConfirmModal opened={confirmAction === 'delete'} title="Delete concept?" message={`Delete ${concept.title}? This cannot be undone.`} confirmLabel="Delete" confirmColor="red" loading={busy} onCancel={() => setConfirmAction(null)} onConfirm={deleteConcept} />
  </>;
}

export function VisualConcepts({ projectId, concepts, onRefresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ConceptFields>(emptyConcept);
  const [editingId, setEditingId] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete that action.'); } finally { setBusy(false); } };
  const generateAll = () => run(() => request(`/projects/${projectId}/concepts/generate`));
  const saveManual = () => run(async () => { await request(`/projects/${projectId}/concepts`, 'POST', form); setForm(emptyConcept); setCreating(false); });
  const valid = Object.values(form).every(value => value.trim());
  const editingConcept = concepts.find(concept => concept.id === editingId);

  if (editingConcept) return <ConceptEditView key={editingConcept.id} projectId={projectId} concept={editingConcept} onRefresh={onRefresh} onBack={() => setEditingId(null)} />;

  return <>
    <WorkspaceHeader title="Concepts" description="Choose a creative direction for the video. Text concepts never use image-generation credits." actions={<><Button variant="default" onClick={() => setCreating(true)} disabled={busy}>+ Create my own</Button><Button onClick={generateAll} disabled={busy}>Generate 3 concepts</Button></>} />
    {busy && <div className="notice">Creating text concepts…</div>}{error && <div className="inline-error notice">{error}</div>}
    {!concepts.length && !creating && <section className="panel empty-concepts"><h2>Start with a creative direction</h2><p>Generate three AI text concepts, or define your own. You can add more concepts later.</p><div className="card-actions"><Button disabled={busy} onClick={generateAll}>Generate 3 concepts with AI</Button><Button variant="default" disabled={busy} onClick={() => setCreating(true)}>+ Create my own concept</Button></div></section>}
    {creating && <section className="panel manual-concept"><h2>Create my own concept</h2><ConceptForm value={form} onChange={setForm} /><div className="card-actions"><Button disabled={busy || !valid} onClick={saveManual}>Create concept</Button><Button variant="default" disabled={busy} onClick={() => { setForm(emptyConcept); setCreating(false); }}>Cancel</Button></div></section>}
    <section className="concept-grid">{concepts.map(concept => <ConceptCard key={concept.id} projectId={projectId} concept={concept} onRefresh={onRefresh} onEdit={() => setEditingId(concept.id)} />)}</section>
  </>;
}
