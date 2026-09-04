import OpenAI from 'openai';
import { ProviderCapabilityError, requireProviderKey, resolveTierConfiguration, resolveProvider, type ImageQuality, type ImageResolution, type ImageTier, type Provider } from './provider-settings.js';
import type { ReferenceContext, NormalizedReference } from './reference-context.js';
import { logAiPrompt } from './ai-prompt-logger.js';

export type ImageProvider = 'openai' | 'grok';
export type ImageReference = NormalizedReference;
export type ImageGenerationRequest = { projectId: string; shotId: string; aspectRatio: string; visualStyle: string; concept: { title: string; description: string; mood: string; visualStyle: string; colorAndLighting: string } | null; description: string; action: string; shotType: string; camera: string; mood: string; characters: ImageReference[]; location: ImageReference | null; previousShot: { description: string; action: string; locationId: string | null } | null; referenceContext: ReferenceContext; generationInstructions: string; prompt: string; tier?: ImageTier; qualityPreset?: ImageQuality; modelOverride?: string | null; resolutionOverride?: ImageResolution | null };
export type ImageGenerationResult = { url: string; provider: ImageProvider; model: string; quality: ImageQuality; resolution: ImageResolution; tier: ImageTier };

export async function generateText(request: { prompt: string; model: string; operation: string; projectId?: string; targetId?: string; requestedProvider?: Provider }) {
  const provider = resolveProvider('textGeneration', { requested: request.requestedProvider, strict: Boolean(request.requestedProvider) });
  const client = new OpenAI({ apiKey: requireProviderKey(provider) });
  logAiPrompt({ provider, model: request.model, operation: request.operation, projectId: request.projectId, targetId: request.targetId }, request.prompt);
  const response = await client.responses.create({ model: request.model, input: request.prompt });
  return response.output_text;
}

function getImageClient(provider: ImageProvider) {
  if (provider === 'openai') {
    return new OpenAI({ apiKey: requireProviderKey('openai') });
  }

  return new OpenAI({ apiKey: requireProviderKey('grok'), baseURL: 'https://api.x.ai/v1' });
}

export const singleFrameOutputInstruction = `Output exactly one unified, full-frame scene that fills the entire canvas. Never reproduce a reference image's layout: no collage, contact sheet, storyboard grid, split screen, diptych, triptych, panels, borders, frames, or multiple smaller images. Use reference images only for visual style, subject identity, wardrobe, props, and location continuity.`;

export function enforceSingleFrameOutput(prompt: string) {
  return `${prompt.trim()}\n\n${singleFrameOutputInstruction}`;
}

async function referenceFile(reference: ImageReference) {
  const response = await fetch(reference.imageAsset!);
  if (!response.ok) throw new Error(`Could not load the ${reference.name} reference image.`);
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  return new File([await response.arrayBuffer()], `${reference.type}-${reference.id}.${extension}`, { type: mimeType });
}

