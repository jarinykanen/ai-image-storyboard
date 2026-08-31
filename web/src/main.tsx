import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { VisualIdentity, type VisualIdentityData } from './VisualIdentity';
import { VisualConcepts, type VisualConcept } from './VisualConcepts';
import { Storyboard, type StoryboardShot } from './Storyboard';
import { SettingsPage } from './Settings';
import { ProjectImageSettings } from './ProjectImageSettings';
import { ProjectLayout, type ProjectView } from './ProjectLayout';
import { ProjectDetails } from './ProjectDetails';

const API = 'http://localhost:3001/api';

type Project = { id:string; title:string; lyrics:string; suno_description?:string | null; visual_style:string; aspect_ratio:string; image_provider:string; image_quality_preset?:string; storyboard_approach?:'narrative'|'performance'|'abstract'|'mixed' };
type ActiveProject = { project: Project; shots: StoryboardShot[]; storyboardPlan?:{summary:string;motifs:string[]}|null; visualIdentity: VisualIdentityData; concepts: VisualConcept[] };
type ProviderSettings = { configured:boolean; status:string; capabilities: { textGeneration:boolean; imageGeneration:boolean; imageEditing:boolean; referenceImages:boolean } };
type ProviderRegistry = { providers: Record<'openai'|'grok', ProviderSettings>; defaultTextProvider: 'openai'|'grok'|null; defaultImageProvider: 'openai'|'grok'|null };

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<ActiveProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ProjectView>('concepts');
  const [showSettings, setShowSettings] = useState(false);
  const [providers, setProviders] = useState<ProviderRegistry | null>(null);
  const [error, setError] = useState('');

  const refresh = async () => setProjects(await (await fetch(`${API}/projects`)).json());
  const projectIdFromUrl = () => new URLSearchParams(window.location.search).get('project');
  const updateProjectUrl = (id: string | null, replace = false) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('project', id);
    else url.searchParams.delete('project');
    window.history[replace ? 'replaceState' : 'pushState']({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    void refresh();
    void fetch(`${API}/settings/providers`).then(response => response.json()).then(setProviders).catch(() => undefined);
    const handlePopState = () => {
      const projectId = projectIdFromUrl();
      if (projectId) void openProject(projectId, false);
      else setActive(null);
    };
    handlePopState();
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  async function createProject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    const r = await fetch(`${API}/projects`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    if (!r.ok) { setError((await r.json()).error || 'Could not create the project.'); return; }
    const { id } = await r.json();
    await openProject(id);
    await refresh();
  }

  async function openProject(id:string, updateUrl = true) {
    const response = await fetch(`${API}/projects/${id}`);
    if (!response.ok) {
      setError('Could not open this project.');
      if (!updateUrl && projectIdFromUrl() === id) updateProjectUrl(null, true);
      return;
    }
    setActive(await response.json());
    if (updateUrl && projectIdFromUrl() !== id) updateProjectUrl(id);
  }

  function closeProject(replaceUrl = false) {
    setActive(null);
    if (projectIdFromUrl()) updateProjectUrl(null, replaceUrl);
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(`Remove “${project.title}”? This permanently removes its storyboard, visual identity, and generated-image history.`)) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/projects/${project.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not remove the project.');
      if (active?.project.id === project.id) closeProject(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the project.');
    } finally {
      setBusy(false);
    }
  }


  if (showSettings) return <SettingsPage onSaved={() => { setShowSettings(false); void fetch(`${API}/settings/providers`).then(response => response.json()).then(setProviders); }} />;
  if (active) {
    const refreshActive = () => openProject(active.project.id);
    const sidebar = view === 'storyboard' ? <ProjectImageSettings project={active.project as any} onSaved={refreshActive} /> : view === 'concepts' ? <section className="context-info"><h2>Creative direction</h2><p>{active.project.visual_style}</p><hr/><h3>Concepts</h3><p>Generate text concepts or create your own direction. Reference images remain an explicit action.</p></section> : view === 'identity' ? <section className="context-info"><h2>Selected direction</h2><p>{active.concepts.find(c => c.status === 'selected')?.title || 'Choose a concept to guide the visual identity.'}</p><hr/><h3>Visual references</h3><p>Style, characters, and locations make future images feel consistent.</p></section> : <section className="context-info"><h2>Project settings</h2><p>Update song context without generating or changing images.</p></section>;
    const page = view === 'identity' ? <VisualIdentity key={JSON.stringify(active.visualIdentity)} projectId={active.project.id} identity={active.visualIdentity} onRefresh={refreshActive} /> : view === 'concepts' ? <VisualConcepts projectId={active.project.id} concepts={active.concepts} onRefresh={refreshActive} /> : view === 'settings' ? <ProjectDetails project={active.project} onSaved={refreshActive} /> : <Storyboard projectId={active.project.id} shots={active.shots} identity={active.visualIdentity} onRefresh={refreshActive} />;
    return <ProjectLayout projectTitle={active.project.title} view={view} onBack={() => closeProject()} onViewChange={setView} sidebar={sidebar}>{page}</ProjectLayout>;
  }

  const imageProviders = (['openai', 'grok'] as const).filter(provider => providers?.providers[provider].capabilities.imageGeneration);
  const configuredImageProviders = imageProviders.filter(provider => providers?.providers[provider].configured);
  const openaiConfigured = configuredImageProviders.includes('openai');
  const grokConfigured = configuredImageProviders.includes('grok');
  const defaultImageProvider = providers?.defaultImageProvider ?? 'openai';
  return <main className="projects-home"><header><div><h1>AI Music Video Studio</h1><p>Create storyboard images without managing prompts manually.</p></div><button className="secondary" onClick={() => setShowSettings(true)}>Settings</button></header>{error && <div className="inline-error notice">{error}</div>}
    <section className="panel"><h2>New project</h2><form onSubmit={createProject}>
      <label>Project title<input name="title" required placeholder="Neon Dreams"/></label>
      <label>Lyrics <span className="optional">(optional)</span><textarea name="lyrics" rows={8} placeholder="Paste lyrics here…"/></label>
      <label>SUNO description <span className="optional">(optional)</span><textarea name="sunoDescription" rows={6} placeholder="Paste the original SUNO song description or prompt here."/><small>Paste the original SUNO song description or prompt here. This helps the AI understand the song's style, mood, instruments and overall direction.</small></label>
      <label>Visual direction<textarea name="visualStyle" required rows={3} placeholder="Describe the kind of video you want: dark cinematic story, dreamy summer road trip, surreal sci-fi, energetic performance video…"/></label>
      <div className="row"><label>Format<select name="aspectRatio" defaultValue="16:9"><option>16:9</option><option>9:16</option><option>1:1</option></select></label><label>Image quality<select name="imageQualityPreset" defaultValue="standard"><option value="draft">Draft — cheapest, for storyboard previews</option><option value="standard">Standard — normal quality</option><option value="best">Best — highest quality, higher cost</option></select></label>
      <label>Image provider<select name="imageProvider" defaultValue={defaultImageProvider} disabled={!configuredImageProviders.length}>{imageProviders.map(provider => <option key={provider} value={provider} disabled={!providers?.providers[provider].configured}>{provider === 'openai' ? 'OpenAI' : 'xAI / Grok'}{!providers?.providers[provider].configured ? ' — Not configured' : ''}</option>)}</select></label></div>
      {!openaiConfigured && !grokConfigured && <div className="inline-error">Connect an image provider in <button className="link-button" type="button" onClick={() => setShowSettings(true)}>Settings</button> to create a project.</div>}
      <button disabled={!openaiConfigured && !grokConfigured}>Create project</button>
    </form></section>
    {!!projects.length && <section><h2>Projects</h2><div className="projects">{projects.map(p => <div className="project" key={p.id}><button className="project-open" disabled={busy} onClick={()=>openProject(p.id)}><strong>{p.title}</strong><span>{p.visual_style}</span></button><button className="danger" disabled={busy} onClick={()=>deleteProject(p)}>Remove</button></div>)}</div></section>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App/>);
