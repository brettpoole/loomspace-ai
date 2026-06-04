import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import Markdown from 'react-markdown';
import {
  PROVIDERS,
  appendContextInjection,
  clearProviderSecret,
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
  resolveBaseUrl,
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
  decodeBase64Text,
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
const WORKSPACE_SAVE_DEBOUNCE_MS = 400;

const PANEL_SIZE_KEY = 'loomspace.panels.v1';
const MIN_PANEL_W = 220;
const MIN_CANVAS_W = 320;
const MIN_BOTTOM_H = 120;
const MAX_BOTTOM_H = 600;

const THEME_MODE_KEY = 'loomspace.theme.v1';
type ThemeMode = 'auto' | 'light' | 'dark';

function loadThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_MODE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto';
}

function resolveThemeMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}


const TTS_SETTINGS_KEY = 'loomspace.tts.v1';

function loadTtsSettings(): { voiceURI: string; rate: number } {
  try {
    const raw = localStorage.getItem(TTS_SETTINGS_KEY);
    if (!raw) return { voiceURI: '', rate: 1 };
    const parsed = JSON.parse(raw) as Partial<{ voiceURI: string; rate: number }>;
    return {
      voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : '',
      rate: clamp(Number(parsed.rate) || 1, 0.75, 1.35),
    };
  } catch {
    return { voiceURI: '', rate: 1 };
  }
}

function cleanTextForSpeech(text: string) {
  return text
    .replace(/```(\w+)?\n[\s\S]*?```/g, (_, lang) => ` Code block${lang ? ` in ${lang}` : ''}. `)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' image ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTextForSpeech(text: string, maxLength = 220) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const next = `${current}${current ? ' ' : ''}${sentence.trim()}`.trim();
    if (next.length <= maxLength) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (sentence.length <= maxLength) {
      current = sentence.trim();
      continue;
    }
    for (let i = 0; i < sentence.length; i += maxLength) chunks.push(sentence.slice(i, i + maxLength).trim());
    current = '';
  }
  if (current) chunks.push(current);
  return chunks;
}

function maxSideWidth(reserved = 0) {
  const viewport = typeof window === 'undefined' ? 1280 : window.innerWidth;
  return Math.max(MIN_PANEL_W, Math.round(viewport - MIN_CANVAS_W - reserved));
}

