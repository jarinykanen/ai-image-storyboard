import { z } from 'zod';
import { generateText } from './providers.js';
import type { VisualIdentity } from './visual-identity.js';
import type { VisualConcept } from './visual-concepts.js';
import { buildShotRegenerationPrompt, buildStoryboardPrompt, type StoryboardApproach, type StoryboardPlan, type StoryboardShotContent } from './storyboard-prompts.js';

const nullableNumber = z.number().finite().nullable();
export const StoryboardShotSchema = z.object({ startTime: nullableNumber, endTime: nullableNumber, section: z.string().min(1), title: z.string().min(1), description: z.string().min(1), action: z.string().min(1), shotType: z.string().min(1), camera: z.string().min(1), mood: z.string().min(1), characterIds: z.array(z.string()), locationId: z.string().nullable() });
export const StoryboardPlanSchema = z.object({ approach: z.enum(['narrative', 'performance', 'abstract', 'mixed']), summary: z.string().min(1), narrativeArc: z.string().min(1), opening: z.string().min(1), midpoint: z.string().min(1), climax: z.string().min(1), ending: z.string().min(1), motifs: z.array(z.string().min(1)).max(3), primaryCharacterIds: z.array(z.string()), primaryLocationIds: z.array(z.string()), pacingNotes: z.string().min(1) });
const StoryboardSchema = z.object({ plan: StoryboardPlanSchema, shots: z.array(StoryboardShotSchema).min(1).max(60) });
export type GeneratedStoryboardShot = z.infer<typeof StoryboardShotSchema>;
type Project = { id: string; title: string; project_type?: 'general'|'music_video'; creative_brief?: string | null; lyrics: string; suno_description?: string | null; visual_style: string; aspect_ratio: string; duration_seconds?: number | null };

function parse(text: string) { return JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim()); }
function validateReferences(shot: GeneratedStoryboardShot, identity: VisualIdentity) {
  const characterIds = new Set(identity.characters.map(item => item.id)); const locationIds = new Set(identity.locations.map(item => item.id));
  return { ...shot, characterIds: shot.characterIds.filter(id => characterIds.has(id)), locationId: shot.locationId && locationIds.has(shot.locationId) ? shot.locationId : null };
}
export function shotCountForDensity(density: 'low' | 'normal' | 'high', duration?: number | null) {
  if (!duration) return density === 'low' ? 8 : density === 'high' ? 18 : 12;
  const secondsPerShot = density === 'low' ? 18 : density === 'high' ? 6 : 10;
  return Math.max(3, Math.min(60, Math.round(duration / secondsPerShot)));
}
export async function createStoryboard(input: { project: Project & { storyboard_approach?: string }; shotCount: number; detailLevel?: number; visualIdentity: VisualIdentity; selectedConcept?: VisualConcept | null }) {
  const approach = (input.project.storyboard_approach || 'mixed') as StoryboardApproach;
  const prompt = buildStoryboardPrompt({ project: input.project, identity: input.visualIdentity, concept: input.selectedConcept, shotCount: input.shotCount, detailLevel: input.detailLevel ?? 50, approach });
  const response = await generateText({ model: 'gpt-5.6-terra', prompt, operation: 'storyboard.generate', projectId: input.project.id, targetId: input.selectedConcept?.id });
  const data = StoryboardSchema.parse(parse(response));
  if (data.shots.length !== input.shotCount) throw new Error('The storyboard generator returned an incomplete storyboard.');
  const characterIds = new Set(input.visualIdentity.characters.map(item => item.id)); const locationIds = new Set(input.visualIdentity.locations.map(item => item.id));
  return { plan: { ...data.plan, approach, primaryCharacterIds: data.plan.primaryCharacterIds.filter(id => characterIds.has(id)), primaryLocationIds: data.plan.primaryLocationIds.filter(id => locationIds.has(id)) }, shots: data.shots.map(shot => validateReferences(shot, input.visualIdentity)) };
}
export async function regenerateStoryboardShot(input: { project: Project; detailLevel?: number; visualIdentity: VisualIdentity; selectedConcept?: VisualConcept | null; plan: StoryboardPlan; previous?: StoryboardShotContent; current: StoryboardShotContent; next?: StoryboardShotContent }) {
  const prompt = buildShotRegenerationPrompt({ project: input.project, identity: input.visualIdentity, concept: input.selectedConcept, detailLevel: input.detailLevel ?? 50, plan: input.plan, previous: input.previous, current: input.current, next: input.next });
  const response = await generateText({ model: 'gpt-5.6-terra', prompt, operation: 'storyboard-shot.regenerate', projectId: input.project.id });
  const content = StoryboardShotSchema.omit({ startTime: true, endTime: true }).parse(parse(response));
  // References are a user-controlled part of the shot. Regeneration can improve
  // creative direction, but it must never replace saved character/location choices.
  return validateReferences({ ...content, characterIds: input.current.characterIds, locationId: input.current.locationId, startTime: null, endTime: null }, input.visualIdentity);
}
