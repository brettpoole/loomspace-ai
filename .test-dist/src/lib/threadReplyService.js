"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThreadReplyService = void 0;
const api_1 = require("./api");
const store_1 = require("./store");
class ThreadReplyService {
    async requestReply(config, thread, messages) {
        const payload = {
            profileId: config.id,
            systemPrompt: systemPrompt(thread),
            messages: messages.map(toPayloadMessage),
        };
        const threadModelSettings = thread.modelSettings;
        if (threadModelSettings) {
            payload.threadModelSettings = {
                providerConfigId: threadModelSettings.providerConfigId,
                model: threadModelSettings.model,
                params: threadModelSettings.params,
            };
        }
        const response = await (0, api_1.apiChat)(payload);
        const effectiveModel = threadModelSettings?.model?.trim() || config.model;
        return {
            assistantText: response.assistantText,
            usage: response.usage
                ? normalizeUsage(effectiveModel, response.usage.inputTokens, response.usage.outputTokens, response.usage.totalTokens)
                : undefined,
        };
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
function toPayloadMessage(message) {
    const text = message.content?.text ?? message.text ?? '';
    const attachments = message.content?.attachments ?? [];
    const payload = { role: message.role, text };
    if (attachments.length > 0) {
        payload.attachments = attachments.map((attachment) => ({
            type: attachment.type,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            data: attachment.data,
        }));
    }
    return payload;
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