function loadPanelSizes(): { left: number; right: number; bottom: number } {
  const fallback = { left: 300, right: 400, bottom: 260 };
  try {
    const raw = localStorage.getItem(PANEL_SIZE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<{ left: number; right: number; bottom: number }>;
    return {
      left: clamp(Number(parsed.left) || fallback.left, MIN_PANEL_W, maxSideWidth()),
      right: clamp(Number(parsed.right) || fallback.right, MIN_PANEL_W, maxSideWidth()),
      bottom: clamp(Number(parsed.bottom) || fallback.bottom, MIN_BOTTOM_H, MAX_BOTTOM_H),
    };
  } catch {
    return fallback;
  }
}

interface ThreadDraft {
  title: string;
  description: string;
}

const DEFAULT_THREAD_DRAFT: ThreadDraft = {
  title: '',
  description: '',
};

type ModelCache = Record<string, string[]>;

interface ComposerState {
  draft: string;
  attachments: MediaAttachment[];
}

const EMPTY_COMPOSER_STATE: ComposerState = { draft: '', attachments: [] };

function composerStateKey(threadId: string, nodeId?: string | null): string {
  return `${threadId}::${nodeId ?? 'root'}`;
}

function providerModelCacheKey(config: AIProviderConfig): string {
  const baseUrl = config.baseUrl?.trim().toLowerCase() ?? '';
  return `provider:${config.kind}:${baseUrl}`;
}

function sameProviderModelSource(left: AIProviderConfig, right: AIProviderConfig): boolean {
  const leftBaseUrl = left.baseUrl?.trim().toLowerCase() ?? '';
  const rightBaseUrl = right.baseUrl?.trim().toLowerCase() ?? '';
  return left.kind === right.kind && leftBaseUrl === rightBaseUrl;
}

export default function App() {
  const [state, setState] = useState<LoomspaceState>(() => loadWorkspace());
  const [settings, setSettings] = useState<AISettings>(() => loadSettings());
  const [composerStates, setComposerStates] = useState<Record<string, ComposerState>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [passphraseModal, setPassphraseModal] = useState<{ mode: 'encrypt' | 'unlock'; passphrase: string; busy: boolean; pendingKey?: string; targetConfigId?: string } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelMaximized, setRightPanelMaximized] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [focusSidebarOpen, setFocusSidebarOpen] = useState(true);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [panelSizes, setPanelSizes] = useState(loadPanelSizes);
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadThemeMode);
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsSettings, setTtsSettings] = useState(loadTtsSettings);
  const [panelResizing, setPanelResizing] = useState(false);
  const ttsQueueRef = useRef<{ messageId: string; chunks: string[]; index: number; keepAlive: number | null } | null>(null);
  const panelDragRef = useRef<{ kind: 'left' | 'right' | 'bottom'; origin: number; size: number } | null>(null);
  const [contextLinkMode, setContextLinkMode] = useState<{
    intent: 'link' | 'fork';
    sourceThreadId: string;
    dotNodeId: string;
    selectedNodes: Array<{ nodeId: string; parts: { user: boolean; assistant: boolean } }>;
    side: 'left' | 'right';
  } | null>(null);
  const [contextLinkPointer, setContextLinkPointer] = useState<{ x: number; y: number } | null>(null);
  const [contextLinkSnapTarget, setContextLinkSnapTarget] = useState<{ threadId: string; nodeId: string } | null>(null);
  const [aiSettingsModalOpen, setAiSettingsModalOpen] = useState(false);
  const [settingsEditorConfigId, setSettingsEditorConfigId] = useState<string | null>(null);
  const rightPanelMessagesRef = useRef<HTMLDivElement>(null);
  const rightPanelEndRef = useRef<HTMLDivElement>(null);
  const focusMessagesRef = useRef<HTMLDivElement>(null);
  const focusEndRef = useRef<HTMLDivElement>(null);
  const [threadEditorOpen, setThreadEditorOpen] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [threadEditorMode, setThreadEditorMode] = useState<'create' | 'edit'>('create');
  const [threadEditorDraft, setThreadEditorDraft] = useState<ThreadDraft>(DEFAULT_THREAD_DRAFT);
  const [threadEditorTargetId, setThreadEditorTargetId] = useState<string | null>(null);
  const [forkDraft, setForkDraft] = useState<ForkDraft | null>(null);
  const [nodePreviewModal, setNodePreviewModal] = useState<{ title: string; messages: ChatMessage[] } | null>(null);
  const [deleteMode, setDeleteMode] = useState<{ nodeId: string; parts: { user: boolean; assistant: boolean } } | null>(null);
  const [modelCache, setModelCache] = useState<ModelCache>(() => loadModelCache());
  const [modelsLoadingConfigId, setModelsLoadingConfigId] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  const stateRef = useRef(state);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panGesture = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const pointerMap = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{ dist: number; zoom: number } | null>(null);
  const suppressReadMoreUntil = useRef(0);
  const readMoreTimerRef = useRef<number | null>(null);
  const spaceHeld = useRef(false);
  const ctrlHeld = useRef(false);
  const [panMode, setPanMode] = useState<'idle' | 'ready' | 'panning'>('idle');

  useEffect(() => {
    const applyTheme = () => {
      const resolved = resolveThemeMode(themeMode);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.appendChild(meta);
      }
      meta.content = resolved === 'light' ? '#f5f7fb' : '#070b17';
    };
    localStorage.setItem(THEME_MODE_KEY, themeMode);
    applyTheme();
    if (themeMode !== 'auto') return;
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    media?.addEventListener('change', applyTheme);
    return () => media?.removeEventListener('change', applyTheme);
  }, [themeMode]);

  useEffect(() => {
    stateRef.current = state;
    const handle = window.setTimeout(() => saveWorkspace(state), WORKSPACE_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [state]);
  useEffect(() => {
    const flush = () => saveWorkspace(stateRef.current);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);
  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
  }, [settings]);
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

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const loadVoices = () => {
      const voices = synth.getVoices();
      setTtsVoices(voices);
      return voices;
    };
    loadVoices();
    const timers = [100, 500, 1500].map((delay) => window.setTimeout(loadVoices, delay));
    synth.addEventListener?.('voiceschanged', loadVoices);
    synth.onvoiceschanged = loadVoices;
    return () => {
      if (ttsQueueRef.current?.keepAlive) window.clearInterval(ttsQueueRef.current.keepAlive);
      ttsQueueRef.current = null;
      synth.cancel();
      timers.forEach((timer) => window.clearTimeout(timer));
      synth.removeEventListener?.('voiceschanged', loadVoices);
      synth.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify(ttsSettings));
  }, [ttsSettings]);

  const metrics = useMemo(() => computeMetrics(state), [state]);
  const activeThread = state.threads.find((thread) => thread.id === state.selectedThreadId) ?? null;
  const activeNode =
    activeThread?.nodes.find((node) => node.id === state.selectedNodeId) ??
    (activeThread ? activeThread.nodes.find((node) => node.id === activeThread.activeNodeId) ?? null : null);
  const composerKey = activeThread ? composerStateKey(activeThread.id, activeNode?.id ?? activeThread.activeNodeId) : null;
  const composerState = composerKey ? composerStates[composerKey] ?? EMPTY_COMPOSER_STATE : EMPTY_COMPOSER_STATE;
  const composerDraft = composerState.draft;
  const composerAttachments = composerState.attachments;
  const activeProviderConfig =
    settings.providerConfigs.find((config) => config.id === settings.activeProviderConfigId) ?? settings.providerConfigs[0] ?? null;
  const settingsLockState = activeProviderConfig ? (activeProviderConfig.hasEncryptedApiKey ? (activeProviderConfig.apiKey.trim() ? 'unlocked' : 'locked') : 'none') : 'none';

  const settingsEditorConfig =
    settings.providerConfigs.find((config) => config.id === settingsEditorConfigId) ?? activeProviderConfig;
  const settingsEditorLockState = settingsEditorConfig
    ? settingsEditorConfig.hasEncryptedApiKey
      ? settingsEditorConfig.apiKey.trim()
        ? 'unlocked'
        : 'locked'
      : 'none'
    : 'none';

  useEffect(() => {
    if (activeProviderConfig?.hasEncryptedApiKey && !activeProviderConfig.apiKey.trim() && !passphraseModal) {
      setPassphraseModal({ mode: 'unlock', passphrase: '', busy: false, targetConfigId: activeProviderConfig.id });
    }
  }, [activeProviderConfig, passphraseModal]);

  const settingsModels = useMemo(
    () => modelsForConfig(modelCache, activeProviderConfig, activeProviderConfig?.model ?? ''),
    [modelCache, activeProviderConfig],
  );

  const messageUsage = useMemo(() => {
    const map = new Map<string, { input: number; output: number; model: string; cost: number }>();
    if (!activeThread) return map;
    for (const node of activeThread.nodes) {
      if (node.kind !== 'chat' || !node.usage) continue;
      const record = {
        input: node.usage.inputTokens,
        output: node.usage.outputTokens,
        model: node.model,
        cost: node.usage.estimatedCostUsd ?? 0,
      };
      for (const message of node.messages) map.set(message.id, record);
    }
    return map;
  }, [activeThread]);
  const settingsEditorModels = useMemo(
    () => modelsForConfig(modelCache, settingsEditorConfig, settingsEditorConfig?.model ?? ''),
    [modelCache, settingsEditorConfig],
  );

  useEffect(() => {
    if (!forkDraft) return;
    if (contextLinkMode?.intent !== 'fork' || contextLinkMode.sourceThreadId !== forkDraft.sourceThreadId) {
      setForkDraft(null);
      return;
    }
    if (forkDraft.selectedNodes !== contextLinkMode.selectedNodes) {
      setForkDraft({ ...forkDraft, selectedNodes: contextLinkMode.selectedNodes });
    }
  }, [contextLinkMode, forkDraft]);

  useEffect(() => {
    if (contextLinkMode?.intent === 'link') return;
    if (contextLinkPointer !== null) setContextLinkPointer(null);
    if (contextLinkSnapTarget !== null) setContextLinkSnapTarget(null);
  }, [contextLinkMode?.intent, contextLinkPointer, contextLinkSnapTarget]);

  const forkSourceThread = forkDraft ? state.threads.find((thread) => thread.id === forkDraft.sourceThreadId) ?? null : null;
  const forkSelectionMessageCount = forkSourceThread && forkDraft ? countSelectedMessages(forkSourceThread, forkDraft.selectedNodes) : 0;
  const forkSelectionPieceCount = forkDraft?.selectedNodes.length ?? 0;

  function clientToCanvasPoint(clientX: number, clientY: number) {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.panX) / state.zoom,
      y: (clientY - rect.top - state.panY) / state.zoom,
    };
  }

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

  const contextLinkPreview = useMemo(() => {
    if (contextLinkMode?.intent !== 'link') return null;
    const sourceLane = lanes.find((lane) => lane.thread.id === contextLinkMode.sourceThreadId);
    if (!sourceLane) return null;
    const sourceEntry = sourceLane.nodes.find((entry) => entry.node.id === contextLinkMode.dotNodeId);
    if (!sourceEntry) return null;
    const sourceX = sourceLane.centerX + (contextLinkMode.side === 'right' ? 22 : -22);
    const sourceY = sourceEntry.top + nodeHeight(sourceLane.thread, sourceEntry.node) / 2;
    const target = contextLinkSnapTarget
      ? (() => {
          const lane = lanes.find((entry) => entry.thread.id === contextLinkSnapTarget.threadId);
          const entry = lane?.nodes.find((item) => item.node.id === contextLinkSnapTarget.nodeId);
          if (!lane || !entry) return null;
          return {
            x: lane.centerX,
            y: entry.top + nodeHeight(lane.thread, entry.node) / 2,
          };
        })()
      : contextLinkPointer;
    if (!target) return null;
    return { sourceX, sourceY, targetX: target.x, targetY: target.y, snapped: contextLinkSnapTarget !== null };
  }, [contextLinkMode, contextLinkPointer, contextLinkSnapTarget, lanes]);

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

  function scrollChatToBottom(behavior: ScrollBehavior = 'auto') {
    const messages = focusMode ? focusMessagesRef.current : rightPanelOpen ? rightPanelMessagesRef.current : null;
    const anchor = focusMode ? focusEndRef.current : rightPanelOpen ? rightPanelEndRef.current : null;
    if (!messages || !anchor) return;
    const scroll = () => {
      anchor.scrollIntoView({ block: 'end', behavior });
      messages.scrollTop = messages.scrollHeight;
    };
    scroll();
    requestAnimationFrame(() => {
      scroll();
      requestAnimationFrame(scroll);
    });
  }

  useEffect(() => {
    scrollChatToBottom('smooth');
  }, [activeThread?.context.length, rightPanelOpen, focusMode]);

  useEffect(() => {
    const messages = focusMode ? focusMessagesRef.current : rightPanelOpen ? rightPanelMessagesRef.current : null;
    if (!messages || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => scrollChatToBottom());
    for (const child of Array.from(messages.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [activeThread?.id, activeThread?.context.length, rightPanelOpen, focusMode]);

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
      if (focusMode) { setFocusMode(false); return; }
      if (rightPanelOpen) { setRightPanelOpen(false); return; }
      if (forkDraft) { cancelForkSelection(); return; }
      if (contextLinkMode) { setContextLinkMode(null); return; }
      if (state.selectedThreadId) { deselectNode(); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [passphraseModal, aiSettingsModalOpen, threadEditorOpen, nodePreviewModal, rightPanelOpen, contextLinkMode, forkDraft, focusMode, state.selectedThreadId]);

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

  function threadLaneHeight(thread: ThreadLane) {
    let cursorTop = TOP_PAD;
    for (const node of thread.nodes) {
      cursorTop += nodeHeight(thread, node) + NODE_GAP;
    }
    return cursorTop + 72;
  }

  function focusCanvasOnThread(threads: ThreadLane[], thread: ThreadLane, threadIndex: number, zoom: number) {
    const viewport = viewportRef.current;
    const width = viewport?.clientWidth ?? window.innerWidth;
    const height = viewport?.clientHeight ?? window.innerHeight;
    const threadCount = threads.length;
    const nextCanvasWidth = Math.max(
      CANVAS_MIN_WIDTH,
      LEFT_PAD * 2 + Math.max(0, threadCount - 1) * (LANE_WIDTH + LANE_GAP) + LANE_WIDTH,
    );
    const nextCanvasHeight = Math.max(CANVAS_MIN_HEIGHT, ...threads.map(threadLaneHeight));
    const threadGroupWidth = threadCount * LANE_WIDTH + Math.max(0, threadCount - 1) * LANE_GAP;
    const groupLeft = nextCanvasWidth / 2 - threadGroupWidth / 2;
    const centerX = groupLeft + threadIndex * (LANE_WIDTH + LANE_GAP) + LANE_WIDTH / 2;
    const centerY = threadLaneHeight(thread) / 2;
    const panX = width / 2 - centerX * zoom;
    const panY = height / 2 - centerY * zoom;
    return boundedPan(panX, panY, zoom, width, height, nextCanvasWidth, nextCanvasHeight);
  }

  function selectThread(threadId: string, nodeId?: string | null) {
    setRightPanelOpen(true);
    setLeftPanelOpen(false);
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
    setLeftPanelOpen(false);
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
    setContextLinkMode({ intent: 'fork', sourceThreadId: thread.id, dotNodeId: nodeId, selectedNodes: forkSelection, side });
    setRightPanelOpen(false);
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

  function countSelectedMessages(sourceThread: ThreadLane, selectedNodes: ForkDraft['selectedNodes']) {
    let count = 0;
    for (const node of sourceThread.nodes) {
      if (node.kind !== 'chat' && node.kind !== 'context') continue;
      const selection = selectedNodes.find((s) => s.nodeId === node.id);
      if (!selection) continue;
      for (const msg of node.messages) {
        if (msg.role === 'user' && selection.parts.user) count += 1;
        if (msg.role === 'assistant' && selection.parts.assistant) count += 1;
      }
    }
    return count;
  }

  function buildForkThread(baseThread: ThreadLane, sourceThread: ThreadLane, selectedNodes: ForkDraft['selectedNodes']) {
    const injectedMessages = collectSelectedMessages(sourceThread, selectedNodes);
    if (injectedMessages.length === 0) return baseThread;
    const contextNode = createContextNode(sourceThread, selectedNodes.map((entry) => entry.nodeId), injectedMessages);
    return appendContextInjection(baseThread, contextNode, injectedMessages);
  }

  function cancelForkSelection() {
    setForkDraft(null);
    setContextLinkMode(null);
  }

  function commitForkSelection() {
    if (!forkDraft) return;
    const sourceThread = state.threads.find((entry) => entry.id === forkDraft.sourceThreadId);
    if (!sourceThread) {
      cancelForkSelection();
      return;
    }
    const selectedCount = countSelectedMessages(sourceThread, forkDraft.selectedNodes);
    if (selectedCount === 0) return;
    const baseThread = createThread(`Fork of ${forkDraft.sourceThreadTitle}`, sourceThread.description, state.threads.length);
    const thread = buildForkThread(baseThread, sourceThread, forkDraft.selectedNodes);
    setState((current) => {
      const nextThreads = [...current.threads, thread];
      return {
        ...current,
        version: current.version + 1,
        threads: nextThreads,
        selectedThreadId: thread.id,
        selectedNodeId: thread.activeNodeId,
        ...focusCanvasOnThread(nextThreads, thread, current.threads.length, current.zoom),
      };
    });
    setRightPanelOpen(true);
    cancelForkSelection();
    setError(null);
  }

  function submitThreadEditor() {
    const title = threadEditorDraft.title.trim() || 'Untitled thread';
    const description = threadEditorDraft.description.trim();

    if (threadEditorMode === 'create') {
      const baseThread = createThread(title, description, state.threads.length);

      const thread = forkDraft && forkDraft.selectedNodes.length > 0
        ? (() => {
            const sourceThread = state.threads.find((entry) => entry.id === forkDraft.sourceThreadId);
            if (!sourceThread) return baseThread;
            return buildForkThread(baseThread, sourceThread, forkDraft.selectedNodes);
          })()
        : baseThread;

      setState((current) => {
        const nextThreads = [...current.threads, thread];
        return {
          ...current,
          version: current.version + 1,
          threads: nextThreads,
          selectedThreadId: thread.id,
          selectedNodeId: thread.activeNodeId,
          ...focusCanvasOnThread(nextThreads, thread, current.threads.length, current.zoom),
        };
      });
      setRightPanelOpen(true);
      cancelForkSelection();
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

  function ensureSendableConfig(verb: 'send' | 'retry'): AIProviderConfig | null {
    const activeConfig = activeProviderConfig;
    if (!activeConfig) {
      if (verb === 'send') {
        setError('Add an AI profile to start chatting.');
        openProviderSetup();
      } else {
        setError('Pick an AI profile first.');
      }
      return null;
    }
    if (!activeConfig.apiKey.trim()) {
      const message = activeConfig.hasEncryptedApiKey ? 'Unlock this AI profile, or save a new encrypted key.' : 'Add your API key to this profile first.';
      setError(message);
      if (activeConfig.hasEncryptedApiKey) {
        setPassphraseModal({ mode: 'unlock', passphrase: '', busy: false, targetConfigId: activeConfig.id });
      } else {
        setProviderError(message);
        openProviderSetup(activeConfig.id);
      }
      return null;
    }
    if (!activeConfig.model.trim()) {
      const message = `Select a model for this AI profile before ${verb === 'send' ? 'sending' : 'retrying'}.`;
      setError(message);
      setProviderError(message);
      openProviderSetup(activeConfig.id);
      return null;
    }
    return activeConfig;
  }


  async function sendMessage(closeAfter = false) {
    if (sending) return;
    if (!activeThread) {
      setError('Select or create a thread before sending.');
      return;
    }
    const activeConfig = ensureSendableConfig('send');
    if (!activeConfig) return;

    const sourceComposerKey = composerKey;
    const composerStateForSend = composerState;
    const userText = composerStateForSend.draft.trim();
    if (!userText && composerStateForSend.attachments.length === 0) {
      setError('Write a message or attach a file before sending.');
      return;
    }

    const userMessage: ChatMessage = {
      id: `msg-${crypto.randomUUID()}`,
      role: 'user',
      content: createMixedMessage(userText, composerStateForSend.attachments),
      text: userText,
    };
    const pendingChatNode = createChatNode('Thinking…', [userMessage], activeConfig.model, undefined, 'pending');
    const pendingComposerKey = composerStateKey(activeThread.id, pendingChatNode.id);

    setSending(true);
    setError(null);
    updateComposerState(sourceComposerKey, () => EMPTY_COMPOSER_STATE);
    if (closeAfter) setRightPanelOpen(false);
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
        text: assistantText,
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
      updateComposerState(pendingComposerKey, () => composerStateForSend);
      setError(err instanceof Error ? err.message : 'AI request failed');
    } finally {
      setSending(false);
    }
  }

  async function copyText(value: string, messageId: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedMessageId(messageId);
      window.setTimeout(() => setCopiedMessageId((current) => (current === messageId ? null : current)), 1400);
    } catch {
      setError('Clipboard access was blocked by the browser.');
    }
  }

  function stopSpeaking() {
    const synth = window.speechSynthesis;
    if (ttsQueueRef.current?.keepAlive) window.clearInterval(ttsQueueRef.current.keepAlive);
    ttsQueueRef.current = null;
    synth?.cancel();
    setSpeakingMessageId(null);
  }

  function listenToMessage(messageId: string, value: string) {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      setError('Speech playback is not available in this browser.');
      return;
    }
    if (speakingMessageId === messageId) {
      stopSpeaking();
      return;
    }
    const spokenText = cleanTextForSpeech(value);
    if (!spokenText) {
      setError('No text to speak.');
      return;
    }

    stopSpeaking();
    const voices = synth.getVoices();
    if (voices.length > 0 && ttsVoices.length === 0) setTtsVoices(voices);
    const voice = voices.find((candidate) => candidate.voiceURI === ttsSettings.voiceURI)
      ?? ttsVoices.find((candidate) => candidate.voiceURI === ttsSettings.voiceURI)
      ?? voices.find((candidate) => candidate.default)
      ?? ttsVoices.find((candidate) => candidate.default)
      ?? null;
    const chunks = splitTextForSpeech(spokenText);
    ttsQueueRef.current = {
      messageId,
      chunks,
      index: 0,
      keepAlive: window.setInterval(() => {
        if (!synth.paused) synth.resume();
      }, 5000),
    };
    setSpeakingMessageId(messageId);

    const speakNext = () => {
      const queue = ttsQueueRef.current;
      if (!queue || queue.messageId !== messageId) return;
      const text = queue.chunks[queue.index++];
      if (!text) {
        stopSpeaking();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) {
        try {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        } catch {
          // Some browser engines reject stale/non-native voice objects; default voice is safer than failing playback.
        }
      }
      utterance.rate = ttsSettings.rate;
      utterance.onend = speakNext;
      utterance.onerror = (event) => {
        stopSpeaking();
        setError(`Speech playback failed${event.error ? `: ${event.error}` : ''}.`);
      };
      try {
        synth.speak(utterance);
        synth.resume();
      } catch (err) {
        stopSpeaking();
        setError(err instanceof Error ? err.message : 'Speech playback failed.');
      }
    };
    speakNext();
  }

  async function retryAssistantMessage(messageId: string) {
    if (!activeThread || sending) return;
    const activeConfig = ensureSendableConfig('retry');
    if (!activeConfig) return;

    const assistantIndex = activeThread.context.findIndex((message) => message.id === messageId && message.role === 'assistant');
    if (assistantIndex !== activeThread.context.length - 1) {
      setError('Only the latest assistant response can be retried safely.');
      return;
    }
    const sourceNode = activeThread.nodes.find((node): node is ThreadChatNode => node.kind === 'chat' && node.messages.some((message) => message.id === messageId));
    const userMessage = sourceNode?.messages.find((message) => message.role === 'user') ?? [...activeThread.context.slice(0, assistantIndex)].reverse().find((message) => message.role === 'user');
    if (!sourceNode || !userMessage) {
      setError('Could not find the prompt for this response.');
      return;
    }

    const requestMessages = activeThread.context.slice(0, assistantIndex);
    setSending(true);
    setError(null);
    setState((current) => ({
      ...current,
      version: current.version + 1,
      threads: current.threads.map((thread) =>
        thread.id === activeThread.id
          ? {
              ...thread,
              context: requestMessages,
              nodes: thread.nodes.map((node) =>
                node.id === sourceNode.id && node.kind === 'chat'
                  ? { ...node, summary: 'Thinking…', messages: [userMessage], usage: undefined, status: 'pending' }
                  : node,
              ),
              activeNodeId: sourceNode.id,
            }
          : thread,
      ),
      selectedThreadId: activeThread.id,
      selectedNodeId: sourceNode.id,
    }));

    try {
      const { assistantText, usage } = await requestAiReply(activeConfig, activeThread, requestMessages);
      const assistantMessage: ChatMessage = {
        id: messageId,
        role: 'assistant',
        content: createTextMessage(assistantText),
        text: assistantText,
      };
      setState((current) => ({
        ...current,
        version: current.version + 1,
        threads: current.threads.map((thread) =>
          thread.id === activeThread.id
            ? {
                ...thread,
                context: [...requestMessages, assistantMessage],
                nodes: thread.nodes.map((node) =>
                  node.id === sourceNode.id && node.kind === 'chat'
                    ? {
                        ...node,
                        summary: summarize(`${getMessageText(userMessage) || userMessage.text || ''} → ${assistantText}`, 52),
                        messages: [userMessage, assistantMessage],
                        usage,
                        status: 'unread',
                      }
                    : node,
                ),
                activeNodeId: sourceNode.id,
              }
            : thread,
        ),
        selectedThreadId: activeThread.id,
        selectedNodeId: sourceNode.id,
      }));
    } catch (err) {
      setState((current) => ({
        ...current,
        version: current.version + 1,
        threads: current.threads.map((thread) =>
          thread.id === activeThread.id
            ? {
                ...thread,
                context: activeThread.context,
                nodes: thread.nodes.map((node) =>
                  node.id === sourceNode.id && node.kind === 'chat' ? { ...sourceNode, status: 'error' } : node,
                ),
              }
            : thread,
        ),
      }));
      setError(err instanceof Error ? err.message : 'AI retry failed');
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
    setRightPanelOpen(false);
    setDeleteMode(null);
  }

  function deleteThread(threadId: string) {
    setState((current) => {
      const remainingThreads = current.threads.filter((thread) => thread.id !== threadId);
      if (remainingThreads.length === 0) {
        const fallbackThread = createThread('New thread', '', 0);
        return {
          ...current,
          threads: [fallbackThread],
          selectedThreadId: fallbackThread.id,
          selectedNodeId: fallbackThread.activeNodeId,
          ...focusCanvasOnThread([fallbackThread], fallbackThread, 0, current.zoom),
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

    clearComposerStatesForThread(threadId);

    setContextLinkMode((mode) => (mode?.sourceThreadId === threadId ? null : mode));
    setDeleteMode(null);
    setRightPanelOpen(false);
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
                const replacementChatNode = createChatNode('', [], node.model || '');
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

  function enterContextLinkMode(thread: ThreadLane, nodeId: string, side: 'left' | 'right', anchor?: { clientX: number; clientY: number }) {
    const selectedNodes = buildContextSelection(thread, nodeId);
    if (!selectedNodes) return;
    setContextLinkPointer(anchor ? clientToCanvasPoint(anchor.clientX, anchor.clientY) : null);
    setContextLinkSnapTarget(null);
    setContextLinkMode({ intent: 'link', sourceThreadId: thread.id, dotNodeId: nodeId, selectedNodes, side });
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
    if (!contextLinkMode || contextLinkMode.intent !== 'link') return;
    const sourceThread = state.threads.find((t) => t.id === contextLinkMode.sourceThreadId);
    if (!sourceThread) return;

    const injectedMessages = collectSelectedMessages(sourceThread, contextLinkMode.selectedNodes);

    if (injectedMessages.length === 0) {
      setContextLinkMode(null);
      setContextLinkPointer(null);
      setContextLinkSnapTarget(null);
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
    setContextLinkPointer(null);
    setContextLinkSnapTarget(null);
  }

  function updateProviderConfig(configId: string, patch: Partial<AIProviderConfig>) {
    setProviderError(null);
    setSettingsNotice(null);
    setSettings((current) => ({
      ...current,
      providerConfigs: current.providerConfigs.map((config) => (config.id === configId ? { ...config, ...patch } : config)),
    }));
  }

  function updateComposerState(key: string | null, updater: (current: ComposerState) => ComposerState) {
    if (!key) return;
    setComposerStates((current) => {
      const nextState = updater(current[key] ?? EMPTY_COMPOSER_STATE);
      if (nextState.draft.length === 0 && nextState.attachments.length === 0) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: nextState };
    });
  }

  function clearComposerStatesForThread(threadId: string) {
    const prefix = `${threadId}::`;
    setComposerStates((current) => {
      let changed = false;
      const next: Record<string, ComposerState> = {};
      Object.entries(current).forEach(([key, value]) => {
        if (key.startsWith(prefix)) {
          changed = true;
          return;
        }
        next[key] = value;
      });
      return changed ? next : current;
    });
  }

  function requestSaveKey(configId: string) {
    const targetConfig = settings.providerConfigs.find((config) => config.id === configId) ?? null;
    const targetConfigId = targetConfig?.id ?? configId;
    const candidate = targetConfig?.apiKey.trim() ?? '';
    if (!candidate) {
      if (targetConfig?.hasEncryptedApiKey) {
        setPassphraseModal({ mode: 'unlock', passphrase: '', busy: false, targetConfigId });
      } else {
        setProviderError('Enter your API key first.');
      }
      return;
    }
    setError(null);
    setPassphraseModal({ mode: 'encrypt', passphrase: '', busy: false, pendingKey: candidate, targetConfigId });
  }

  function deleteSavedKey(configId: string) {
    const targetConfig = settings.providerConfigs.find((config) => config.id === configId) ?? null;
    if (!targetConfig) return;
    const confirmed = targetConfig.hasEncryptedApiKey ? window.confirm('Delete the saved encrypted key from this browser?') : true;
    if (!confirmed) return;
    clearProviderSecret(targetConfig.id);
    updateProviderConfig(targetConfig.id, { apiKey: '', hasEncryptedApiKey: false });
    setSettingsNotice('Saved key deleted from this browser.');
    setProviderError(null);
    setError(null);
  }

  async function submitPassphraseModal() {
    if (!passphraseModal) return;
    const passphrase = passphraseModal.passphrase;
    if (!passphrase.trim()) {
      const message = 'Enter a passphrase.';
      setError(message);
      setProviderError(message);
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
        const targetConfig = settingsRef.current.providerConfigs.find((config) => config.id === configId) ?? null;
        updateProviderConfig(configId, { apiKey, hasEncryptedApiKey: true });
        setSettingsNotice('Key unlocked — loaded in memory for this session.');
        if (targetConfig) {
          await fetchModelsForConfig({ ...targetConfig, apiKey, hasEncryptedApiKey: true }, { requireKey: false, updateSelectedModel: true });
        }
      } else {
        const keyToSave = passphraseModal.pendingKey?.trim() ?? settings.providerConfigs.find((config) => config.id === configId)?.apiKey.trim() ?? '';
        if (!keyToSave) throw new Error('No key to save.');
        await saveProviderSecret(configId, keyToSave, passphrase);
        const targetConfig = settingsRef.current.providerConfigs.find((config) => config.id === configId) ?? null;
        updateProviderConfig(configId, { apiKey: keyToSave, hasEncryptedApiKey: true });
        setSettingsNotice('Key encrypted and saved. Loaded in memory for this session.');
        if (targetConfig) {
          await fetchModelsForConfig({ ...targetConfig, apiKey: keyToSave, hasEncryptedApiKey: true }, { requireKey: false, updateSelectedModel: true });
        }
      }
      setPassphraseModal(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Passphrase action failed.';
      setError(message);
      setProviderError(message);
      setPassphraseModal((current) => (current ? { ...current, busy: false } : current));
    } finally {
      setSavingSettings(false);
    }
  }

  function closePassphraseModal() {
    setPassphraseModal(null);
  }

  function confirmResetWorkspace() {
    const confirmed = window.confirm(
      'Reset workspace canvas?\n\nThis removes all threads, messages, nodes, and canvas layout from this browser. Your AI provider profiles and saved provider keys will be kept.',
    );
    if (!confirmed) return;
    resetWorkspace();
  }

  function resetWorkspace() {
    localStorage.removeItem('loomspace.workspace.v7');
    setState(loadWorkspace());
    setComposerStates({});
    setPassphraseModal(null);
    setSettingsNotice(null);
    setError(null);
    setThreadEditorOpen(false);
    setRightPanelOpen(false);
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

  function addProviderProfile() {
    const next = createProviderConfig('openai');
    setSettings((current) => ({
      ...current,
      providerConfigs: [...current.providerConfigs, next],
    }));
    setSettingsEditorConfigId(next.id);
    setLeftPanelOpen(false);
    setProviderMenuOpen(false);
    setAiSettingsModalOpen(true);
    setSettingsNotice(null);
    setProviderError(null);
  }

  function openProviderSetup(configId?: string) {
    setLeftPanelOpen(false);
    setProviderMenuOpen(false);
    if (settings.providerConfigs.length === 0) {
      addProviderProfile();
      return;
    }
    setSettingsEditorConfigId(configId ?? activeProviderConfig?.id ?? settings.providerConfigs[0]?.id ?? null);
    setAiSettingsModalOpen(true);
  }

  function removeProfile(target: AIProviderConfig) {
    setSettings(deleteProviderConfig(settings, target.id));
    setModelCache((current) => {
      const copy = { ...current };
      delete copy[target.id];
      return copy;
    });
    setSettingsNotice(`Deleted AI profile "${target.label}".`);
    setProviderError(null);
    setError(null);
  }

  function deleteProfile(configId: string) {
    const target = settings.providerConfigs.find((config) => config.id === configId);
    if (!target) return;
    const confirmed = window.confirm(`Delete AI profile "${target.label}"? Its saved key will be removed from this browser.`);
    if (!confirmed) return;
    removeProfile(target);
  }

  async function fetchModelsForConfig(
    config: AIProviderConfig,
    options: { requireKey?: boolean; updateSelectedModel?: boolean } = {},
  ) {
    if (!config.apiKey.trim()) {
      if (options.requireKey !== false) {
        const message = config.hasEncryptedApiKey ? 'Unlock this provider config first so we can list models.' : 'Add your API key to list models.';
        setProviderError(message);
        if (config.hasEncryptedApiKey) {
          setPassphraseModal({ mode: 'unlock', passphrase: '', busy: false, targetConfigId: config.id });
        }
      }
      return false;
    }

    setModelsLoadingConfigId(config.id);
    setProviderError(null);
    setSettingsNotice(null);
    try {
      const ids = await fetchProviderModels(config);
      const currentConfig = settingsRef.current.providerConfigs.find((entry) => entry.id === config.id) ?? null;
      if (!currentConfig || !sameProviderModelSource(currentConfig, config)) return false;

      const providerKey = providerModelCacheKey(config);
      const sourceConfigIds = settingsRef.current.providerConfigs
        .filter((entry) => sameProviderModelSource(entry, config))
        .map((entry) => entry.id);

      setModelCache((current) => {
        const next = { ...current };
        for (const id of sourceConfigIds) delete next[id];
        delete next[providerKey];
        if (ids.length > 0) {
          next[config.id] = ids;
          next[providerKey] = ids;
        }
        return next;
      });

      if (options.updateSelectedModel !== false) {
        setSettings((current) => {
          let changed = false;
          const providerConfigs = current.providerConfigs.map((entry) => {
            if (!sameProviderModelSource(entry, config)) return entry;
            if (ids.length === 0) {
              if (!entry.model) return entry;
              changed = true;
              return { ...entry, model: '' };
            }
            if (ids.includes(entry.model)) return entry;
            changed = true;
            return { ...entry, model: ids[0] };
          });
          return changed ? { ...current, providerConfigs } : current;
        });
      }

      setSettingsNotice(ids.length === 0 ? `No models returned for ${config.label}.` : `Loaded ${ids.length} models for ${config.label}.`);
      return true;
    } catch (err) {
      setProviderError(err instanceof Error ? err.message : `Failed to list models for ${config.label}`);
      return false;
    } finally {
      setModelsLoadingConfigId((current) => (current === config.id ? null : current));
    }
  }

  async function refreshModels(providerConfigId: string) {
    const config = settings.providerConfigs.find((entry) => entry.id === providerConfigId);
    if (!config) return;
    await fetchModelsForConfig(config, { requireKey: true, updateSelectedModel: true });
  }

  useEffect(() => {
    try { localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(panelSizes)); } catch { /* storage may be unavailable */ }
  }, [panelSizes]);

  function beginPanelResize(kind: 'left' | 'right' | 'bottom', event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    if (kind === 'right' && rightPanelMaximized) setRightPanelMaximized(false);
    panelDragRef.current = { kind, origin: kind === 'bottom' ? event.clientY : event.clientX, size: panelSizes[kind] };
    setPanelResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePanelResize(event: PointerEvent<HTMLDivElement>) {
    const drag = panelDragRef.current;
    if (!drag) return;
    if (drag.kind === 'left') {
      const max = maxSideWidth(rightPanelOpen && !rightPanelMaximized ? panelSizes.right : 0);
      setPanelSizes((sizes) => ({ ...sizes, left: clamp(drag.size + (event.clientX - drag.origin), MIN_PANEL_W, max) }));
    } else if (drag.kind === 'right') {
      const max = maxSideWidth(leftPanelOpen ? panelSizes.left : 0);
      setPanelSizes((sizes) => ({ ...sizes, right: clamp(drag.size + (drag.origin - event.clientX), MIN_PANEL_W, max) }));
    } else {
      setPanelSizes((sizes) => ({ ...sizes, bottom: clamp(drag.size + (drag.origin - event.clientY), MIN_BOTTOM_H, MAX_BOTTOM_H) }));
    }
  }

  function endPanelResize(event: PointerEvent<HTMLDivElement>) {
    if (!panelDragRef.current) return;
    panelDragRef.current = null;
    setPanelResizing(false);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* capture may already be gone */ }
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

    if (contextLinkMode?.intent === 'link') {
      const pointer = clientToCanvasPoint(event.clientX, event.clientY);
      if (pointer) setContextLinkPointer(pointer);
      const target = event.target instanceof Element ? event.target.closest('[data-thread-id][data-node-id]') : null;
      if (target instanceof HTMLElement) {
        const threadId = target.dataset.threadId;
        const nodeId = target.dataset.nodeId;
        if (threadId && nodeId && threadId !== contextLinkMode.sourceThreadId) setContextLinkSnapTarget({ threadId, nodeId });
        else setContextLinkSnapTarget(null);
      } else {
        setContextLinkSnapTarget(null);
      }
    }

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
  const remainingContext = activeThread && selectedThreadUsage && activeProviderConfig?.model.trim()
    ? Math.max(getModelWindow(activeProviderConfig.model) - selectedThreadUsage.totalTokens, 0)
    : 0;
  const settingsEditorModelsLoading = settingsEditorConfig ? modelsLoadingConfigId === settingsEditorConfig.id : false;
  const settingsEditorHasCachedModels = settingsEditorConfig ? Boolean(modelCache[settingsEditorConfig.id] ?? modelCache[providerModelCacheKey(settingsEditorConfig)]) : false;

  const renderNodeFooter = (title: string, messages: ChatMessage[]) => (
    <div className="node-footer">
      {messages.length > 0 ? (
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
              setNodePreviewModal({ title, messages });
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
  );

  const renderNodeDeleteCorner = (thread: ThreadLane, node: ThreadNode, isSelected: boolean) =>
    isSelected && !contextLinkMode ? (
      <button
        type="button"
        className="node-delete-corner"
        aria-label="Delete node"
        title="Delete node"
        onClick={(e) => { e.stopPropagation(); enterDeleteMode(thread.id, node.id); }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 3 14 13 14 13 6"/><line x1="1" y1="3" x2="15" y2="3"/><line x1="7" y1="7" x2="7" y2="11"/></svg>
      </button>
    ) : null;

  const renderContextSelectOverlay = (nodeId: string, ctxPart: { parts: { user: boolean; assistant: boolean } } | null) =>
    ctxPart ? (
      <div className="context-select-overlay" onClick={(e) => e.stopPropagation()}>
        <button type="button" className={`context-select-half user ${ctxPart.parts.user ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleContextPart(nodeId, 'user'); }}>
          <span>User prompt</span>
          <span className="context-select-check">{ctxPart.parts.user ? '✓' : '○'}</span>
        </button>
        <button type="button" className={`context-select-half assistant ${ctxPart.parts.assistant ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleContextPart(nodeId, 'assistant'); }}>
          <span>Asst response</span>
          <span className="context-select-check">{ctxPart.parts.assistant ? '✓' : '○'}</span>
        </button>
      </div>
    ) : null;

  const renderDeleteOverlay = (thread: ThreadLane, nodeId: string) =>
    deleteMode && deleteMode.nodeId === nodeId ? (
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
    ) : null;

  const renderActionDots = (thread: ThreadLane, node: ThreadNode, isLast: boolean) => {
    const handleSideDot = (side: 'left' | 'right') => (e: React.MouseEvent) => {
      e.stopPropagation();
      if (contextLinkMode?.dotNodeId === node.id && contextLinkMode.sourceThreadId === thread.id && contextLinkMode.side === side) {
        if (contextLinkMode.selectedNodes.length <= 1) setContextLinkMode(null);
        else setContextLinkMode({ ...contextLinkMode, selectedNodes: [{ nodeId: node.id, parts: { user: true, assistant: true } }] });
      } else {
        enterContextLinkMode(thread, node.id, side, { clientX: e.clientX, clientY: e.clientY });
      }
    };
    const handleForkDot = (side: 'left' | 'right') => (e: React.MouseEvent) => {
      e.stopPropagation();
      openForkThreadEditor(thread, node.id, side);
    };
    return (
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
        {isLast && (<>
          <div className="action-line-v" style={{ top: CHAT_HEIGHT, left: NODE_WIDTH / 2 }} />
          <button type="button" className="action-node-ghost" style={{ top: CHAT_HEIGHT + 36, left: 0 }} aria-label="Open chat" onClick={(e) => { e.stopPropagation(); setRightPanelOpen(true); }}>
            <span>Open chat</span>
          </button>
        </>)}
      </>
    );
  };

  const renderChatMessage = (message: ChatMessage, isLatestAssistant: boolean) => {
    const usage = messageUsage.get(message.id);
    const messageText = getMessageText(message) || message.text || '';
    return (
      <article
        key={message.id}
        className={`bubble chat-message ${message.role} ${message.injectedFromThreadId ? 'injected' : ''}`}
        style={message.injectedFromColor ? {
          '--inject-bg': hexToRgba(message.injectedFromColor, 0.07),
          '--inject-border': hexToRgba(message.injectedFromColor, 0.3),
        } as React.CSSProperties : undefined}
      >
        <div className="chat-message-topline">
          <strong>{message.role === 'assistant' ? 'AI' : message.role}</strong>
          <div className="chat-message-actions">
            <button type="button" onClick={() => copyText(messageText, message.id)} aria-label="Copy message">{copiedMessageId === message.id ? 'Copied' : 'Copy'}</button>
            <button type="button" onClick={() => listenToMessage(message.id, messageText)} aria-label={speakingMessageId === message.id ? 'Stop reading message' : 'Read message aloud'}>{speakingMessageId === message.id ? 'Stop' : 'Listen'}</button>
            {isLatestAssistant ? <button type="button" onClick={() => retryAssistantMessage(message.id)} disabled={sending} aria-label="Retry response">Retry</button> : null}
          </div>
        </div>
        <FormattedMessage text={messageText} rich={message.role === 'assistant'} />
        {hasAttachments(message) && (
          <div className="message-attachments">
            {getAttachmentsByType(message, 'image').map(att => (
              <img key={att.id} src={att.preview} alt={att.filename} className="message-image" />
            ))}
            {getAttachmentsByType(message, 'document').map(att => (
              <div key={att.id} className="message-document">📄 {att.filename}</div>
            ))}
          </div>
        )}
        {usage ? (
          <div className="bubble-meta">
            {message.role === 'assistant'
              ? `${usage.output.toLocaleString()} tokens out · ${usage.model}${usage.cost ? ` · $${usage.cost.toFixed(4)}` : ''}`
              : `${usage.input.toLocaleString()} tokens in`}
          </div>
        ) : null}
      </article>
    );
  };

  const renderComposer = (opts: { fileInputId: string; placeholder: string; onEscape: () => void; autoFocus?: boolean }) => (
    <div className="mini-chat-composer">
      <textarea
        autoFocus={opts.autoFocus}
        value={composerDraft}
        onChange={(e) => updateComposerState(composerKey, (current) => ({ ...current, draft: e.target.value }))}
        placeholder={opts.placeholder}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); opts.onEscape(); return; }
          if (e.key !== 'Enter') return;
          if (e.shiftKey) return;
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) { sendMessage(true); } else { sendMessage(); }
        }}
      />
      {composerAttachments.length > 0 && (
        <div className="composer-attachments">
          {composerAttachments.map(att => (
            <div key={att.id} className="attachment-preview">
              {att.type === 'image' ? (
                <img src={att.preview} alt={att.filename} className="attachment-thumbnail" />
              ) : (
                <div className="document-preview">📄 {att.filename}</div>
              )}
              <button onClick={() => updateComposerState(composerKey, (current) => ({ ...current, attachments: current.attachments.filter((attachment) => attachment.id !== att.id) }))} className="remove-attachment">×</button>
            </div>
          ))}
        </div>
      )}
      {settingsLockState === 'locked' ? <p className="muted">Unlock the active AI profile to send a message.</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="mini-chat-actions">
        <input
          type="file"
          id={opts.fileInputId}
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
            if (errors.length > 0) setError(errors.join('\n'));
            if (newAttachments.length > 0) updateComposerState(composerKey, (current) => ({ ...current, attachments: [...current.attachments, ...newAttachments] }));
            e.target.value = '';
          }}
          style={{ display: 'none' }}
        />
        <label htmlFor={opts.fileInputId} className="file-upload-button mini-chat-attach">📎</label>
        <button
          className="mini-chat-send"
          onClick={() => sendMessage()}
          disabled={sending}
        >
          {sending ? 'Thinking…' : !activeProviderConfig ? 'Add AI profile' : settingsLockState === 'locked' ? 'Unlock to send' : 'Send'}
        </button>
      </div>
    </div>
  );

  function focusNewThread() {
    const baseThread = createThread('New chat', '', state.threads.length);
    setState((current) => {
      const nextThreads = [...current.threads, baseThread];
      return {
        ...current,
        version: current.version + 1,
        threads: nextThreads,
        selectedThreadId: baseThread.id,
        selectedNodeId: baseThread.activeNodeId,
        ...focusCanvasOnThread(nextThreads, baseThread, current.threads.length, current.zoom),
      };
    });
    setError(null);
  }

  function enterFocusMode() {
    if (!activeThread && state.threads.length > 0) {
      const last = state.threads[state.threads.length - 1];
      setState((current) => ({ ...current, selectedThreadId: last.id, selectedNodeId: last.activeNodeId }));
    }
    setFocusMode(true);
  }

  const renderFocusMode = () => {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return (
      <div className="focus-mode">
        {focusSidebarOpen ? (
          <aside className="focus-sidebar">
            <div className="focus-sidebar-head">
              <span className="focus-brand">Loomspace</span>
              <button type="button" className="focus-icon-btn" onClick={() => setFocusSidebarOpen(false)} aria-label="Collapse sidebar" title="Collapse sidebar">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 3 4 8 9 13"/></svg>
              </button>
            </div>
            <button type="button" className="focus-new-chat" onClick={focusNewThread}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6.5" y1="1.5" x2="6.5" y2="11.5"/><line x1="1.5" y1="6.5" x2="11.5" y2="6.5"/></svg>
              New chat
            </button>
            <div className="focus-thread-list">
              {state.threads.length === 0 ? (
                <p className="muted focus-empty-list">No chats yet.</p>
              ) : (
                state.threads.slice().reverse().map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`focus-thread-item ${t.id === activeThread?.id ? 'active' : ''}`}
                    onClick={() => setState((current) => ({ ...current, selectedThreadId: t.id, selectedNodeId: t.activeNodeId }))}
                    style={{ '--thread-color': t.color } as React.CSSProperties}
                  >
                    <span className="focus-thread-dot" aria-hidden="true" />
                    <span className="focus-thread-name">{t.title || 'Untitled thread'}</span>
                  </button>
                ))
              )}
            </div>
            <div className="focus-sidebar-foot">
              <button type="button" className="quiet" onClick={() => openProviderSetup()}>AI profiles</button>
            </div>
          </aside>
        ) : null}
        <div className="focus-main">
          <header className="focus-topbar">
            {!focusSidebarOpen ? (
              <button type="button" className="focus-icon-btn" onClick={() => setFocusSidebarOpen(true)} aria-label="Show sidebar" title="Show sidebar">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg>
              </button>
            ) : null}
            {activeThread ? (
              <input className="focus-title-input" value={activeThread.title} onChange={(e) => updateTitle(activeThread.id, e.target.value)} placeholder="Untitled thread" aria-label="Thread title" />
            ) : <span className="focus-title-input focus-title-placeholder" />}
            <div className="focus-topbar-right">
              {settings.providerConfigs.length > 0 && activeProviderConfig ? (
                <select className="focus-model-select" value={activeProviderConfig.model} onChange={(e) => updateProviderConfig(activeProviderConfig.id, { model: e.target.value })} aria-label="Model">
                  {settingsModels.length === 0 ? <option value={activeProviderConfig.model}>{activeProviderConfig.model || 'no model'}</option> : settingsModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <button type="button" className="quiet focus-add-profile" onClick={() => openProviderSetup()}>Add AI profile</button>
              )}
              <button type="button" className="focus-exit" onClick={() => setFocusMode(false)} aria-label="Exit focus mode" title="Exit focus mode (Esc)">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2H14v4.5"/><path d="M14 2 8.5 7.5"/><path d="M6.5 14H2V9.5"/><path d="M2 14l5.5-5.5"/></svg>
                <span>Exit</span>
              </button>
            </div>
          </header>
          {activeThread ? (
            <>
              <div className="focus-scroll" ref={focusMessagesRef}>
                <div className="focus-column">
                  {activeThread.context.length === 0 ? (
                    <div className="focus-greeting">
                      <h1>{greeting}</h1>
                      <p className="focus-greeting-sub">Send a message to start this chat.</p>
                    </div>
                  ) : (
                    activeThread.context.map((m) => renderChatMessage(m, m.role === 'assistant' && activeThread.context[activeThread.context.length - 1]?.id === m.id))
                  )}
                  <div ref={focusEndRef} className="chat-scroll-anchor" aria-hidden="true" />
                </div>
              </div>
              <div className="focus-composer-bar">
                <div className="focus-column">
                  {renderComposer({ fileInputId: 'file-upload-focus', placeholder: 'Message your thread…', onEscape: () => setFocusMode(false), autoFocus: true })}
                </div>
              </div>
            </>
          ) : (
            <div className="focus-conversation-empty">
              <div className="focus-greeting">
                <h1>{greeting}</h1>
                <p className="focus-greeting-sub">Start a new chat to begin.</p>
                <button type="button" className="focus-new-chat focus-new-chat-lg" onClick={focusNewThread}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6.5" y1="1.5" x2="6.5" y2="11.5"/><line x1="1.5" y1="6.5" x2="11.5" y2="6.5"/></svg>
                  New chat
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const layoutStyle = {} as React.CSSProperties & Record<string, string>;
  if (leftPanelOpen) layoutStyle['--left-w'] = `${panelSizes.left}px`;
  if (rightPanelOpen) layoutStyle['--right-w'] = rightPanelMaximized ? `${maxSideWidth(leftPanelOpen ? panelSizes.left : 0)}px` : `${panelSizes.right}px`;
  if (bottomPanelOpen) layoutStyle['--bottom-h'] = `${panelSizes.bottom}px`;

  return (
    <div className="app-shell">
      {focusMode ? renderFocusMode() : (
      <>
      <header className="topbar">
        <div className="topbar-title">
          <div className="brand-mark" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M6 8.5C9.5 3.5 18.2 3.8 21.6 8.9C24.9 13.8 22.5 22.8 14.2 23.5C6 24.2 1.9 14.4 6 8.5Z" fill="currentColor" opacity="0.13"/>
              <path d="M8.2 15.2C10.4 11.6 14.2 9.7 19.9 9.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <path d="M8.2 12.3C11.4 16.1 15.2 17.7 20 17.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx="8.2" cy="13.7" r="2.1" fill="currentColor"/>
              <circle cx="20" cy="9.7" r="1.8" fill="currentColor"/>
              <circle cx="20" cy="17.1" r="1.8" fill="currentColor"/>
            </svg>
          </div>
          <div>
            <p className="eyebrow">Loomspace</p>
            <h1>{state.title}</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="layout-toggles">
            <button type="button" className={`layout-toggle icon-btn ${leftPanelOpen ? 'active' : ''}`} aria-pressed={leftPanelOpen} onClick={() => setLeftPanelOpen((open) => !open)} aria-label="Toggle left panel" title="Toggle left panel"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><rect x="1.5" y="2.5" width="4.5" height="11" fill="currentColor" stroke="none"/></svg></button>
            <button type="button" className={`layout-toggle icon-btn ${bottomPanelOpen ? 'active' : ''}`} aria-pressed={bottomPanelOpen} onClick={() => setBottomPanelOpen((open) => !open)} aria-label="Toggle bottom panel" title="Toggle bottom panel"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><rect x="1.5" y="9.5" width="13" height="4" fill="currentColor" stroke="none"/></svg></button>
            <button type="button" className={`layout-toggle icon-btn ${rightPanelOpen ? 'active' : ''}`} aria-pressed={rightPanelOpen} onClick={() => setRightPanelOpen((open) => !open)} aria-label="Toggle right panel (chat)" title="Toggle chat panel"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><rect x="10" y="2.5" width="4.5" height="11" fill="currentColor" stroke="none"/></svg></button>
          </div>
          <button type="button" className="focus-enter" onClick={enterFocusMode} aria-label="Enter focus mode" title="Focus mode — distraction-free chat"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6V3.5A1.5 1.5 0 0 1 3.5 2H6"/><path d="M14 6V3.5A1.5 1.5 0 0 0 12.5 2H10"/><path d="M2 10v2.5A1.5 1.5 0 0 0 3.5 14H6"/><path d="M14 10v2.5a1.5 1.5 0 0 1-1.5 1.5H10"/></svg> Focus</button>
          <button onClick={() => openThreadEditor('create')}><svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6.5" y1="1.5" x2="6.5" y2="11.5"/><line x1="1.5" y1="6.5" x2="11.5" y2="6.5"/></svg> New thread</button>
          <div className="zoom-control" aria-label="Canvas zoom controls">
            <button type="button" onClick={() => zoomFromButton(-1)} aria-label="Zoom out">−</button>
            <button type="button" onClick={resetView} className="topbar-reset-view" aria-label="Center canvas" title="Center canvas">100%</button>
            <button type="button" onClick={() => zoomFromButton(1)} aria-label="Zoom in">+</button>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setThemeMode((mode) => (mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto'))}
            aria-label={`Theme: ${themeMode}`}
            title={`Theme: ${themeMode}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {themeMode === 'dark' ? (
                <path d="M13.5 10.2A5.8 5.8 0 0 1 5.8 2.5 6.2 6.2 0 1 0 13.5 10.2Z"/>
              ) : (
                <><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85"/></>
              )}
            </svg>
            <span>{themeMode === 'auto' ? 'Auto' : themeMode === 'light' ? 'Light' : 'Dark'}</span>
          </button>
          <button type="button" onClick={confirmResetWorkspace} className="quiet workspace-reset" aria-label="Reset workspace" title="Reset workspace (provider profiles are kept)">
            Reset workspace
          </button>
        </div>
      </header>

      <main
        className={`layout ${leftPanelOpen ? 'left-open' : ''} ${rightPanelOpen ? 'right-open' : ''} ${bottomPanelOpen ? 'bottom-open' : ''} ${panelResizing ? 'resizing' : ''}`}
        style={layoutStyle}
      >
        {leftPanelOpen ? <div className="sidebar-scrim" onClick={() => setLeftPanelOpen(false)} /> : null}
        <aside className={`panel left ${leftPanelOpen ? 'open' : ''}`}>
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
                onClick={() => openProviderSetup()}
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
                  onClick={addProviderProfile}
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
                        onClick={() => openProviderSetup(config.id)}
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
                  <button type="button" onClick={addProviderProfile}>
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

          {forkDraft && forkSourceThread ? (
            <div className="fork-selection-banner">
              <div className="fork-selection-copy">
                <p className="eyebrow">Fork selection</p>
                <h2>{forkSelectionMessageCount > 0 ? `${forkSelectionMessageCount} message${forkSelectionMessageCount === 1 ? '' : 's'} selected` : 'Select conversation pieces to fork'}</h2>
                <p>{forkSelectionPieceCount} piece{forkSelectionPieceCount === 1 ? '' : 's'} selected. Use the user / assistant toggles to trim what carries over.</p>
              </div>
              <div className="fork-selection-actions">
                <button type="button" onClick={cancelForkSelection}>Cancel</button>
                <button type="button" disabled={forkSelectionMessageCount === 0} onClick={commitForkSelection}>Fork selected</button>
              </div>
            </div>
          ) : null}

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
                  if (forkDraft) return;
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
                {contextLinkPreview ? (
                  <line
                    key="ctx-preview"
                    x1={contextLinkPreview.sourceX}
                    y1={contextLinkPreview.sourceY}
                    x2={contextLinkPreview.targetX}
                    y2={contextLinkPreview.targetY}
                    className={`context-link-preview${contextLinkPreview.snapped ? ' snapped' : ''}`}
                  />
                ) : null}

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
                        const isSelected = thread.id === state.selectedThreadId && node.id === state.selectedNodeId;
                        const isLast = nodeIndex === lane.nodes.length - 1;
                        const titleHeight = TITLE_HEIGHT + (thread.infoOpen ? TITLE_INFO_EXTRA : 0);
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
                            {!rightPanelOpen && isSelected && isLast ? (
                              <>
                                <div className="action-line-v" style={{ top: titleHeight, left: NODE_WIDTH / 2 }} />
                                <button type="button" className="action-node-ghost" style={{ top: titleHeight + 36, left: 0 }} aria-label="Open chat" onClick={(e) => { e.stopPropagation(); setRightPanelOpen(true); }}>
                                  <span>Open chat</span>
                                </button>
                              </>
                            ) : null}
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
                        const isContextSnapTarget = contextLinkSnapTarget?.threadId === thread.id && contextLinkSnapTarget.nodeId === node.id;
                        const showDots = !rightPanelOpen && (isSelected || (contextLinkMode?.dotNodeId === node.id && contextLinkMode.sourceThreadId === thread.id));
                        return (
                          <div
                            key={node.id}
                            style={{ position: 'absolute', top, left: 0 }}
                            data-thread-id={thread.id}
                            data-node-id={node.id}
                          >
                            <div
                              className={`context-node ${isSelected ? 'selected' : ''} ${isContextSource ? 'context-source-selected' : ''} ${isContextTarget ? 'context-target' : ''} ${isContextSnapTarget ? 'context-link-snap-target' : ''}`}
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
                                  setRightPanelOpen(true);
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
                              {renderNodeFooter(ctxNode.sourceThreadTitle, ctxNode.messages)}
                              {renderNodeDeleteCorner(thread, node, isSelected)}
                            </div>
                            {renderContextSelectOverlay(node.id, ctxPart)}
                            {renderDeleteOverlay(thread, node.id)}
                            {showDots && renderActionDots(thread, node, nodeIndex === lane.nodes.length - 1)}
                          </div>
                        );
                      }

                      const chatNode = node;
                      const isSelected = thread.id === state.selectedThreadId && node.id === state.selectedNodeId;
                      const ctxPart = contextLinkMode?.sourceThreadId === thread.id
                        ? contextLinkMode.selectedNodes.find((s) => s.nodeId === node.id) ?? null
                        : null;
                      const isContextSource = ctxPart !== null;
                      const isContextTarget = contextLinkMode?.intent === 'link' && thread.id !== contextLinkMode.sourceThreadId;
                      const isContextSnapTarget = contextLinkSnapTarget?.threadId === thread.id && contextLinkSnapTarget.nodeId === node.id;
                      const showDots = !rightPanelOpen && (isSelected || (contextLinkMode?.dotNodeId === node.id && contextLinkMode.sourceThreadId === thread.id));

                      return (
                        <div
                          key={node.id}
                          style={{ position: 'absolute', top, left: 0 }}
                          data-thread-id={thread.id}
                          data-node-id={node.id}
                        >
                          <div
                            className={`chat-node ${isSelected ? 'selected' : ''} ${chatNode.status === 'pending' ? 'sending' : ''} ${chatNode.status === 'unread' && !(rightPanelOpen && thread.id === state.selectedThreadId) ? 'responded' : ''} ${isContextSource ? 'context-source-selected' : ''} ${isContextTarget ? 'context-target' : ''} ${isContextSnapTarget ? 'context-link-snap-target' : ''}`}
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
                                setRightPanelOpen(true);
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
                            {renderNodeFooter(chatNode.summary, chatNode.messages)}
                            {renderNodeDeleteCorner(thread, node, isSelected)}
                          </div>
                          {renderContextSelectOverlay(node.id, ctxPart)}
                          {renderDeleteOverlay(thread, node.id)}
                          {showDots && renderActionDots(thread, node, nodeIndex === lane.nodes.length - 1)}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          </div>
        </section>
        <section className="panel bottom">
          {bottomPanelOpen ? (
            <div className="bottom-dock">
              <div className="bottom-dock-header">
                <span className="bottom-dock-title">Panel</span>
                <button type="button" className="quiet icon-btn bottom-dock-close" onClick={() => setBottomPanelOpen(false)} aria-label="Close bottom panel">×</button>
              </div>
              <div className="bottom-dock-body">
                <p className="muted">Nothing here yet.</p>
              </div>
            </div>
          ) : null}
        </section>
        <aside className="panel right">
          {rightPanelOpen ? (
            activeThread ? (
              <div className="chat-dock">
                <div className="mini-chat-header">
                  <span className="mini-chat-title">{activeThread.title}</span>
                  <div className="mini-chat-header-actions">
                    <button type="button" className="quiet mini-chat-icon" onClick={() => openThreadEditor('edit', activeThread)} aria-label="Edit thread" title="Edit thread"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11.5 2.5a1.5 1.5 0 0 1 2.12 2.12L5 13.24l-3 .76.76-3 8.74-8.5z"/></svg></button>
                    <button type="button" className="quiet mini-chat-maximize" onClick={() => setRightPanelMaximized((current) => !current)} aria-label={rightPanelMaximized ? 'Restore chat panel width' : 'Widen chat panel'} title={rightPanelMaximized ? 'Restore' : 'Widen'}>{rightPanelMaximized ? '▢' : '□'}</button>
                    <button type="button" className="quiet mini-chat-close" onClick={() => setRightPanelOpen(false)} aria-label="Close chat">×</button>
                  </div>
                </div>
                <div className="chat-dock-meta">
                  <div className="chat-dock-meta-bar">
                    <button type="button" className="chat-dock-provider" onClick={() => setProviderMenuOpen((open) => !open)} aria-expanded={providerMenuOpen} aria-label="Thread AI provider" title="Thread AI provider">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>
                      <span className="chat-dock-provider-label">{activeProviderConfig ? `${activeProviderConfig.label} · ${activeProviderConfig.model || 'no model'}` : 'No AI profile'}</span>
                      <svg className={`chat-dock-caret ${providerMenuOpen ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 4 5 7 8 4"/></svg>
                    </button>
                    <span className="pill chat-dock-context" title="Context tokens remaining">{remainingContext.toLocaleString()} left</span>
                  </div>
                  {providerMenuOpen ? (
                    <div className="chat-dock-provider-menu">
                      {settings.providerConfigs.length === 0 ? (
                        <button type="button" className="mini-chat-add-profile" onClick={addProviderProfile}>Add AI profile to chat</button>
                      ) : (
                        <>
                          <label className="chat-dock-field">
                            <span>Profile</span>
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
                                <option key={config.id} value={config.id}>{config.label}</option>
                              ))}
                            </select>
                          </label>
                          {activeProviderConfig ? (
                            <label className="chat-dock-field">
                              <span>Model</span>
                              <select
                                value={activeProviderConfig.model}
                                onChange={(e) => updateProviderConfig(activeProviderConfig.id, { model: e.target.value })}
                              >
                                {settingsModels.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </label>
                          ) : null}
                          <button type="button" className="quiet chat-dock-manage" onClick={() => openProviderSetup()}>Manage profiles</button>
                        </>
                      )}
                    </div>
                  ) : null}
                  {selectedThreadUsage ? (
                    <details className="chat-dock-usage-summary">
                      <summary>
                        <span className="chat-dock-usage-caret" aria-hidden="true">▸</span>
                        <span className="chat-dock-usage-headline"><strong>{selectedThreadUsage.totalTokens.toLocaleString()}</strong> tokens</span>
                        <span className="chat-dock-usage-cost">${selectedThreadUsage.estimatedCostUsd.toFixed(4)}</span>
                      </summary>
                      <div className="usage-grid chat-dock-usage">
                        <div><span>Input</span><strong>{selectedThreadUsage.inputTokens.toLocaleString()}</strong></div>
                        <div><span>Output</span><strong>{selectedThreadUsage.outputTokens.toLocaleString()}</strong></div>
                        <div><span>Total</span><strong>{selectedThreadUsage.totalTokens.toLocaleString()}</strong></div>
                        <div><span>Cost est.</span><strong>${selectedThreadUsage.estimatedCostUsd.toFixed(4)}</strong></div>
                      </div>
                    </details>
                  ) : null}
                  {ttsVoices.length > 0 ? (
                    <details className="chat-dock-tts">
                      <summary>
                        <span className="chat-dock-usage-caret" aria-hidden="true">▸</span>
                        <span>Browser voice</span>
                      </summary>
                      <div className="chat-dock-tts-grid">
                        <label className="chat-dock-field">
                          <span>Voice</span>
                          <select
                            value={ttsSettings.voiceURI}
                            onChange={(event) => setTtsSettings((current) => ({ ...current, voiceURI: event.target.value }))}
                          >
                            <option value="">Browser default</option>
                            {ttsVoices.map((voice) => (
                              <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>
                            ))}
                          </select>
                        </label>
                        <label className="chat-dock-field">
                          <span>Speed {ttsSettings.rate.toFixed(2)}×</span>
                          <input
                            type="range"
                            min="0.75"
                            max="1.35"
                            step="0.05"
                            value={ttsSettings.rate}
                            onChange={(event) => setTtsSettings((current) => ({ ...current, rate: Number(event.target.value) }))}
                          />
                        </label>
                      </div>
                    </details>
                  ) : null}
                </div>
                <div className="mini-chat-messages" ref={rightPanelMessagesRef}>
                  {activeThread.context.length === 0 ? (
                    <p className="muted">No messages yet. Send the first one.</p>
                  ) : (
                    activeThread.context.map((message) =>
                      renderChatMessage(message, message.role === 'assistant' && activeThread.context[activeThread.context.length - 1]?.id === message.id),
                    )
                  )}
                  <div ref={rightPanelEndRef} className="chat-scroll-anchor" aria-hidden="true" />
                </div>
                {renderComposer({ fileInputId: 'file-upload', placeholder: 'Ask the thread something', onEscape: () => setRightPanelOpen(false), autoFocus: true })}
              </div>
            ) : (
              <div className="panel-empty">
                <p className="muted">Select a thread to start chatting.</p>
              </div>
            )
          ) : null}
        </aside>
        {leftPanelOpen ? (
          <div className="resize-handle resize-handle-left" role="separator" aria-orientation="vertical" aria-label="Resize left panel" onPointerDown={(event) => beginPanelResize('left', event)} onPointerMove={movePanelResize} onPointerUp={endPanelResize} onPointerCancel={endPanelResize} />
        ) : null}
        {rightPanelOpen && !rightPanelMaximized ? (
          <div className="resize-handle resize-handle-right" role="separator" aria-orientation="vertical" aria-label="Resize chat panel" onPointerDown={(event) => beginPanelResize('right', event)} onPointerMove={movePanelResize} onPointerUp={endPanelResize} onPointerCancel={endPanelResize} />
        ) : null}
        {bottomPanelOpen ? (
          <div className="resize-handle resize-handle-bottom" role="separator" aria-orientation="horizontal" aria-label="Resize bottom panel" onPointerDown={(event) => beginPanelResize('bottom', event)} onPointerMove={movePanelResize} onPointerUp={endPanelResize} onPointerCancel={endPanelResize} />
        ) : null}
      </main>
      </>
      )}

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


      {aiSettingsModalOpen ? (
        <div className="chat-modal-backdrop" onClick={() => { setAiSettingsModalOpen(false); setSettingsEditorConfigId(null); }}>
          <section className="ai-settings-modal" onClick={(event) => event.stopPropagation()}>
            <header className="chat-modal-header">
              <div>
                <p className="eyebrow">AI settings</p>
                <h2>Manage AI profiles</h2>
              </div>
              <button type="button" className="quiet" onClick={() => { setAiSettingsModalOpen(false); setSettingsEditorConfigId(null); }} aria-label="Close AI settings">
                ×
              </button>
            </header>
            <div className="chat-modal-body">
              <section className="inspector-card settings-card">
                <div className="profile-tabs" role="tablist" aria-label="AI profiles">
                  {settings.providerConfigs.map((config) => (
                    <button
                      key={config.id}
                      type="button"
                      role="tab"
                      aria-selected={config.id === settingsEditorConfig?.id}
                      className={`profile-tab ${config.id === settingsEditorConfig?.id ? 'selected' : ''}`}
                      onClick={() => setSettingsEditorConfigId(config.id)}
                    >
                      {config.label}
                    </button>
                  ))}
                  <button type="button" className="profile-tab profile-tab-add" onClick={addProviderProfile} aria-label="Add AI profile">
                    + New
                  </button>
                </div>
                {settingsEditorConfig ? (
                  <>
                    <label className="field">
                      Provider
                      <select
                        autoFocus
                        value={settingsEditorConfig.kind}
                        onChange={(event) => {
                          const kind = event.target.value as AIProvider;
                          const info = providerInfo(kind);
                          const patch = {
                            kind,
                            label: autoProfileLabel(kind, settingsEditorConfig.label),
                            model: '',
                            baseUrl: info.baseUrl,
                          };
                          updateProviderConfig(settingsEditorConfig.id, patch);
                          void fetchModelsForConfig({ ...settingsEditorConfig, ...patch }, { requireKey: false, updateSelectedModel: true });
                        }}
                      >
                        {PROVIDERS.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {settingsEditorConfig.kind === 'openai-compatible-custom' ? (
                      <>
                        <label className="field">
                          Profile name
                          <input
                            value={settingsEditorConfig.label}
                            onChange={(event) => updateProviderConfig(settingsEditorConfig.id, { label: event.target.value })}
                            placeholder="e.g. Local Llama"
                          />
                        </label>
                        <label className="field">
                          Base URL
                          <input
                            value={settingsEditorConfig.baseUrl ?? ''}
                            onChange={(event) => updateProviderConfig(settingsEditorConfig.id, { baseUrl: event.target.value })}
                            onBlur={(event) => {
                              void fetchModelsForConfig(
                                { ...settingsEditorConfig, baseUrl: event.target.value },
                                { requireKey: false, updateSelectedModel: true },
                              );
                            }}
                            placeholder="https://api.example.com/v1"
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </label>
                      </>
                    ) : null}
                    <label className="field">
                      <span className="field-label-row">
                        <span>{providerInfo(settingsEditorConfig.kind).label} API key</span>
                        <span className={`pill settings-pill ${settingsEditorLockState}`}>
                          {settingsEditorLockState === 'none' ? 'no saved key' : settingsEditorLockState === 'unlocked' ? 'unlocked' : 'locked'}
                        </span>
                      </span>
                      <input
                        type="password"
                        value={settingsEditorConfig.apiKey}
                        onChange={(event) => updateProviderConfig(settingsEditorConfig.id, { apiKey: event.target.value })}
                        onBlur={(event) => {
                          void fetchModelsForConfig(
                            { ...settingsEditorConfig, apiKey: event.target.value },
                            { requireKey: false, updateSelectedModel: true },
                          );
                        }}
                        placeholder={settingsEditorConfig.hasEncryptedApiKey && !settingsEditorConfig.apiKey ? 'saved key — tap Unlock to load' : apiKeyPlaceholder(settingsEditorConfig.kind)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {providerKeyLink(settingsEditorConfig.kind) ? (
                        <a
                          className="key-signup-link"
                          href={providerKeyLink(settingsEditorConfig.kind)!.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {providerKeyLink(settingsEditorConfig.kind)!.label} →
                        </a>
                      ) : null}
                    </label>
                    <div className="editor-actions left-aligned">
                      <button type="button" onClick={() => requestSaveKey(settingsEditorConfig.id)} disabled={savingSettings}>
                        {savingSettings
                          ? 'Working…'
                          : settingsEditorConfig.apiKey.trim()
                            ? settingsEditorConfig.hasEncryptedApiKey ? 'Update saved key' : 'Save key'
                            : settingsEditorConfig.hasEncryptedApiKey ? 'Unlock saved key' : 'Save key'}
                      </button>
                      <button
                        type="button"
                        className="quiet btn-danger"
                        onClick={() => deleteSavedKey(settingsEditorConfig.id)}
                        disabled={savingSettings || !settingsEditorConfig.hasEncryptedApiKey}
                      >
                        Delete saved key
                      </button>
                    </div>
                    <label className="field">
                      Model
                      <select
                        value={settingsEditorConfig.model}
                        onChange={(event) => updateProviderConfig(settingsEditorConfig.id, { model: event.target.value })}
                      >
                        {settingsEditorModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="editor-actions left-aligned">
                      <button
                        type="button"
                        onClick={() => refreshModels(settingsEditorConfig.id)}
                        disabled={settingsEditorModelsLoading || !settingsEditorConfig.apiKey.trim()}
                      >
                        {settingsEditorModelsLoading ? 'Loading models…' : settingsEditorHasCachedModels ? 'Refresh models' : 'List models'}
                      </button>
                    </div>
                    {providerError ? <p className="error">{providerError}</p> : null}
                    {settingsNotice ? <p className="muted">{settingsNotice}</p> : null}
                    <div className="settings-profile-footer">
                      <button type="button" className="quiet btn-danger" onClick={() => deleteProfile(settingsEditorConfig.id)}>
                        Delete this profile
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="profile-list-empty">
                    <p>No AI profiles yet. Add one to start chatting.</p>
                    <button type="button" className="profile-list-empty-cta" onClick={addProviderProfile}>
                      Add AI profile
                    </button>
                  </div>
                )}
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
            <form className="chat-modal-body" onSubmit={(event) => { event.preventDefault(); submitThreadEditor(); }}>
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
                <button type="submit">{threadEditorMode === 'create' ? 'Create thread' : 'Save changes'}</button>
                <button type="button" className="quiet" onClick={closeThreadEditor}>
                  Cancel
                </button>
              </div>
            </form>
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
                      removeProfile(target);
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

// Convert a single attachment into an OpenAI chat-completions content part.
// Images use image_url, PDFs use the `file` part, and text documents are inlined as text.
function attachmentToOpenAIPart(attachment: MediaAttachment) {
  if (attachment.type === 'image') {
    return { type: 'image_url', image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` } };
  }
  if (attachment.mimeType === 'application/pdf') {
    return { type: 'file', file: { filename: attachment.filename, file_data: `data:application/pdf;base64,${attachment.data}` } };
  }
  return { type: 'text', text: `Attached file "${attachment.filename}":\n\n${decodeBase64Text(attachment.data)}` };
}

// Helper function to convert ChatMessage to OpenAI API format
function formatMessageForOpenAI(message: ChatMessage) {
  const role = message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user';
  const attachments = message.content?.attachments ?? [];
  if (!message.content || message.content.type === 'text' || attachments.length === 0) {
    return { role, content: getMessageText(message) };
  }

  const content: unknown[] = [];
  if (message.content.text) content.push({ type: 'text', text: message.content.text });
  for (const attachment of attachments) content.push(attachmentToOpenAIPart(attachment));
  return { role, content };
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

function autoProfileLabel(kind: AIProvider, current: string): string {
  if (kind !== 'openai-compatible-custom') return providerInfo(kind).label;
  const presetLabels = PROVIDERS.map((entry) => entry.label);
  const trimmed = current.trim();
  return trimmed && trimmed !== 'New profile' && !presetLabels.includes(trimmed) ? trimmed : 'Custom provider';
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

// Convert a single attachment into an Anthropic content block.
// Images and PDFs use base64 source blocks; text documents are inlined as text.
function attachmentToAnthropicPart(attachment: MediaAttachment) {
  if (attachment.type === 'image') {
    return { type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.data } };
  }
  if (attachment.mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.data } };
  }
  return { type: 'text', text: `Attached file "${attachment.filename}":\n\n${decodeBase64Text(attachment.data)}` };
}

// Helper function to convert ChatMessage to Anthropic API format
function formatMessageForAnthropic(message: ChatMessage) {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const attachments = message.content?.attachments ?? [];
  if (!message.content || message.content.type === 'text' || attachments.length === 0) {
    return { role, content: getMessageText(message) };
  }

  const content: unknown[] = [];
  if (message.content.text) content.push({ type: 'text', text: message.content.text });
  for (const attachment of attachments) content.push(attachmentToAnthropicPart(attachment));
  return { role, content };
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

function FormattedMessage({ text, rich = false }: { text: string; rich?: boolean }) {
  return (
    <div className="message-copy">
      <Markdown components={rich ? { code: CodeBlock } : undefined}>{text}</Markdown>
    </div>
  );
}

function CodeBlock({ inline, className, children, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const value = String(children ?? '').replace(/\n$/, '');
  const language = /language-(\w+)/.exec(className ?? '')?.[1];

  if (inline) {
    return <code className={className} {...props}>{children}</code>;
  }

  async function copyCode() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="code-block-shell">
      <div className="code-block-header">
        <span>{language ?? 'code'}</span>
        <button type="button" onClick={copyCode}>{copied ? 'Copied' : 'Copy code'}</button>
      </div>
      <pre className={className}><code {...props}>{value}</code></pre>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
