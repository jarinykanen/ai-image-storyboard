export type SongContextInput = { lyrics?: string | null; sunoDescription?: string | null; suno_description?: string | null };

export function buildSongContext(input: SongContextInput) {
  const description = input.sunoDescription ?? input.suno_description;
  const sections = [`Lyrics:\n${input.lyrics?.trim() || 'No lyrics supplied.'}`];
  if (description?.trim()) sections.push(`SUNO description (semantic musical and creative context; use it to infer style, mood, atmosphere, era, instrumentation, vocal character, energy, and visual associations, without repeating it verbatim):\n${description.trim()}`);
  return sections.join('\n\n');
}
