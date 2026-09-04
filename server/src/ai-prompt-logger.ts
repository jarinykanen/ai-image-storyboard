export type AiPromptMetadata = {
  provider: string;
  model: string;
  operation: string;
  projectId?: string;
  targetId?: string;
};

export function isAiPromptDebugEnabled() {
  return ['1', 'true', 'yes', 'on'].includes((process.env.AI_PROMPT_DEBUG ?? '').trim().toLowerCase());
}

/**
 * Writes prompt content only when explicitly enabled. Keep credentials, binary
 * inputs, provider responses, and complete provider payloads out of this log.
 */
export function logAiPrompt(metadata: AiPromptMetadata, prompt: string) {
  if (!isAiPromptDebugEnabled()) return;
  console.debug(`[ai-prompt] ${JSON.stringify(metadata)}\n${prompt}\n[/ai-prompt]`);
}
