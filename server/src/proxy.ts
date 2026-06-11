/**
 * AI provider proxy.
 *
 * The server holds the decrypted API keys; the frontend sends requests here
 * that include only the profile id and the message payload. The server adds
 * the authorization header and forwards to the upstream provider.
 */

import type { AIProvider, GenerationParams, Profile } from './profiles.js';
import { resolveKey } from './profiles.js';

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

export function resolveBaseUrl(baseUrl: string | undefined, kind: AIProvider): string {
  if (kind === 'anthropic') return baseUrl?.trim().replace(/\/+$/, '') || 'https://api.anthropic.com/v1';
  if (kind === 'openrouter') return baseUrl?.trim().replace(/\/+$/, '') || 'https://openrouter.ai/api/v1';
  if (kind === 'openai') return baseUrl?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
  const trimmed = baseUrl?.trim();
  if (!trimmed) throw new Error('baseUrl is required for custom OpenAI-compatible providers');
  return trimmed.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export async function fetchModels(profile: Profile): Promise<string[]> {
  const baseUrl = resolveBaseUrl(profile.baseUrl, profile.kind);

  // Custom providers may not require an API key
  const apiKey = resolveKey(profile.id, { optional: profile.kind === 'openai-compatible-custom' });

  if (profile.kind === 'anthropic') {
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) throw new Error((await res.text()) || 'Anthropic /models failed');
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map((entry) => entry.id ?? '').filter(Boolean).sort();
  }

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) throw new Error((await res.text()) || `${profile.label} /models failed`);
  const data = (await res.json()) as {
    data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }>;
  };

  if (profile.kind === 'openrouter') {
    return (data.data ?? [])
      .filter((entry) => {
        const id = entry.id ?? '';
        if (!id) return false;
        if (id.endsWith(':free')) return true;
        const prompt = parseFloat(entry.pricing?.prompt ?? '');
        const completion = parseFloat(entry.pricing?.completion ?? '');
        return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
      })
      .map((entry) => entry.id ?? '')
      .filter(Boolean)
      .sort();
  }

  return (data.data ?? []).map((entry) => entry.id ?? '').filter(Boolean).sort();
}

// ---------------------------------------------------------------------------
// Chat completions
// ---------------------------------------------------------------------------

export interface ChatRequest {
  messages: Array<{
    role: string;
    content: unknown;
  }>;
  systemPrompt?: string;
}

export interface ChatResponse {
  assistantText: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

function openAiGenerationBody(profile: Profile, mergedParams: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const temperature = mergedParams.temperature ?? (profile.kind === 'openai' ? undefined : 0.4);
  if (temperature !== undefined) body.temperature = temperature;
  if (mergedParams.topP !== undefined) body.top_p = mergedParams.topP;
  if (mergedParams.maxTokens !== undefined) body.max_tokens = mergedParams.maxTokens;
  if (mergedParams.frequencyPenalty !== undefined) body.frequency_penalty = mergedParams.frequencyPenalty;
  if (mergedParams.presencePenalty !== undefined) body.presence_penalty = mergedParams.presencePenalty;
  if (mergedParams.seed !== undefined) body.seed = mergedParams.seed;
  if (mergedParams.stop && Array.isArray(mergedParams.stop)) body.stop = mergedParams.stop;
  if (profile.kind !== 'openai' && mergedParams.topK !== undefined) body.top_k = mergedParams.topK;
  return body;
}

export async function chatCompletion(
  profile: Profile,
  req: ChatRequest,
  threadOverrides?: { model?: string; params?: GenerationParams },
): Promise<ChatResponse> {
  // Custom providers may not require an API key
  const apiKey = resolveKey(profile.id, { optional: profile.kind === 'openai-compatible-custom' });
  const baseUrl = resolveBaseUrl(profile.baseUrl, profile.kind);

  const resolvedModel = threadOverrides?.model ?? profile.model;
  const mergedParams: Record<string, unknown> = { ...(profile.params ?? {}) };
  if (threadOverrides?.params) {
    Object.assign(mergedParams, threadOverrides.params);
  }

  if (profile.kind === 'anthropic') {
    return anthropicChat(baseUrl, apiKey, profile, req, resolvedModel, mergedParams);
  }
  return openaiCompatibleChat(baseUrl, apiKey, profile, req, resolvedModel, mergedParams);
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function anthropicChat(
  baseUrl: string,
  apiKey: string,
  profile: Profile,
  req: ChatRequest,
  resolvedModel: string,
  mergedParams: Record<string, unknown>,
): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model: resolvedModel,
    max_tokens: (mergedParams.maxTokens as number) ?? 1024,
    messages: req.messages.filter((message) => message.role !== 'system'),
  };
  if (req.systemPrompt) body.system = req.systemPrompt;
  if (mergedParams.temperature !== undefined) body.temperature = mergedParams.temperature;
  if (mergedParams.topP !== undefined) body.top_p = mergedParams.topP;
  if (mergedParams.topK !== undefined) body.top_k = mergedParams.topK;
  if (mergedParams.stop && Array.isArray(mergedParams.stop)) body.stop_sequences = mergedParams.stop;
  if (mergedParams.stop_sequences) body.stop_sequences = mergedParams.stop_sequences;

  const res = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error((await res.text()) || 'Anthropic request failed');

  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const assistantText = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();

  if (!assistantText) throw new Error('Anthropic returned no text');

  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  return {
    assistantText,
    usage: data.usage ? { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } : undefined,
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenAI, OpenRouter, custom)
// ---------------------------------------------------------------------------

async function openaiCompatibleChat(
  baseUrl: string,
  apiKey: string,
  profile: Profile,
  req: ChatRequest,
  resolvedModel: string,
  mergedParams: Record<string, unknown>,
): Promise<ChatResponse> {
  const messages: Array<{ role: string; content: unknown }> = [];
  if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt });
  messages.push(...req.messages);

  const payloadBase = {
    model: resolvedModel,
    messages,
    ...openAiGenerationBody(profile, mergedParams),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (profile.kind === 'openrouter') {
    headers['X-App-Name'] = 'Loomspace';
  }

  const send = async (includeTemperature: boolean) => {
    const body: Record<string, unknown> = { ...payloadBase };
    if (!includeTemperature) delete body.temperature;
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false as const, status: res.status, text };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    return { ok: true as const, data };
  };

  let result = await send(true);

  if (!result.ok && profile.kind === 'openai') {
    const maybeUnsupported = /temperature/i.test(result.text) && /unsupported|default \(1\)/i.test(result.text);
    if (maybeUnsupported) result = await send(false);
  }

  if (!result.ok) throw new Error(result.text || `${profile.label} request failed`);

  const assistantText = result.data.choices?.[0]?.message?.content?.trim();
  if (!assistantText) throw new Error(`${profile.label} returned no assistant text`);

  const usage = result.data.usage;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  return {
    assistantText,
    usage: usage ? { inputTokens, outputTokens, totalTokens: usage.total_tokens ?? inputTokens + outputTokens } : undefined,
  };
}
