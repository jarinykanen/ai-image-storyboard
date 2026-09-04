import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@mantine/core/styles.css';
import { ActionIcon, Alert, Button, Group, MantineProvider, Paper, Table, Text, Tooltip } from '@mantine/core';
import './styles.css';
import { VisualIdentity, VisualIdentitySidebar, type VisualIdentityData } from './VisualIdentity';
import { VisualConcepts, type VisualConcept } from './VisualConcepts';
import { Storyboard, type StoryboardShot, type StoryboardReview } from './Storyboard';
import { SettingsPage } from './Settings';
import { ProjectLayout, type ProjectView } from './ProjectLayout';
import { ProjectDetails } from './ProjectDetails';
import { ArtworkPage } from './Artwork';
import { studioTheme } from './theme';
import { ConfirmModal } from './ConfirmModal';
import { AppLayout, WorkspaceHeader } from './AppLayout';
import { ProjectCreationModal } from './ProjectCreationModal';

const API = 'http://localhost:3001/api';

type Project = { id:string; title:string; lyrics:string; suno_description?:string | null; visual_style:string; aspect_ratio:string; image_provider:'openai'|'grok'; image_quality_preset?:'draft'|'standard'|'best'; image_model_override?:string|null; image_resolution_override?:string|null; storyboard_approach?:'narrative'|'performance'|'abstract'|'mixed'; publishing_targets?:string; primary_visual_format?:string; selected_concept_id?:string|null; created_at:string };
type ActiveProject = { project: Project; shots: StoryboardShot[]; storyboardPlan?:{summary:string;motifs:string[]}|null; visualIdentity: VisualIdentityData; concepts: VisualConcept[]; storyboardReview: StoryboardReview|null; artwork:any[] };
type ProviderSettings = { configured:boolean; status:string; capabilities: { textGeneration:boolean; imageGeneration:boolean; imageEditing:boolean; referenceImages:boolean } };
type ProviderRegistry = { providers: Record<'openai'|'grok', ProviderSettings>; defaultTextProvider: 'openai'|'grok'|null; defaultImageProvider: 'openai'|'grok'|null };

function ArrowRightIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>;
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<ActiveProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ProjectView>('concepts');
  const [showSettings, setShowSettings] = useState(false);
  const [providers, setProviders] = useState<ProviderRegistry | null>(null);
  const [error, setError] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [createOpened, setCreateOpened] = useState(false);
  const [creating, setCreating] = useState(false);

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
    setCreating(true);
    setError('');
    try {
      const fd = new FormData(e.currentTarget);
      const body = Object.fromEntries(fd.entries());
      const r = await fetch(`${API}/projects`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not create the project.');
      const { id } = await r.json();
      await openProject(id);
      await refresh();
      setCreateOpened(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the project.');
    } finally {
      setCreating(false);
    }
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

  const closeSettings = () => {
    setShowSettings(false);
    void fetch(`${API}/settings/providers`).then(response => response.json()).then(setProviders);
  };

  if (showSettings) return <AppLayout headerStart={<Button variant="subtle" className="nav-back" onClick={closeSettings}>← <span>Projects</span></Button>} headerEnd={<Text className="app-brand">AI Music Video Studio</Text>}><SettingsPage onSaved={closeSettings} /></AppLayout>;
  if (active) {
    const refreshActive = () => openProject(active.project.id);
    const selectedConcept = active.concepts.find(concept => concept.id === active.project.selected_concept_id) ?? active.concepts.find(concept => concept.status === 'selected');
    const sidebar = view === 'concepts' ? <section className="context-info"><h2>Creative direction</h2><p>{active.project.visual_style}</p><hr/><h3>Concepts</h3><p>Generate text concepts or create your own direction. Reference images remain an explicit action.</p></section> : view === 'identity' ? <VisualIdentitySidebar selectedConcept={selectedConcept} /> : <section className="context-info"><h2>{view === 'settings' ? 'General settings' : 'Project context'}</h2><p>{view === 'settings' ? 'Defaults here apply across image generation and can be overridden before each generation.' : 'Image generation uses the project defaults unless you override the quality in the confirmation window.'}</p></section>;
    const defaultQuality = active.project.image_quality_preset ?? 'standard';
    const needsConcept = !selectedConcept && view !== 'concepts' && view !== 'settings';
    const page = needsConcept ? <><WorkspaceHeader title="Select a creative direction" description="Visual identity, storyboard, images, and artwork are kept separately for each concept."/><Paper p="lg"><Text mb="md">Choose a concept to open its workspace.</Text><Button onClick={()=>setView('concepts')}>Choose a concept</Button></Paper></> : view === 'identity' ? <VisualIdentity key={JSON.stringify(active.visualIdentity)} projectId={active.project.id} identity={active.visualIdentity} selectedConcept={selectedConcept} defaultQuality={defaultQuality} onRefresh={refreshActive} /> : view === 'concepts' ? <VisualConcepts projectId={active.project.id} concepts={active.concepts} defaultQuality={defaultQuality} onRefresh={refreshActive} /> : view === 'settings' ? <ProjectDetails project={active.project} onSaved={refreshActive} /> : view === 'artwork' ? <ArtworkPage project={active.project} artwork={active.artwork} shots={active.shots} onRefresh={refreshActive}/> : <Storyboard projectId={active.project.id} shots={active.shots} identity={active.visualIdentity} review={active.storyboardReview} defaultQuality={defaultQuality} onRefresh={refreshActive} />;
    return <ProjectLayout projectTitle={active.project.title} view={view} onBack={() => closeProject()} onViewChange={setView} sidebar={sidebar}>{page}</ProjectLayout>;
  }

  const imageProviders = (['openai', 'grok'] as const).filter(provider => providers?.providers[provider].capabilities.imageGeneration);
  const configuredImageProviders = imageProviders.filter(provider => providers?.providers[provider].configured);
  const configuredDefaultProvider = providers?.defaultImageProvider && configuredImageProviders.includes(providers.defaultImageProvider) ? providers.defaultImageProvider : configuredImageProviders[0] ?? 'openai';
  return <AppLayout headerStart={<Text className="app-brand">AI Music Video Studio</Text>} headerEnd={<Button variant="default" onClick={() => setShowSettings(true)}>Settings</Button>}>
    <WorkspaceHeader title="Projects" description="Create storyboard images without managing prompts manually." actions={<Button onClick={() => { setError(''); setCreateOpened(true); }}>+ New project</Button>} />
    {error && !createOpened && <Alert color="red" mb="md">{error}</Alert>}
    {!!projects.length ? <Paper className="project-table" p={0}><Table.ScrollContainer minWidth={520}><Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>Title</Table.Th><Table.Th>Created at</Table.Th><Table.Th className="project-actions-column">Actions</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{projects.map(project => <Table.Tr key={project.id}><Table.Td><Text fw={600}>{project.title}</Text></Table.Td><Table.Td><Text c="dimmed" size="sm" title={project.created_at}>{formatCreatedAt(project.created_at)}</Text></Table.Td><Table.Td className="project-actions-column"><Group gap="xs" justify="flex-end" wrap="nowrap"><Tooltip label="Open project"><ActionIcon variant="subtle" size="lg" disabled={busy} aria-label={`Open ${project.title}`} onClick={() => openProject(project.id)}><ArrowRightIcon /></ActionIcon></Tooltip><Tooltip label="Remove project"><ActionIcon variant="subtle" color="red" size="lg" disabled={busy} aria-label={`Remove ${project.title}`} onClick={() => setProjectToDelete(project)}><TrashIcon /></ActionIcon></Tooltip></Group></Table.Td></Table.Tr>)}</Table.Tbody>
    </Table></Table.ScrollContainer></Paper> : <Paper className="panel empty-projects" p="lg"><h2>No projects yet</h2><p>Create your first project to start developing its visual direction and storyboard.</p><Button onClick={() => { setError(''); setCreateOpened(true); }}>Create project</Button></Paper>}
    <ProjectCreationModal opened={createOpened} loading={creating} error={error} imageProviders={imageProviders} configuredImageProviders={configuredImageProviders} defaultImageProvider={configuredDefaultProvider} onClose={() => { if (!creating) { setCreateOpened(false); setError(''); } }} onOpenSettings={() => { setCreateOpened(false); setError(''); setShowSettings(true); }} onSubmit={createProject} />
    <ConfirmModal opened={!!projectToDelete} title="Remove project?" message={projectToDelete ? `Remove “${projectToDelete.title}”? This permanently removes its storyboard, visual identity, and generated-image history.` : ''} confirmLabel="Remove project" confirmColor="red" loading={busy} onCancel={()=>setProjectToDelete(null)} onConfirm={()=>{if(projectToDelete) void deleteProject(projectToDelete).finally(()=>setProjectToDelete(null));}} />
  </AppLayout>;
}

createRoot(document.getElementById('root')!).render(<MantineProvider theme={studioTheme} defaultColorScheme="dark"><App/></MantineProvider>);
