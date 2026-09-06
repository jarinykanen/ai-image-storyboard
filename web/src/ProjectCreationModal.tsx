import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Divider, Group, Modal, SegmentedControl, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';

type ImageProvider = 'openai' | 'grok';
type ProjectType = 'general' | 'music_video';
export type ProjectDraft = { title:string; projectType:ProjectType; creativeBrief:string; visualStyle:string; lyrics:string; sunoDescription:string; aspectRatio:'16:9'|'9:16'|'1:1'; warnings:string[] };

type ProjectCreationModalProps = {
  opened:boolean; loading:boolean; error:string; imageProviders:ImageProvider[]; configuredImageProviders:ImageProvider[];
  defaultImageProvider:ImageProvider; textAnalysisAvailable:boolean; onClose:()=>void; onOpenSettings:()=>void;
  onAnalyze:(source:string)=>Promise<ProjectDraft>; onSubmit:(event:FormEvent<HTMLFormElement>)=>void;
};

const emptyDraft:ProjectDraft={title:'',projectType:'general',creativeBrief:'',visualStyle:'',lyrics:'',sunoDescription:'',aspectRatio:'16:9',warnings:[]};

export function ProjectCreationModal({opened,loading,error,imageProviders,configuredImageProviders,defaultImageProvider,textAnalysisAvailable,onClose,onOpenSettings,onAnalyze,onSubmit}:ProjectCreationModalProps){
  const [setupMode,setSetupMode]=useState<'manual'|'import'>('manual');
  const [draft,setDraft]=useState<ProjectDraft>(emptyDraft);
  const [source,setSource]=useState('');
  const [analyzing,setAnalyzing]=useState(false);
  const [analysisError,setAnalysisError]=useState('');
  useEffect(()=>{if(opened){setSetupMode('manual');setDraft(emptyDraft);setSource('');setAnalysisError('');}},[opened]);
  const update=<K extends keyof ProjectDraft>(key:K,value:ProjectDraft[K])=>setDraft(current=>({...current,[key]:value}));
  const analyze=async()=>{setAnalyzing(true);setAnalysisError('');try{setDraft(await onAnalyze(source));}catch(e){setAnalysisError(e instanceof Error?e.message:'Could not analyze that content.');}finally{setAnalyzing(false);}};
  const music=draft.projectType==='music_video';
  const availableProviders:ImageProvider[]=imageProviders.length?imageProviders:['openai','grok'];
  const providerData=availableProviders.map(provider=>({value:provider,label:`${provider==='openai'?'OpenAI':'xAI / Grok'}${!configuredImageProviders.includes(provider)?' — connect later':''}`}));
  return <Modal opened={opened} onClose={onClose} title="Create project" size="xl" centered closeOnClickOutside={!loading&&!analyzing} closeOnEscape={!loading&&!analyzing}>
    <form onSubmit={onSubmit}><Stack gap="md">
      <SegmentedControl fullWidth value={setupMode} onChange={value=>setSetupMode(value as 'manual'|'import')} data={[{value:'manual',label:'Start manually'},{value:'import',label:'Import AI response'}]}/>
      {setupMode==='import'&&<Stack gap="sm">
        <Textarea label="Content from another AI" description="Paste prose, Markdown, lists, JSON, or any other concept format." value={source} onChange={event=>setSource(event.target.value)} minRows={7} maxRows={16} autosize placeholder="Paste the complete concept or creative response here…"/>
        <Group justify="space-between"><Text size="sm" c="dimmed">Using it as a brief makes no AI call. Analysis is optional and never creates images.</Text><Group gap="sm"><Button type="button" variant="default" disabled={!source.trim()||analyzing} onClick={()=>{update('creativeBrief',source.trim());setAnalysisError('');}}>Use as creative brief</Button><Button type="button" loading={analyzing} disabled={!source.trim()||!textAnalysisAvailable} onClick={()=>void analyze()}>Analyze and organize</Button></Group></Group>
        {!textAnalysisAvailable&&<Alert color="blue">Connect a text provider in <Button type="button" variant="transparent" px={4} onClick={onOpenSettings}>Settings</Button> to analyze automatically. You can still use the text directly and create the project manually.</Alert>}
        {analysisError&&<Alert color="red">{analysisError}</Alert>}
        {!!draft.warnings.length&&<Alert color="yellow" title="Review these suggestions">{draft.warnings.map(warning=><Text size="sm" key={warning}>• {warning}</Text>)}</Alert>}
        <Divider label="Review and edit the project draft" labelPosition="center"/>
      </Stack>}
      <TextInput name="title" label="Project title" required placeholder="Untitled concept" value={draft.title} onChange={event=>update('title',event.target.value)} autoFocus={setupMode==='manual'}/>
      <Select name="projectType" label="Project type" value={draft.projectType} onChange={value=>update('projectType',(value||'general') as ProjectType)} allowDeselect={false} data={[{value:'general',label:'General concept'},{value:'music_video',label:'Music video'}]}/>
      <Textarea name="creativeBrief" label="Creative brief (optional)" minRows={5} value={draft.creativeBrief} onChange={event=>update('creativeBrief',event.target.value)} placeholder="Describe the idea, purpose, subjects, setting, themes, audience, or desired result…"/>
      <Textarea name="visualStyle" label="Visual direction (optional)" minRows={3} value={draft.visualStyle} onChange={event=>update('visualStyle',event.target.value)} placeholder="Describe the look, medium, mood, palette, lighting, or references…"/>
      {music&&<Stack gap="md"><Textarea name="lyrics" label="Lyrics (optional)" minRows={6} value={draft.lyrics} onChange={event=>update('lyrics',event.target.value)} placeholder="Paste lyrics here…"/><Textarea name="sunoDescription" label="SUNO description (optional)" minRows={4} value={draft.sunoDescription} onChange={event=>update('sunoDescription',event.target.value)} description="Optional musical context such as style, mood, instruments, vocals, and energy." placeholder="Paste the original SUNO description or prompt here."/></Stack>}
      {!music&&<><input type="hidden" name="lyrics" value={draft.lyrics}/><input type="hidden" name="sunoDescription" value={draft.sunoDescription}/></>}
      <Group grow align="start" className="project-create-options"><Select name="aspectRatio" label="Format" value={draft.aspectRatio} onChange={value=>update('aspectRatio',(value||'16:9') as ProjectDraft['aspectRatio'])} allowDeselect={false} data={['16:9','9:16','1:1']}/><Select name="imageQualityPreset" label="Generation tier" defaultValue="draft" data={[{value:'draft',label:'Draft — cheapest, for iteration'},{value:'standard',label:'Standard — balanced'},{value:'best',label:'Final — highest quality'}]}/><Select key={`${defaultImageProvider}-${configuredImageProviders.join('-')}`} name="imageProvider" label="Default image provider" defaultValue={defaultImageProvider} allowDeselect={false} data={providerData}/></Group>
      {!configuredImageProviders.length&&<Alert color="blue">No image provider is connected. You can create and edit the project manually, then connect one later if you want to generate images.</Alert>}
      {error&&<Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button type="button" variant="default" disabled={loading||analyzing} onClick={onClose}>Cancel</Button><Button type="submit" loading={loading} disabled={analyzing}>Create project</Button></Group>
    </Stack></form>
  </Modal>;
}
