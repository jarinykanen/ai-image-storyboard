import React, { useState } from 'react';
import { WorkspaceHeader } from './ProjectLayout';

export type VisualReference = { id: string; name: string; description: string; image_url: string | null; image_outdated: boolean; locked: boolean };
export type VisualIdentityData = {
  style: { description: string; image_url: string | null; image_outdated: boolean; locked: boolean };
  characters: VisualReference[];
  locations: VisualReference[];
};

type Props = { projectId: string; identity: VisualIdentityData; onRefresh: () => Promise<void> };
const API = 'http://localhost:3001/api';

async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${API}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Something went wrong. Please try again.');
  return response.status === 204 ? undefined : response.json();
}

function ReferenceCard({ projectId, type, reference, onRefresh }: { projectId: string; type: 'character' | 'location'; reference: VisualReference; onRefresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(reference.name);
  const [description, setDescription] = useState(reference.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); } };
  const base = `/projects/${projectId}/visual-identity/${type}/${reference.id}`;
  return <article className="reference-card">
    <div className="reference-image">{reference.image_url ? <img src={reference.image_url} alt={reference.name} /> : <span>No reference image yet</span>}</div>
    {editing ? <><label>Name<input value={name} onChange={e => setName(e.target.value)} /></label><label>Description<textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} /></label></> : <><h3>{reference.name}</h3><p>{reference.description}</p></>}
    {error && <div className="inline-error">{error}</div>}
    <div className="card-actions">
      {editing ? <><button disabled={busy || !name.trim() || !description.trim()} onClick={() => run(async () => { await request(base, 'PUT', { name, description }); setEditing(false); })}>Save</button><button className="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></> : <>
        {reference.image_outdated && <p className="reference-status">Reference image may no longer match the current description.</p>}
        <button disabled={busy || reference.locked} onClick={() => run(() => request(`${base}/image`, 'POST'))}>{reference.image_url ? 'Regenerate image' : 'Generate reference image'}</button>
        <button className="secondary" disabled={busy} onClick={() => run(() => request(`${base}/lock`, 'PUT', { locked: !reference.locked }))}>{reference.locked ? 'Unlock' : 'Lock'}</button>
        <button className="secondary" disabled={busy || reference.locked} onClick={() => setEditing(true)}>Edit</button>
        <button className="danger" disabled={busy || reference.locked} onClick={() => { if (window.confirm(`Delete ${reference.name}?`)) run(() => request(base, 'DELETE')); }}>Delete</button>
      </>}
    </div>
  </article>;
}

function ReferenceSection({ projectId, type, title, references, onRefresh }: { projectId: string; type: 'character' | 'location'; title: string; references: VisualReference[]; onRefresh: () => Promise<void> }) {
  const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const add = async () => { setBusy(true); setError(''); try { await request(`/projects/${projectId}/visual-identity/${type}`, 'POST', { name, description }); setName(''); setDescription(''); setAdding(false); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); } };
  return <section className="identity-section"><h2>{title}</h2><div className="reference-grid">{references.map(reference => <ReferenceCard key={reference.id} projectId={projectId} type={type} reference={reference} onRefresh={onRefresh} />)}</div>
    {adding ? <div className="add-reference panel"><label>Name<input autoFocus value={name} onChange={e => setName(e.target.value)} /></label><label>Description<textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder={`Describe this ${type}…`} /></label>{error && <div className="inline-error">{error}</div>}<div className="card-actions"><button disabled={busy || !name.trim() || !description.trim()} onClick={add}>Add {type}</button><button className="secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</button></div></div> : <button className="add-button" onClick={() => setAdding(true)}>+ Add {type}</button>}</section>;
}

export function VisualIdentity({ projectId, identity, onRefresh }: Props) {
  const [description, setDescription] = useState(identity.style.description); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); } };
  const base = `/projects/${projectId}/visual-identity/style`;
  return <><WorkspaceHeader title="Visual Identity" description="Set the visual references your future storyboard images will use for consistency." />
    <section className="identity-section"><h2>Style</h2><article className="style-card"><div className="style-preview">{identity.style.image_url ? <img src={identity.style.image_url} alt="Visual style reference" /> : <span>No reference image yet</span>}</div><div className="style-content"><label>Description<textarea rows={4} value={description} disabled={identity.style.locked} onChange={e => setDescription(e.target.value)} /></label>{identity.style.image_outdated && <p className="reference-status">Reference image may no longer match the current description.</p>}{error && <div className="inline-error">{error}</div>}<div className="card-actions"><button disabled={busy || identity.style.locked || !description.trim()} onClick={() => run(() => request(base, 'PUT', { description }))}>Save style</button><button disabled={busy || identity.style.locked || !identity.style.description.trim()} onClick={() => run(() => request(`${base}/image`, 'POST'))}>{identity.style.image_url ? 'Regenerate image' : 'Generate style reference'}</button><button className="secondary" disabled={busy} onClick={() => run(() => request(`${base}/lock`, 'PUT', { locked: !identity.style.locked }))}>{identity.style.locked ? 'Unlock' : 'Lock'}</button></div></div></article></section>
    <ReferenceSection projectId={projectId} type="character" title="Characters" references={identity.characters} onRefresh={onRefresh} />
    <ReferenceSection projectId={projectId} type="location" title="Locations" references={identity.locations} onRefresh={onRefresh} />
  </>;
}
