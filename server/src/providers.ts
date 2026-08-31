import OpenAI from 'openai';
import { requireProviderKey, resolveImageConfiguration, resolveProvider, type ImageQuality, type ImageResolution, type Provider } from './provider-settings.js';

export type ImageProvider = 'openai' | 'grok';
export type ImageReference = { id: string; name: string; description: string; imageUrl: string | null };
export type ImageGenerationRequest = { projectId: string; shotId: string; aspectRatio: string; visualStyle: string; concept: { title: string; description: string; mood: string; visualStyle: string; colorAndLighting: string } | null; description: string; action: string; shotType: string; camera: string; mood: string; characters: ImageReference[]; location: ImageReference | null; previousShot: { description: string; action: string; locationId: string | null } | null; generationInstructions: string; prompt: string; qualityPreset?: ImageQuality; modelOverride?: string | null; resolutionOverride?: ImageResolution | null };
export type ImageGenerationResult = { url: string; model: string; quality: ImageQuality; resolution: ImageResolution };

export function getTextClient(requestedProvider?: Provider) {
  const provider = resolveProvider('textGeneration', { requested: requestedProvider, strict: Boolean(requestedProvider) });
  return new OpenAI({ apiKey: requireProviderKey(provider) });
}

function getImageClient(provider: ImageProvider) {
  if (provider === 'openai') {
    return new OpenAI({ apiKey: requireProviderKey('openai') });
  }

  return new OpenAI({ apiKey: requireProviderKey('grok'), baseURL: 'https://api.x.ai/v1' });
}

export async function generateImage(provider: ImageProvider, request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  provider = resolveProvider('imageGeneration', { requested: provider });
  const client = getImageClient(provider);
  const referenceImages = [...request.characters, request.location].filter((item): item is ImageReference => Boolean(item?.imageUrl));
  if (referenceImages.length) console.info(`[${provider}] locked reference images supplied for shot ${request.shotId}; this provider adapter currently uses their descriptions in the prompt because its generate endpoint has no portable URL-reference field.`);

  const config = resolveImageConfiguration({ provider, preset: request.qualityPreset, modelId: request.modelOverride, resolution: request.resolutionOverride });
  if (provider === 'grok') {
    const response = await client.images.generate({
      model: config.model.modelId,
      prompt: request.prompt,
      n: 1,
      // xAI accepts provider-specific fields through the OpenAI-compatible API.
      ...({ aspect_ratio: request.aspectRatio, resolution: config.resolution, quality: config.quality } as Record<string, unknown>),
    } as never);

    const image = response.data?.[0];
    if (!image?.url) throw new Error('Grok returned no image URL');
    return { url: image.url, model: config.model.modelId, quality: config.quality, resolution: config.resolution };
  }

  const size = request.resolutionOverride ?? (request.aspectRatio === '9:16' ? '1024x1536' : request.aspectRatio === '1:1' ? '1024x1024' : '1536x1024');
  const response = await client.images.generate({
    model: config.model.modelId,
    prompt: request.prompt,
    n: 1,
    size: size as '1024x1024' | '1024x1536' | '1536x1024',
    quality: config.quality === 'draft' ? 'low' : config.quality === 'best' ? 'high' : 'medium',
  } as never);

  const image = response.data?.[0];
  if (image?.url) return { url: image.url, model: config.model.modelId, quality: config.quality, resolution: size as ImageResolution };
  if (image?.b64_json) return { url: `data:image/png;base64,${image.b64_json}`, model: config.model.modelId, quality: config.quality, resolution: size as ImageResolution };
  throw new Error('OpenAI returned no image');
}
