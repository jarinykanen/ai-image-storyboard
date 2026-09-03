import OpenAI from 'openai';
import { db } from './db.js';

export type Provider = 'openai' | 'grok';
export type ProviderCapability = 'textGeneration' | 'imageGeneration' | 'imageEditing' | 'referenceImages' | 'imageUnderstanding';
export type ProviderCapabilities = Record<ProviderCapability, boolean>;
export type ProviderStatus = 'connected' | 'not_configured' | 'invalid_key' | 'rate_limited' | 'provider_unavailable' | 'error' | 'configured';
export type ProviderSettings = { configured: boolean; status: ProviderStatus; lastSuccessfulTestAt: string | null };
export type ProviderAvailability = ProviderSettings & { capabilities: ProviderCapabilities };
export type ImageQuality = 'draft' | 'standard' | 'best';
export type ImageResolution = '1024x1024' | '1024x1536' | '1536x1024' | '1k' | '2k';
export type ImageModel = { provider: Provider; modelId: string; displayName: string; supportedQualities: ImageQuality[]; supportedResolutions: ImageResolution[]; referenceImageSupport: boolean; imageEditingSupport: boolean; maxReferenceImages: number; recommendedUse: string; estimatedCostUsd?: Partial<Record<ImageQuality, number>> };

// This is the single source of truth for image-model capabilities, presets, and
// pricing estimates. Update it when providers change their offerings.
export const imageModels: ImageModel[] = [
  { provider: 'openai', modelId: 'gpt-image-2', displayName: 'GPT Image 2', supportedQualities: ['draft', 'standard', 'best'], supportedResolutions: ['1024x1024', '1024x1536', '1536x1024'], referenceImageSupport: false, imageEditingSupport: false, maxReferenceImages: 0, recommendedUse: 'Best overall image quality.', estimatedCostUsd: { draft: 0.01, standard: 0.04, best: 0.17 } },
  { provider: 'openai', modelId: 'gpt-image-1', displayName: 'GPT Image 1', supportedQualities: ['draft', 'standard', 'best'], supportedResolutions: ['1024x1024', '1024x1536', '1536x1024'], referenceImageSupport: true, imageEditingSupport: true, maxReferenceImages: 4, recommendedUse: 'Use when direct image references or editing are needed.' },
  { provider: 'openai', modelId: 'gpt-image-1-mini', displayName: 'GPT Image 1 Mini', supportedQualities: ['draft', 'standard'], supportedResolutions: ['1024x1024', '1024x1536', '1536x1024'], referenceImageSupport: false, imageEditingSupport: false, maxReferenceImages: 0, recommendedUse: 'Fast, low-cost storyboard previews.' },
  { provider: 'grok', modelId: 'grok-imagine-image', displayName: 'Grok Imagine Image', supportedQualities: ['draft', 'standard'], supportedResolutions: ['1k'], referenceImageSupport: false, imageEditingSupport: false, maxReferenceImages: 0, recommendedUse: 'Fast visual exploration.' },
  { provider: 'grok', modelId: 'grok-imagine-image-quality', displayName: 'Grok Imagine Image Quality', supportedQualities: ['standard', 'best'], supportedResolutions: ['1k', '2k'], referenceImageSupport: false, imageEditingSupport: false, maxReferenceImages: 0, recommendedUse: 'Higher-detail final images.' },
  { provider: 'grok', modelId: 'grok-imagine-image-2.0', displayName: 'Grok Imagine Image 2', supportedQualities: ['draft', 'standard', 'best'], supportedResolutions: ['1k', '2k'], referenceImageSupport: false, imageEditingSupport: false, maxReferenceImages: 0, recommendedUse: 'Balanced Grok image generation.' },
];
export const imagePresets: Record<Provider, Record<ImageQuality, { modelId: string; quality: ImageQuality }>> = {
  openai: { draft: { modelId: 'gpt-image-1-mini', quality: 'draft' }, standard: { modelId: 'gpt-image-2', quality: 'standard' }, best: { modelId: 'gpt-image-2', quality: 'best' } },
  grok: { draft: { modelId: 'grok-imagine-image', quality: 'draft' }, standard: { modelId: 'grok-imagine-image-2.0', quality: 'standard' }, best: { modelId: 'grok-imagine-image-quality', quality: 'best' } },
};
export function modelsForProvider(provider: Provider, needsReferenceImages = false) { return imageModels.filter(model => model.provider === provider && (!needsReferenceImages || model.referenceImageSupport)); }
export function findImageModel(provider: Provider, modelId: string | null | undefined, needsReferenceImages = false) { return modelsForProvider(provider, needsReferenceImages).find(model => model.modelId === modelId); }
export function resolveImageConfiguration(input: { provider: Provider; preset?: ImageQuality; modelId?: string | null; resolution?: ImageResolution | null; needsReferenceImages?: boolean }) {
  const preset = input.preset ?? 'standard';
  const fallback = imagePresets[input.provider][preset];
  let model = findImageModel(input.provider, input.modelId, input.needsReferenceImages)
    ?? findImageModel(input.provider, fallback.modelId, input.needsReferenceImages)
    ?? modelsForProvider(input.provider, input.needsReferenceImages)[0];
  if (!model) throw new ProviderCapabilityError(input.provider, 'referenceImages');
  const quality = model.supportedQualities.includes(preset) ? preset : model.supportedQualities[model.supportedQualities.length - 1];
  const resolution = model.supportedResolutions.includes(input.resolution as ImageResolution) ? input.resolution as ImageResolution : model.supportedResolutions[0];
  return { provider: input.provider, model, quality, resolution, estimatedCostUsd: model.estimatedCostUsd?.[quality] };
}

