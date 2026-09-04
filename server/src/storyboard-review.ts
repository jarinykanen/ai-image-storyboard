import { z } from 'zod';
import { generateText } from './providers.js';
import { buildStoryboardReviewPrompt } from './storyboard-prompts.js';
import type { VisualIdentity } from './visual-identity.js';
import type { VisualConcept } from './visual-concepts.js';
import type { StoryboardPlan } from './storyboard-prompts.js';

const IssueSchema = z.object({ severity: z.enum(['info', 'warning', 'important']), category: z.enum(['CHARACTER CONTINUITY', 'LOCATION CONTINUITY', 'VISUAL STYLE', 'SHOT VARIETY', 'NARRATIVE', 'MOTIFS', 'REFERENCE CONSISTENCY']), title: z.string().min(1).max(140), description: z.string().min(1).max(1000), shotIds: z.array(z.string()).max(12), suggestion: z.string().min(1).max(600) });
const ResultSchema = z.object({ summary: z.string().min(1).max(1200), score: z.number().int().min(1).max(100).nullable().optional(), issues: z.array(IssueSchema).max(30) });
const parse = (text: string) => JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim());
export type ReviewShot = { id: string; order: number; section: string; title: string; description: string; action: string; shotType: string; camera: string; mood: string; characterIds: string[]; locationId: string | null; imageUrl?: string | null };

export async function reviewStoryboard(input: { project: { id: string; title: string; visual_style: string; lyrics: string; suno_description?: string | null }; plan: StoryboardPlan | null; identity: VisualIdentity; concept?: VisualConcept | null; shots: ReviewShot[] }) {
  const prompt = buildStoryboardReviewPrompt(input);
  const response = await generateText({ model: 'gpt-5.6-terra', prompt, operation: 'storyboard.review', projectId: input.project.id, targetId: input.concept?.id });
  const result = ResultSchema.parse(parse(response));
  const valid = new Set(input.shots.map(shot => shot.id));
  return { ...result, issues: result.issues.map(issue => ({ ...issue, shotIds: issue.shotIds.filter(id => valid.has(id)) })) };
}
