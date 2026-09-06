import type { VisualConcept } from './visual-concepts.js';
import type { VisualIdentity } from './visual-identity.js';
import { buildProjectContext, projectType, type ProjectContextInput } from './project-context.js';

export type ReferencePromptType = 'character' | 'location';

type ReferenceProjectContext = ProjectContextInput & {
  title: string;
  visual_style: string;
  aspect_ratio: string;
};

function detailDirection(type: ReferencePromptType, detailLevel: number) {
  if (detailLevel <= 20) return 'Use one or two concise sentences containing only the most recognizable details.';
  if (detailLevel <= 40) return 'Use a short practical description with a few distinctive visual details.';
  if (detailLevel <= 60) return `Use balanced detail covering the main ${type === 'character' ? 'appearance, wardrobe, and presence' : 'layout, materials, lighting, and atmosphere'}.`;
  if (detailLevel <= 80) return `Use rich, specific detail covering ${type === 'character' ? 'appearance, facial features, hair, wardrobe, silhouette, age cues, and presence' : 'layout, architecture, materials, recurring objects, lighting, weather, and atmosphere'}.`;
  return `Make the description extremely detailed and reference-ready, precisely defining ${type === 'character' ? 'appearance, facial features, hair, body type, wardrobe, accessories, textures, silhouette, age cues, and presence' : 'spatial layout, architecture, materials, surfaces, recurring objects, lighting sources, weather, palette, texture, and atmosphere'}.`;
}

function referenceList(identity: VisualIdentity) {
  const items = [...identity.characters, ...identity.locations];
  return items.map(item => `- ${item.name}: ${item.description}`).join('\n') || '- None defined';
}

export function buildVisualReferencePrompt(input: {
  type: ReferencePromptType;
  idea: string;
  detailLevel: number;
  project?: ReferenceProjectContext;
  identity?: VisualIdentity;
  concept?: VisualConcept | null;
  storyboard?: { summary: string; narrativeArc: string; motifs: string[] } | null;
}) {
  const subjectGuidance = input.type === 'character'
    ? 'Describe one visually consistent person or performer. Focus on stable traits that can be reused across storyboard shots; do not describe a scene, pose sequence, or camera setup.'
    : 'Describe one visually consistent place or environment. Focus on stable spatial and visual traits that can be reused across storyboard shots; do not describe a sequence of events or camera setup.';
  const context = input.project && input.identity
    ? `\n\nSECONDARY PROJECT CONTEXT (use only to fill gaps left by the manual direction):\nProject: ${input.project.title}\nAspect ratio: ${input.project.aspect_ratio}\nVisual identity style: ${input.identity.style.description || input.project.visual_style}\nSelected visual concept: ${input.concept ? `${input.concept.title} — ${input.concept.description}. Mood: ${input.concept.mood}. Style: ${input.concept.visualStyle}. Color and lighting: ${input.concept.colorAndLighting}. Narrative: ${input.concept.narrativeDirection}` : 'None selected.'}\nStoryboard direction: ${input.storyboard ? `${input.storyboard.summary}. Narrative arc: ${input.storyboard.narrativeArc}. Motifs: ${input.storyboard.motifs.join(', ') || 'None'}.` : 'No storyboard plan yet.'}\nExisting visual references (complement these and avoid accidental duplicates unless the manual direction asks for one):\n${referenceList(input.identity)}\n${buildProjectContext(input.project)}`
    : '';

  return `Create text details for a new ${input.project && projectType(input.project) === 'music_video' ? 'music-video ' : ''}${input.type} reference.\n\nRequested reference detail: ${input.detailLevel}/100. ${detailDirection(input.type, input.detailLevel)} ${subjectGuidance}${context}\n\nHIGHEST PRIORITY — USER'S MANUAL DIRECTION:\n${input.idea.trim()}\n\nThe manual direction overrides every conflicting detail in the project context, including the visual style. Preserve every concrete trait, subject, object, relationship, and constraint from it in the generated description. The detail level controls how much compatible elaboration to add; it is never permission to omit manual instructions. Use project context only for compatible details the user did not specify. The result must visibly and specifically reflect the manual direction rather than replacing it with a generalized interpretation. Do not mention the project, source material, prompt, or these instructions. Use a short memorable name and plain, production-useful visual language. Return ONLY JSON: {"name":"...","description":"..."}.`;
}

export function buildVisualReferenceImagePrompt(input: {
  type: ReferencePromptType;
  name: string;
  description: string;
  visualStyle: string;
}) {
  const composition = input.type === 'character'
    ? 'Create one clear character reference image centered on the described person. Show the stable appearance and wardrobe clearly. Do not add other people or narrative scene elements unless the reference specification explicitly requests them.'
    : 'Create one clear location reference image centered on the described environment. Show its stable spatial and environmental traits clearly. Do not add people, figures, creatures, vehicles, buildings, or narrative action unless the reference specification explicitly requests them.';

  return `${composition}\n\nSECONDARY AESTHETIC GUIDANCE:\n${input.visualStyle || 'Cinematic visual imagery.'}\nUse this only for compatible rendering qualities such as medium, palette, texture, and photographic or illustrative treatment. Never copy or introduce its subjects, setting, architecture, objects, weather, lighting scenario, or story content.\n\nHIGHEST PRIORITY — ${input.type.toUpperCase()} REFERENCE SPECIFICATION:\nName: ${input.name.trim()}\nDescription: ${input.description.trim()}\n\nThe image must visibly and specifically depict every concrete detail and respect every negative constraint in the reference specification. If any aesthetic guidance conflicts with the specification, the specification wins. Do not reinterpret the subject through project themes or invent contrasting story imagery. Do not include text, captions, signs, logos, or watermarks.`;
}
