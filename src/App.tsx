import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import Markdown from 'react-markdown';
import {
  PROVIDERS,
  appendContextInjection,
  clearProviderSecret,
  clearSettingsCookies,
  computeMetrics,
  createChatNode,
  createContextNode,
  createProviderConfig,
  createThread,
  deleteProviderConfig,
  estimateCost,
  fetchProviderModels,
  getModelWindow,
  loadModelCache,
  loadSettings,
  loadWorkspace,
  providerInfo,
  saveModelCache,
  saveProviderSecret,
  saveSettings,
  saveWorkspace,
  summarize,
  summarizeThreadUsage,
  threadWithActiveNode,
  threadWithInfo,
  unlockProviderSecret,
  updateThreadDetails,
  updateThreadTitle,
} from './lib/store';
import {
  createTextMessage,
  createMixedMessage,
  getMessageText,
  hasAttachments,
  getAttachmentsByType,
  processFile,
  validateFile,
  verifyImageBytes,
  type MediaAttachment
} from './lib/mediaUtils';
import type {
  AIProvider,
  AIProviderConfig,
  AISettings,
  ChatMessage,
  ForkDraft,
  LoomspaceState,
  ThreadChatNode,
  ThreadContextNode,
  ThreadLane,
  ThreadNode,
  TokenUsage,
} from './lib/types';

const LANE_WIDTH = 320;
const LANE_GAP = 56;
const LEFT_PAD = 64;
const TOP_PAD = 28;
const TITLE_HEIGHT = 66;
const TITLE_INFO_EXTRA = 84;
const CHAT_HEIGHT = 148;
const NODE_GAP = 30;
const NODE_WIDTH = 232;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.6;
const EDGE_PADDING = 80;
const CANVAS_MIN_WIDTH = 4000;
const CANVAS_MIN_HEIGHT = 2400;

interface ThreadDraft {
  title: string;
  description: string;
}

const DEFAULT_THREAD_DRAFT: ThreadDraft = {
  title: '',
  description: '',
};

type ModelCache = Record<string, string[]>;

function providerModelCacheKey(config: AIProviderConfig): string {
  const baseUrl = config.baseUrl?.trim().toLowerCase() ?? '';
  return `provider:${config.kind}:${baseUrl}`;
}

