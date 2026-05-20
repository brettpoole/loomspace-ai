export type AIProvider = 'openai' | 'anthropic' | 'openrouter';
export type Confidence = 'low' | 'medium' | 'high';
export type ThreadStatus = 'draft' | 'active' | 'stitch-ready' | 'closed';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ThreadNodeKind = 'title' | 'chat';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
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
  confidence: Confidence;
  createdAt: string;
  usage?: TokenUsage;
}

export type ThreadNode = ThreadTitleNode | ThreadChatNode;

export interface ThreadLane {
  id: string;
  color: string;
  status: ThreadStatus;
  title: string;
  description: string;
  provider: AIProvider;
  model: string;
  context: ChatMessage[];
  nodes: ThreadNode[];
  activeNodeId: string | null;
  infoOpen: boolean;
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
  provider: AIProvider;
  model: string;
  apiKey: string;
  hasEncryptedApiKey: boolean;
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
}
