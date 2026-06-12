import { PROVIDERS, providerInfo } from './store';
import type { AIProvider } from './types';

export class ProviderPresentationPolicy {
  apiKeyPlaceholder(provider: AIProvider) {
    if (provider === 'openai') return 'sk-...';
    if (provider === 'anthropic') return 'sk-ant-...';
    if (provider === 'openrouter') return 'sk-or-...';
    return 'optional';
  }

  autoProfileLabel(kind: AIProvider, current: string): string {
    if (kind !== 'openai-compatible-custom') return providerInfo(kind).label;
    const presetLabels = PROVIDERS.map((entry) => entry.label);
    const trimmed = current.trim();
    return trimmed && trimmed !== 'New profile' && !presetLabels.includes(trimmed) ? trimmed : 'Custom provider';
  }

  providerKeyLink(provider: AIProvider): { label: string; href: string } | null {
    if (provider === 'openrouter') return { label: 'Get a free OpenRouter key', href: 'https://openrouter.ai/keys' };
    if (provider === 'openai') return { label: 'Get an OpenAI key', href: 'https://platform.openai.com/api-keys' };
    if (provider === 'anthropic') return { label: 'Get an Anthropic key', href: 'https://console.anthropic.com/settings/keys' };
    return null;
  }
}

export const providerPresentationPolicy = new ProviderPresentationPolicy();