export async function generateImage(provider: ImageProvider, request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  provider = resolveProvider('imageGeneration', { requested: provider });
  const client = getImageClient(provider);
  const selectedReferences = [...request.referenceContext.characters, request.referenceContext.location, request.referenceContext.style].filter(Boolean) as ImageReference[];
  const candidates = [...selectedReferences, request.referenceContext.continuityReference].filter((item): item is ImageReference => Boolean(item?.imageAsset));
  let config = resolveTierConfiguration({ provider, tier: request.tier, legacyQuality: request.qualityPreset, modelId: request.modelOverride, resolution: request.resolutionOverride });
  if (candidates.length) {
    try {
      config = resolveTierConfiguration({ provider, tier: request.tier, legacyQuality: request.qualityPreset, modelId: request.modelOverride, resolution: request.resolutionOverride, needsReferenceImages: true });
    } catch (error) {
      if (!(error instanceof ProviderCapabilityError)) throw error;
      // The normalized prompt still carries the textual reference description for
      // providers that cannot accept image conditioning.
    }
  }
  const referenceImages = candidates.slice(0, config.model.maxReferenceImages);
  const omitted = candidates.slice(config.model.maxReferenceImages);
  console.info('[reference-context]', JSON.stringify({ shotId: request.shotId, selected: selectedReferences.map(item => ({ id: item.id, type: item.type, textOnly: !item.imageAsset, stale: item.stale })), continuity: request.referenceContext.continuityReference?.id, model: config.model.modelId, referenceImages: referenceImages.map(item => item.id), omitted: omitted.map(item => item.id) }));
  if (referenceImages.length && !config.model.referenceImageSupport) console.info(`[${provider}] reference assets for shot ${request.shotId} are represented by their current text descriptions; this model does not accept reference-image conditioning.`);
  const prompt = enforceSingleFrameOutput(request.prompt);
  if (provider === 'grok') {
    logAiPrompt({ provider, model: config.model.modelId, operation: 'image.generate', projectId: request.projectId, targetId: request.shotId }, prompt);
    const response = await client.images.generate({
      model: config.model.modelId,
      prompt,
      n: 1,
      // xAI accepts provider-specific fields through the OpenAI-compatible API.
      ...({ aspect_ratio: request.aspectRatio, resolution: config.resolution, quality: config.quality } as Record<string, unknown>),
    } as never);

    const image = response.data?.[0];
    if (!image?.url) throw new Error('Grok returned no image URL');
    return { url: image.url, provider, model: config.model.modelId, quality: config.quality, resolution: config.resolution, tier: config.tier };
  }

  const size = request.resolutionOverride ?? (request.aspectRatio === '9:16' ? '1024x1536' : request.aspectRatio === '1:1' ? '1024x1024' : '1536x1024');
  const common = { model: config.model.modelId, prompt, n: 1, size: size as '1024x1024' | '1024x1536' | '1536x1024', quality: config.quality === 'draft' ? 'low' : config.quality === 'best' ? 'high' : 'medium' } as const;
  let response;
  if (referenceImages.length) {
    const images = await Promise.all(referenceImages.map(referenceFile));
    logAiPrompt({ provider, model: config.model.modelId, operation: 'image.edit-with-references', projectId: request.projectId, targetId: request.shotId }, prompt);
    response = await client.images.edit({ ...common, image: images } as never);
  } else {
    logAiPrompt({ provider, model: config.model.modelId, operation: 'image.generate', projectId: request.projectId, targetId: request.shotId }, prompt);
    response = await client.images.generate(common as never);
  }

  const image = response.data?.[0];
  if (image?.url) return { url: image.url, provider, model: config.model.modelId, quality: config.quality, resolution: size as ImageResolution, tier: config.tier };
  if (image?.b64_json) return { url: `data:image/png;base64,${image.b64_json}`, provider, model: config.model.modelId, quality: config.quality, resolution: size as ImageResolution, tier: config.tier };
  throw new Error('OpenAI returned no image');
}

/** Generate a new version from a supplied image without exposing provider payloads outside this adapter. */
export async function refineImage(provider: ImageProvider, request: ImageGenerationRequest, image: Buffer, filename: string): Promise<ImageGenerationResult> {
  provider = resolveProvider('imageEditing', { requested: provider, strict: true });
  const config = resolveTierConfiguration({ provider, tier: request.tier, legacyQuality: request.qualityPreset, modelId: request.modelOverride, resolution: request.resolutionOverride, needsReferenceImages: true });
  if (!config.model.imageEditingSupport) throw new Error('The selected image model does not support refinement. Choose a compatible model in Advanced image settings.');
  const client = getImageClient(provider);
  const bytes = new Uint8Array(image.byteLength); bytes.set(image);
  const file = new File([bytes], filename, { type: 'image/png' });
  const size = request.resolutionOverride ?? (request.aspectRatio === '9:16' ? '1024x1536' : request.aspectRatio === '1:1' ? '1024x1024' : '1536x1024');
  const prompt = enforceSingleFrameOutput(request.prompt);
  logAiPrompt({ provider, model: config.model.modelId, operation: 'image.refine', projectId: request.projectId, targetId: request.shotId }, prompt);
  const response = await client.images.edit({ model: config.model.modelId, image: file, prompt, size: size as '1024x1024' | '1024x1536' | '1536x1024', quality: config.quality === 'draft' ? 'low' : config.quality === 'best' ? 'high' : 'medium' } as never);
  const result = response.data?.[0];
  if (result?.url) return { url: result.url, provider, model: config.model.modelId, quality: config.quality, resolution: size as ImageResolution, tier: config.tier };
  if (result?.b64_json) return { url: `data:image/png;base64,${result.b64_json}`, provider, model: config.model.modelId, quality: config.quality, resolution: size as ImageResolution, tier: config.tier };
  throw new Error('OpenAI returned no refined image');
}