const providers: Record<Provider, { name: string; capabilities: ProviderCapabilities }> = {
  openai: { name: 'OpenAI', capabilities: { textGeneration: true, imageGeneration: true, imageEditing: true, referenceImages: true, imageUnderstanding: false } },
  // xAI text, editing, and direct reference-image adapters are not implemented yet.
  grok: { name: 'xAI / Grok', capabilities: { textGeneration: false, imageGeneration: true, imageEditing: false, referenceImages: false, imageUnderstanding: false } },
};
const providerOrder = Object.keys(providers) as Provider[];
const envKey = (provider: Provider) => provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.XAI_API_KEY;

export class ProviderCredentialError extends Error {
  constructor(public readonly provider: Provider, public readonly status: Exclude<ProviderStatus, 'configured' | 'connected'> = 'not_configured') { super(`${providers[provider].name} is not configured.`); this.name = 'ProviderCredentialError'; }
}
export class ProviderNotConfiguredError extends ProviderCredentialError {
  constructor(provider?: Provider) { super(provider ?? 'openai'); this.name = 'ProviderNotConfiguredError'; this.message = provider ? `${providers[provider].name} is not configured for this action.` : 'No compatible AI provider is configured. Connect a provider in Settings to continue.'; }
}
export class ProviderCapabilityError extends Error {
  constructor(public readonly provider: Provider, public readonly capability: ProviderCapability) { super(`${providers[provider].name} does not support this action.`); this.name = 'ProviderCapabilityError'; }
}

function row(provider: Provider) { return db.prepare('SELECT api_key, status, last_successful_test_at FROM provider_settings WHERE provider=?').get(provider) as { api_key: string; status: ProviderStatus; last_successful_test_at: string | null } | undefined; }
export function getProviderKey(provider: Provider) { return row(provider)?.api_key || envKey(provider); }
export function requireProviderKey(provider: Provider) { const key = getProviderKey(provider); if (!key) throw new ProviderCredentialError(provider); return key; }
export function getProviderSettings(provider: Provider): ProviderSettings { const setting = row(provider); const configured = Boolean(setting?.api_key || envKey(provider)); return { configured, status: configured ? (setting?.status === 'connected' ? 'connected' : 'configured') : 'not_configured', lastSuccessfulTestAt: setting?.last_successful_test_at ?? null }; }
export function getProviderAvailability(provider: Provider): ProviderAvailability { return { ...getProviderSettings(provider), capabilities: providers[provider].capabilities }; }

