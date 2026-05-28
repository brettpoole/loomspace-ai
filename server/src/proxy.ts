/**
 * AI provider proxy.
 *
 * The server holds the decrypted API keys; the frontend sends requests here
 * that include only the profile id and the message payload.  The server
 * adds the authorization header and forwards to the upstream provider.
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
  // openai-compatible-custom
  const trimmed = baseUrl?.trim();
  if (!trimmed) throw new Error('baseUrl is required for custom OpenAI-compatible providers');
  return trimmed.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export async function fetchModels(profile: Profile): Promise<string[]> {
  const apiKey = resolveKey(profile.id);
  const baseUrl = resolveBaseUrl(profile.baseUrl, profile.kind);

  if (profile.kind === 'anthropic') {
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) throw new Error((await res.text()) || 'Anthropic /models failed');
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map((e) => e.id ?? '').filter(Boolean).sort();
  }

  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error((await res.text()) || `${profile.label} /models failed`);
  const data = (await res.json()) as {
    data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }>;
  };

  if (profile.kind === 'openrouter') {
    return (data.data ?? [])
      .filter((e) => {
        const id = e.id ?? '';
        if (!id) return false;
        if (id.endsWith(':free')) return true;
        const prompt = parseFloat(e.pricing?.prompt ?? '');
        const completion = parseFloat(e.pricing?.completion ?? '');
        return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
      })
      .map((e) => e.id ?? '')
      .filter(Boolean)
      .sort();
  }

  return (data.data ?? []).map((e) => e.id ?? '').filter(Boolean).sort();
}

// ---------------------------------------------------------------------------
// Chat completions
// ---------------------------------------------------------------------------

export interface ChatRequest {
  messages: Array<{
    role: string;
    content: unknown; // text string or Anthropic/OpenAI content blocks
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

export async function chatCompletion(profile: Profile, req: ChatRequest): Promise<ChatResponse> {
  const apiKey = resolveKey(profile.id);
  const baseUrl = resolveBaseUrl(profile.baseUrl, profile.kind);

  if (profile.kind === 'anthropic') {
    return anthropicChat(baseUrl, apiKey, profile.model, req);
  }
  return openaiCompatibleChat(baseUrl, apiKey, profile, req);
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function anthropicChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  req: ChatRequest,
): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: req.messages.filter((m) => m.role !== 'system'),
  };
  if (req.systemPrompt) body.system = req.systemPrompt;

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
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
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

  const payloadBase = { model: profile.model, messages };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (profile.kind === 'openrouter') {
    headers['X-App-Name'] = 'Loomspace';
    // X-App-URL would require knowing the frontend origin; omit
  }

  const send = async (withTemperature: boolean) => {
    const body = withTemperature ? { ...payloadBase, temperature: 0.4 } : payloadBase;
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

  // OpenAI o-series models don't support temperature — try with, then without
  let result = await send(profile.kind !== 'openai');

  if (!result.ok && profile.kind === 'openai') {
    const maybeUnsupported = /temperature/i.test(result.text) && /unsupported|default \(1\)/i.test(result.text);
    if (maybeUnsupported) result = await send(false);
  }

  if (!result.ok) throw new Error(result.text || `${profile.label} request failed`);

  const assistantText = result.data.choices?.[0]?.message?.content?.trim();
  if (!assistantText) throw new Error(`${profile.label} returned no assistant text`);

  const u = result.data.usage;
  const inputTokens = u?.prompt_tokens ?? 0;
  const outputTokens = u?.completion_tokens ?? 0;
  return {
    assistantText,
    usage: u ? { inputTokens, outputTokens, totalTokens: u.total_tokens ?? inputTokens + outputTokens } : undefined,
  };
}