export default function App() {
  const [state, setState] = useState<LoomspaceState>(() => loadWorkspace());
  const [settings, setSettings] = useState<AISettings>(() => loadSettings());
  const [composerDraft, setComposerDraft] = useState('');
  const [composerAttachments, setComposerAttachments] = useState<MediaAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [passphraseModal, setPassphraseModal] = useState<{ mode: 'encrypt' | 'unlock'; passphrase: string; busy: boolean; pendingKey?: string; targetConfigId?: string } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [miniChatOpen, setMiniChatOpen] = useState(false);
  const [miniChatMaximized, setMiniChatMaximized] = useState(false);
  const [contextLinkMode, setContextLinkMode] = useState<{
    sourceThreadId: string;
    dotNodeId: string;
    selectedNodes: Array<{ nodeId: string; parts: { user: boolean; assistant: boolean } }>;
    side: 'left' | 'right';
  } | null>(null);
  const [aiSettingsModalOpen, setAiSettingsModalOpen] = useState(false);
  const miniChatMessagesRef = useRef<HTMLDivElement>(null);
  const [threadEditorOpen, setThreadEditorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [threadEditorMode, setThreadEditorMode] = useState<'create' | 'edit'>('create');
  const [threadEditorDraft, setThreadEditorDraft] = useState<ThreadDraft>(DEFAULT_THREAD_DRAFT);
  const [threadEditorTargetId, setThreadEditorTargetId] = useState<string | null>(null);
  const [forkDraft, setForkDraft] = useState<ForkDraft | null>(null);
  const [nodePreviewModal, setNodePreviewModal] = useState<{ title: string; messages: ChatMessage[] } | null>(null);
  const [deleteMode, setDeleteMode] = useState<{ nodeId: string; parts: { user: boolean; assistant: boolean } } | null>(null);
  const [modelCache, setModelCache] = useState<ModelCache>(() => loadModelCache());
  const [modelsLoading, setModelsLoading] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panGesture = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const pointerMap = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{ dist: number; zoom: number } | null>(null);
  const suppressReadMoreUntil = useRef(0);
  const readMoreTimerRef = useRef<number | null>(null);
  const spaceHeld = useRef(false);
  const ctrlHeld = useRef(false);
  const [panMode, setPanMode] = useState<'idle' | 'ready' | 'panning'>('idle');

  useEffect(() => saveWorkspace(state), [state]);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveModelCache(modelCache), [modelCache]);

  useEffect(() => {
    const validConfigIds = new Set(settings.providerConfigs.map((config) => config.id));
    setModelCache((current) => {
      const next: ModelCache = {};
      let changed = false;
      Object.entries(current).forEach(([key, models]) => {
        if (key.startsWith('provider:')) {
          next[key] = models;
          return;
        }
        if (!validConfigIds.has(key)) {
          changed = true;
          return;
        }
        next[key] = models;
      });
      return changed ? next : current;
    });
  }, [settings.providerConfigs]);

  useEffect(() => {
    const isNavKey = (code: string) => code === 'Space' || code === 'ControlLeft' || code === 'ControlRight';
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isNavKey(e.code)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'Space') spaceHeld.current = true;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') ctrlHeld.current = true;
      setPanMode((m) => (m === 'panning' ? 'panning' : 'ready'));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isNavKey(e.code)) return;
      if (e.code === 'Space') spaceHeld.current = false;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') ctrlHeld.current = false;
      if (!spaceHeld.current && !ctrlHeld.current) {
        setPanMode((m) => (m === 'panning' ? 'idle' : 'idle'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const block = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  const metrics = useMemo(() => computeMetrics(state), [state]);
  const activeThread = state.threads.find((thread) => thread.id === state.selectedThreadId) ?? null;
  const activeNode =
    activeThread?.nodes.find((node) => node.id === state.selectedNodeId) ??
    (activeThread ? activeThread.nodes.find((node) => node.id === activeThread.activeNodeId) ?? null : null);
  const activeNodeIsChat = activeNode?.kind === 'chat';
  const activeProviderConfig =
    settings.providerConfigs.find((config) => config.id === settings.activeProviderConfigId) ?? settings.providerConfigs[0] ?? null;
  const settingsLockState = activeProviderConfig ? (activeProviderConfig.hasEncryptedApiKey ? (activeProviderConfig.apiKey.trim() ? 'unlocked' : 'locked') : 'none') : 'none';

  useEffect(() => {
    if (activeProviderConfig?.hasEncryptedApiKey && !activeProviderConfig.apiKey.trim() && !passphraseModal) {
      setPassphraseModal({ mode: 'unlock', passphrase: '', busy: false, targetConfigId: activeProviderConfig.id });
    }
  }, [activeProviderConfig, passphraseModal]);

  const settingsModels = useMemo(
    () => modelsForConfig(modelCache, activeProviderConfig, activeProviderConfig?.model ?? ''),
    [modelCache, activeProviderConfig],
  );

  const canvasWidth = Math.max(
    CANVAS_MIN_WIDTH,
    LEFT_PAD * 2 + Math.max(0, state.threads.length - 1) * (LANE_WIDTH + LANE_GAP) + LANE_WIDTH,
  );

  const lanes = useMemo(() => {
    const threadGroupWidth = state.threads.length * LANE_WIDTH + Math.max(0, state.threads.length - 1) * LANE_GAP;
    const groupLeft = canvasWidth / 2 - threadGroupWidth / 2;
    return state.threads.map((thread, index) => {
      const centerX = groupLeft + index * (LANE_WIDTH + LANE_GAP) + LANE_WIDTH / 2;
      const nodes: Array<{ node: ThreadNode; top: number }> = [];
      let cursorTop = TOP_PAD;
      for (const node of thread.nodes) {
        nodes.push({ node, top: cursorTop });
        cursorTop += nodeHeight(thread, node) + NODE_GAP;
      }
      return {
        thread,
        centerX,
        nodes,
        height: cursorTop + 72,
      };
    });
  }, [canvasWidth, state.threads]);

  const canvasHeight = Math.max(CANVAS_MIN_HEIGHT, ...lanes.map((lane) => lane.height));

  useEffect(() => {
    clampViewport();
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    const onResize = () => clampViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    resetView();
  }, []);

  useEffect(() => {
    if (miniChatOpen && miniChatMessagesRef.current) {
      miniChatMessagesRef.current.scrollTop = miniChatMessagesRef.current.scrollHeight;
    }
  }, [activeThread?.context.length, miniChatOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isEscape = e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape';
      if (!isEscape) return;
      e.preventDefault();
      e.stopPropagation();
      if (passphraseModal && !passphraseModal.busy) { closePassphraseModal(); return; }
      if (aiSettingsModalOpen) { setAiSettingsModalOpen(false); return; }
      if (threadEditorOpen) { closeThreadEditor(); return; }
      if (nodePreviewModal) { setNodePreviewModal(null); return; }
      if (chatModalOpen) { setChatModalOpen(false); return; }
      if (miniChatOpen) { setMiniChatOpen(false); return; }
      if (contextLinkMode) { setContextLinkMode(null); return; }
      if (state.selectedThreadId) { deselectNode(); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [passphraseModal, aiSettingsModalOpen, threadEditorOpen, nodePreviewModal, chatModalOpen, miniChatOpen, contextLinkMode, state.selectedThreadId]);

  function clampViewport(next?: Partial<Pick<LoomspaceState, 'panX' | 'panY' | 'zoom'>>) {
    const viewport = viewportRef.current;
    const width = viewport?.clientWidth ?? window.innerWidth;
    const height = viewport?.clientHeight ?? window.innerHeight;
    const zoom = clamp(next?.zoom ?? state.zoom, MIN_ZOOM, MAX_ZOOM);
    const panX = next?.panX ?? state.panX;
    const panY = next?.panY ?? state.panY;
    const nextBounds = boundedPan(panX, panY, zoom, width, height, canvasWidth, canvasHeight);
    if (nextBounds.panX === state.panX && nextBounds.panY === state.panY && zoom === state.zoom && !next) {
      return;
    }
    setState((current) => ({ ...current, ...nextBounds, zoom }));
  }

  function selectThread(threadId: string, nodeId?: string | null) {
    setChatModalOpen(true);
    setMiniChatOpen(false);
    setSidebarOpen(false);
    setState((current) => ({
      ...current,
      selectedThreadId: threadId,
      selectedNodeId: nodeId ?? current.threads.find((thread) => thread.id === threadId)?.activeNodeId ?? null,
      threads: current.threads.map((thread) => {
        if (thread.id !== threadId) {
          return threadWithActiveNode(thread, thread.activeNodeId);
        }
        const nextNodeId = nodeId ?? thread.activeNodeId;
        return {
          ...threadWithActiveNode(thread, nextNodeId),
          nodes: thread.nodes.map((entry) =>
            entry.id === nextNodeId && entry.kind === 'chat' && entry.status === 'unread'
              ? { ...entry, status: undefined }
              : entry,
          ),
        };
      }),
    }));
  }

  function openThreadEditor(mode: 'create' | 'edit', thread?: ThreadLane) {
    setSidebarOpen(false);
    setThreadEditorMode(mode);
    setThreadEditorTargetId(thread?.id ?? null);
    setThreadEditorDraft(
      thread
        ? { title: thread.title, description: thread.description }
        : { title: '', description: '' },
    );
    setThreadEditorOpen(true);
  }

  function openForkThreadEditor(thread: ThreadLane, nodeId: string, side: 'left' | 'right') {
    const forkSelection = buildContextSelection(thread, nodeId);
    if (!forkSelection) return;
    setForkDraft({
      sourceThreadId: thread.id,
      sourceThreadTitle: thread.title,
      sourceThreadColor: thread.color,
      selectedNodes: forkSelection,
    });
    setContextLinkMode({ sourceThreadId: thread.id, dotNodeId: nodeId, selectedNodes: forkSelection, side });
    setThreadEditorMode('create');
    setThreadEditorTargetId(null);
    setThreadEditorDraft({
      title: `Fork of ${thread.title}`,
      description: thread.description,
    });
    setChatModalOpen(false);
    setMiniChatOpen(false);
    setThreadEditorOpen(true);
  }

  function closeThreadEditor() {
    setThreadEditorOpen(false);
    setForkDraft(null);
  }

  function buildContextSelection(thread: ThreadLane, nodeId: string) {
    const selectableNodes = thread.nodes.filter((n) => (n.kind === 'chat' && n.messages.length > 0) || n.kind === 'context');
    const idx = selectableNodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return null;
    return selectableNodes.slice(0, idx + 1).map((n) => ({
      nodeId: n.id,
      parts: { user: true, assistant: true },
    }));
  }

  function collectSelectedMessages(sourceThread: ThreadLane, selectedNodes: ForkDraft['selectedNodes']) {
    const injectedMessages: ChatMessage[] = [];
    for (const node of sourceThread.nodes) {
      if (node.kind !== 'chat' && node.kind !== 'context') continue;
      const selection = selectedNodes.find((s) => s.nodeId === node.id);
      if (!selection) continue;
      for (const msg of node.messages) {
        if (msg.role === 'user' && !selection.parts.user) continue;
        if (msg.role === 'assistant' && !selection.parts.assistant) continue;
        injectedMessages.push({
          ...msg,
          id: `injected-${crypto.randomUUID().slice(0, 8)}`,
          injectedFromThreadId: sourceThread.id,
          injectedFromColor: sourceThread.color,
        });
      }
    }
    return injectedMessages;
  }

  function submitThreadEditor() {
    const title = threadEditorDraft.title.trim() || 'Untitled thread';
    const description = threadEditorDraft.description.trim() || 'A new lane for a project idea and its AI chat context.';

    if (threadEditorMode === 'create') {
      const baseThread = createThread(title, description, state.threads.length, {
        initialModel: activeProviderConfig?.model,
      });

      const thread = forkDraft && forkDraft.selectedNodes.length > 0
        ? (() => {
            const sourceThread = state.threads.find((entry) => entry.id === forkDraft.sourceThreadId);
            if (!sourceThread) return baseThread;
            const injectedMessages = collectSelectedMessages(sourceThread, forkDraft.selectedNodes);
            if (injectedMessages.length === 0) return baseThread;
            const contextNode = createContextNode(sourceThread, forkDraft.selectedNodes.map((entry) => entry.nodeId), injectedMessages);
            return {
              ...baseThread,
              context: [...injectedMessages],
              nodes: [baseThread.nodes[0], contextNode],
              activeNodeId: baseThread.activeNodeId,
            };
          })()
        : baseThread;

      setState((current) => ({
        ...current,
        version: current.version + 1,
        threads: [...current.threads, thread],
        selectedThreadId: thread.id,
        selectedNodeId: thread.activeNodeId,
        panX: current.threads.length === 0 ? current.panX : current.panX - 40,
      }));
      setChatModalOpen(false);
      setMiniChatOpen(true);
      setContextLinkMode(null);
    } else if (threadEditorTargetId) {
      setState((current) => ({
        ...current,
        version: current.version + 1,
        threads: current.threads.map((thread) =>
          thread.id === threadEditorTargetId ? updateThreadDetails(thread, { title, description }) : thread,
        ),
      }));
    }

    closeThreadEditor();
    setError(null);
  }

async function sendMessage(closeAfter = false) {
    if (!activeThread || !activeNodeIsChat || (!composerDraft.trim() && composerAttachments.length === 0) || sending) return;
    const activeConfig = activeProviderConfig;
    if (!activeConfig) {
      setError('Pick an AI profile first.');
      return;
    }
    if (!activeConfig.apiKey.trim()) {
      setError(activeConfig.hasEncryptedApiKey ? 'Unlock this AI profile, or save a new encrypted key.' : 'Add your API key to this profile first.');
      setPassphraseModal({ mode: 'unlock', passphrase: '', busy: false, targetConfigId: activeConfig.id });
      return;
    }

    const userText = composerDraft.trim();
const userMessage: ChatMessage = {
      id: `msg-${crypto.randomUUID()}`,
      role: 'user',
      content: createMixedMessage(userText, composerAttachments),
      text: userText // Keep for backward compatibility
    };
    const pendingChatNode = createChatNode('Thinking…', [userMessage], activeConfig.model, undefined, 'pending');

    setSending(true);
    setError(null);
    setComposerDraft('');
if (closeAfter) setMiniChatOpen(false);
    setComposerAttachments([]);
    setState((current) => ({
      ...current,
      version: current.version + 1,
      threads: current.threads.map((thread) =>
        thread.id === activeThread.id
          ? {
              ...thread,
              status: 'active',
              context: [...thread.context, userMessage],
              nodes: [...thread.nodes, pendingChatNode],
              activeNodeId: pendingChatNode.id,
            }
          : thread,
      ),
      selectedThreadId: activeThread.id,
      selectedNodeId: pendingChatNode.id,
    }));

    try {
      const { assistantText, usage } = await requestAiReply(activeConfig, activeThread, [...activeThread.context, userMessage]);
      const assistantMessage: ChatMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'assistant',
        content: createTextMessage(assistantText),
        text: assistantText // Keep for backward compatibility
      };

      setState((current) => ({
        ...current,
        version: current.version + 1,
        threads: current.threads.map((thread) => {
          if (thread.id !== activeThread.id) return thread;
          return {
            ...thread,
            context: [...thread.context, assistantMessage],
            nodes: thread.nodes.map((node) =>
              node.id === pendingChatNode.id && node.kind === 'chat'
                ? {
                    ...node,
                    summary: summarize(`${userText} → ${assistantText}`, 52),
                    messages: [userMessage, assistantMessage],
                    usage,
                    status: 'unread',
                  }
                : node,
            ),
            activeNodeId: pendingChatNode.id,
          };
        }),
        selectedThreadId: activeThread.id,
        selectedNodeId: pendingChatNode.id,
      }));
      // mini chat already closed if closeAfter was set
    } catch (err) {
      setState((current) => ({
        ...current,
        version: current.version + 1,
        threads: current.threads.map((thread) => {
          if (thread.id !== activeThread.id) return thread;
          return {
            ...thread,
            nodes: thread.nodes.map((node) =>
              node.id === pendingChatNode.id && node.kind === 'chat'
                ? { ...node, status: 'error' }
                : node,
            ),
          };
        }),
      }));
      setError(err instanceof Error ? err.message : 'AI request failed');
      setComposerDraft(userText);
    } finally {
      setSending(false);
    }
  }

  function updateTitle(threadId: string, title: string) {
    setState((current) => ({
      ...current,
      version: current.version + 1,
      threads: current.threads.map((thread) => (thread.id === threadId ? updateThreadTitle(thread, title) : thread)),
    }));
  }

  function toggleInfo(threadId: string) {
    setState((current) => ({
      ...current,
      threads: current.threads.map((thread) =>
        thread.id === threadId ? threadWithInfo(thread, !thread.infoOpen) : threadWithInfo(thread, false),
      ),
    }));
  }

  function selectNode(threadId: string, nodeId: string) {
    setState((current) => ({
      ...current,
      selectedThreadId: threadId,
      selectedNodeId: nodeId,
      threads: current.threads.map((thread) => {
        if (thread.id !== threadId) {
          return threadWithActiveNode(thread, thread.activeNodeId);
        }
        return {
          ...threadWithActiveNode(thread, nodeId),
          nodes: thread.nodes.map((node) =>
            node.id === nodeId && node.kind === 'chat' && node.status === 'unread'
              ? { ...node, status: undefined }
              : node,
          ),
        };
      }),
    }));
  }

  function deselectNode() {
    setState((current) => ({ ...current, selectedThreadId: null, selectedNodeId: null }));
    setContextLinkMode(null);
    setMiniChatOpen(false);
    setDeleteMode(null);
  }

  function deleteThread(threadId: string) {
    setState((current) => {
      const remainingThreads = current.threads.filter((thread) => thread.id !== threadId);
      if (remainingThreads.length === 0) {
        const fallbackThread = createThread(
          'New thread',
          'A new lane for a project idea and its AI chat context.',
          0,
          { initialModel: activeProviderConfig?.model ?? '' },
        );
        return {
          ...current,
          threads: [fallbackThread],
          selectedThreadId: fallbackThread.id,
          selectedNodeId: fallbackThread.activeNodeId,
        };
      }

      if (current.selectedThreadId === threadId) {
        const nextThread = remainingThreads[0];
        return {
          ...current,
          threads: remainingThreads,
          selectedThreadId: nextThread.id,
          selectedNodeId: nextThread.activeNodeId,
        };
      }

      return {
        ...current,
        threads: remainingThreads,
      };
    });

    setContextLinkMode((mode) => (mode?.sourceThreadId === threadId ? null : mode));
    setDeleteMode(null);
    setMiniChatOpen(false);
  }

  function enterDeleteMode(threadId: string, nodeId: string) {
    const thread = state.threads.find((t) => t.id === threadId);
    const node = thread?.nodes.find((n) => n.id === nodeId);
    if (!node || (node.kind !== 'chat' && node.kind !== 'context')) return;
    const hasUser = node.messages.some((m) => m.role === 'user');
    const hasAssistant = node.messages.some((m) => m.role === 'assistant');
    setDeleteMode({ nodeId, parts: { user: hasUser, assistant: hasAssistant } });
  }

  function toggleDeletePart(part: 'user' | 'assistant') {
    if (!deleteMode) return;
    const newParts = { ...deleteMode.parts, [part]: !deleteMode.parts[part] };
    if (!newParts.user && !newParts.assistant) return;
    setDeleteMode({ ...deleteMode, parts: newParts });
  }

  function confirmDeleteNode(threadId: string) {
    if (!deleteMode) return;
    setState((current) => {
      const targetThread = current.threads.find((t) => t.id === threadId);
      if (!targetThread) return current;
      const targetNode = targetThread.nodes.find((n) => n.id === deleteMode.nodeId);
      if (!targetNode || (targetNode.kind !== 'chat' && targetNode.kind !== 'context')) return current;

      return {
        ...current,
        threads: current.threads.map((thread) => {
          if (thread.id !== threadId) return thread;
          const node = thread.nodes.find((n) => n.id === deleteMode.nodeId);
          if (!node) return thread;
          if (node.kind !== 'chat' && node.kind !== 'context') return thread;
          const nodeMsgIds = new Set(node.messages.map((m) => m.id));

          if (node.kind === 'chat') {
            const remaining = node.messages.filter((m) => {
              if (m.role === 'user' && deleteMode.parts.user) return false;
              if (m.role === 'assistant' && deleteMode.parts.assistant) return false;
              return true;
            });
            if (remaining.length === 0) {
              const newNodes = thread.nodes.filter((n) => n.id !== deleteMode.nodeId);
              const remainingChatNodes = newNodes.filter((n): n is ThreadChatNode => n.kind === 'chat');

              if (remainingChatNodes.length === 0) {
                const replacementChatNode = createChatNode('AI chat ready', [], node.model || '');
                const nodesWithReplacement = [...newNodes, replacementChatNode];
                return {
                  ...thread,
                  nodes: nodesWithReplacement,
                  context: thread.context.filter((m) => !nodeMsgIds.has(m.id)),
                  activeNodeId: replacementChatNode.id,
                };
              }

              return {
                ...thread,
                nodes: newNodes,
                context: thread.context.filter((m) => !nodeMsgIds.has(m.id)),
                activeNodeId: thread.activeNodeId === deleteMode.nodeId
                  ? (newNodes.find((n) => n.kind === 'chat')?.id ?? null)
                  : thread.activeNodeId,
              };
            }
            return {
              ...thread,
              nodes: thread.nodes.map((n) =>
                n.id === deleteMode.nodeId
                  ? { ...n, messages: remaining, summary: summarize(remaining.map((m) => m.text).join(' ')) }
                  : n,
              ),
            };
          }
          if (node.kind === 'context') {
            const newNodes = thread.nodes.filter((n) => n.id !== deleteMode.nodeId);
            return {
              ...thread,
              nodes: newNodes,
              context: thread.context.filter((m) => !nodeMsgIds.has(m.id)),
              activeNodeId: thread.activeNodeId === deleteMode.nodeId
                ? (newNodes.find((n) => n.kind === 'chat')?.id ?? null)
                : thread.activeNodeId,
            };
          }
          return thread;
        }),
        selectedNodeId: current.selectedNodeId === deleteMode.nodeId ? null : current.selectedNodeId,
      };
    });
    setDeleteMode(null);
  }

  function enterContextLinkMode(thread: ThreadLane, nodeId: string, side: 'left' | 'right') {
    const selectableNodes = thread.nodes.filter((n) => (n.kind === 'chat' && n.messages.length > 0) || n.kind === 'context');
    const idx = selectableNodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return;
    const selectedNodes = selectableNodes.slice(0, idx + 1).map((n) => ({
      nodeId: n.id,
      parts: { user: true, assistant: true },
    }));
    setContextLinkMode({ sourceThreadId: thread.id, dotNodeId: nodeId, selectedNodes, side });
  }

  function toggleContextNode(nodeId: string) {
    if (!contextLinkMode) return;
    const isSelected = contextLinkMode.selectedNodes.some((s) => s.nodeId === nodeId);
    if (isSelected && contextLinkMode.selectedNodes.length === 1) return;
    const selectedNodes = isSelected
      ? contextLinkMode.selectedNodes.filter((s) => s.nodeId !== nodeId)
      : [...contextLinkMode.selectedNodes, { nodeId, parts: { user: true, assistant: true } }];
    setContextLinkMode({ ...contextLinkMode, selectedNodes });
  }

  function toggleContextPart(nodeId: string, part: 'user' | 'assistant') {
    if (!contextLinkMode) return;
    const selectedNodes = contextLinkMode.selectedNodes.flatMap((s) => {
      if (s.nodeId !== nodeId) return [s];
      const newParts = { ...s.parts, [part]: !s.parts[part] };
      if (!newParts.user && !newParts.assistant) return [];
      return [{ ...s, parts: newParts }];
    });
    setContextLinkMode({ ...contextLinkMode, selectedNodes });
  }

  function injectContextTo(destThreadId: string) {
    if (!contextLinkMode) return;
    const sourceThread = state.threads.find((t) => t.id === contextLinkMode.sourceThreadId);
    if (!sourceThread) return;

    const injectedMessages: ChatMessage[] = [];
    for (const node of sourceThread.nodes) {
      if (node.kind !== 'chat' && node.kind !== 'context') continue;
      const selection = contextLinkMode.selectedNodes.find((s) => s.nodeId === node.id);
      if (!selection) continue;
      for (const msg of node.messages) {
        if (msg.role === 'user' && !selection.parts.user) continue;
        if (msg.role === 'assistant' && !selection.parts.assistant) continue;
        injectedMessages.push({
          ...msg,
          id: `injected-${crypto.randomUUID().slice(0, 8)}`,
          injectedFromThreadId: sourceThread.id,
          injectedFromColor: sourceThread.color,
        });
      }
    }

    if (injectedMessages.length === 0) {
      setContextLinkMode(null);
      return;
    }

    const contextNode = createContextNode(sourceThread, contextLinkMode.selectedNodes.map((s) => s.nodeId), injectedMessages);

    setState((current) => ({
      ...current,
      version: current.version + 1,
      threads: current.threads.map((t) =>
        t.id === destThreadId ? appendContextInjection(t, contextNode, injectedMessages) : t,
      ),
      selectedThreadId: destThreadId,
      selectedNodeId: contextNode.id,
    }));

    setContextLinkMode(null);
  }

  function updateProviderConfig(configId: string, patch: Partial<AIProviderConfig>) {
    setSettings((current) => ({
      ...current,
      providerConfigs: current.providerConfigs.map((config) => (config.id === configId ? { ...config, ...patch } : config)),
    }));
  }

  function requestSaveKey() {
    const candidate = activeProviderConfig?.apiKey.trim() ?? '';
    if (!candidate) {
      if (activeProviderConfig?.hasEncryptedApiKey) {
        setPassphraseModal({ mode: 'unlock', passphrase: '', busy: false, targetConfigId: activeProviderConfig.id });
      } else {
        setError('Enter your API key first.');
      }
      return;
    }
    setError(null);
    setPassphraseModal({ mode: 'encrypt', passphrase: '', busy: false, pendingKey: candidate, targetConfigId: activeProviderConfig.id });
  }

  function deleteSavedKey() {
    if (!activeProviderConfig) return;
    const confirmed = activeProviderConfig.hasEncryptedApiKey ? window.confirm('Delete the saved encrypted key from this browser?') : true;
    if (!confirmed) return;
    clearProviderSecret(activeProviderConfig.id);
    updateProviderConfig(activeProviderConfig.id, { apiKey: '', hasEncryptedApiKey: false });
    setSettingsNotice('Saved key deleted from this browser.');
    setError(null);
  }

  async function submitPassphraseModal() {
    if (!passphraseModal) return;
    const passphrase = passphraseModal.passphrase;
    if (!passphrase.trim()) {
      setError('Enter a passphrase.');
      return;
    }
    const configId = passphraseModal.targetConfigId ?? activeProviderConfig?.id;
    if (!configId) return;
    setPassphraseModal({ ...passphraseModal, busy: true });
    setError(null);
    setSavingSettings(true);
    try {
      if (passphraseModal.mode === 'unlock') {
        const apiKey = await unlockProviderSecret(configId, passphrase);
        updateProviderConfig(configId, { apiKey, hasEncryptedApiKey: true });
        setSettings((current) => ({ ...current, activeProviderConfigId: configId }));
        setSettingsNotice('Key unlocked — loaded in memory for this session.');
      } else {
        const keyToSave = passphraseModal.pendingKey?.trim() ?? settings.providerConfigs.find((config) => config.id === configId)?.apiKey.trim() ?? '';
        if (!keyToSave) throw new Error('No key to save.');
        await saveProviderSecret(configId, keyToSave, passphrase);
        updateProviderConfig(configId, { apiKey: keyToSave, hasEncryptedApiKey: true });
        setSettings((current) => ({ ...current, activeProviderConfigId: configId }));
        setSettingsNotice('Key encrypted and saved. Loaded in memory for this session.');
      }
      setPassphraseModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passphrase action failed.');
      setPassphraseModal((current) => (current ? { ...current, busy: false } : current));
    } finally {
      setSavingSettings(false);
    }
  }

  function closePassphraseModal() {
    setPassphraseModal(null);
  }

  function resetWorkspace() {
    localStorage.removeItem('loomspace.workspace.v7');
    clearSettingsCookies();
    settings.providerConfigs.forEach((config) => clearProviderSecret(config.id));
    clearProviderSecret('openai');
    clearProviderSecret('anthropic');
    clearProviderSecret('openrouter');
    clearProviderSecret('openai-compatible-custom');
    setState(loadWorkspace());
    setSettings(loadSettings());
    setComposerDraft('');
    setPassphraseModal(null);
    setSettingsNotice(null);
    setError(null);
    setModelCache({});
    setChatModalOpen(false);
    setThreadEditorOpen(false);
  }

  function changeSettingsProvider(providerConfigId: string) {
    const config = settings.providerConfigs.find((entry) => entry.id === providerConfigId);
    if (!config) return;
    const cached = modelCache[providerConfigId] ?? modelCache[providerModelCacheKey(config)];
    const nextModel = cached?.[0] ?? config.model ?? providerInfo(config.kind).defaultModel;
    setSettings((current) => ({
      ...current,
      activeProviderConfigId: providerConfigId,
      providerConfigs: current.providerConfigs.map((entry) =>
        entry.id === providerConfigId ? { ...entry, model: nextModel } : entry,
      ),
    }));
  }

  function deleteProfile(configId: string) {
    const target = settings.providerConfigs.find((config) => config.id === configId);
    if (!target) return;
    const confirmed = window.confirm(`Delete AI profile "${target.label}"? Its saved key will be removed from this browser.`);
    if (!confirmed) return;
    const next = deleteProviderConfig(settings, configId);
    setSettings(next);
    setModelCache((current) => {
      const copy = { ...current };
      delete copy[configId];
      return copy;
    });
    setSettingsNotice(`Deleted AI profile "${target.label}".`);
    setError(null);
  }

  async function refreshModels(providerConfigId: string) {
    const config = settings.providerConfigs.find((entry) => entry.id === providerConfigId);
    if (!config) return;
    if (!config.apiKey.trim()) {
      setError(config.hasEncryptedApiKey ? 'Unlock this provider config first so we can list models.' : 'Add and unlock your API key to list models.');
      setPassphraseModal({ mode: 'unlock', passphrase: '', busy: false, targetConfigId: config.id });
      return;
    }
    setModelsLoading(true);
    setError(null);
    try {
      const ids = await fetchProviderModels(config);
      const providerKey = providerModelCacheKey(config);
      setModelCache((current) => ({ ...current, [providerConfigId]: ids, [providerKey]: ids }));
      setSettingsNotice(`Loaded ${ids.length} models for ${config.label}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to list models for ${config.label}`);
    } finally {
      setModelsLoading(false);
    }
  }

  function beginPan(event: PointerEvent<HTMLDivElement>) {
    pointerMap.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointerMap.current.size === 2) {
      panGesture.current = null;
      const [p1, p2] = [...pointerMap.current.values()];
      pinchState.current = {
        dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        zoom: state.zoom,
      };
      return;
    }

    const isMiddle = event.button === 1;
    const isPanKey = spaceHeld.current || ctrlHeld.current;
    const isBackground = event.target === event.currentTarget;

    if (!isMiddle && !isPanKey && !isBackground) return;

    if (isMiddle) event.preventDefault();

    panGesture.current = { startX: event.clientX, startY: event.clientY, panX: state.panX, panY: state.panY };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (isPanKey) setPanMode('panning');
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    pointerMap.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinchState.current && pointerMap.current.size === 2) {
      const [p1, p2] = [...pointerMap.current.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const nextZoom = clamp(pinchState.current.zoom * (dist / pinchState.current.dist), MIN_ZOOM, MAX_ZOOM);
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      zoomAt(midX, midY, nextZoom);
      return;
    }

    if (!panGesture.current) return;
    const deltaX = event.clientX - panGesture.current.startX;
    const deltaY = event.clientY - panGesture.current.startY;
    const viewport = viewportRef.current;
    const width = viewport?.clientWidth ?? window.innerWidth;
    const height = viewport?.clientHeight ?? window.innerHeight;
    const next = boundedPan(
      panGesture.current.panX + deltaX,
      panGesture.current.panY + deltaY,
      state.zoom,
      width,
      height,
      canvasWidth,
      canvasHeight,
    );
    setState((current) => ({ ...current, ...next }));
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    pointerMap.current.delete(event.pointerId);
    if (pointerMap.current.size < 2) pinchState.current = null;
    if (pointerMap.current.size === 0) {
      panGesture.current = null;
      if (spaceHeld.current || ctrlHeld.current) setPanMode('ready');
      else setPanMode('idle');
    }
  }

  function zoomAt(clientX: number, clientY: number, nextZoom: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const pointX = clientX - rect.left;
    const pointY = clientY - rect.top;

    setState((current) => {
      const scale = zoom / current.zoom;
      const transformed = {
        panX: pointX - (pointX - current.panX) * scale,
        panY: pointY - (pointY - current.panY) * scale,
      };
      return {
        ...current,
        zoom,
        ...boundedPan(transformed.panX, transformed.panY, zoom, rect.width, rect.height, canvasWidth, canvasHeight),
      };
    });
  }

  function zoomFromButton(direction: 1 | -1) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, state.zoom + direction * 0.1);
  }

  function setZoom(nextZoom: number) {
    clampViewport({ zoom: nextZoom });
  }

  function resetView() {
    const viewport = viewportRef.current;
    if (!viewport) {
      setState((current) => ({ ...current, zoom: 1, panX: 0, panY: 0 }));
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const centered = boundedPan(
      (rect.width - canvasWidth) / 2,
      EDGE_PADDING,
      1,
      rect.width,
      rect.height,
      canvasWidth,
      canvasHeight,
    );
    setState((current) => ({ ...current, zoom: 1, ...centered }));
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomAt(event.clientX, event.clientY, state.zoom - event.deltaY * 0.0005);
      return;
    }
    const viewport = viewportRef.current;
    const width = viewport?.clientWidth ?? window.innerWidth;
    const height = viewport?.clientHeight ?? window.innerHeight;
    const next = boundedPan(state.panX - event.deltaX, state.panY - event.deltaY, state.zoom, width, height, canvasWidth, canvasHeight);
    setState((current) => ({ ...current, ...next }));
  }

  const selectedThreadUsage = activeThread ? summarizeThreadUsage(activeThread) : null;
  const remainingContext = activeThread && selectedThreadUsage && activeProviderConfig
    ? Math.max(getModelWindow(activeProviderConfig.model) - selectedThreadUsage.totalTokens, 0)
    : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <button
            type="button"
            className="menu-toggle"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle threads panel"
          >
            ☰
          </button>
          <div>
            <p className="eyebrow">Loomspace</p>
            <h1>{state.title}</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <button onClick={() => openThreadEditor('create')}><svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6.5" y1="1.5" x2="6.5" y2="11.5"/><line x1="1.5" y1="6.5" x2="11.5" y2="6.5"/></svg> New thread</button>
          <button onClick={() => zoomFromButton(-1)} aria-label="Zoom out">−</button>
          <button onClick={resetView} className="topbar-reset-view" aria-label="Reset view"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8a6 6 0 1 0 1.17-3.6"/><polyline points="2 4 2 8 6 8"/></svg></button>
          <button onClick={() => zoomFromButton(1)} aria-label="Zoom in">+</button>
          <input
            className="zoom-slider"
            type="range"
            min={Math.round(MIN_ZOOM * 100)}
            max={Math.round(MAX_ZOOM * 100)}
            value={Math.round(state.zoom * 100)}
            onChange={(event) => setZoom(Number(event.target.value) / 100)}
          />
          <button onClick={() => { if (window.confirm('Reset the fabric?\n\nThis will permanently delete all threads and AI profiles from this browser. This cannot be undone.')) resetWorkspace(); }} className="quiet topbar-reset-fabric icon-btn" aria-label="Reset fabric"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 3 14 13 14 13 6"/><line x1="1" y1="3" x2="15" y2="3"/><line x1="6" y1="3" x2="6" y2="1"/><line x1="10" y1="3" x2="10" y2="1"/></svg></button>
        </div>
      </header>

      <main className="layout">
        {sidebarOpen ? <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} /> : null}
        <aside className={`panel left ${sidebarOpen ? 'open' : ''}`}>
          {activeThread ? (
            <section className="inspector-card editor-summary">
              <div className="meta-row">
                <div>
                  <p className="eyebrow">Selected thread</p>
                  <h2>{activeThread.title}</h2>
                </div>
                <button className="quiet icon-btn" onClick={() => openThreadEditor('edit', activeThread)} aria-label="Edit thread"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11.5 2.5a1.5 1.5 0 0 1 2.12 2.12L5 13.24l-3 .76.76-3 8.74-8.5z"/></svg></button>
              </div>
              <p>{activeThread.description}</p>
              <button onClick={() => selectThread(activeThread.id, activeThread.activeNodeId)} style={{ marginTop: 12 }}>
                Open chat
              </button>
            </section>
          ) : (
            <section className="inspector-card editor-summary">
              <p className="eyebrow">Thread setup</p>
              <h2>Start a new thread</h2>
              <p>Pop the title and description in first, then jump into the chat.</p>
              <button onClick={() => openThreadEditor('create')} style={{ marginTop: 12 }}>
                Create thread
              </button>
            </section>
          )}

          <section className="inspector-card profile-list-card">
            <div className="meta-row">
              <h2>AI profiles</h2>
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  setSidebarOpen(false);
                  setAiSettingsModalOpen(true);
                }}
              >
                Manage
              </button>
            </div>
            {settings.providerConfigs.length === 0 ? (
              <div className="profile-list-empty">
                <p>No AI profiles yet.</p>
                <button
                  type="button"
                  className="profile-list-empty-cta"
                  onClick={() => {
                    const next = createProviderConfig('openai-compatible-custom', { label: 'New profile', model: '' });
                    setSettings((current) => ({
                      ...current,
                      activeProviderConfigId: next.id,
                      providerConfigs: [...current.providerConfigs, next],
                    }));
                    setSidebarOpen(false);
                    setAiSettingsModalOpen(true);
                  }}
                >
                  Add AI profile
                </button>
              </div>
            ) : (
              <>
                <div className="profile-list">
                  {settings.providerConfigs.map((config) => {
                    const isActive = config.id === activeProviderConfig?.id;
                    const lock = config.hasEncryptedApiKey
                      ? config.apiKey.trim()
                        ? 'unlocked'
                        : 'locked'
                      : 'none';
                    return (
                      <button
                        key={config.id}
                        type="button"
                        className={`profile-chip ${isActive ? 'selected' : ''}`}
                        onClick={() => changeSettingsProvider(config.id)}
                      >
                        <span className="profile-chip-copy">
                          <strong>{config.label}</strong>
                          <small>{providerInfo(config.kind).label} · {config.model}</small>
                        </span>
                        <span className={`pill profile-lock ${lock}`}>
                          {lock === 'none' ? 'no key' : lock === 'unlocked' ? 'unlocked' : 'locked'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="editor-actions left-aligned">
                  <button
                    type="button"
                    onClick={() => {
                      const next = createProviderConfig('openai-compatible-custom', { label: 'New profile', model: '' });
                      setSettings((current) => ({
                        ...current,
                        activeProviderConfigId: next.id,
                        providerConfigs: [...current.providerConfigs, next],
                      }));
                      setSidebarOpen(false);
                      setAiSettingsModalOpen(true);
                    }}
                  >
                    Add profile
                  </button>
                </div>
              </>
            )}
          </section>

          <div className="thread-list-spacer">
            <h2>Threads</h2>
            <div className="thread-list">
              {state.threads.length === 0 ? <p className="muted">No threads yet.</p> : null}
              {state.threads.map((thread) => {
                const isActive = thread.id === activeThread?.id;
                return (
                  <button
                    key={thread.id}
                    className={`thread-chip ${isActive ? 'selected' : ''}`}
                    style={{ borderColor: thread.color }}
                    onClick={() => selectThread(thread.id, thread.activeNodeId)}
                  >
                    <span className="dot" style={{ background: thread.color }} />
                    <span className="thread-chip-copy">
                      {thread.title}
                      <small>{thread.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <span>{state.densityOverlay ? 'Threadlines on' : 'Threadlines off'}</span>
            <span>{Math.round(state.zoom * 100)}%</span>
            <span>{metrics.saturation * 100 < 50 ? 'light weave' : 'dense weave'}</span>
          </div>

          <div className="canvas-area">
          <div ref={viewportRef} className={`canvas-viewport ${state.densityOverlay ? 'overlay' : ''} pan-${panMode}`} onWheel={onWheel}>
            <div
              className="canvas-stage"
              style={{
                width: canvasWidth,
                height: canvasHeight,
                transform: `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`,
              }}
              onPointerDown={beginPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerLeave={endPan}
              onPointerCancel={endPan}
              onContextMenu={(e) => { if (e.button === 1) e.preventDefault(); }}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                deselectNode();
              }}
            >
              <svg className="edges-layer" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} preserveAspectRatio="none">
                {lanes.map((lane) => {
                  const path = buildThreadPath(lane.centerX, lane.nodes.map((entry) => entry.node), lane.thread);
                  const anchors = buildAnchors(lane.centerX, lane.nodes.map((entry) => entry.node), lane.thread);
                  return (
                    <g key={lane.thread.id}>
                      <path d={path} className={`rope-shadow ${lane.thread.id === activeThread?.id ? 'active' : ''}`} />
                      <path d={path} className={`rope ${lane.thread.id === activeThread?.id ? 'active' : ''}`} />
                      {anchors.map((point, index) => (
                        <circle key={`${lane.thread.id}-${index}`} cx={point.x} cy={point.y} r="4" className="knot" />
                      ))}
                    </g>
                  );
                })}
                {lanes.flatMap((destLane) =>
                  destLane.nodes
                    .filter((entry): entry is { node: ThreadContextNode; top: number } => entry.node.kind === 'context')
                    .map(({ node: ctxNode, top: destTop }) => {
                      const sourceLane = lanes.find((l) => l.thread.id === ctxNode.sourceThreadId);
                      if (!sourceLane) return null;
                      const firstEntry = sourceLane.nodes.find((e) => e.node.id === ctxNode.sourceNodeIds[0]);
                      const lastEntry = sourceLane.nodes.find((e) => e.node.id === ctxNode.sourceNodeIds[ctxNode.sourceNodeIds.length - 1]);
                      if (!firstEntry || !lastEntry) return null;
                      const dir = destLane.centerX >= sourceLane.centerX ? 1 : -1;
                      const srcX = sourceLane.centerX + dir * 22;
                      const srcY1 = firstEntry.top + CHAT_HEIGHT / 2;
                      const srcY2 = lastEntry.top + CHAT_HEIGHT / 2;
                      const dstX = destLane.centerX;
                      const dstY = destTop + CHAT_HEIGHT / 2;
                      const dx = Math.abs(dstX - srcX) * 0.45;
                      return (
                        <path
                          key={ctxNode.id}
                          d={`M ${srcX} ${srcY1} L ${srcX} ${srcY2} C ${srcX + dir * dx} ${srcY2} ${dstX - dir * dx} ${dstY} ${dstX} ${dstY}`}
                          className="context-link"
                          stroke={ctxNode.sourceThreadColor}
                        />
                      );
                    })
                )}
                {contextLinkMode && (() => {
                  const srcLane = lanes.find((l) => l.thread.id === contextLinkMode.sourceThreadId);
                  if (!srcLane) return null;
                  const selectedIds = new Set(contextLinkMode.selectedNodes.map((s) => s.nodeId));
                  const sorted = srcLane.nodes
                    .filter((e) => selectedIds.has(e.node.id))
                    .sort((a, b) => a.top - b.top);
                  if (sorted.length === 0) return null;
                  const offset = contextLinkMode.side === 'right' ? 22 : -22;
                  const srcX = srcLane.centerX + offset;
                  return (
                    <line
                      key="ctx-preview"
                      x1={srcX} y1={sorted[0].top + CHAT_HEIGHT / 2}
                      x2={srcX} y2={sorted[sorted.length - 1].top + CHAT_HEIGHT / 2}
                      className="context-link-preview"
                    />
                  );
                })()}
              </svg>

              {lanes.map((lane) => {
                const thread = lane.thread;
                const isActiveLane = thread.id === activeThread?.id;
                return (
                  <div
                    key={thread.id}
                    className={`thread-lane ${isActiveLane ? 'active' : ''}`}
                    style={{ left: lane.centerX - NODE_WIDTH / 2, top: 0, width: NODE_WIDTH, height: lane.height, zIndex: thread.nodes.some((n) => n.kind === 'context') ? 0 : 1 }}
                  >
                    {lane.nodes.map(({ node, top }, nodeIndex) => {
                      if (node.kind === 'title') {
                        const titleNode = node;
                        return (
                          <div key={node.id} className={`title-node-wrap ${thread.infoOpen ? 'open' : ''}`} style={{ top }}>
                            <article className="title-node">
                              <div className="title-node-head">
                                <input value={titleNode.title} onChange={(event) => updateTitle(thread.id, event.target.value)} onFocus={() => selectThread(thread.id, node.id)} />
                                <div className="title-node-actions">
                                  <button type="button" className="info-button" onClick={() => toggleInfo(thread.id)} aria-label="Thread info">
                                    ⓘ
                                  </button>
                                  <button
                                    type="button"
                                    className="thread-delete-button"
                                    onClick={() => deleteThread(thread.id)}
                                    aria-label="Delete thread"
                                    title="Delete thread"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 3 14 13 14 13 6"/><line x1="1" y1="3" x2="15" y2="3"/><line x1="7" y1="7" x2="7" y2="11"/></svg>
                                  </button>
                                </div>
                              </div>
                              {thread.infoOpen ? <p className="thread-popout">{titleNode.description}</p> : null}
                            </article>
                          </div>
                        );
                      }

                      if (node.kind === 'context') {
                        const ctxNode = node;
                        const isSelected = thread.id === state.selectedThreadId && node.id === state.selectedNodeId;
                        const ctxPart = contextLinkMode?.sourceThreadId === thread.id
                          ? contextLinkMode.selectedNodes.find((s) => s.nodeId === node.id) ?? null
                          : null;
                        const isContextSource = ctxPart !== null;
                        const isContextTarget = contextLinkMode !== null && thread.id !== contextLinkMode.sourceThreadId;
                        const showDots = !miniChatOpen && (isSelected || (contextLinkMode?.dotNodeId === node.id && contextLinkMode.sourceThreadId === thread.id));

                        const handleSideDotCtx = (side: 'left' | 'right') => (e: React.MouseEvent) => {
                          e.stopPropagation();
                          if (contextLinkMode?.dotNodeId === node.id && contextLinkMode.sourceThreadId === thread.id && contextLinkMode.side === side) {
                            if (contextLinkMode.selectedNodes.length <= 1) setContextLinkMode(null);
                            else setContextLinkMode({ ...contextLinkMode, selectedNodes: [{ nodeId: node.id, parts: { user: true, assistant: true } }] });
                          } else {
                            enterContextLinkMode(thread, node.id, side);
                          }
                        };

                        const handleForkDotCtx = (side: 'left' | 'right') => (e: React.MouseEvent) => {
                          e.stopPropagation();
                          openForkThreadEditor(thread, node.id, side);
                        };

                        return (
                          <div key={node.id} style={{ position: 'absolute', top, left: 0 }}>
                            <div
                              className={`context-node ${isSelected ? 'selected' : ''} ${isContextSource ? 'context-source-selected' : ''} ${isContextTarget ? 'context-target' : ''}`}
                              style={{ position: 'relative', '--ctx-color': ctxNode.sourceThreadColor, '--ctx-bg': hexToRgba(ctxNode.sourceThreadColor, 0.07), '--ctx-border': hexToRgba(ctxNode.sourceThreadColor, 0.35) } as React.CSSProperties}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (contextLinkMode) {
                                  if (thread.id === contextLinkMode.sourceThreadId) toggleContextNode(node.id);
                                  else injectContextTo(thread.id);
                                  return;
                                }
                                selectNode(thread.id, node.id);
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                suppressReadMoreUntil.current = Date.now() + 350;
                                if (contextLinkMode) return;
                                selectNode(thread.id, node.id);
                                if (nodeIndex === lane.nodes.length - 1) {
                                  setChatModalOpen(false);
                                  setMiniChatOpen(true);
                                  return;
                                }
                                if (ctxNode.messages.length > 0) {
                                  setNodePreviewModal({ title: ctxNode.sourceThreadTitle, messages: ctxNode.messages });
                                }
                              }}
                            >
                              <div className="exchange-head" style={{ color: ctxNode.sourceThreadColor, opacity: 0.75 }}>
                                <span>Context from</span>
                              </div>
                              <strong style={{ color: ctxNode.sourceThreadColor }}>{ctxNode.sourceThreadTitle}</strong>
                              <small>{ctxNode.messages.length} messages · {ctxNode.createdAt.slice(0, 10)}</small>
                              <div className="node-footer">
                                {ctxNode.messages.length > 0 ? (
                                  <button
                                    type="button"
                                    className="node-expand-toggle"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (e.detail > 1) return;
                                      if (readMoreTimerRef.current) window.clearTimeout(readMoreTimerRef.current);
                                      const openedAt = Date.now();
                                      readMoreTimerRef.current = window.setTimeout(() => {
                                        readMoreTimerRef.current = null;
                                        if (Date.now() < suppressReadMoreUntil.current || suppressReadMoreUntil.current > openedAt) return;
                                        setNodePreviewModal({ title: ctxNode.sourceThreadTitle, messages: ctxNode.messages });
                                      }, 320);
                                    }}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      suppressReadMoreUntil.current = Date.now() + 400;
                                      if (readMoreTimerRef.current) {
                                        window.clearTimeout(readMoreTimerRef.current);
                                        readMoreTimerRef.current = null;
                                      }
                                    }}
                                  >
                                    Read more
                                  </button>
                                ) : null}
                              </div>
                              {isSelected && !contextLinkMode ? (
                                <button
                                  type="button"
                                  className="node-delete-corner"
                                  aria-label="Delete node"
                                  title="Delete node"
                                  onClick={(e) => { e.stopPropagation(); enterDeleteMode(thread.id, node.id); }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 3 14 13 14 13 6"/><line x1="1" y1="3" x2="15" y2="3"/><line x1="7" y1="7" x2="7" y2="11"/></svg>
                                </button>
                              ) : null}
                            </div>
                            {isContextSource && ctxPart ? (
                              <div className="context-select-overlay" onClick={(e) => e.stopPropagation()}>
                                <button type="button" className={`context-select-half user ${ctxPart.parts.user ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleContextPart(node.id, 'user'); }}>
                                  <span>User prompt</span>
                                  <span className="context-select-check">{ctxPart.parts.user ? '✓' : '○'}</span>
                                </button>
                                <button type="button" className={`context-select-half assistant ${ctxPart.parts.assistant ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleContextPart(node.id, 'assistant'); }}>
                                  <span>Asst response</span>
                                  <span className="context-select-check">{ctxPart.parts.assistant ? '✓' : '○'}</span>
                                </button>
                              </div>
                            ) : null}
                            {deleteMode?.nodeId === node.id && (
                              <div className="delete-select-overlay" onClick={(e) => e.stopPropagation()}>
                                {deleteMode.parts.user && (
                                  <button type="button" className="delete-select-half user active" onClick={(e) => { e.stopPropagation(); toggleDeletePart('user'); }}>
                                    <span>User prompt</span>
                                    <span className="delete-select-check">✓</span>
                                  </button>
                                )}
                                {deleteMode.parts.assistant && (
                                  <button type="button" className="delete-select-half assistant active" onClick={(e) => { e.stopPropagation(); toggleDeletePart('assistant'); }}>
                                    <span>Asst response</span>
                                    <span className="delete-select-check">✓</span>
                                  </button>
                                )}
                                <button type="button" className="delete-confirm-btn" onClick={(e) => { e.stopPropagation(); confirmDeleteNode(thread.id); }}>
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 3 14 13 14 13 6"/><line x1="1" y1="3" x2="15" y2="3"/><line x1="7" y1="7" x2="7" y2="11"/></svg>
                                  Delete
                                </button>
                              </div>
                            )}
                            {showDots && (
                              <>
                                <div className="action-line-h" style={{ top: CHAT_HEIGHT / 2, left: -36 }} />
                                <div className="action-dot-group action-left" style={{ top: 0, left: -52, height: CHAT_HEIGHT }}>
                                  <button type="button" className="action-dot" aria-label="Inject context left" onClick={handleSideDotCtx('left')}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 9l-1 1a3 3 0 0 1-4.24-4.24l2-2a3 3 0 0 1 4.24 4.24"/><path d="M9 7l1-1a3 3 0 0 1 4.24 4.24l-2 2a3 3 0 0 1-4.24-4.24"/></svg><span>Link</span></button>
                                  <button type="button" className="fork-dot" aria-label="Fork into new thread" onClick={handleForkDotCtx('left')}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="8" r="1.5"/><path d="M5.5 3h2a2 2 0 0 1 2 2v1.5"/><path d="M5.5 13h2a2 2 0 0 0 2-2V9.5"/></svg><span>Fork</span></button>
                                </div>
                                <div className="action-line-h" style={{ top: CHAT_HEIGHT / 2, left: NODE_WIDTH }} />
                                <div className="action-dot-group action-right" style={{ top: 0, left: NODE_WIDTH + 10, height: CHAT_HEIGHT }}>
                                  <button type="button" className="action-dot" aria-label="Inject context right" onClick={handleSideDotCtx('right')}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 9l-1 1a3 3 0 0 1-4.24-4.24l2-2a3 3 0 0 1 4.24 4.24"/><path d="M9 7l1-1a3 3 0 0 1 4.24 4.24l-2 2a3 3 0 0 1-4.24-4.24"/></svg><span>Link</span></button>
                                  <button type="button" className="fork-dot" aria-label="Fork into new thread" onClick={handleForkDotCtx('right')}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="8" r="1.5"/><path d="M5.5 3h2a2 2 0 0 1 2 2v1.5"/><path d="M5.5 13h2a2 2 0 0 0 2-2V9.5"/></svg><span>Fork</span></button>
                                </div>
                                {nodeIndex === lane.nodes.length - 1 && (<>
                                  <div className="action-line-v" style={{ top: CHAT_HEIGHT, left: NODE_WIDTH / 2 }} />
                                  <button type="button" className="action-node-ghost" style={{ top: CHAT_HEIGHT + 36, left: 0 }} aria-label="Open chat" onClick={(e) => { e.stopPropagation(); setChatModalOpen(false); setMiniChatOpen(true); }}>
                                    <span>Open chat</span>
                                  </button>
                                </>)}
                              </>
                            )}
                          </div>
                        );
                      }

                      const chatNode = node;
                      const isSelected = thread.id === state.selectedThreadId && node.id === state.selectedNodeId;
                      const ctxPart = contextLinkMode?.sourceThreadId === thread.id
                        ? contextLinkMode.selectedNodes.find((s) => s.nodeId === node.id) ?? null
                        : null;
                      const isContextSource = ctxPart !== null;
                      const isContextTarget = contextLinkMode !== null && thread.id !== contextLinkMode.sourceThreadId;
                      const showDots = !miniChatOpen && (isSelected || (contextLinkMode?.dotNodeId === node.id && contextLinkMode.sourceThreadId === thread.id));

                      const handleSideDot = (side: 'left' | 'right') => (e: React.MouseEvent) => {
                        e.stopPropagation();
                        if (contextLinkMode?.dotNodeId === node.id && contextLinkMode.sourceThreadId === thread.id && contextLinkMode.side === side) {
                          if (contextLinkMode.selectedNodes.length <= 1) setContextLinkMode(null);
                          else setContextLinkMode({ ...contextLinkMode, selectedNodes: [{ nodeId: node.id, parts: { user: true, assistant: true } }] });
                        } else {
                          enterContextLinkMode(thread, node.id, side);
                        }
                      };

                      const handleForkDot = (side: 'left' | 'right') => (e: React.MouseEvent) => {
                        e.stopPropagation();
                        openForkThreadEditor(thread, node.id, side);
                      };

                      return (
                        <div key={node.id} style={{ position: 'absolute', top, left: 0 }}>
                          <div
                            className={`chat-node ${isSelected ? 'selected' : ''} ${chatNode.status === 'pending' ? 'sending' : ''} ${chatNode.status === 'unread' && !(miniChatOpen && thread.id === state.selectedThreadId) ? 'responded' : ''} ${isContextSource ? 'context-source-selected' : ''} ${isContextTarget ? 'context-target' : ''}`}
                            style={{ position: 'relative', top: 0, left: 0 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (contextLinkMode) {
                                if (thread.id === contextLinkMode.sourceThreadId) toggleContextNode(node.id);
                                else injectContextTo(thread.id);
                                return;
                              }
                              selectNode(thread.id, node.id);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              suppressReadMoreUntil.current = Date.now() + 350;
                              if (contextLinkMode) return;
                              selectNode(thread.id, node.id);
                              if (nodeIndex === lane.nodes.length - 1) {
                                setChatModalOpen(false);
                                setMiniChatOpen(true);
                                return;
                              }
                              if (chatNode.messages.length > 0) {
                                setNodePreviewModal({ title: chatNode.summary, messages: chatNode.messages });
                              }
                            }}
                          >
                            <div className="exchange-head">
                              <span>AI chat</span>
                            </div>
                            <strong>{chatNode.summary}</strong>
                            <small>{chatNode.model}</small>
                            <div className="node-footer">
                              {chatNode.messages.length > 0 ? (
                                <button
                                  type="button"
                                  className="node-expand-toggle"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (e.detail > 1) return;
                                    if (readMoreTimerRef.current) window.clearTimeout(readMoreTimerRef.current);
                                    const openedAt = Date.now();
                                    readMoreTimerRef.current = window.setTimeout(() => {
                                      readMoreTimerRef.current = null;
                                      if (Date.now() < suppressReadMoreUntil.current || suppressReadMoreUntil.current > openedAt) return;
                                      setNodePreviewModal({ title: chatNode.summary, messages: chatNode.messages });
                                    }, 320);
                                  }}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    suppressReadMoreUntil.current = Date.now() + 400;
                                    if (readMoreTimerRef.current) {
                                      window.clearTimeout(readMoreTimerRef.current);
                                      readMoreTimerRef.current = null;
                                    }
                                  }}
                                >
                                  Read more
                                </button>
                              ) : null}
                            </div>
                            {isSelected && !contextLinkMode ? (
                              <button
                                type="button"
                                className="node-delete-corner"
                                aria-label="Delete node"
                                title="Delete node"
                                onClick={(e) => { e.stopPropagation(); enterDeleteMode(thread.id, node.id); }}
                              >
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 3 14 13 14 13 6"/><line x1="1" y1="3" x2="15" y2="3"/><line x1="7" y1="7" x2="7" y2="11"/></svg>
                              </button>
                            ) : null}
                          </div>
                          {isContextSource && ctxPart ? (
                            <div className="context-select-overlay" onClick={(e) => e.stopPropagation()}>
                              <button type="button" className={`context-select-half user ${ctxPart.parts.user ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleContextPart(node.id, 'user'); }}>
                                <span>User prompt</span>
                                <span className="context-select-check">{ctxPart.parts.user ? '✓' : '○'}</span>
                              </button>
                              <button type="button" className={`context-select-half assistant ${ctxPart.parts.assistant ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleContextPart(node.id, 'assistant'); }}>
                                <span>Asst response</span>
                                <span className="context-select-check">{ctxPart.parts.assistant ? '✓' : '○'}</span>
                              </button>
                            </div>
                          ) : null}
                          {deleteMode?.nodeId === node.id && (
                            <div className="delete-select-overlay" onClick={(e) => e.stopPropagation()}>
                              {deleteMode.parts.user && (
                                <button type="button" className="delete-select-half user active" onClick={(e) => { e.stopPropagation(); toggleDeletePart('user'); }}>
                                  <span>User prompt</span>
                                  <span className="delete-select-check">✓</span>
                                </button>
                              )}
                              {deleteMode.parts.assistant && (
                                <button type="button" className="delete-select-half assistant active" onClick={(e) => { e.stopPropagation(); toggleDeletePart('assistant'); }}>
                                  <span>Asst response</span>
                                  <span className="delete-select-check">✓</span>
                                </button>
                              )}
                              <button type="button" className="delete-confirm-btn" onClick={(e) => { e.stopPropagation(); confirmDeleteNode(thread.id); }}>
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 3 14 13 14 13 6"/><line x1="1" y1="3" x2="15" y2="3"/><line x1="7" y1="7" x2="7" y2="11"/></svg>
                                Delete
                              </button>
                            </div>
                          )}
                          {showDots && (
                            <>
                              <div className="action-line-h" style={{ top: CHAT_HEIGHT / 2, left: -36 }} />
                              <div className="action-dot-group action-left" style={{ top: 0, left: -52, height: CHAT_HEIGHT }}>
                                <button type="button" className="action-dot" aria-label="Inject context left" onClick={handleSideDot('left')}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 9l-1 1a3 3 0 0 1-4.24-4.24l2-2a3 3 0 0 1 4.24 4.24"/><path d="M9 7l1-1a3 3 0 0 1 4.24 4.24l-2 2a3 3 0 0 1-4.24-4.24"/></svg><span>Link</span></button>
                                <button type="button" className="fork-dot" aria-label="Fork into new thread" onClick={handleForkDot('left')}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="8" r="1.5"/><path d="M5.5 3h2a2 2 0 0 1 2 2v1.5"/><path d="M5.5 13h2a2 2 0 0 0 2-2V9.5"/></svg><span>Fork</span></button>
                              </div>
                              <div className="action-line-h" style={{ top: CHAT_HEIGHT / 2, left: NODE_WIDTH }} />
                              <div className="action-dot-group action-right" style={{ top: 0, left: NODE_WIDTH + 10, height: CHAT_HEIGHT }}>
                                <button type="button" className="action-dot" aria-label="Inject context right" onClick={handleSideDot('right')}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 9l-1 1a3 3 0 0 1-4.24-4.24l2-2a3 3 0 0 1 4.24 4.24"/><path d="M9 7l1-1a3 3 0 0 1 4.24 4.24l-2 2a3 3 0 0 1-4.24-4.24"/></svg><span>Link</span></button>
                                <button type="button" className="fork-dot" aria-label="Fork into new thread" onClick={handleForkDot('right')}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="8" r="1.5"/><path d="M5.5 3h2a2 2 0 0 1 2 2v1.5"/><path d="M5.5 13h2a2 2 0 0 0 2-2V9.5"/></svg><span>Fork</span></button>
                              </div>
                              {nodeIndex === lane.nodes.length - 1 && (<>
                                <div className="action-line-v" style={{ top: CHAT_HEIGHT, left: NODE_WIDTH / 2 }} />
                                <button type="button" className="action-node-ghost" style={{ top: CHAT_HEIGHT + 36, left: 0 }} aria-label="Open chat" onClick={(e) => { e.stopPropagation(); setChatModalOpen(false); setMiniChatOpen(true); }}>
                                  <span>Open chat</span>
                                </button>
                              </>)}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {miniChatOpen && activeThread ? (
            <div className={`mini-chat ${miniChatMaximized ? 'maximized' : ''}`}>
              <div className="mini-chat-header">
                <span className="mini-chat-title">{activeThread.title}</span>
                <div className="mini-chat-header-actions">
                  <button
                    type="button"
                    className="quiet mini-chat-maximize"
                    onClick={() => setMiniChatMaximized((current) => !current)}
                    aria-label={miniChatMaximized ? 'Restore mini chat size' : 'Maximize mini chat'}
                    title={miniChatMaximized ? 'Restore' : 'Maximize'}
                  >
                    {miniChatMaximized ? '▢' : '□'}
                  </button>
                  <button type="button" className="quiet mini-chat-close" onClick={() => setMiniChatOpen(false)} aria-label="Close chat">×</button>
                </div>
              </div>
              <div className="mini-chat-messages" ref={miniChatMessagesRef}>
                {activeThread.context.length === 0 ? (
                  <p className="muted">No messages yet. Send the first one.</p>
                ) : (
                  activeThread.context.map((message) => (
                    <div
                      key={message.id}
                      className={`bubble ${message.role} ${message.injectedFromThreadId ? 'injected' : ''}`}
                      style={message.injectedFromColor ? {
                        '--inject-bg': hexToRgba(message.injectedFromColor, 0.07),
                        '--inject-border': hexToRgba(message.injectedFromColor, 0.3),
                      } as React.CSSProperties : undefined}
                    >
                      <strong>{message.role === 'assistant' ? 'ai' : message.role}</strong>
                      <FormattedMessage text={getMessageText(message) || message.text || ''} />
                    </div>
                  ))
                )}
              </div>
              <div className="mini-chat-composer">
                <textarea
                  autoFocus
                  value={composerDraft}
                  onChange={(e) => setComposerDraft(e.target.value)}
                  placeholder="Ask the thread something"
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); setMiniChatOpen(false); return; }
                    if (e.key !== 'Enter') return;
                    if (e.shiftKey) return;
                    e.preventDefault();
                    if (e.ctrlKey || e.metaKey) { sendMessage(true); } else { sendMessage(); }
                  }}
                />
                {error ? <p className="error">{error}</p> : null}
                <div className="mini-chat-actions">
                  {settings.providerConfigs.length === 0 ? (
                    <button type="button" className="mini-chat-add-profile" onClick={() => setAiSettingsModalOpen(true)}>Add AI profile</button>
                  ) : (
                    <select
                      value={activeProviderConfig?.id ?? ''}
                      onChange={(e) => changeSettingsProvider(e.target.value)}
                    >
                      {settings.providerConfigs.map((config) => (
                        <option key={config.id} value={config.id}>{config.label}</option>
                      ))}
                    </select>
                  )}
                  {activeProviderConfig ? (
                    <select
                      className="mini-chat-model"
                      value={activeProviderConfig.model}
                      onChange={(e) => updateProviderConfig(activeProviderConfig.id, { model: e.target.value })}
                    >
                      {settingsModels.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : null}
                  <button
                    className="mini-chat-send"
                    onClick={() => sendMessage()}
                    disabled={!composerDraft.trim() || sending || !activeProviderConfig?.apiKey.trim()}
                  >
                    {sending ? '…' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          </div>
        </section>
      </main>

      {nodePreviewModal ? (
        <div className="chat-modal-backdrop" onClick={() => setNodePreviewModal(null)}>
          <section className="chat-modal node-preview-modal" onClick={(e) => e.stopPropagation()}>
            <header className="chat-modal-header">
              <div>
                <p className="eyebrow">Node preview</p>
                <h2>{nodePreviewModal.title}</h2>
              </div>
              <button type="button" className="quiet" onClick={() => setNodePreviewModal(null)} aria-label="Close">×</button>
            </header>
            <div className="node-preview-messages">
              {nodePreviewModal.messages.map((message) => (
                <div key={message.id} className={`bubble ${message.role} ${message.injectedFromThreadId ? 'injected' : ''}`}>
                  <strong>{message.role === 'assistant' ? 'ai' : message.role}</strong>
                  <FormattedMessage text={getMessageText(message) || message.text || ''} />
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {chatModalOpen && activeThread ? (
        <div className="chat-modal-backdrop" onClick={() => setChatModalOpen(false)}>
          <section className="chat-modal" onClick={(event) => event.stopPropagation()}>
            <header className="chat-modal-header">
              <div>
                <p className="eyebrow">Active thread</p>
                <h2>{activeThread.title}</h2>
              </div>
              <button type="button" className="quiet" onClick={() => setChatModalOpen(false)} aria-label="Close chat panel">
                ×
              </button>
            </header>

            <div className="chat-modal-body">
              <article className="inspector-card">
                <div className="meta-row">
                  <div>
                    <h3>{activeThread.description}</h3>
                    <p>{activeThread.nodes.length} nodes in this lane.</p>
                  </div>
                  <button className="quiet icon-btn" onClick={() => openThreadEditor('edit', activeThread)} aria-label="Edit thread"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11.5 2.5a1.5 1.5 0 0 1 2.12 2.12L5 13.24l-3 .76.76-3 8.74-8.5z"/></svg></button>
                </div>
                <div className="thread-meta-row stack">
                  {settings.providerConfigs.length === 0 ? (
                    <button type="button" onClick={() => setAiSettingsModalOpen(true)}>
                      Add AI profile to chat
                    </button>
                  ) : (
                    <label className="field compact">
                      AI profile
                      <select
                        value={activeProviderConfig?.id ?? ''}
                        onChange={(event) => {
                          const nextConfigId = event.target.value;
                          changeSettingsProvider(nextConfigId);
                          const nextConfig = settings.providerConfigs.find((config) => config.id === nextConfigId);
                          if (nextConfig?.hasEncryptedApiKey && !nextConfig.apiKey.trim()) {
                            setPassphraseModal({ mode: 'unlock', passphrase: '', busy: false, targetConfigId: nextConfigId });
                          }
                        }}
                      >
                        {settings.providerConfigs.map((config) => (
                          <option key={config.id} value={config.id}>
                            {config.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <span className="pill">Model: {activeProviderConfig?.model ?? '—'}</span>
                  <span className="pill">Context left: {activeThread ? remainingContext.toLocaleString() : '—'}</span>
                  <button type="button" className="quiet icon-btn" onClick={() => setAiSettingsModalOpen(true)} aria-label="AI settings"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg></button>
                </div>
                {selectedThreadUsage ? (
                  <div className="usage-grid">
                    <div>
                      <span>Input</span>
                      <strong>{selectedThreadUsage.inputTokens.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>Output</span>
                      <strong>{selectedThreadUsage.outputTokens.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>{selectedThreadUsage.totalTokens.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>Cost est.</span>
                      <strong>${selectedThreadUsage.estimatedCostUsd.toFixed(4)}</strong>
                    </div>
                  </div>
                ) : null}
              </article>

              <section className="chat-panel">
                {activeThread.context.length === 0 ? (
                  <p className="muted">No messages yet. Send the first one.</p>
                ) : (
                  activeThread.context.map((message) => (
<div
                      key={message.id}
                      className={`bubble ${message.role} ${message.injectedFromThreadId ? 'injected' : ''}`}
                      style={message.injectedFromColor ? {
                        '--inject-bg': hexToRgba(message.injectedFromColor, 0.07),
                        '--inject-border': hexToRgba(message.injectedFromColor, 0.3),
                      } as React.CSSProperties : undefined}
                    >
                      <strong>{message.role === 'assistant' ? 'ai' : message.role}</strong>
                      <FormattedMessage text={getMessageText(message) || message.text || ''} />
                      {hasAttachments(message) && (
                        <div className="message-attachments">
                          {getAttachmentsByType(message, 'image').map(att => (
                            <img key={att.id} src={att.preview} alt={att.filename} className="message-image" />
                          ))}
                          {getAttachmentsByType(message, 'document').map(att => (
                            <div key={att.id} className="message-document">
                              📄 {att.filename}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </section>

              {activeNodeIsChat ? (
                <section className="inspector-card send-card">
                  <h4>Send to AI</h4>
                  <textarea
                    autoFocus
                    value={composerDraft}
                    onChange={(event) => setComposerDraft(event.target.value)}
                    placeholder="Ask the thread something"
                    rows={5}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      if (e.shiftKey) return;
                      e.preventDefault();
                      if (e.ctrlKey || e.metaKey) { sendMessage(true); } else { sendMessage(); }
                    }}
                  />
                  
                  {/* File attachments display */}
                  {composerAttachments.length > 0 && (
                    <div className="composer-attachments">
                      {composerAttachments.map(att => (
                        <div key={att.id} className="attachment-preview">
                          {att.type === 'image' ? (
                            <img src={att.preview} alt={att.filename} className="attachment-thumbnail" />
                          ) : (
                            <div className="document-preview">📄 {att.filename}</div>
                          )}
                          <button 
                            onClick={() => setComposerAttachments(prev => prev.filter(a => a.id !== att.id))}
                            className="remove-attachment"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* File upload */}
                  <div className="file-upload-area">
                    <input
                      type="file"
                      id="file-upload"
                      multiple
                      accept="image/*,application/pdf,text/plain,text/markdown"
                      onChange={async (e) => {
                        if (!e.target.files) return;
                        const newAttachments: MediaAttachment[] = [];
                        const errors: string[] = [];
                        
                        for (const file of Array.from(e.target.files)) {
                          const validation = validateFile(file);
                          if (!validation.valid) {
                            errors.push(`${file.name}: ${validation.error}`);
                            continue;
                          }
                          
                          // Verify image magic bytes to catch MIME spoofing
                          if (file.type === 'image/png' || file.type === 'image/jpeg') {
                            const byteCheck = await verifyImageBytes(file);
                            if (!byteCheck.valid) {
                              errors.push(byteCheck.error!);
                              continue;
                            }
                          }
                          
                          try {
                            const attachment = await processFile(file);
                            newAttachments.push(attachment);
                          } catch {
                            errors.push(`Failed to process ${file.name}`);
                          }
                        }
                        
                        if (errors.length > 0) {
                          setError(errors.join('\n'));
                        }
                        if (newAttachments.length > 0) {
                          setComposerAttachments(prev => [...prev, ...newAttachments]);
                        }
                        e.target.value = '';
                      }}
                      style={{ display: 'none' }}
                    />
                    <label htmlFor="file-upload" className="file-upload-button">
                      📎 Attach files
                    </label>
                  </div>
                  
                  {settingsLockState === 'locked' ? <p className="muted">Unlock the active AI profile to send a message.</p> : null}
                  {error ? <p className="error">{error}</p> : null}
<button
                    onClick={() => sendMessage()}
                    disabled={(!composerDraft.trim() && composerAttachments.length === 0) || sending || !activeProviderConfig?.apiKey.trim()}
                  >
                    {sending ? 'Thinking…' : settingsLockState === 'locked' ? 'Unlock to send' : 'Send'}
                  </button>
                </section>
              ) : null}

              {activeNode?.kind === 'chat' ? (
                <section className={`inspector-card node-card ${sending && activeNode.id === activeThread.activeNodeId ? 'sending' : ''}`}>
                  <h4>Selected node</h4>
                  <p>{activeNode.summary}</p>
                  <ul>
                    <li>{activeNode.messages.length} messages</li>
                    <li>{activeNode.createdAt.slice(0, 10)}</li>
                    <li>{activeNode.model}</li>
                    {activeNode.usage ? <li>{activeNode.usage.totalTokens.toLocaleString()} tokens</li> : null}
                  </ul>
                </section>
              ) : null}

            </div>
          </section>
        </div>
      ) : null}

      {aiSettingsModalOpen ? (
        <div className="chat-modal-backdrop" onClick={() => setAiSettingsModalOpen(false)}>
          <section className="ai-settings-modal" onClick={(event) => event.stopPropagation()}>
            <header className="chat-modal-header">
              <div>
                <p className="eyebrow">AI settings</p>
                <h2>Manage AI profiles</h2>
              </div>
              <button type="button" className="quiet" onClick={() => setAiSettingsModalOpen(false)} aria-label="Close AI settings">
                ×
              </button>
            </header>
            <div className="chat-modal-body">
              <section className="inspector-card settings-card">
                <div className="settings-management-header">
                  <div className="settings-management-row">
                    <label className="field compact-inline">
                      <span>Profile</span>
                      <select
                        autoFocus
                        value={activeProviderConfig?.id ?? ''}
                        onChange={(event) => changeSettingsProvider(event.target.value)}
                      >
                        {settings.providerConfigs.map((config) => (
                          <option key={config.id} value={config.id}>
                            {config.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className={`pill settings-pill ${settingsLockState}`}>
                      {settingsLockState === 'none' ? 'no saved key' : settingsLockState === 'unlocked' ? 'unlocked' : 'locked'}
                    </span>
                  </div>
                  <div className="editor-actions left-aligned">
                    <button
                      type="button"
                      onClick={() => {
                        const next = createProviderConfig('openai-compatible-custom', { label: 'New profile', model: '' });
                        setSettings((current) => ({
                          ...current,
                          activeProviderConfigId: next.id,
                          providerConfigs: [...current.providerConfigs, next],
                        }));
                      }}
                    >
                      New profile
                    </button>
                    <button
                      type="button"
                      className="quiet btn-danger"
                      onClick={() => activeProviderConfig && deleteProfile(activeProviderConfig.id)}
                      disabled={!activeProviderConfig}
                    >
                      Delete profile
                    </button>
                  </div>
                </div>
                {activeProviderConfig ? (
                  <>
                    <label className="field">
                      Provider type
                      <select
                        value={activeProviderConfig.kind}
                        onChange={(event) => {
                          const kind = event.target.value as AIProvider;
                          const info = providerInfo(kind);
                          updateProviderConfig(activeProviderConfig.id, {
                            kind,
                            label: activeProviderConfig.label || info.label,
                            model: '',
                            baseUrl: info.baseUrl,
                          });
                          setSettings((current) => ({ ...current, activeProviderConfigId: activeProviderConfig.id }));
                        }}
                      >
                        {PROVIDERS.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Label
                      <input
                        value={activeProviderConfig.label}
                        onChange={(event) => updateProviderConfig(activeProviderConfig.id, { label: event.target.value })}
                        placeholder="Profile name"
                      />
                    </label>
                    {activeProviderConfig.kind === 'openai-compatible-custom' ? (
                      <label className="field">
                        Base URL
                        <input
                          value={activeProviderConfig.baseUrl ?? ''}
                          onChange={(event) => updateProviderConfig(activeProviderConfig.id, { baseUrl: event.target.value })}
                          placeholder="https://api.example.com/v1"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                    ) : null}
                    <label className="field">
                      Model
                      <select
                        value={activeProviderConfig.model}
                        onChange={(event) => updateProviderConfig(activeProviderConfig.id, { model: event.target.value })}
                      >
                        {settingsModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="editor-actions left-aligned">
                      <button
                        type="button"
                        onClick={() => refreshModels(activeProviderConfig.id)}
                        disabled={modelsLoading || !activeProviderConfig.apiKey.trim()}
                      >
                        {modelsLoading ? 'Loading models…' : modelCache[activeProviderConfig.id] ? 'Refresh models' : 'List models'}
                      </button>
                    </div>
                    <label className="field">
                      {providerInfo(activeProviderConfig.kind).label} API key
                      <input
                        type="password"
                        value={activeProviderConfig.apiKey}
                        onChange={(event) => updateProviderConfig(activeProviderConfig.id, { apiKey: event.target.value })}
                        placeholder={activeProviderConfig.hasEncryptedApiKey && !activeProviderConfig.apiKey ? 'saved key — tap Unlock to load' : apiKeyPlaceholder(activeProviderConfig.kind)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {providerKeyLink(activeProviderConfig.kind) ? (
                        <a
                          className="key-signup-link"
                          href={providerKeyLink(activeProviderConfig.kind)!.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {providerKeyLink(activeProviderConfig.kind)!.label} →
                        </a>
                      ) : null}
                    </label>
                    <div className="editor-actions left-aligned">
                      <button type="button" onClick={requestSaveKey} disabled={savingSettings}>
                        {savingSettings
                          ? 'Working…'
                          : activeProviderConfig.apiKey.trim()
                            ? activeProviderConfig.hasEncryptedApiKey ? 'Update saved key' : 'Save key'
                            : activeProviderConfig.hasEncryptedApiKey ? 'Unlock saved key' : 'Save key'}
                      </button>
                      <button
                        type="button"
                        className="quiet btn-danger"
                        onClick={deleteSavedKey}
                        disabled={savingSettings || !activeProviderConfig.hasEncryptedApiKey}
                      >
                        Delete saved key
                      </button>
                    </div>
                  </>
                ) : null}
                {settingsNotice ? <p className="muted">{settingsNotice}</p> : null}
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {threadEditorOpen ? (
        <div className="chat-modal-backdrop" onClick={closeThreadEditor}>
          <section className="thread-editor-modal" onClick={(event) => event.stopPropagation()}>
            <header className="chat-modal-header">
              <div>
                <p className="eyebrow">{threadEditorMode === 'create' ? 'Create thread' : 'Edit thread'}</p>
                <h2>{threadEditorMode === 'create' ? 'Start with the title and description' : 'Update the thread details'}</h2>
              </div>
              <button type="button" className="quiet" onClick={closeThreadEditor} aria-label="Close thread editor">
                ×
              </button>
            </header>
            <div className="chat-modal-body">
              <label className="field">
                Thread title
                <input
                  autoFocus
                  value={threadEditorDraft.title}
                  onChange={(event) => setThreadEditorDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="e.g. deployment plan"
                />
              </label>
              <label className="field">
                Thread description
                <textarea
                  value={threadEditorDraft.description}
                  onChange={(event) => setThreadEditorDraft((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Why this thread exists"
                  rows={4}
                />
              </label>
              <p className="muted">Threads are provider-agnostic now. The active AI profile (set in the sidebar) decides which model answers when you send.</p>
              <div className="editor-actions">
                <button onClick={submitThreadEditor}>{threadEditorMode === 'create' ? 'Create thread' : 'Save changes'}</button>
                <button className="quiet" onClick={closeThreadEditor}>
                  Cancel
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {passphraseModal ? (
        <div className="chat-modal-backdrop" onClick={passphraseModal.busy ? undefined : closePassphraseModal}>
          <section className="passphrase-modal" onClick={(event) => event.stopPropagation()}>
            <header className="chat-modal-header">
              <div>
                <p className="eyebrow">{passphraseModal.mode === 'encrypt' ? 'Encrypt your key' : 'Unlock your saved key'}</p>
                <h2>{passphraseModal.mode === 'encrypt' ? 'Choose a passphrase' : 'Enter your passphrase'}</h2>
              </div>
              <button type="button" className="quiet" onClick={closePassphraseModal} aria-label="Close" disabled={passphraseModal.busy}>
                ×
              </button>
            </header>
            <div className="chat-modal-body">
              <p className="muted">
                {passphraseModal.mode === 'encrypt'
                  ? 'Your key is encrypted in this browser using this passphrase. Anyone with access to this browser also needs the passphrase to load it. There is no recovery — write it down.'
                  : 'Decrypts the key saved in this browser. It stays in memory until you refresh or close the tab.'}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitPassphraseModal();
                }}
              >
                <label className="field">
                  Passphrase
                  <input
                    autoFocus
                    type="password"
                    value={passphraseModal.passphrase}
                    onChange={(event) =>
                      setPassphraseModal((current) => (current ? { ...current, passphrase: event.target.value } : current))
                    }
                    autoComplete="off"
                    spellCheck={false}
                    disabled={passphraseModal.busy}
                  />
                </label>
                {error ? <p className="error">{error}</p> : null}
                <div className="editor-actions">
                  <button type="submit" disabled={passphraseModal.busy || !passphraseModal.passphrase.trim()}>
                    {passphraseModal.busy
                      ? 'Working…'
                      : passphraseModal.mode === 'encrypt' ? 'Encrypt and save' : 'Unlock'}
                  </button>
                  <button type="button" className="quiet" onClick={closePassphraseModal} disabled={passphraseModal.busy}>
                    Cancel
                  </button>
                </div>
              </form>
              {passphraseModal.mode === 'unlock' && passphraseModal.targetConfigId ? (
                <div className="passphrase-escape">
                  <p className="muted">
                    Forgot your passphrase? You can delete this profile to escape this prompt. The encrypted key will be wiped from this browser.
                  </p>
                  <button
                    type="button"
                    className="quiet"
                    disabled={passphraseModal.busy}
                    onClick={() => {
                      const target = settings.providerConfigs.find((config) => config.id === passphraseModal.targetConfigId);
                      if (!target) return;
                      const confirmed = window.confirm(`Delete AI profile "${target.label}" and the saved key you can no longer unlock?`);
                      if (!confirmed) return;
                      const next = deleteProviderConfig(settings, target.id);
                      setSettings(next);
                      setModelCache((current) => {
                        const copy = { ...current };
                        delete copy[target.id];
                        return copy;
                      });
                      setSettingsNotice(`Deleted AI profile "${target.label}".`);
                      setError(null);
                      setPassphraseModal(null);
                    }}
                  >
                    Delete this profile and exit
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function modelsForConfig(cache: ModelCache, config: AIProviderConfig | null | undefined, currentModel: string): string[] {
  if (!config) return currentModel ? [currentModel] : [];
  const cached = cache[config.id] ?? cache[providerModelCacheKey(config)];
  const base = cached && cached.length > 0 ? cached : [];
  if (currentModel && !base.includes(currentModel)) {
    return [currentModel, ...base];
  }
  return base;
}

// Helper function to convert ChatMessage to OpenAI API format
function formatMessageForOpenAI(message: ChatMessage) {
  const role = message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user';
  
  // Handle backward compatibility and simple text messages
  if (!message.content || message.content.type === 'text') {
    return { role, content: getMessageText(message) };
  }
  
  // Handle mixed content with attachments
  if (message.content.attachments && message.content.attachments.length > 0) {
    const content = [];
    
    // Add text if present
    if (message.content.text) {
      content.push({ type: 'text', text: message.content.text });
    }
    
    // Add images (documents are not supported in vision API)
    message.content.attachments.forEach(attachment => {
      if (attachment.type === 'image') {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${attachment.mimeType};base64,${attachment.data}`
          }
        });
      }
    });
    
    return { role, content };
  }
  
  // Fallback to text
  return { role, content: getMessageText(message) };
}

async function requestAiReply(config: AIProviderConfig, thread: ThreadLane, messages: ChatMessage[]) {
  if (config.kind === 'anthropic') return requestAnthropic(config, thread, messages);
  if (config.kind === 'openrouter') return requestOpenRouter(config, thread, messages);
  return requestOpenAiCompatible(config, thread, messages);
}

function apiKeyPlaceholder(provider: AIProvider) {
  if (provider === 'openai') return 'sk-...';
  if (provider === 'anthropic') return 'sk-ant-...';
  if (provider === 'openrouter') return 'sk-or-...';
  if (provider === 'openai-compatible-custom') return 'sk-...';
  return '';
}

function providerKeyLink(provider: AIProvider): { label: string; href: string } | null {
  if (provider === 'openrouter') return { label: 'Get a free OpenRouter key', href: 'https://openrouter.ai/keys' };
  if (provider === 'openai') return { label: 'Get an OpenAI key', href: 'https://platform.openai.com/api-keys' };
  if (provider === 'anthropic') return { label: 'Get an Anthropic key', href: 'https://console.anthropic.com/settings/keys' };
  return null;
}

const SYSTEM_PROMPT = (thread: ThreadLane) =>
  [
    `Thread title: ${thread.title}`,
    `Thread description: ${thread.description}`,
    'Keep replies concise and useful.',
    'Prefer short paragraphs or bullet lists.',
    'Use blank lines between ideas.',
    'Do not mention internal tools or policies.',
  ].join(' ');

function resolveBaseUrl(baseUrl: string | undefined, kind: AIProvider) {
  if (kind === 'anthropic') return baseUrl?.trim().replace(/\/+$/, '') || 'https://api.anthropic.com/v1';
  if (kind === 'openrouter') return baseUrl?.trim().replace(/\/+$/, '') || 'https://openrouter.ai/api/v1';
  if (kind === 'openai') return baseUrl?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
  if (!baseUrl?.trim()) throw new Error('Enter a Base URL for the custom OpenAI-compatible provider.');
  return baseUrl.trim().replace(/\/+$/, '');
}

async function requestOpenRouter(config: AIProviderConfig, thread: ThreadLane, messages: ChatMessage[]) {
  const baseUrl = resolveBaseUrl(config.baseUrl, config.kind);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      // CORS-friendly attribution headers for OpenRouter
      'X-App-Name': 'Loomspace',
      'X-App-URL': window.location.origin,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT(thread) },
        ...messages.map(formatMessageForOpenAI),
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    let errorText = '';
    try {
      errorText = await response.text();
    } catch {
      // If we can't read the response text, it's likely a network issue
      errorText = 'Network error - check your internet connection';
    }
    
    // Provide more detailed error messages for common OpenRouter issues
    if (response.status === 0 || !response.status) {
      throw new Error('OpenRouter request failed - check your internet connection and try again');
    } else if (response.status === 401) {
      throw new Error('OpenRouter API key is invalid - check your API key');
    } else if (response.status === 429) {
      throw new Error('OpenRouter rate limit exceeded - wait a moment and try again');
    } else if (response.status >= 500) {
      throw new Error('OpenRouter server error - try again in a moment');
    } else {
      throw new Error(errorText || `OpenRouter request failed (${response.status})`);
    }
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const assistantText = data.choices?.[0]?.message?.content?.trim();
  if (!assistantText) throw new Error('OpenRouter returned no assistant text');

  const usage = data.usage
    ? normalizeUsage(config.model, data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0, data.usage.total_tokens ?? 0)
    : undefined;

  return { assistantText, usage };
}

async function requestOpenAiCompatible(config: AIProviderConfig, thread: ThreadLane, messages: ChatMessage[]) {
  const baseUrl = resolveBaseUrl(config.baseUrl, config.kind);
  const payloadBase = {
    model: config.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT(thread) },
      ...messages.map(formatMessageForOpenAI),
    ],
  };

  const send = async (includeTemperature: boolean) => {
    const body = includeTemperature
      ? { ...payloadBase, temperature: 0.4 }
      : payloadBase;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false as const, text };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    return { ok: true as const, data };
  };

  let result = await send(config.kind !== 'openai');

  if (!result.ok && config.kind === 'openai') {
    const maybeTempUnsupported = /temperature/i.test(result.text) && /unsupported|default \(1\)/i.test(result.text);
    if (maybeTempUnsupported) {
      result = await send(false);
    }
  }

  if (!result.ok) {
    throw new Error(result.text || `${config.label} request failed`);
  }

  const assistantText = result.data.choices?.[0]?.message?.content?.trim();
  if (!assistantText) throw new Error(`${config.label} returned no assistant text`);

  const usage = result.data.usage
    ? normalizeUsage(config.model, result.data.usage.prompt_tokens ?? 0, result.data.usage.completion_tokens ?? 0, result.data.usage.total_tokens ?? 0)
    : undefined;

  return { assistantText, usage };
}

// Helper function to convert ChatMessage to Anthropic API format
function formatMessageForAnthropic(message: ChatMessage) {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  
  // Handle backward compatibility and simple text messages  
  if (!message.content || message.content.type === 'text') {
    return { role, content: getMessageText(message) };
  }
  
  // Handle mixed content with attachments
  if (message.content.attachments && message.content.attachments.length > 0) {
    const content = [];
    
    // Add text if present
    if (message.content.text) {
      content.push({ type: 'text', text: message.content.text });
    }
    
    // Add images in Anthropic format
    message.content.attachments.forEach(attachment => {
      if (attachment.type === 'image') {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mimeType,
            data: attachment.data
          }
        });
      }
    });
    
    return { role, content };
  }
  
  // Fallback to text
  return { role, content: getMessageText(message) };
}

async function requestAnthropic(config: AIProviderConfig, thread: ThreadLane, messages: ChatMessage[]) {
  const baseUrl = resolveBaseUrl(config.baseUrl, config.kind);
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
      max_tokens: 1024,
      system: SYSTEM_PROMPT(thread),
      messages: messages
        .filter((message) => message.role !== 'system')
        .map(formatMessageForAnthropic),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Anthropic request failed');
  }

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const assistantText = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
  if (!assistantText) throw new Error('Anthropic returned no assistant text');

  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const usage = data.usage ? normalizeUsage(config.model, inputTokens, outputTokens, inputTokens + outputTokens) : undefined;

  return { assistantText, usage };
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

function nodeHeight(thread: ThreadLane, node: ThreadNode) {
  if (node.kind === 'title') return TITLE_HEIGHT + (thread.infoOpen ? TITLE_INFO_EXTRA : 0);
  return CHAT_HEIGHT;
}

function buildThreadPath(centerX: number, nodes: ThreadNode[], thread: ThreadLane) {
  if (!nodes.length) return '';
  const commands: string[] = [];
  let cursor = TOP_PAD;
  commands.push(`M ${centerX} ${cursor}`);

  nodes.forEach((node, index) => {
    const height = nodeHeight(thread, node);
    commands.push(`L ${centerX} ${cursor + height}`);
    cursor += height;
    if (index < nodes.length - 1) {
      commands.push(`L ${centerX} ${cursor + NODE_GAP}`);
      cursor += NODE_GAP;
    }
  });

  return commands.join(' ');
}

function buildAnchors(centerX: number, nodes: ThreadNode[], thread: ThreadLane) {
  const points: Array<{ x: number; y: number }> = [];
  let cursor = TOP_PAD;
  for (const node of nodes) {
    const height = nodeHeight(thread, node);
    points.push({ x: centerX, y: cursor });
    points.push({ x: centerX, y: cursor + height });
    cursor += height + NODE_GAP;
  }
  return points;
}

function boundedPan(
  panX: number,
  panY: number,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
) {
  const renderedWidth = contentWidth * zoom;
  const renderedHeight = contentHeight * zoom;

  const minX = renderedWidth <= viewportWidth ? (viewportWidth - renderedWidth) / 2 : viewportWidth - renderedWidth - EDGE_PADDING;
  const maxX = renderedWidth <= viewportWidth ? (viewportWidth - renderedWidth) / 2 : EDGE_PADDING;
  const minY = renderedHeight <= viewportHeight ? (viewportHeight - renderedHeight) / 2 : viewportHeight - renderedHeight - EDGE_PADDING;
  const maxY = renderedHeight <= viewportHeight ? (viewportHeight - renderedHeight) / 2 : EDGE_PADDING;

  return {
    panX: clamp(panX, minX, maxX),
    panY: clamp(panY, minY, maxY),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function FormattedMessage({ text }: { text: string }) {
  return (
    <div className="message-copy">
      <Markdown>{text}</Markdown>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
