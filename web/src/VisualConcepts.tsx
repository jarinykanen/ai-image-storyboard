import React, { useState } from 'react';
import './concepts.css';
import { WorkspaceHeader } from './ProjectLayout';

export type VisualConcept = { id: string; title: string; description: string; mood: string; visualStyle: string; colorAndLighting: string; narrativeDirection: string; referenceImageUrl: string | null; status: 'generating' | 'generated' | 'selected' | 'failed'; imageStatus: 'pending' | 'generating' | 'generated' | 'failed'; source: 'ai' | 'manual'; imageOutdated: boolean };
type ConceptFields = Pick<VisualConcept, 'title' | 'description' | 'mood' | 'visualStyle' | 'colorAndLighting' | 'narrativeDirection'>;
type Props = { projectId: string; concepts: VisualConcept[]; onRefresh: () => Promise<void> };
const API = 'http://localhost:3001/api';
const emptyConcept: ConceptFields = { title: '', description: '', mood: '', visualStyle: '', colorAndLighting: '', narrativeDirection: '' };

async function request(path: string, method = 'POST', body?: unknown) {
  const response = await fetch(`${API}${path}`, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Something went wrong. Please try again.');
  return response.status === 204 ? undefined : response.json();
}

function ConceptForm({ value, onChange }: { value: ConceptFields; onChange: (value: ConceptFields) => void }) {
  const field = (key: keyof ConceptFields, label: string, rows?: number) => <label>{label}{rows ? <textarea rows={rows} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} /> : <input value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} />}</label>;
  return <div className="concept-form">{field('title', 'Title')}{field('description', 'Description', 3)}{field('mood', 'Mood')}{field('visualStyle', 'Visual style')}{field('colorAndLighting', 'Color and lighting')}{field('narrativeDirection', 'Narrative direction', 3)}</div>;
}

function ConceptCard({ projectId, concept, onRefresh }: { projectId: string; concept: VisualConcept; onRefresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false); const [form, setForm] = useState<ConceptFields>(concept); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete that action.'); } finally { setBusy(false); } };
  const base = `/projects/${projectId}/concepts/${concept.id}`;
  const valid = Object.values(form).every(value => typeof value === 'string' && value.trim());
  const imageLabel = concept.referenceImageUrl ? 'Regenerate image' : 'Generate reference image';
  return <article className={`concept-card ${concept.status === 'selected' ? 'selected' : ''}`}>
    <div className="concept-image">{concept.referenceImageUrl ? <img src={concept.referenceImageUrl} alt={concept.title} /> : <span>{concept.imageStatus === 'generating' ? 'Creating reference image…' : concept.imageStatus === 'failed' ? 'Reference image could not be created' : 'No reference image yet'}</span>}</div>
    <div className="concept-content">
      {editing ? <ConceptForm value={form} onChange={setForm} /> : <><div className="concept-heading"><h2>{concept.title}</h2>{concept.status === 'selected' && <span className="selected-badge">Selected</span>}</div><p>{concept.description}</p><dl><div><dt>Mood</dt><dd>{concept.mood}</dd></div><div><dt>Visual style</dt><dd>{concept.visualStyle}</dd></div><div><dt>Color and lighting</dt><dd>{concept.colorAndLighting}</dd></div><div><dt>Narrative direction</dt><dd>{concept.narrativeDirection}</dd></div></dl></>}
      {concept.imageOutdated && <p className="outdated-image">Concept changed since this image was generated.</p>}
      {error && <div className="inline-error">{error}</div>}
      <div className="card-actions text-actions">{editing ? <><button disabled={busy || !valid} onClick={() => run(async () => { await request(base, 'PUT', form); setEditing(false); })}>Save</button><button className="secondary" disabled={busy} onClick={() => { setForm(concept); setEditing(false); }}>Cancel</button></> : <><button disabled={busy || concept.status === 'selected'} onClick={() => run(() => request(`${base}/select`))}>{concept.status === 'selected' ? 'Selected concept' : 'Select'}</button><button className="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit</button>{concept.source === 'ai' && <button className="secondary" disabled={busy} onClick={() => run(() => request(`${base}/regenerate`))}>Regenerate text</button>}<button className="danger" disabled={busy} onClick={() => { if (window.confirm(`Delete ${concept.title}?`)) run(() => request(base, 'DELETE')); }}>Delete</button></>}</div>
      {!editing && <div className="image-actions"><span>Reference image</span><button className="secondary" disabled={busy || concept.imageStatus === 'generating'} onClick={() => run(() => request(`${base}/image`))}>{imageLabel}</button></div>}
    </div>
  </article>;
}

export function VisualConcepts({ projectId, concepts, onRefresh }: Props) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [creating, setCreating] = useState(false); const [form, setForm] = useState<ConceptFields>(emptyConcept);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete that action.'); } finally { setBusy(false); } };
  const generateAll = () => run(() => request(`/projects/${projectId}/concepts/generate`));
  const saveManual = () => run(async () => { await request(`/projects/${projectId}/concepts`, 'POST', form); setForm(emptyConcept); setCreating(false); });
  const valid = Object.values(form).every(value => typeof value === 'string' && value.trim());
  return <><WorkspaceHeader title="Concepts" description="Choose a creative direction for the video. Text concepts never use image-generation credits." actions={<><button className="secondary" onClick={() => setCreating(true)} disabled={busy}>+ Create my own</button><button onClick={generateAll} disabled={busy}>Generate 3 concepts</button></>}/>
    {busy && <div className="notice">Creating text concepts…</div>}{error && <div className="inline-error notice">{error}</div>}
    {!concepts.length && !creating && <section className="panel empty-concepts"><h2>Start with a creative direction</h2><p>Generate three AI text concepts, or define your own. You can add more concepts later.</p><div className="card-actions"><button disabled={busy} onClick={generateAll}>Generate 3 concepts with AI</button><button className="secondary" disabled={busy} onClick={() => setCreating(true)}>+ Create my own concept</button></div></section>}
    {concepts.length > 0 && !creating && <button className="add-button" disabled={busy} onClick={() => setCreating(true)}>+ Create my own concept</button>}
    {creating && <section className="panel manual-concept"><h2>Create my own concept</h2><ConceptForm value={form} onChange={setForm} /><div className="card-actions"><button disabled={busy || !valid} onClick={saveManual}>Create concept</button><button className="secondary" disabled={busy} onClick={() => { setForm(emptyConcept); setCreating(false); }}>Cancel</button></div></section>}
    <section className="concept-grid">{concepts.map(concept => <ConceptCard key={concept.id} projectId={projectId} concept={concept} onRefresh={onRefresh} />)}</section>
  </>;
}
