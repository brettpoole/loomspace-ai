export type AIProvider = 'openai' | 'anthropic' | 'openrouter' | 'openai-compatible-custom';
export type ThreadStatus = 'draft' | 'active' | 'stitch-ready' | 'closed';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ThreadNodeKind = 'title' | 'chat' | 'context';

export type MessageContentType = 'text' | 'image' | 'document' | 'mixed';

export interface MediaAttachment {
  id: string;
  type: 'image' | 'document';
  filename: string;
  mimeType: string;
  size: number;
  data: string; // base64 encoded content
  preview?: string; // thumbnail or preview text
}

export interface MessageContent {
  type: MessageContentType;
  text?: string;
  attachments?: MediaAttachment[];
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: MessageContent; // Enhanced from simple text
  // Keep text field for backward compatibility during migration
  text?: string;
  injectedFromThreadId?: string;
  injectedFromColor?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

export interface ThreadTitleNode {
  id: string;
  kind: 'title';
  title: string;
  description: string;
}

export interface ThreadChatNode {
  id: string;
  kind: 'chat';
  summary: string;
  model: string;
  messages: ChatMessage[];
  createdAt: string;
  usage?: TokenUsage;
  status?: 'pending' | 'unread' | 'error';
}

export interface ThreadContextNode {
  id: string;
  kind: 'context';
  sourceThreadId: string;
  sourceThreadTitle: string;
  sourceThreadColor: string;
  sourceNodeIds: string[];
  messages: ChatMessage[];
  createdAt: string;
}

export type ThreadNode = ThreadTitleNode | ThreadChatNode | ThreadContextNode;

export interface ThreadLane {
  id: string;
  color: string;
  status: ThreadStatus;
  title: string;
  description: string;
  context: ChatMessage[];
  nodes: ThreadNode[];
  activeNodeId: string | null;
  infoOpen: boolean;
}

export interface AIProviderConfig {
  id: string;
  kind: AIProvider;
  label: string;
  model: string;
  apiKey: string;
  hasEncryptedApiKey: boolean;
  baseUrl?: string;
}

export interface LoomspaceState {
  workspaceId: string;
  title: string;
  threads: ThreadLane[];
  selectedThreadId: string | null;
  selectedNodeId: string | null;
  densityOverlay: boolean;
  panX: number;
  panY: number;
  zoom: number;
  version: number;
}

export interface AISettings {
  activeProviderConfigId: string;
  providerConfigs: AIProviderConfig[];
}

export interface FabricMetrics {
  threadCount: number;
  nodeCount: number;
  chatCount: number;
  density: number;
  saturation: number;
}

export interface PersistedWorkspace {
  state: LoomspaceState;
}

export interface ThreadUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ProviderInfo {
  id: AIProvider;
  label: string;
  defaultModel: string;
  baseUrl?: string;
}

export interface ForkDraft {
  sourceThreadId: string;
  sourceThreadTitle: string;
  sourceThreadColor: string;
  selectedNodes: Array<{ nodeId: string; parts: { user: boolean; assistant: boolean } }>;
}