/** Public registry: no provider credentials are included in this response. */
export function getProviderRegistry() {
  const entries = Object.fromEntries(providerOrder.map(provider => [provider, { name: providers[provider].name, ...getProviderAvailability(provider) }])) as Record<Provider, ProviderAvailability & { name: string }>;
  return { providers: entries, imageModels, imagePresets, defaultTextProvider: resolveProviderOrNull('textGeneration'), defaultImageProvider: resolveProviderOrNull('imageGeneration') };
}
export function listProviderAvailability() { return getProviderRegistry().providers; }
function resolveProviderOrNull(capability: ProviderCapability) { return providerOrder.find(provider => providers[provider].capabilities[capability] && getProviderSettings(provider).configured) ?? null; }
export function getDefaultProvider(capability: ProviderCapability) { return resolveProviderOrNull(capability); }

/** Resolves a configured adapter for one normalized operation. */
export function resolveProvider(capability: ProviderCapability, options: { requested?: Provider; strict?: boolean } = {}): Provider {
  if (options.requested) {
    const supported = providers[options.requested].capabilities[capability];
    const configured = getProviderSettings(options.requested).configured;
    if (supported && configured) return options.requested;
    if (options.strict) {
      if (!supported) throw new ProviderCapabilityError(options.requested, capability);
      throw new ProviderNotConfiguredError(options.requested);
    }
  }
  const provider = getDefaultProvider(capability);
  if (!provider) throw new ProviderNotConfiguredError();
  return provider;
}
export function saveProviderKey(provider: Provider, apiKey: string) {
  db.prepare(`INSERT INTO provider_settings(provider, api_key, status, last_successful_test_at) VALUES (?, ?, 'configured', NULL)
    ON CONFLICT(provider) DO UPDATE SET api_key=excluded.api_key, status='configured', last_successful_test_at=NULL`).run(provider, apiKey.trim());
}
export function removeProviderKey(provider: Provider) { db.prepare('DELETE FROM provider_settings WHERE provider=?').run(provider); }
function client(provider: Provider, apiKey: string) { return new OpenAI(provider === 'openai' ? { apiKey } : { apiKey, baseURL: 'https://api.x.ai/v1' }); }
export function normalizeProviderError(error: unknown): ProviderStatus {
  const hasStatus = typeof error === 'object' && error && 'status' in error;
  const status = hasStatus ? Number((error as { status?: unknown }).status) : NaN;
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  if (!hasStatus && error instanceof Error && /ECONN|ENOTFOUND|fetch failed|network/i.test(error.message)) return 'provider_unavailable';
  return 'error';
}
export function providerErrorMessage(provider: Provider, status: ProviderStatus) {
  const name = provider === 'openai' ? 'OpenAI' : 'xAI / Grok';
  if (status === 'not_configured') return `${name} is not configured.`;
  if (status === 'invalid_key') return 'API key is invalid.';
  if (status === 'rate_limited') return 'Provider rate limit reached. Please try again later.';
  if (status === 'provider_unavailable') return 'Provider is temporarily unavailable. Please try again later.';
  return 'We could not connect to this provider. Please try again.';
}
export async function testProvider(provider: Provider): Promise<ProviderSettings> {
  const apiKey = requireProviderKey(provider);
  try {
    await client(provider, apiKey).models.list();
    const now = new Date().toISOString();
    if (row(provider)) db.prepare("UPDATE provider_settings SET status='connected', last_successful_test_at=? WHERE provider=?").run(now, provider);
    return { configured: true, status: 'connected', lastSuccessfulTestAt: now };
  } catch (error) {
    const status = normalizeProviderError(error);
    if (row(provider)) db.prepare('UPDATE provider_settings SET status=? WHERE provider=?').run(status, provider);
    return { configured: true, status, lastSuccessfulTestAt: getProviderSettings(provider).lastSuccessfulTestAt };
  }
}
