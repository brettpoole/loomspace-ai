"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThreadReplyService = void 0;
const api_1 = require("./api");
const mediaUtils_1 = require("./mediaUtils");
const store_1 = require("./store");
class ThreadReplyService {
    async requestReply(config, thread, messages) {
        const effective = resolveThreadConfig(config, thread);
        const threadModelSettings = thread.modelSettings;
        if (!effective.apiKey.trim() && effective.hasEncryptedApiKey) {
            const apiPayload = {
                profileId: effective.id,
                systemPrompt: systemPrompt(thread),
                messages: effective.kind === 'anthropic'
                    ? messages.filter((message) => message.role !== 'system').map(formatMessageForAnthropic)
                    : messages.map(formatMessageForOpenAI),
            };
            if (threadModelSettings) {
                apiPayload.threadModelSettings = {
                    providerConfigId: threadModelSettings.providerConfigId,
                    model: threadModelSettings.model,
                    params: threadModelSettings.params,
                };
            }
            const response = await (0, api_1.apiChat)(apiPayload);
            return {
                assistantText: response.assistantText,
                usage: response.usage
                    ? normalizeUsage(effective.model, response.usage.inputTokens, response.usage.outputTokens, response.usage.totalTokens)
                    : undefined,
            };
        }
        if (effective.kind === 'anthropic')
            return requestAnthropic(effective, thread, messages, effective.threadParams);
        if (effective.kind === 'openrouter')
            return requestOpenRouter(effective, thread, messages, effective.threadParams);
        return requestOpenAiCompatible(effective, thread, messages, effective.threadParams);
    }
}
exports.ThreadReplyService = ThreadReplyService;
function systemPrompt(thread) {
    return [
        `Thread title: ${thread.title}`,
        `Thread description: ${thread.description}`,
        'Keep replies concise and useful.',
        'Prefer short paragraphs or bullet lists.',
        'Use blank lines between ideas.',
        'Do not mention internal tools or policies.',
    ].join(' ');
}
function resolveThreadConfig(config, thread) {
    const ts = thread.modelSettings;
    if (!ts)
        return { ...config, threadParams: undefined };
    return {
        ...config,
        model: ts.model?.trim() || config.model,
        threadParams: ts.params,
    };
}
function formatMessageForOpenAI(message) {
    if (!message.content || message.content.type === 'text' || !message.content.attachments?.length) {
        return { role: message.role, content: message.text ?? message.content?.text ?? '' };
    }
    const parts = [];
    if (message.content.text)
        parts.push({ type: 'text', text: message.content.text });
    for (const attachment of message.content.attachments) {
        parts.push(attachmentToOpenAIPart(attachment));
    }
    return { role: message.role, content: parts };
}
function attachmentToOpenAIPart(attachment) {
    if (attachment.type === 'image') {
        return {
            type: 'image_url',
            image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
        };
    }
    if (attachment.mimeType === 'application/pdf') {
        return {
            type: 'file',
            file: { filename: attachment.filename, file_data: `data:application/pdf;base64,${attachment.data}` },
        };
    }
    return {
        type: 'text',
        text: `Attached file "${attachment.filename}":\n\n${(0, mediaUtils_1.decodeBase64Text)(attachment.data)}`,
    };
}
function attachmentToAnthropicPart(attachment) {
    if (attachment.type === 'image') {
        return { type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.data } };
    }
    if (attachment.mimeType === 'application/pdf') {
        return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.data } };
    }
    return { type: 'text', text: `Attached file "${attachment.filename}":\n\n${(0, mediaUtils_1.decodeBase64Text)(attachment.data)}` };
}
function formatMessageForAnthropic(message) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const attachments = message.content?.attachments ?? [];
    if (!message.content || message.content.type === 'text' || attachments.length === 0) {
        return { role, content: message.text ?? message.content?.text ?? '' };
    }
    const content = [];
    if (message.content.text)
        content.push({ type: 'text', text: message.content.text });
    for (const attachment of attachments)
        content.push(attachmentToAnthropicPart(attachment));
    return { role, content };
}
function openAiGenerationBodyForParams(params, kind) {
    const body = {};
    const temperature = params.temperature ?? (kind === 'openai' ? undefined : 0.4);
    if (temperature !== undefined)
        body.temperature = temperature;
    if (params.topP !== undefined)
        body.top_p = params.topP;
    if (params.maxTokens !== undefined)
        body.max_tokens = params.maxTokens;
    if (params.frequencyPenalty !== undefined)
        body.frequency_penalty = params.frequencyPenalty;
    if (params.presencePenalty !== undefined)
        body.presence_penalty = params.presencePenalty;
    if (params.seed !== undefined)
        body.seed = params.seed;
    if (params.stop && Array.isArray(params.stop) && params.stop.length > 0)
        body.stop = params.stop;
    if (kind !== 'openai' && params.topK !== undefined)
        body.top_k = params.topK;
    return body;
}
async function requestOpenRouter(config, thread, messages, threadParams) {
    const baseUrl = (0, store_1.resolveBaseUrl)(config.baseUrl, config.kind);
    const mergedParams = { ...(config.params ?? {}) };
    if (threadParams)
        Object.assign(mergedParams, threadParams);
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'X-App-Name': 'Loomspace',
            'X-App-URL': window.location.origin,
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: systemPrompt(thread) },
                ...messages.map(formatMessageForOpenAI),
            ],
            ...openAiGenerationBodyForParams(mergedParams, config.kind),
        }),
    });
    if (!response.ok) {
        let errorText = '';
        try {
            errorText = await response.text();
        }
        catch {
            errorText = 'Network error - check your internet connection';
        }
        if (response.status === 0 || !response.status) {
            throw new Error('OpenRouter request failed - check your internet connection and try again');
        }
        else if (response.status === 401) {
            throw new Error('OpenRouter API key is invalid - check your API key');
        }
        else if (response.status === 429) {
            throw new Error('OpenRouter rate limit exceeded - wait a moment and try again');
        }
        else if (response.status >= 500) {
            throw new Error('OpenRouter server error - try again in a moment');
        }
        else {
            throw new Error(errorText || `OpenRouter request failed (${response.status})`);
        }
    }
    const data = (await response.json());
    const assistantText = data.choices?.[0]?.message?.content?.trim();
    if (!assistantText)
        throw new Error('OpenRouter returned no assistant text');
    return {
        assistantText,
        usage: data.usage
            ? normalizeUsage(config.model, data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0, data.usage.total_tokens ?? 0)
            : undefined,
    };
}
async function requestOpenAiCompatible(config, thread, messages, threadParams) {
    const baseUrl = (0, store_1.resolveBaseUrl)(config.baseUrl, config.kind);
    const mergedParams = { ...(config.params ?? {}) };
    if (threadParams)
        Object.assign(mergedParams, threadParams);
    const payloadBase = {
        model: config.model,
        messages: [
            { role: 'system', content: systemPrompt(thread) },
            ...messages.map(formatMessageForOpenAI),
        ],
    };
    const genBody = openAiGenerationBodyForParams(mergedParams, config.kind);
    const send = async (includeTemperature) => {
        const body = { ...payloadBase, ...genBody };
        if (!includeTemperature)
            delete body.temperature;
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            return { ok: false, text: await response.text() };
        }
        const data = (await response.json());
        return { ok: true, data };
    };
    let result = await send(true);
    if (!result.ok && config.kind === 'openai') {
        const maybeTempUnsupported = /temperature/i.test(result.text) && /unsupported|default \(1\)/i.test(result.text);
        if (maybeTempUnsupported)
            result = await send(false);
    }
    if (!result.ok)
        throw new Error(result.text || `${config.label} request failed`);
    const assistantText = result.data.choices?.[0]?.message?.content?.trim();
    if (!assistantText)
        throw new Error(`${config.label} returned no assistant text`);
    return {
        assistantText,
        usage: result.data.usage
            ? normalizeUsage(config.model, result.data.usage.prompt_tokens ?? 0, result.data.usage.completion_tokens ?? 0, result.data.usage.total_tokens ?? 0)
            : undefined,
    };
}
async function requestAnthropic(config, thread, messages, threadParams) {
    const baseUrl = (0, store_1.resolveBaseUrl)(config.baseUrl, config.kind);
    const mergedParams = { ...(config.params ?? {}) };
    if (threadParams)
        Object.assign(mergedParams, threadParams);
    const maxTokens = mergedParams.maxTokens ?? 1024;
    const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: config.model,
            max_tokens: maxTokens,
            ...(mergedParams.temperature !== undefined ? { temperature: mergedParams.temperature } : {}),
            ...(mergedParams.topP !== undefined ? { top_p: mergedParams.topP } : {}),
            ...(mergedParams.topK !== undefined ? { top_k: mergedParams.topK } : {}),
            ...(mergedParams.stop && Array.isArray(mergedParams.stop) && mergedParams.stop.length > 0 ? { stop_sequences: mergedParams.stop } : {}),
            system: systemPrompt(thread),
            messages: messages
                .filter((message) => message.role !== 'system')
                .map(formatMessageForAnthropic),
        }),
    });
    if (!response.ok) {
        throw new Error((await response.text()) || 'Anthropic request failed');
    }
    const data = (await response.json());
    const assistantText = (data.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
        .trim();
    if (!assistantText)
        throw new Error('Anthropic returned no assistant text');
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    return {
        assistantText,
        usage: data.usage ? normalizeUsage(config.model, inputTokens, outputTokens, inputTokens + outputTokens) : undefined,
    };
}
function normalizeUsage(model, inputTokens, outputTokens, totalTokens) {
    const total = totalTokens || inputTokens + outputTokens;
    return {
        inputTokens,
        outputTokens,
        totalTokens: total,
        estimatedCostUsd: (0, store_1.estimateCost)(model, { inputTokens, outputTokens }),
    };
}
