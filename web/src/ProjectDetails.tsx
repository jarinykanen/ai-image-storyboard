import { useEffect, useState } from 'react';
import { WorkspaceHeader } from './AppLayout';
import { Button, Checkbox, Paper, Select, Stack, Text, Textarea } from '@mantine/core';
import { ProjectImageSettings } from './ProjectImageSettings';

const API = 'http://localhost:3001/api';

const targetLabels:Record<string,string>={youtube:'YouTube','youtube-shorts':'YouTube Shorts',tiktok:'TikTok',spotify:'Spotify',landscape:'Generic Landscape',vertical:'Generic Vertical',square:'Generic Square'};
type Project = { id:string; lyrics?:string; suno_description?:string|null; publishing_targets?:string; primary_visual_format?:string; image_provider:'openai'|'grok'; image_quality_preset?:'draft'|'standard'|'best'; image_model_override?:string|null; image_resolution_override?:string|null };
export function ProjectDetails({ project, onSaved }: { project: Project; onSaved: () => Promise<void> }) {
  const [lyrics, setLyrics] = useState(project.lyrics ?? '');
  const [sunoDescription, setSunoDescription] = useState(project.suno_description ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [targets,setTargets]=useState<string[]>(()=>JSON.parse(project.publishing_targets||'[]'));
  const [primary,setPrimary]=useState(project.primary_visual_format||'landscape');

  useEffect(() => { setLyrics(project.lyrics ?? ''); setSunoDescription(project.suno_description ?? ''); }, [project.id, project.lyrics, project.suno_description]);

  async function save() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${API}/projects/${project.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lyrics, sunoDescription }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not save the SUNO description.');
      await onSaved();
      setMessage('Lyrics and SUNO description saved. Existing concepts and storyboard remain unchanged.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the SUNO description.'); }
    finally { setBusy(false); }
  }
  async function savePublishing(){setBusy(true);setMessage('');try{const r=await fetch(`${API}/projects/${project.id}/publishing`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({publishingTargets:targets,primaryVisualFormat:targets.includes(primary)?primary:(targets[0]||'landscape')})});if(!r.ok)throw new Error((await r.json()).error||'Could not save publishing targets.');await onSaved();setMessage('Publishing targets saved. No images were generated or changed.');}catch(e){setMessage(e instanceof Error?e.message:'Could not save publishing targets.')}finally{setBusy(false)}}

  return <main><WorkspaceHeader title="General settings" description="Manage project-wide defaults and creative context." />
    <Paper className="panel project-details" p="lg"><ProjectImageSettings project={project} onSaved={onSaved}/></Paper>
    <Paper className="panel project-details" p="lg"><Stack><h2>Song context</h2><Textarea label="SUNO description (optional)" autosize minRows={4} maxRows={16} resize="vertical" value={sunoDescription} onChange={event => setSunoDescription(event.target.value)} placeholder="Paste the original SUNO song description or prompt here." /><Text>Paste the original SUNO song description or prompt here. This helps the AI understand the song's style, mood, instruments and overall direction.</Text><Textarea label="Lyrics (optional)" autosize minRows={6} maxRows={24} resize="vertical" value={lyrics} onChange={event => setLyrics(event.target.value)} placeholder="Paste or update the song lyrics here." /><Button loading={busy} onClick={() => void save()}>Save project settings</Button></Stack></Paper><Paper className="panel project-details" p="lg"><Stack><h2>Publishing targets</h2><Text>Targets guide future generation and artwork only. Existing images are never regenerated.</Text>{Object.entries(targetLabels).map(([id,label])=><Checkbox key={id} label={label} checked={targets.includes(id)} onChange={e=>setTargets(e.target.checked?[...targets,id]:targets.filter(x=>x!==id))}/>) }<Select label="Primary visual format" value={targets.includes(primary)?primary:(targets[0]||'landscape')} onChange={value=>setPrimary(value || 'landscape')} data={(targets.length?targets:['landscape']).map(id=>({value:id,label:targetLabels[id]}))}/><Button loading={busy} onClick={()=>void savePublishing()}>Save publishing targets</Button>{message && <Text className={message.startsWith('SUNO')||message.startsWith('Publishing') ? 'settings-message' : 'inline-error'}>{message}</Text>}</Stack></Paper>
  </main>;
}
