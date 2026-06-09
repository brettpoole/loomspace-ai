/**
 * AI provider proxy.
 *
 * The server holds the decrypted API keys; the frontend sends requests here
 * that include only the profile id and the message payload. The server adds
 * the authorization header and forwards to the upstream provider.
 */

import type { AIProvider, Profile } from './profiles.js';
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

function openAiGenerationBody(profile: Profile): Record<string, unknown> {
  const params = profile.params ?? {};
  const body: Record<string, unknown> = {};
  const temperature = params.temperature ?? (profile.kind === 'openai' ? undefined : 0.4);
  if (temperature !== undefined) body.temperature = temperature;
  if (params.topP !== undefined) body.top_p = params.topP;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  if (params.frequencyPenalty !== undefined) body.frequency_penalty = params.frequencyPenalty;
  if (params.presencePenalty !== undefined) body.presence_penalty = params.presencePenalty;
  if (params.seed !== undefined) body.seed = params.seed;
  if (params.stop && params.stop.length > 0) body.stop = params.stop;
  if (profile.kind !== 'openai' && params.topK !== undefined) body.top_k = params.topK;
  return body;
}

export async function chatCompletion(profile: Profile, req: ChatRequest): Promise<ChatResponse> {
  // Custom providers may not require an API key
  const apiKey = resolveKey(profile.id, { optional: profile.kind === 'openai-compatible-custom' });
  const baseUrl = resolveBaseUrl(profile.baseUrl, profile.kind);

  if (profile.kind === 'anthropic') {
    return anthropicChat(baseUrl, apiKey, profile, req);
  }
  return openaiCompatibleChat(baseUrl, apiKey, profile, req);
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function anthropicChat(
  baseUrl: string,
  apiKey: string,
  profile: Profile,
  req: ChatRequest,
): Promise<ChatResponse> {
  const params = profile.params ?? {};
  const body: Record<string, unknown> = {
    model: profile.model,
    max_tokens: params.maxTokens ?? 1024,
    messages: req.messages.filter((message) => message.role !== 'system'),
  };
  if (req.systemPrompt) body.system = req.systemPrompt;
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.topP !== undefined) body.top_p = params.topP;
  if (params.topK !== undefined) body.top_k = params.topK;
  if (params.stop && params.stop.length > 0) body.stop_sequences = params.stop;

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
): Promise<ChatResponse> {
  const messages: Array<{ role: string; content: unknown }> = [];
  if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt });
  messages.push(...req.messages);

  const payloadBase = {
    model: profile.model,
    messages,
    ...openAiGenerationBody(profile),
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
