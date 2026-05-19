import { useEffect, useMemo, useState } from 'react';
import {
  appendChatToThread,
  computeMetrics,
  createChatNode,
  createThread,
  loadWorkspace,
  saveWorkspace,
  threadWithActiveNode,
  threadWithInfo,
  updateThreadTitle,
} from './lib/store';
import type { ChatMessage, LoomspaceState, ThreadChatNode, ThreadLane, ThreadNode } from './lib/types';

const LANE_WIDTH = 320;
const LANE_GAP = 44;
const LEFT_PAD = 44;
const TOP_PAD = 24;
const TITLE_HEIGHT = 66;
const CHAT_HEIGHT = 92;
const NODE_GAP = 34;
const NODE_WIDTH = 232;
const SPINE_OFFSET = NODE_WIDTH / 2;

export default function App() {
  const [state, setState] = useState<LoomspaceState>(() => loadWorkspace());
  const [threadTitleDraft, setThreadTitleDraft] = useState('');
  const [threadDescriptionDraft, setThreadDescriptionDraft] = useState('');
  const [composerDraft, setComposerDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveWorkspace(state);
  }, [state]);

  const metrics = useMemo(() => computeMetrics(state), [state]);
  const activeThread = state.threads.find((thread) => thread.id === state.selectedThreadId) ?? state.threads[0] ?? null;
  const activeNode = activeThread?.nodes.find((node) => node.id === state.selectedNodeId) ?? activeThread?.nodes.at(-1) ?? null;

  const canvasWidth = Math.max(1200, LEFT_PAD * 2 + state.threads.length * LANE_WIDTH + Math.max(0, state.threads.length - 1) * LANE_GAP);

  const lanes = useMemo(() => {
    return state.threads.map((thread, index) => {
      const laneCenterX = state.threads.length === 1 ? canvasWidth / 2 : LEFT_PAD + index * (LANE_WIDTH + LANE_GAP) + LANE_WIDTH / 2;
      const nodeEntries: Array<{ node: ThreadNode; top: number }> = [];
      let cursorTop = TOP_PAD;
      for (const node of thread.nodes) {
        nodeEntries.push({ node, top: cursorTop });
        cursorTop += nodeKindHeight(node) + NODE_GAP;
      }
      const laneHeight = Math.max(cursorTop + 80 + (thread.infoOpen ? 90 : 0), 420);

      return {
        thread,
        laneCenterX,
        spineX: laneCenterX,
        nodeEntries,
        laneHeight,
      };
    });
  }, [canvasWidth, state.threads]);

  function selectThread(threadId: string, nodeId?: string | null) {
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
    const selectedChat = thread.nodes.find((node): node is ThreadChatNode => node.kind === 'chat') ?? null;

    setState((current) => ({
      ...current,
      version: current.version + 1,
      threads: [...current.threads, thread],
      selectedThreadId: thread.id,
      selectedNodeId: selectedChat?.id ?? null,
    }));

    setThreadTitleDraft('');
    setThreadDescriptionDraft('');
    setComposerDraft('');
    setError(null);
  }

  async function sendMessage() {
    if (!activeThread || !composerDraft.trim() || sending) return;

    const userText = composerDraft.trim();
    const userMessage: ChatMessage = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      role: 'user',
      text: userText,
    };

    setSending(true);
    setError(null);
    setComposerDraft('');

    try {
      const assistantText = await requestAiReply(activeThread, [...activeThread.context, userMessage]);
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
          thread.id === activeThread.id
            ? appendChatToThread(thread, newChatNode, [userMessage, assistantMessage])
            : thread,
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

  function resetWorkspace() {
    localStorage.removeItem('loomspace.workspace.v4');
    setState(loadWorkspace());
    setThreadTitleDraft('');
    setThreadDescriptionDraft('');
    setComposerDraft('');
    setError(null);
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
          <button onClick={() => setState((current) => ({ ...current, densityOverlay: !current.densityOverlay }))}>
            {state.densityOverlay ? 'Hide' : 'Show'} threadlines
          </button>
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
            <span>{metrics.saturation * 100 < 50 ? 'light weave' : 'dense weave'}</span>
          </div>

          <div className={`fabric-canvas ${state.densityOverlay ? 'overlay' : ''}`}>
            <div className="fabric-stage" style={{ width: canvasWidth, height: Math.max(...lanes.map((lane) => lane.laneHeight), 480) }}>
              {lanes.length === 0 ? (
                <div className="empty-state">
                  <p className="eyebrow">Canvas idle</p>
                  <h2>Start a thread to begin the weave</h2>
                  <p>The first thread will center itself. New threads line up to the right.</p>
                  <button onClick={createNewThread}>Create first thread</button>
                </div>
              ) : null}

              <svg className="edges-layer" viewBox={`0 0 ${canvasWidth} ${Math.max(...lanes.map((lane) => lane.laneHeight), 480)}`} preserveAspectRatio="none">
                {lanes.map((lane) => {
                  const nodes = lane.nodeEntries;
                  const startY = nodes[0]?.top ?? TOP_PAD;
                  const endY = (nodes.at(-1)?.top ?? TOP_PAD) + nodeKindHeight(nodes.at(-1)?.node ?? null);
                  const startX = lane.spineX;
                  return (
                    <g key={lane.thread.id}>
                      <path
                        d={`M ${startX} ${startY} L ${startX} ${endY}`}
                        className={`rope-shadow ${lane.thread.id === activeThread?.id ? 'active' : ''}`}
                      />
                      <path
                        d={`M ${startX} ${startY} L ${startX} ${endY}`}
                        className={`rope ${lane.thread.id === activeThread?.id ? 'active' : ''}`}
                      />
                      {nodes.map(({ node, top }) => (
                        <g key={node.id}>
                          <circle cx={startX} cy={top} r="4" className="knot" />
                          <path d={`M ${startX} ${top} L ${startX} ${top + nodeKindHeight(node)}`} className="link-line" />
                        </g>
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
                    style={{ left: lane.laneCenterX - LANE_WIDTH / 2, top: 0, width: LANE_WIDTH, height: lane.laneHeight }}
                  >
                    {lane.nodeEntries.map(({ node, top }, index) => {
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
                                <button
                                  type="button"
                                  className="info-button"
                                  onClick={() => toggleInfo(thread.id)}
                                  aria-label="Thread info"
                                >
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
                          style={{ top, left: lane.spineX - NODE_WIDTH / 2 }}
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

        <aside className="panel right">
          <h2>Active chat</h2>
          {activeThread ? (
            <>
              <article className="inspector-card">
                <p className="eyebrow">{activeThread.title}</p>
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
                      <p>{message.text}</p>
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
            </>
          ) : (
            <p className="muted">Create a thread and it will open here with its chat context.</p>
          )}
        </aside>
      </main>
    </div>
  );
}

async function requestAiReply(thread: ThreadLane, messages: ChatMessage[]) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      threadId: thread.id,
      threadTitle: thread.title,
      threadDescription: thread.description,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'AI service unavailable');
  }

  const data = (await response.json()) as { assistantText?: string };
  if (!data.assistantText) throw new Error('AI service returned no text');
  return data.assistantText;
}

function nodeKindHeight(node: ThreadNode | null) {
  if (!node) return 0;
  return node.kind === 'title' ? TITLE_HEIGHT : CHAT_HEIGHT;
}
