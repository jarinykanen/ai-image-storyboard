import { getVisualIdentity, type VisualReference } from './visual-identity.js';

export type NormalizedReference = {
  id: string;
  type: 'character' | 'location' | 'style' | 'continuity';
  name: string;
  description: string;
  imageAsset: string | null;
  locked: boolean;
  stale: boolean;
};
export type ReferenceContext = {
  style: NormalizedReference;
  characters: NormalizedReference[];
  location: NormalizedReference | null;
  continuityReference: NormalizedReference | null;
};

type Project = { id: string; visual_style: string };
type Shot = { id: string; character_ids?: string | null; location_id?: string | null; description: string; action?: string | null; image_url?: string | null; generation_status?: string | null };

function fromVisual(reference: VisualReference, type: 'character' | 'location'): NormalizedReference {
  // Locking prevents edits; it must not silently disable a selected, current
  // reference image from guiding generation. Outdated images remain text-only
  // until the user refreshes or explicitly marks them current.
  return { id: reference.id, type, name: reference.name, description: reference.description, imageAsset: reference.image_outdated ? null : reference.image_url, locked: reference.locked, stale: reference.image_outdated };
}

/** Resolves only the identity records assigned to a shot. This is deliberately
 * provider-neutral so every generation entry point shares the same decision. */
export function resolveReferenceContext(project: Project, shot: Shot, previous?: Shot, conceptId?:string): ReferenceContext {
  const identity = getVisualIdentity(project.id,conceptId);
  const characterIds = JSON.parse(shot.character_ids || '[]') as string[];
  const characters = characterIds
    .map(id => identity.characters.find(reference => reference.id === id))
    .filter((reference): reference is VisualReference => Boolean(reference))
    .sort((a, b) => Number(b.locked) - Number(a.locked))
    .map(reference => fromVisual(reference, 'character'));
  const assignedLocation = identity.locations.find(reference => reference.id === shot.location_id);
  const location = assignedLocation ? fromVisual(assignedLocation, 'location') : null;
  const style: NormalizedReference = {
    id: 'visual-style', type: 'style', name: 'Visual Style', description: identity.style.description || project.visual_style,
    imageAsset: identity.style.image_outdated ? null : identity.style.image_url, locked: identity.style.locked, stale: identity.style.image_outdated,
  };
  const previousCharacters = new Set(JSON.parse(previous?.character_ids || '[]') as string[]);
  const sharesCharacter = characterIds.some(id => previousCharacters.has(id));
  const sharesLocation = Boolean(shot.location_id && shot.location_id === previous?.location_id);
  // A previous image is a gentle continuity hint only for an obvious continuation.
  const continuityReference = previous?.image_url && (sharesCharacter || sharesLocation)
    ? { id: `continuity:${previous.id}`, type: 'continuity' as const, name: 'Previous shot', description: `${previous.description}${previous.action ? ` — ${previous.action}` : ''}`, imageAsset: previous.image_url, locked: false, stale: previous.generation_status === 'needs_regeneration' }
    : null;
  return { style, characters, location, continuityReference };
}
