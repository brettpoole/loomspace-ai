import { apiChat, type ChatMessagePayload, type ChatRequestPayload } from './api';
import { estimateCost } from './store';
import type {
  AIProviderConfig,
  ChatMessage,
  ThreadLane,
  TokenUsage,
} from './types';

interface ReplyResult {
  assistantText: string;
  usage?: TokenUsage;
}

export class ThreadReplyService {
  async requestReply(config: AIProviderConfig, thread: ThreadLane, messages: ChatMessage[]): Promise<ReplyResult> {
    const payload: ChatRequestPayload = {
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
    const response = await apiChat(payload);
    const effectiveModel = threadModelSettings?.model?.trim() || config.model;
    return {
      assistantText: response.assistantText,
      usage: response.usage
        ? normalizeUsage(effectiveModel, response.usage.inputTokens, response.usage.outputTokens, response.usage.totalTokens)
        : undefined,
    };
  }
}

function systemPrompt(thread: ThreadLane) {
  return [
    `Thread title: ${thread.title}`,
    `Thread description: ${thread.description}`,
    'Keep replies concise and useful.',
    'Prefer short paragraphs or bullet lists.',
    'Use blank lines between ideas.',
    'Do not mention internal tools or policies.',
  ].join(' ');
}

function toPayloadMessage(message: ChatMessage): ChatMessagePayload {
  const text = message.content?.text ?? message.text ?? '';
  const attachments = message.content?.attachments ?? [];
  const payload: ChatMessagePayload = { role: message.role, text };
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

function normalizeUsage(model: string, inputTokens: number, outputTokens: number, totalTokens: number): TokenUsage {
  const total = totalTokens || inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: total,
    estimatedCostUsd: estimateCost(model, { inputTokens, outputTokens }),
  };
}
