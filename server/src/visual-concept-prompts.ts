import { buildSongContext } from './song-context.js';

export type ConceptPromptInput = {
  title: string;
  lyrics: string;
  visualDirection: string;
  aspectRatio: string;
  sunoDescription?: string | null;
  videoType?: string;
};

export function buildConceptTextPrompt(input: ConceptPromptInput) {
  return `Develop exactly three clearly different visual concepts for a music video. Each must take a distinct narrative approach, setting, visual language, palette, and emotional tone; do not make minor variations of one concept. Keep each description concise and understandable without production jargon.

Project: ${input.title}
User's visual direction: ${input.visualDirection}
${input.videoType ? `Video type: ${input.videoType}\n` : ''}${buildSongContext(input)}

Return ONLY JSON: {"concepts":[{"title":"...","description":"...","mood":"...","visualStyle":"...","colorAndLighting":"...","narrativeDirection":"..."}]}.`;
}

export function buildConceptImagePrompt(concept: { title: string; description: string; mood: string; visual_style: string; color_and_lighting: string; narrative_direction: string }) {
  return `Create a cinematic reference image for the music video concept "${concept.title}". ${concept.description}. Mood: ${concept.mood}. Visual style: ${concept.visual_style}. Color and lighting: ${concept.color_and_lighting}. Narrative direction: ${concept.narrative_direction}. This is an evocative visual keyframe, not a poster. Do not include text, captions, logos, or watermarks.`;
}

export function buildSingleConceptPrompt(input: ConceptPromptInput, existingTitles: string[]) {
  return `Create one new visual concept for this music video. It must be meaningfully different from these existing concepts: ${existingTitles.join(', ') || 'none'}. Keep it concise and understandable without production jargon.\n\nProject: ${input.title}\nUser's visual direction: ${input.visualDirection}\n${buildSongContext(input)}\n\nReturn ONLY JSON: {"title":"...","description":"...","mood":"...","visualStyle":"...","colorAndLighting":"...","narrativeDirection":"..."}.`;
}

export function buildExternalConceptPrompt(input: ConceptPromptInput, existingTitles: string[]) {
  return `Create one visual concept for this music video. Make it a coherent creative direction that could guide the video's visual identity and storyboard. It must be meaningfully different from these existing concepts: ${existingTitles.join(', ') || 'none'}.

The concept must cover:
- title: a short, memorable name for the concept
- description: the central visual premise, setting, and defining idea
- mood: the emotional tone and atmosphere
- visualStyle: the visual language, medium, aesthetic, and cinematic treatment
- colorAndLighting: the main color palette and lighting approach
- narrativeDirection: how the visual idea develops across the song

Keep every field concise, specific, and understandable without production jargon. Do not include image-generation prompts or technical model instructions.

Project: ${input.title}
Format: ${input.aspectRatio}
User's visual direction: ${input.visualDirection}
${input.videoType ? `Video type: ${input.videoType}\n` : ''}${buildSongContext(input)}

Return ONLY one valid JSON object in exactly this structure:
{"title":"...","description":"...","mood":"...","visualStyle":"...","colorAndLighting":"...","narrativeDirection":"..."}

Do not wrap the JSON in commentary. Do not add any other fields.`;
}

export function buildSelectedConceptContext(concept?: { title: string; description: string; mood: string; visual_style?: string; color_and_lighting?: string; narrative_direction?: string; visualStyle?: string; colorAndLighting?: string; narrativeDirection?: string } | null) {
  if (!concept) return '';
  return ` Selected creative concept: ${concept.title}. ${concept.description}. Mood: ${concept.mood}. Visual style: ${concept.visual_style ?? concept.visualStyle}. Color and lighting: ${concept.color_and_lighting ?? concept.colorAndLighting}. Narrative direction: ${concept.narrative_direction ?? concept.narrativeDirection}.`;
}
