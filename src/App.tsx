import { useEffect, useMemo, useRef, useState } from 'react';
import {
  appendChatToThread,
  clearSecretCookie,
  clearSettingsCookies,
  computeMetrics,
  createChatNode,
  createThread,
  loadSettings,
  loadWorkspace,
  saveSettings,
  saveWorkspace,
  threadWithActiveNode,
  threadWithInfo,
  unlockApiKey,
  updateThreadTitle,
} from './lib/store';
import type { ChatMessage, LoomspaceState, OpenAISettings, ThreadChatNode, ThreadLane, ThreadNode } from './lib/types';

const LANE_WIDTH = 320;
const LANE_GAP = 56;
const LEFT_PAD = 64;
const TOP_PAD = 28;
const TITLE_HEIGHT = 66;
const TITLE_INFO_EXTRA = 84;
const CHAT_HEIGHT = 92;
const NODE_GAP = 30;
const NODE_WIDTH = 232;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.6;
const EDGE_PADDING = 80;

export default function App() {
  const [state, setState] = useState<LoomspaceState>(() => loadWorkspace());
  const [settings, setSettings] = useState<OpenAISettings>(() => loadSettings());
  const [threadTitleDraft, setThreadTitleDraft] = useState('');
  const [threadDescriptionDraft, setThreadDescriptionDraft] = useState('');
  const [composerDraft, setComposerDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [passphraseDraft, setPassphraseDraft] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panGesture = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  useEffect(() => saveWorkspace(state), [state]);

  const metrics = useMemo(() => computeMetrics(state), [state]);
  const activeThread = state.threads.find((thread) => thread.id === state.selectedThreadId) ?? state.threads[0] ?? null;
  const activeNode = activeThread?.nodes.find((node) => node.id === state.selectedNodeId) ?? activeThread?.nodes.at(-1) ?? null;
  const settingsLockState = settings.hasEncryptedApiKey ? (settings.apiKey.trim() ? 'unlocked' : 'locked') : 'none';

  const canvasWidth = Math.max(
    1280,
    LEFT_PAD * 2 + Math.max(0, state.threads.length - 1) * (LANE_WIDTH + LANE_GAP) + LANE_WIDTH,
  );

  const lanes = useMemo(() => {
    return state.threads.map((thread, index) => {
      const centerX = state.threads.length === 1 ? canvasWidth / 2 : LEFT_PAD + index * (LANE_WIDTH + LANE_GAP) + LANE_WIDTH / 2;
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

  const canvasHeight = Math.max(720, ...lanes.map((lane) => lane.height));

  useEffect(() => {
    clampViewport();
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    const onResize = () => clampViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [canvasWidth, canvasHeight]);

  function clampViewport(next?: Partial<Pick<LoomspaceState, 'panX' | 'panY' | 'zoom'>>) {
    const viewport = viewportRef.current;
    const width = viewport?.clientWidth ?? window.innerWidth;
    const height = viewport?.clientHeight ?? window.innerHeight;
    const zoom = clamp(next?.zoom ?? state.zoom, MIN_ZOOM, MAX_ZOOM);
    const panX = next?.panX ?? state.panX;
    const panY = next?.panY ?? state.panY;
    const nextBounds = boundedPan(panX, panY, zoom, width, height, canvasWidth, canvasHeight);
    if (
      nextBounds.panX === state.panX &&
      nextBounds.panY === state.panY &&
      zoom === state.zoom &&
      !next
    ) {
      return;
    }
    setState((current) => ({ ...current, ...nextBounds, zoom }));
  }

  function selectThread(threadId: string, nodeId?: string | null) {
    setChatModalOpen(true);
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

  function createNewThread() {
    const title = threadTitleDraft.trim() || `Thread ${state.threads.length + 1}`;
    const description = threadDescriptionDraft.trim() || 'A new lane for a project idea and its AI chat context.';
    const thread = createThread(title, description, state.threads.length);
    const firstChat = thread.nodes.find((node): node is ThreadChatNode => node.kind === 'chat') ?? null;

    setState((current) => ({
      ...current,
      version: current.version + 1,
      threads: [...current.threads, thread],
      selectedThreadId: thread.id,
      selectedNodeId: firstChat?.id ?? null,
      panX: current.threads.length === 0 ? current.panX : current.panX - 40,
    }));
    setChatModalOpen(true);

    setThreadTitleDraft('');
    setThreadDescriptionDraft('');
    setComposerDraft('');
    setError(null);
  }

  async function sendMessage() {
    if (!activeThread || !composerDraft.trim() || sending) return;
    if (!settings.apiKey.trim()) {
      setError('Add your OpenAI API key in settings first.');
      return;
    }

    const userText = composerDraft.trim();
    const userMessage: ChatMessage = { id: `msg-${crypto.randomUUID().slice(0, 8)}`, role: 'user', text: userText };

    setSending(true);
    setError(null);
    setComposerDraft('');

    try {
      const assistantText = await requestAiReply(settings, activeThread, [...activeThread.context, userMessage]);
      const assistantMessage: ChatMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'assistant',
        text: assistantText,
      };
      const newChatNode = createChatNode(`${userText} → ${assistantText}`, 'medium', [userMessage, assistantMessage]);

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
    setChatModalOpen(true);
    setState((current) => ({
      ...current,
      selectedThreadId: threadId,
      selectedNodeId: nodeId,
      threads: current.threads.map((thread) =>
        thread.id === threadId ? threadWithActiveNode(thread, nodeId) : threadWithActiveNode(thread, thread.activeNodeId),
      ),
    }));
  }

  async function unlockStoredKey() {
    if (!settings.hasEncryptedApiKey) {
      setSettingsNotice('No encrypted key is stored yet.');
      return;
    }

    try {
      const apiKey = await unlockApiKey(passphraseDraft);
      setSettings((current) => ({ ...current, apiKey, hasEncryptedApiKey: true }));
      setSettingsNotice('API key unlocked in memory.');
      setError(null);
    } catch (err) {
      setSettings((current) => ({ ...current, apiKey: '' }));
      setError(err instanceof Error ? err.message : 'Unable to unlock the API key.');
    }
  }

  async function saveSecureSettings() {
    setSavingSettings(true);
    setError(null);
    try {
      await saveSettings(settings, passphraseDraft);
      const hasKey = Boolean(settings.apiKey.trim());
      setSettings((current) => ({
        ...current,
        apiKey: '',
        hasEncryptedApiKey: hasKey ? true : current.hasEncryptedApiKey,
      }));
      setSettingsNotice(hasKey ? 'Encrypted API key saved to cookies and cleared from memory.' : 'Provider and model saved to cookies.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save encrypted settings.');
    } finally {
      setSavingSettings(false);
    }
  }

  function forgetUnlockedKey() {
    setSettings((current) => ({ ...current, apiKey: '' }));
    setSettingsNotice('Cleared from memory. The encrypted cookie stays put until you overwrite it.');
  }

  function lockNow() {
    setSettings((current) => ({ ...current, apiKey: '' }));
    setSettingsNotice('Locked. The encrypted key stays in the cookie.');
  }

  function removeStoredKey() {
    clearSecretCookie();
    setSettings((current) => ({ ...current, apiKey: '', hasEncryptedApiKey: false }));
    setSettingsNotice('Encrypted API key removed from cookies.');
  }

  function resetWorkspace() {
    localStorage.removeItem('loomspace.workspace.v5');
    clearSettingsCookies();
    setState(loadWorkspace());
    setSettings(loadSettings());
    setThreadTitleDraft('');
    setThreadDescriptionDraft('');
    setComposerDraft('');
    setPassphraseDraft('');
    setSettingsNotice(null);
    setError(null);
    setChatModalOpen(false);
  }

  function beginPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    panGesture.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: state.panX,
      panY: state.panY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>) {
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

  function endPan() {
    panGesture.current = null;
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
      Math.max(0, (rect.width - canvasWidth) / 2),
      Math.max(0, (rect.height - canvasHeight) / 2),
      1,
      rect.width,
      rect.height,
      canvasWidth,
      canvasHeight,
    );
    setState((current) => ({ ...current, zoom: 1, ...centered }));
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Loomspace</p>
          <h1>{state.title}</h1>
        </div>
        <div className="topbar-actions">
          <button onClick={createNewThread}>New thread</button>
          <button onClick={() => zoomFromButton(-1)}>−</button>
          <button onClick={resetView}>Reset view</button>
          <button onClick={() => zoomFromButton(1)}>+</button>
          <input
            className="zoom-slider"
            type="range"
            min={Math.round(MIN_ZOOM * 100)}
            max={Math.round(MAX_ZOOM * 100)}
            value={Math.round(state.zoom * 100)}
            onChange={(event) => setZoom(Number(event.target.value) / 100)}
          />
          <button onClick={resetWorkspace} className="quiet">
            Reset fabric
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="panel left">
          <section className="metric-card accent">
            <span>Threads</span>
            <strong>{metrics.threadCount}</strong>
          </section>
          <section className="metric-card">
            <span>Nodes</span>
            <strong>{metrics.nodeCount}</strong>
          </section>
          <section className="metric-card">
            <span>Chats</span>
            <strong>{metrics.chatCount}</strong>
          </section>
          <section className="metric-card">
            <span>Density</span>
            <strong>{metrics.density.toFixed(2)}</strong>
          </section>

          <h2>Create thread</h2>
          <label className="field">
            Thread title
            <input value={threadTitleDraft} onChange={(event) => setThreadTitleDraft(event.target.value)} placeholder="e.g. deployment plan" />
          </label>
          <label className="field">
            Thread description
            <textarea
              value={threadDescriptionDraft}
              onChange={(event) => setThreadDescriptionDraft(event.target.value)}
              placeholder="Why this thread exists"
              rows={4}
            />
          </label>
          <button onClick={createNewThread}>Create thread</button>

          <h2>Threads</h2>
          <div className="thread-list">
            {state.threads.length === 0 ? <p className="muted">No threads yet.</p> : null}
            {state.threads.map((thread) => (
              <button
                key={thread.id}
                className={`thread-chip ${thread.id === activeThread?.id ? 'selected' : ''}`}
                style={{ borderColor: thread.color }}
                onClick={() => selectThread(thread.id, thread.activeNodeId)}
              >
                <span className="dot" style={{ background: thread.color }} />
                <span>
                  {thread.title}
                  <small>{thread.description}</small>
                </span>
                <small>{thread.nodes.length} nodes</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <span>{state.densityOverlay ? 'Threadlines on' : 'Threadlines off'}</span>
            <span>{Math.round(state.zoom * 100)}%</span>
            <span>{metrics.saturation * 100 < 50 ? 'light weave' : 'dense weave'}</span>
          </div>

          <div
            ref={viewportRef}
            className={`canvas-viewport ${state.densityOverlay ? 'overlay' : ''}`}
            onWheel={onWheel}
          >
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
            >
              {lanes.length === 0 ? (
                <div className="empty-state">
                  <p className="eyebrow">Canvas idle</p>
                  <h2>Start a thread to begin the weave</h2>
                  <p>The first thread centers itself. New threads line up to the right.</p>
                  <button onClick={createNewThread}>Create first thread</button>
                </div>
              ) : null}

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
                                <input
                                  value={titleNode.title}
                                  onChange={(event) => updateTitle(thread.id, event.target.value)}
                                  onFocus={() => selectThread(thread.id, node.id)}
                                />
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
                        <button
                          key={node.id}
                          className={`chat-node ${isSelected ? 'selected' : ''}`}
                          style={{ top, left: 0 }}
                          onClick={() => selectNode(thread.id, node.id)}
                        >
                          <div className="exchange-head">
                            <span>AI chat</span>
                            <span className={`confidence ${chatNode.confidence}`}>{chatNode.confidence}</span>
                          </div>
                          <strong>{chatNode.summary}</strong>
                          <small>{chatNode.messages.length ? `${chatNode.messages.length} messages` : 'ready'}</small>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
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
                <h3>{activeThread.description}</h3>
                <p>{activeThread.nodes.length} nodes in this lane.</p>
              </article>

              <section className="chat-panel">
                {activeThread.context.length === 0 ? (
                  <p className="muted">No messages yet. Send the first one.</p>
                ) : (
                  activeThread.context.map((message) => (
                    <div key={message.id} className={`bubble ${message.role}`}>
                      <strong>{message.role}</strong>
                      <FormattedMessage text={message.text} />
                    </div>
                  ))
                )}
              </section>

              <section className="inspector-card">
                <h4>Send to AI</h4>
                <textarea
                  value={composerDraft}
                  onChange={(event) => setComposerDraft(event.target.value)}
                  placeholder="Ask the thread something"
                  rows={5}
                />
                {error ? <p className="error">{error}</p> : null}
                <button onClick={sendMessage} disabled={!composerDraft.trim() || sending}>
                  {sending ? 'Thinking…' : 'Send'}
                </button>
              </section>

              {activeNode?.kind === 'chat' ? (
                <section className="inspector-card">
                  <h4>Selected node</h4>
                  <p>{activeNode.summary}</p>
                  <ul>
                    <li>{activeNode.messages.length} messages</li>
                    <li>{activeNode.createdAt.slice(0, 10)}</li>
                  </ul>
                </section>
              ) : null}

              <section className="inspector-card settings-card">
                <div className="meta-row">
                  <h4>AI settings</h4>
                  <span className={`pill settings-pill ${settingsLockState}`}>{settingsLockState === 'none' ? 'no stored key' : settingsLockState}</span>
                </div>
                <label className="field">
                  AI provider
                  <select
                    value={settings.provider}
                    onChange={(event) => setSettings((current) => ({ ...current, provider: event.target.value as OpenAISettings['provider'] }))}
                  >
                    <option value="openai">OpenAI</option>
                  </select>
                </label>
                <label className="field">
                  Model
                  <input
                    value={settings.model}
                    onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))}
                    placeholder="gpt-4o-mini"
                  />
                </label>
                <label className="field">
                  Passphrase
                  <input
                    type="password"
                    value={passphraseDraft}
                    onChange={(event) => setPassphraseDraft(event.target.value)}
                    placeholder="unlock / encrypt the API key"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  OpenAI API key
                  <input
                    type="password"
                    value={settings.apiKey}
                    onChange={(event) => setSettings((current) => ({ ...current, apiKey: event.target.value }))}
                    placeholder={settings.hasEncryptedApiKey ? 'locked in cookie — unlock to load' : 'sk-...'}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <div className="editor-actions left-aligned">
                  <button type="button" onClick={unlockStoredKey} disabled={savingSettings || !settings.hasEncryptedApiKey}>
                    Unlock key
                  </button>
                  <button type="button" onClick={lockNow} disabled={savingSettings || !settings.apiKey.trim()}>
                    Lock now
                  </button>
                  <button type="button" onClick={forgetUnlockedKey} disabled={savingSettings || !settings.apiKey.trim()}>
                    Forget from memory
                  </button>
                  <button type="button" onClick={removeStoredKey} disabled={savingSettings || !settings.hasEncryptedApiKey}>
                    Remove stored key
                  </button>
                  <button type="button" onClick={saveSecureSettings} disabled={savingSettings}>
                    {savingSettings ? 'Saving…' : settings.hasEncryptedApiKey ? 'Update encrypted settings' : 'Save encrypted settings'}
                  </button>
                </div>
                {settingsNotice ? <p className="muted">{settingsNotice}</p> : <p className="muted">The API key is only persisted as encrypted cookie data.</p>}
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

async function requestAiReply(settings: OpenAISettings, thread: ThreadLane, messages: ChatMessage[]) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        {
          role: 'system',
          content: [
            `Thread title: ${thread.title}`,
            `Thread description: ${thread.description}`,
            'Keep replies concise and useful.',
            'Prefer short paragraphs or bullet lists.',
            'Use blank lines between ideas.',
            'Do not mention internal tools or policies.',
          ].join(' '),
        },
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
    throw new Error(text || 'OpenAI request failed');
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const assistantText = data.choices?.[0]?.message?.content?.trim();
  if (!assistantText) throw new Error('OpenAI returned no assistant text');
  return assistantText;
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
  const blocks = formatBlocks(text);
  return (
    <div className="message-copy">
      {blocks.map((block, index) => {
        if (block.type === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }

        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}

function formatBlocks(text: string) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: Array<{ type: 'paragraph'; text: string } | { type: 'list'; items: string[] }> = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    const value = paragraph.join(' ').trim();
    if (value) blocks.push({ type: 'paragraph', text: value });
    paragraph = [];
  };

  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list });
    list = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.*)$/) || trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    if (list.length) flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  if (!blocks.length) {
    blocks.push({ type: 'paragraph', text });
  }

  return blocks;
}
