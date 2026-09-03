import { useState } from 'react';
import { Alert, Button, Group, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { ConfirmModal } from './ConfirmModal';
import { ImageGenerationModal, type ImageQuality } from './ImageGenerationModal';
const API='http://localhost:3001/api'; type Asset={id:string;url:string;version:number;active:boolean};type Artwork={id:string;platform:string;sourceImage?:{id:string;url:string}|null;variants:Asset[]};
const labels:Record<string,string>={youtube:'YouTube','youtube-shorts':'YouTube Shorts',tiktok:'TikTok',spotify:'Spotify',landscape:'Generic Landscape',vertical:'Generic Vertical',square:'Generic Square'};
async function api(path:string,method:string,body?:unknown){const r=await fetch(API+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error((await r.json()).error||'Could not update artwork.');return r.json();}
export function ArtworkPage({project,artwork,shots,onRefresh}:{project:any;artwork:Artwork[];shots:any[];onRefresh:()=>Promise<void>}){const[platform,setPlatform]=useState(project.primary_visual_format||'landscape'),[count,setCount]=useState(3),[strategy,setStrategy]=useState('Cinematic'),[customStylePrompt,setCustomStylePrompt]=useState(''),[text,setText]=useState(project.title||''),[subtitle,setSubtitle]=useState(''),[style,setStyle]=useState('Bold impact'),[mood,setMood]=useState('Epic'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState<'generate'|'delete'|null>(null),[asset,setAsset]=useState<string|null>(null);const targets:string[]=JSON.parse(project.publishing_targets||'[]'),active=artwork.find(a=>a.platform===platform),shotsWithAssets=shots.map(s=>({...s,asset:s.generations?.find((g:any)=>g.active&&g.assetId)||s.generations?.find((g:any)=>g.assetId)})).filter(s=>s.asset);const run=async(f:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await f();await onRefresh()}catch(e){setError(e instanceof Error?e.message:'Could not complete artwork action.')}finally{setBusy(false)}};return <main className="artwork-page">
<header>
<div>
<h1>Artwork</h1>
<p>Create platform-ready thumbnails and covers without changing your storyboard.</p>
</div>
</header>
<Paper className="panel" p="lg">
<Stack>
<h2>Thumbnail generation</h2>
<SimpleGrid cols={{base:1,sm:3}}>
<Select label="Target" value={platform} onChange={v=>setPlatform(v||'landscape')} data={(targets.length?targets:['youtube','tiktok','spotify','landscape','vertical','square']).map(id=>({value:id,label:labels[id]}))}/>
<Select label="Creative direction" value={strategy} onChange={v=>setStrategy(v||'Cinematic')} data={['Cinematic','Character focused','Dramatic','Minimal','Mysterious','High contrast','Custom']}/>
<Select label="Variants" value={String(count)} onChange={v=>setCount(Number(v||3))} data={['2','3','4']}/>
</SimpleGrid>
<Textarea label="Custom style prompt (optional)" description="Describe the composition, atmosphere, colors, subjects, or details you want. This is combined with the project's locked visual identity." value={customStylePrompt} onChange={e=>setCustomStylePrompt(e.currentTarget.value)} minRows={4} autosize maxRows={10} maxLength={2000} placeholder="For example: A solitary singer in profile, surrounded by deep blue fog and a sharp amber rim light. Keep the composition sparse and cinematic."/>
<Stack className="artwork-text-controls" gap="sm">
<Text fw={600}>Thumbnail text</Text>
<Text size="sm" c="dimmed">Rendered into newly generated thumbnails and their downloads.</Text>
<TextInput label="Title" value={text} onChange={e=>setText(e.currentTarget.value)} maxLength={80} placeholder="Song name"/>
<TextInput label="Supporting text (optional)" value={subtitle} onChange={e=>setSubtitle(e.currentTarget.value)} maxLength={120}/>
<SimpleGrid cols={{base:1,sm:2}}>
<Select label="Text style" value={style} onChange={v=>setStyle(v||'Bold impact')} data={['Bold impact','Neon glow','Elegant serif','Handwritten','Clean minimal']}/>
<Select label="Text mood" value={mood} onChange={v=>setMood(v||'Epic')} data={['Energetic','Romantic','Dark','Dreamy','Epic']}/>
</SimpleGrid>
</Stack>
<Button loading={busy} onClick={()=>setConfirm('generate')}>Generate {count} variants</Button>{error&&<Alert color="red">{error}</Alert>}</Stack>
</Paper>
<Paper className="panel" p="lg">
<h2>{labels[platform]} artwork</h2>
<Text className="safe-area">Safe-area guides are preview-only and never baked into downloads.</Text>
<SimpleGrid className="comparison-grid" cols={{base:1,sm:2,lg:3}}>{active?.sourceImage&&<Paper className="comparison-image" p="sm">
<img src={active.sourceImage.url} alt="Selected storyboard source"/>
<Text size="sm">Selected storyboard image · linked, not copied</Text>
</Paper>}{active?.variants.map(v=>
<Paper className="comparison-image" p="sm" key={v.id}>
<img src={v.url} alt={`Artwork version ${v.version}`}/>
<Text size="sm">Version {v.version}{v.active?' · ACTIVE':''}</Text>
<Group>
<Button component="a" variant="default" href={`${API}/assets/${v.id}/download`}>Download</Button>
<Button color="red" disabled={busy} onClick={()=>{setAsset(v.id);setConfirm('delete')}}>Delete</Button>
</Group>
</Paper>)}</SimpleGrid>{!active?.sourceImage&&!active?.variants.length&&<Text>No artwork yet.</Text>}</Paper>
<Paper className="panel" p="lg">
<h2>Use storyboard image</h2>
<Text>Selecting a shot links it here. It does not create or copy an image.</Text>
<div className="storyboard-source-scroller">{shotsWithAssets.map(s=>
<Button key={s.id} className="storyboard-source-button" variant="default" disabled={busy} onClick={()=>void run(()=>api(`/projects/${project.id}/artwork/from-source`,'POST',{platform,assetId:s.asset.assetId}))}>
<span className="storyboard-source-content">
<img src={s.asset.assetUrl} alt=""/>
<span>Use shot {s.order}</span>
</span>
</Button>)}</div>
</Paper>
<ImageGenerationModal opened={confirm==='generate'} defaultQuality={(project.image_quality_preset || 'standard') as ImageQuality} title="Generate artwork variants?" message={`Generate ${count} ${labels[platform]} variants with this title treatment? This is a paid generation action.`} confirmLabel={`Generate ${count} variants`} loading={busy} onCancel={()=>setConfirm(null)} onConfirm={qualityPreset=>void run(()=>api(`/projects/${project.id}/artwork/generate`,'POST',{platform,count,strategy,customStylePrompt,text,subtitle,textConfig:{title:text,subtitle,style,mood},qualityPreset})).finally(()=>setConfirm(null))}/>
<ConfirmModal opened={confirm==='delete'} title="Delete artwork version?" message="Delete this artwork version? This cannot be undone." confirmLabel="Delete" confirmColor="red" loading={busy} onCancel={()=>setConfirm(null)} onConfirm={()=>{if(asset&&active)void run(()=>api(`/projects/${project.id}/artwork/${active.id}/assets/${asset}`,'DELETE')).finally(()=>setConfirm(null));}}/>
</main>}
