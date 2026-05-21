import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import Markdown from 'react-markdown';
import {
  PROVIDERS,
  appendChatToThread,
  clearProviderSecret,
  clearSettingsCookies,
  computeMetrics,
  createChatNode,
  createProviderConfig,
  createThread,
  deleteProviderConfig,
  estimateCost,
  fetchProviderModels,
  getModelWindow,
  loadSettings,
  loadWorkspace,
  providerInfo,
  saveProviderSecret,
  saveSettings,
  saveWorkspace,
  summarizeThreadUsage,
  threadWithActiveNode,
  threadWithInfo,
  unlockProviderSecret,
  updateThreadDetails,
  updateThreadTitle,
} from './lib/store';
import type {
  AIProvider,
  AIProviderConfig,
  AISettings,
  ChatMessage,
  LoomspaceState,
  ThreadChatNode,
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
const CHAT_HEIGHT = 92;
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

export default function App() {
  const [state, setState] = useState<LoomspaceState>(() => loadWorkspace());
  const [settings, setSettings] = useState<AISettings>(() => loadSettings());
  const [composerDraft, setComposerDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [passphraseModal, setPassphraseModal] = useState<{ mode: 'encrypt' | 'unlock'; passphrase: string; busy: boolean; pendingKey?: string; targetConfigId?: string } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [miniChatOpen, setMiniChatOpen] = useState(false);
  const [aiSettingsModalOpen, setAiSettingsModalOpen] = useState(false);
  const miniChatMessagesRef = useRef<HTMLDivElement>(null);
  const [threadEditorOpen, setThreadEditorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [threadEditorMode, setThreadEditorMode] = useState<'create' | 'edit'>('create');
  const [threadEditorDraft, setThreadEditorDraft] = useState<ThreadDraft>(DEFAULT_THREAD_DRAFT);
  const [threadEditorTargetId, setThreadEditorTargetId] = useState<string | null>(null);
  const [modelCache, setModelCache] = useState<ModelCache>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panGesture = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const pointerMap = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{ dist: number; zoom: number } | null>(null);
  const spaceHeld = useRef(false);
  const ctrlHeld = useRef(false);
  const [panMode, setPanMode] = useState<'idle' | 'ready' | 'panning'>('idle');

  useEffect(() => saveWorkspace(state), [state]);
  useEffect(() => saveSettings(settings), [settings]);

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
    setSidebarOpen(false);
    setState((current) => ({
      ...current,
      selectedThreadId: threadId,
      selectedNodeId: nodeId ?? current.threads.find((thread) => thread.id === threadId)?.activeNodeId ?? null,
      threads: current.threads.map((thread) =>
        thread.id === threadId
          ? threadWithActiveNode(thread, nodeId ?? thread.activeNodeId)
          : threadWithActiveNode(thread, thread.activeNodeId),
      ),
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

  function closeThreadEditor() {
    setThreadEditorOpen(false);
  }

  function submitThreadEditor() {
    const title = threadEditorDraft.title.trim() || 'Untitled thread';
    const description = threadEditorDraft.description.trim() || 'A new lane for a project idea and its AI chat context.';

    if (threadEditorMode === 'create') {
      const thread = createThread(title, description, state.threads.length, {
        initialModel: activeProviderConfig?.model,
      });
      setState((current) => ({
        ...current,
        version: current.version + 1,
        threads: [...current.threads, thread],
        selectedThreadId: thread.id,
        selectedNodeId: thread.activeNodeId,
        panX: current.threads.length === 0 ? current.panX : current.panX - 40,
      }));
      setChatModalOpen(true);
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

  async function sendMessage() {
    if (!activeThread || !activeNodeIsChat || !composerDraft.trim() || sending) return;
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
    const userMessage: ChatMessage = { id: `msg-${crypto.randomUUID().slice(0, 8)}`, role: 'user', text: userText };

    setSending(true);
    setError(null);
    setComposerDraft('');

    try {
      const { assistantText, usage } = await requestAiReply(activeConfig, activeThread, [...activeThread.context, userMessage]);
      const assistantMessage: ChatMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'assistant',
        text: assistantText,
      };
      const newChatNode = createChatNode(`${userText} → ${assistantText}`, 'medium', [userMessage, assistantMessage], activeConfig.model, usage);

      setState((current) => ({
        ...current,
        version: current.version + 1,
        threads: current.threads.map((thread) =>
          thread.id === activeThread.id ? appendChatToThread(thread, newChatNode, [userMessage, assistantMessage]) : thread,
        ),
        selectedThreadId: activeThread.id,
        selectedNodeId: newChatNode.id,
      }));
    } catch (err) {
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
      threads: current.threads.map((thread) =>
        thread.id === threadId ? threadWithActiveNode(thread, nodeId) : threadWithActiveNode(thread, thread.activeNodeId),
      ),
    }));
  }

  function deselectNode() {
    setState((current) => ({ ...current, selectedNodeId: null }));
    setMiniChatOpen(false);
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
    const cached = modelCache[providerConfigId];
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
      setModelCache((current) => ({ ...current, [providerConfigId]: ids }));
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
      zoomAt(event.clientX, event.clientY, state.zoom - event.deltaY * 0.0015);
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
          <button onClick={() => openThreadEditor('create')}>New thread</button>
          <button onClick={() => zoomFromButton(-1)} aria-label="Zoom out">−</button>
          <button onClick={resetView} className="topbar-reset-view">Reset view</button>
          <button onClick={() => zoomFromButton(1)} aria-label="Zoom in">+</button>
          <input
            className="zoom-slider"
            type="range"
            min={Math.round(MIN_ZOOM * 100)}
            max={Math.round(MAX_ZOOM * 100)}
            value={Math.round(state.zoom * 100)}
            onChange={(event) => setZoom(Number(event.target.value) / 100)}
          />
          <button onClick={resetWorkspace} className="quiet topbar-reset-fabric">
            Reset fabric
          </button>
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
                <button className="quiet" onClick={() => openThreadEditor('edit', activeThread)}>
                  Edit thread
                </button>
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
                    const next = createProviderConfig('openai-compatible-custom', { label: 'New profile' });
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
                      const next = createProviderConfig('openai-compatible-custom', { label: 'New profile' });
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
              </svg>

              {lanes.map((lane) => {
                const thread = lane.thread;
                const isActiveLane = thread.id === activeThread?.id;
                return (
                  <div
                    key={thread.id}
                    className={`thread-lane ${isActiveLane ? 'active' : ''}`}
                    style={{ left: lane.centerX - NODE_WIDTH / 2, top: 0, width: NODE_WIDTH, height: lane.height }}
                  >
                    {lane.nodes.map(({ node, top }) => {
                      if (node.kind === 'title') {
                        const titleNode = node;
                        return (
                          <div key={node.id} className={`title-node-wrap ${thread.infoOpen ? 'open' : ''}`} style={{ top }}>
                            <article className="title-node">
                              <div className="title-node-head">
                                <input value={titleNode.title} onChange={(event) => updateTitle(thread.id, event.target.value)} onFocus={() => selectThread(thread.id, node.id)} />
                                <button type="button" className="info-button" onClick={() => toggleInfo(thread.id)} aria-label="Thread info">
                                  ⓘ
                                </button>
                              </div>
                              {thread.infoOpen ? <p className="thread-popout">{titleNode.description}</p> : null}
                            </article>
                          </div>
                        );
                      }

                      const chatNode = node;
                      const isSelected = node.id === activeNode?.id;
                      return (
                        <div key={node.id} style={{ position: 'absolute', top, left: 0 }}>
                          <button
                            className={`chat-node ${isSelected ? 'selected' : ''} ${sending && isSelected ? 'sending' : ''}`}
                            style={{ position: 'relative', top: 0, left: 0 }}
                            onClick={(e) => { e.stopPropagation(); selectNode(thread.id, node.id); }}
                          >
                            <div className="exchange-head">
                              <span>AI chat</span>
                              <span className={`confidence ${chatNode.confidence}`}>{chatNode.confidence}</span>
                            </div>
                            <strong>{chatNode.summary}</strong>
                            <small>{chatNode.model}</small>
                          </button>
                          {isSelected && (
                            <>
                              <div className="action-line-h" style={{ top: CHAT_HEIGHT / 2, left: -36 }} />
                              <button className="action-dot" style={{ top: CHAT_HEIGHT / 2 - 12, left: -60 }} aria-label="Left action" onClick={(e) => e.stopPropagation()} />
                              <div className="action-line-h" style={{ top: CHAT_HEIGHT / 2, left: NODE_WIDTH }} />
                              <button className="action-dot" style={{ top: CHAT_HEIGHT / 2 - 12, left: NODE_WIDTH + 36 }} aria-label="Right action" onClick={(e) => e.stopPropagation()} />
                              <div className="action-line-v" style={{ top: CHAT_HEIGHT, left: NODE_WIDTH / 2 }} />
                              <button
                                className="action-dot bottom"
                                style={{ top: CHAT_HEIGHT + 36, left: NODE_WIDTH / 2 - 12 }}
                                aria-label="Open chat"
                                onClick={(e) => { e.stopPropagation(); setMiniChatOpen(true); }}
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            {lanes.length === 0 ? (
              <div className="empty-state">
                <p className="eyebrow">Canvas idle</p>
                <h2>Start a thread to begin the weave</h2>
                <p>The first thread centers itself. New threads line up to the right.</p>
                <button onClick={() => openThreadEditor('create')}>Create first thread</button>
              </div>
            ) : null}
          </div>

          {miniChatOpen && activeThread ? (
            <div className="mini-chat">
              <div className="mini-chat-header">
                <span className="mini-chat-title">{activeThread.title}</span>
                <button type="button" className="quiet mini-chat-close" onClick={() => setMiniChatOpen(false)} aria-label="Close chat">×</button>
              </div>
              <div className="mini-chat-messages" ref={miniChatMessagesRef}>
                {activeThread.context.length === 0 ? (
                  <p className="muted">No messages yet. Send the first one.</p>
                ) : (
                  activeThread.context.map((message) => (
                    <div key={message.id} className={`bubble ${message.role}`}>
                      <strong>{message.role === 'assistant' ? 'ai' : message.role}</strong>
                      <FormattedMessage text={message.text} />
                    </div>
                  ))
                )}
              </div>
              <div className="mini-chat-composer">
                <textarea
                  value={composerDraft}
                  onChange={(e) => setComposerDraft(e.target.value)}
                  placeholder="Ask the thread something"
                  rows={3}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendMessage(); }}
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
                  <span className="pill mini-chat-model">{activeProviderConfig?.model ?? '—'}</span>
                  <button
                    className="mini-chat-send"
                    onClick={sendMessage}
                    disabled={!composerDraft.trim() || sending || !activeProviderConfig?.apiKey.trim()}
                  >
                    {sending ? '…' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </main>

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
                  <button className="quiet" onClick={() => openThreadEditor('edit', activeThread)}>
                    Edit thread
                  </button>
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
                  <button type="button" className="quiet" onClick={() => setAiSettingsModalOpen(true)}>
                    Manage AI settings
                  </button>
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
                    <div key={message.id} className={`bubble ${message.role}`}>
                      <strong>{message.role === 'assistant' ? 'ai' : message.role}</strong>
                      <FormattedMessage text={message.text} />
                    </div>
                  ))
                )}
              </section>

              {activeNodeIsChat ? (
                <section className="inspector-card send-card">
                  <h4>Send to AI</h4>
                  <textarea
                    value={composerDraft}
                    onChange={(event) => setComposerDraft(event.target.value)}
                    placeholder="Ask the thread something"
                    rows={5}
                  />
                  {settingsLockState === 'locked' ? <p className="muted">Unlock the active AI profile to send a message.</p> : null}
                  {error ? <p className="error">{error}</p> : null}
                  <button onClick={sendMessage} disabled={!composerDraft.trim() || sending || !activeProviderConfig?.apiKey.trim()}>
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
                <div className="meta-row">
                  <h4>Active profile</h4>
                  <span className={`pill settings-pill ${settingsLockState}`}>
                    {settingsLockState === 'none' ? 'no saved key' : settingsLockState === 'unlocked' ? 'unlocked for session' : 'saved, locked'}
                  </span>
                </div>
                <label className="field">
                  Profile
                  <select
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
                <div className="editor-actions left-aligned">
                  <button
                    type="button"
                    onClick={() => {
                      const next = createProviderConfig('openai-compatible-custom', { label: 'New profile' });
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
                    className="quiet"
                    onClick={() => activeProviderConfig && deleteProfile(activeProviderConfig.id)}
                    disabled={!activeProviderConfig}
                  >
                    Delete profile
                  </button>
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
                            model: info.defaultModel,
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
                        className="quiet"
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
  const cached = cache[config.id];
  const fallback = providerInfo(config.kind).defaultModel;
  const base = cached && cached.length > 0 ? cached : [fallback];
  if (currentModel && !base.includes(currentModel)) {
    return [currentModel, ...base];
  }
  return base;
}

async function requestAiReply(config: AIProviderConfig, thread: ThreadLane, messages: ChatMessage[]) {
  if (config.kind === 'anthropic') return requestAnthropic(config, thread, messages);
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

async function requestOpenAiCompatible(config: AIProviderConfig, thread: ThreadLane, messages: ChatMessage[]) {
  const baseUrl = resolveBaseUrl(config.baseUrl, config.kind);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT(thread) },
        ...messages.map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
          content: message.text,
        })),
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${config.label} request failed`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const assistantText = data.choices?.[0]?.message?.content?.trim();
  if (!assistantText) throw new Error(`${config.label} returned no assistant text`);

  const usage = data.usage
    ? normalizeUsage(config.model, data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0, data.usage.total_tokens ?? 0)
    : undefined;

  return { assistantText, usage };
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
        .map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.text,
        })),
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
