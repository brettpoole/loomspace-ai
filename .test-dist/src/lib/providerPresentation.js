"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerPresentationPolicy = exports.ProviderPresentationPolicy = void 0;
const store_1 = require("./store");
class ProviderPresentationPolicy {
    apiKeyPlaceholder(provider) {
        if (provider === 'openai')
            return 'sk-...';
        if (provider === 'anthropic')
            return 'sk-ant-...';
        if (provider === 'openrouter')
            return 'sk-or-...';
        return 'optional';
    }
    autoProfileLabel(kind, current) {
        if (kind !== 'openai-compatible-custom')
            return (0, store_1.providerInfo)(kind).label;
        const presetLabels = store_1.PROVIDERS.map((entry) => entry.label);
        const trimmed = current.trim();
        return trimmed && trimmed !== 'New profile' && !presetLabels.includes(trimmed) ? trimmed : 'Custom provider';
    }
    providerKeyLink(provider) {
        if (provider === 'openrouter')
            return { label: 'Get a free OpenRouter key', href: 'https://openrouter.ai/keys' };
        if (provider === 'openai')
            return { label: 'Get an OpenAI key', href: 'https://platform.openai.com/api-keys' };
        if (provider === 'anthropic')
            return { label: 'Get an Anthropic key', href: 'https://console.anthropic.com/settings/keys' };
        return null;
    }
}
exports.ProviderPresentationPolicy = ProviderPresentationPolicy;
exports.providerPresentationPolicy = new ProviderPresentationPolicy();
