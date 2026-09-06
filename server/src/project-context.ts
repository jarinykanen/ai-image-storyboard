export type ProjectType = 'general' | 'music_video';

export type ProjectContextInput = {
  title?: string | null;
  project_type?: ProjectType | null;
  projectType?: ProjectType | null;
  creative_brief?: string | null;
  creativeBrief?: string | null;
  visual_style?: string | null;
  visualStyle?: string | null;
  lyrics?: string | null;
  suno_description?: string | null;
  sunoDescription?: string | null;
};

export function projectType(input: ProjectContextInput): ProjectType {
  return input.projectType ?? input.project_type ?? 'music_video';
}

export function buildProjectContext(input: ProjectContextInput) {
  const sections: string[] = [];
  const brief = input.creativeBrief ?? input.creative_brief;
  const visualDirection = input.visualStyle ?? input.visual_style;
  const suno = input.sunoDescription ?? input.suno_description;

  if (brief?.trim()) sections.push(`Creative brief:\n${brief.trim()}`);
  if (visualDirection?.trim()) sections.push(`User visual direction:\n${visualDirection.trim()}`);

  if (projectType(input) === 'music_video') {
    sections.push(`Lyrics:\n${input.lyrics?.trim() || 'No lyrics supplied.'}`);
    if (suno?.trim()) sections.push(`SUNO description (semantic musical and creative context; infer mood, atmosphere, era, instrumentation, vocal character, energy, and visual associations without repeating it verbatim):\n${suno.trim()}`);
  }

  return sections.join('\n\n') || 'No additional project context supplied.';
}
