import { buildProjectContext, projectType, type ProjectType } from './project-context.js';
import type { VisualConcept } from './visual-concepts.js';
import type { VisualIdentity } from './visual-identity.js';
import type { ShotComposition } from './video-prompt-options.js';

type VideoPromptProject = { title: string; project_type?: ProjectType; creative_brief?: string | null; lyrics: string; suno_description?: string | null; visual_style: string; aspect_ratio: string };
type VideoPromptShot = { title: string; section: string; description: string; action: string; shotType: string; camera: string; mood: string; characterIds: string[]; locationId: string | null; durationSeconds: number };

function seconds(value: number) { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))); }

/** Creates copy-ready direction for Grok Imagine without making a provider request. */
export function buildGrokImagineVideoPrompt(input: { project: VideoPromptProject; identity: VisualIdentity; concept: VisualConcept | null; shot: VideoPromptShot; shotComposition?: ShotComposition | null }) {
  const characters = input.shot.characterIds.map(id => input.identity.characters.find(item => item.id === id)).filter((item): item is VisualIdentity['characters'][number] => Boolean(item));
  const location = input.shot.locationId ? input.identity.locations.find(item => item.id === input.shot.locationId) ?? null : null;
  const style = input.identity.style.description || input.project.visual_style || 'cinematic visual continuity';
  const characterDirection = characters.length ? `Characters: ${characters.map(item => `${item.name} — ${item.description}`).join(' ')} Preserve their recognizable appearance, wardrobe, and relationships throughout the clip.` : 'No named character reference is assigned to this shot.';
  const locationDirection = location ? `Location: ${location.name} — ${location.description}. Preserve environmental continuity.` : 'Use an environment that supports the shot without introducing a conflicting new location.';
  const conceptDirection = input.concept ? `Selected visual concept: ${input.concept.title}. ${input.concept.description}. Mood: ${input.concept.mood}. Style: ${input.concept.visualStyle}. Lighting: ${input.concept.colorAndLighting}.` : '';
  const duration = seconds(input.shot.durationSeconds);
  const compositionDirection = input.shotComposition ? `PRIMARY SHOT COMPOSITION — ${input.shotComposition.name}: ${input.shotComposition.description} This composition is mandatory and takes priority over any general framing language.` : '';

  return `Create one continuous ${duration}-second ${projectType(input.project) === 'music_video' ? 'music-video ' : ''}clip in ${input.project.aspect_ratio}. Project: ${input.project.title}. ${buildProjectContext(input.project)}\n\nVisual direction: ${style}. ${conceptDirection}\n\n${characterDirection}\n${locationDirection}\n\n${compositionDirection}\n\nShot: ${input.shot.title} (${input.shot.section}). Scene: ${input.shot.description}. Visible action and motion: ${input.shot.action}. Composition: ${input.shot.shotType}. Camera direction: ${input.shot.camera}. Mood: ${input.shot.mood}.\n\nMake the one clear primary action unfold and complete naturally within exactly ${duration} seconds. Use one coherent scene with natural, believable motion and physics. Keep character identity, wardrobe, environment, lighting, scale, and visual identity stable from beginning to end. ${input.shotComposition ? `Preserve ${input.shotComposition.name} throughout the clip as the dominant composition.` : ''} Let camera movement support the specified framing. No cuts, transitions, scene changes, extra subjects, or layout changes. No text, captions, logos, watermarks, split screens, panels, or UI.`;
}
