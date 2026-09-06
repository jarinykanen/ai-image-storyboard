export type ShotComposition = { name: string; description: string };

export const shotCompositions: ShotComposition[] = [
  { name: 'Wide shot', description: 'Keep the subject smaller in frame so the surrounding location and spatial context are clearly readable.' },
  { name: 'Rule of thirds', description: 'Place key elements on a 3×3 grid rather than always centering them.' },
  { name: 'Center framing', description: 'Place the subject in the middle for a formal, iconic, or oppressive feeling.' },
  { name: 'Symmetry', description: 'Use mirror-like balance to suggest control, ritual, or deliberate order.' },
  { name: 'Leading lines', description: 'Use roads, walls, or other lines to guide the eye toward the subject.' },
  { name: 'Frame within a frame', description: 'Use doorways, windows, mirrors, or similar elements to surround the subject.' },
  { name: 'Negative space', description: 'Leave empty area around the subject to evoke loneliness, threat, or waiting.' },
  { name: 'Headroom', description: 'Deliberately control the space above the subject’s head to feel spacious or cramped.' },
  { name: 'Looking room / lead room', description: 'Leave extra space in the direction the subject looks or moves.' },
  { name: 'Short-siding', description: 'Leave little space in the look direction to make the subject feel uneasy or boxed in.' },
  { name: 'Silhouette', description: 'Render the subject dark against a bright background for mystery or an iconic shape.' },
];

export function findShotComposition(name: string | undefined) {
  return name ? shotCompositions.find(item => item.name === name) ?? null : null;
}
