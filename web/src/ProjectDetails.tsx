import { useEffect, useState } from 'react';
import { WorkspaceHeader } from './ProjectLayout';

const API = 'http://localhost:3001/api';

export function ProjectDetails({ project, onSaved }: { project: { id: string; suno_description?: string | null }; onSaved: () => Promise<void> }) {
  const [sunoDescription, setSunoDescription] = useState(project.suno_description ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => setSunoDescription(project.suno_description ?? ''), [project.id, project.suno_description]);

  async function save() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${API}/projects/${project.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sunoDescription }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not save the SUNO description.');
      await onSaved();
      setMessage('SUNO description saved. Existing concepts and storyboard remain unchanged.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the SUNO description.'); }
    finally { setBusy(false); }
  }

  return <main><WorkspaceHeader title="Project settings" description="Keep the song’s original creative direction with your project." />
    <section className="panel project-details"><h2>Song context</h2><label>SUNO description <span className="optional">(optional)</span><textarea rows={10} value={sunoDescription} onChange={event => setSunoDescription(event.target.value)} placeholder="Paste the original SUNO song description or prompt here." /></label><p>Paste the original SUNO song description or prompt here. This helps the AI understand the song's style, mood, instruments and overall direction.</p><button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save project settings'}</button>{message && <p className={message.startsWith('SUNO') ? 'settings-message' : 'inline-error'}>{message}</p>}</section>
  </main>;
}
