import { useMemo, useState } from 'react';
import { appendEvent, applyEvent, computeMetrics, loadLog, summarize } from './lib/store';
import { sampleState } from './lib/sample';
import type { ChatMessage, LoomspaceEvent, LoomspaceState, ThreadExchange, ThreadLane } from './lib/types';

const LANE_WIDTH = 300;
const LANE_GAP = 40;
const HEADER_TOP = 28;
const HEADER_HEIGHT = 66;
const FIRST_EXCHANGE_TOP = 118;
const EXCHANGE_HEIGHT = 60;
const EXCHANGE_GAP = 22;
const LEFT_PAD = 36;
const SPINE_OFFSET = 18;
const CARD_OFFSET = 40;

export default function App() {
  const [events, setEvents] = useState<LoomspaceEvent[]>(() => loadLog().events);
  const [threadTitleDraft, setThreadTitleDraft] = useState('');
  const [exchangeDraft, setExchangeDraft] = useState('');

  const state = useMemo<LoomspaceState>(() => events.reduce(applyEvent, structuredClone(sampleState)), [events]);
  const metrics = useMemo(() => computeMetrics(state), [state]);
  const activeThread = state.threads.find((thread) => thread.id === state.selectedThreadId) ?? state.threads[0] ?? null;
  const activeExchange = activeThread
    ? activeThread.exchanges.find((exchange) => exchange.id === state.selectedExchangeId) ?? activeThread.exchanges.at(-1) ?? null
    : null;

  const lanes = useMemo(() => {
    return state.threads.map((thread, index) => {
      const laneX = LEFT_PAD + index * (LANE_WIDTH + LANE_GAP);
      const spineX = laneX + SPINE_OFFSET;
      const exchangePositions = thread.exchanges.map((exchange, exchangeIndex) => ({
        exchange,
        top: FIRST_EXCHANGE_TOP + exchangeIndex * (EXCHANGE_HEIGHT + EXCHANGE_GAP),
      }));
      const laneHeight = Math.max(FIRST_EXCHANGE_TOP + thread.exchanges.length * (EXCHANGE_HEIGHT + EXCHANGE_GAP) + 80, 340);
      return {
        thread,
        laneX,
        spineX,
        laneHeight,
        exchangePositions,
      };
    });
  }, [state.threads]);

  const canvasHeight = Math.max(...lanes.map((lane) => lane.laneHeight), 460);
  const canvasWidth = Math.max(1200, LEFT_PAD * 2 + state.threads.length * LANE_WIDTH + Math.max(state.threads.length - 1, 0) * LANE_GAP);

  function commit(event: LoomspaceEvent) {
    setEvents((current) => appendEvent(current, event));
  }

  function startThread() {
    const title = threadTitleDraft.trim() || `Thread ${state.threads.length + 1}`;
    const exchangeText = exchangeDraft.trim() || 'Thread opened.';
    const threadId = `thread-${crypto.randomUUID().slice(0, 8)}`;
    const exchangeId = `exchange-${crypto.randomUUID().slice(0, 8)}`;
    const thread: ThreadLane = {
      id: threadId,
      title,
      summary: summarize(exchangeText, 48),
      color: pickColor(state.threads.length),
      status: 'active',
      exchanges: [
        makeExchange(exchangeId, exchangeText, 'high', [
          { id: `msg-${crypto.randomUUID().slice(0, 8)}`, role: 'user', text: exchangeText },
          { id: `msg-${crypto.randomUUID().slice(0, 8)}`, role: 'assistant', text: summarize(exchangeText, 64) },
        ]),
      ],
    };

    commit({ type: 'thread.add', thread });
    commit({ type: 'thread.select', threadId });
    commit({ type: 'exchange.select', threadId, exchangeId });
    setThreadTitleDraft('');
    setExchangeDraft('');
  }

  function addExchange() {
    if (!activeThread) return;
    const text = exchangeDraft.trim();
    if (!text) return;
    const exchangeId = `exchange-${crypto.randomUUID().slice(0, 8)}`;
    const exchange = makeExchange(exchangeId, text, 'medium', [
      { id: `msg-${crypto.randomUUID().slice(0, 8)}`, role: 'user', text },
      { id: `msg-${crypto.randomUUID().slice(0, 8)}`, role: 'assistant', text: summarize(text, 72) },
    ]);

    commit({ type: 'exchange.add', threadId: activeThread.id, exchange });
    commit({ type: 'exchange.select', threadId: activeThread.id, exchangeId });
    setExchangeDraft('');
  }

  function selectThread(thread: ThreadLane) {
    const latest = thread.exchanges.at(-1) ?? null;
    commit({ type: 'thread.select', threadId: thread.id });
    commit({ type: 'exchange.select', threadId: thread.id, exchangeId: latest?.id ?? null });
  }

  function selectExchange(threadId: string, exchangeId: string) {
    commit({ type: 'exchange.select', threadId, exchangeId });
  }

  function resetLog() {
    localStorage.removeItem('loomspace.thread-log.v2');
    setEvents([]);
    setExchangeDraft('');
    setThreadTitleDraft('');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Loomspace</p>
          <h1>{state.title}</h1>
        </div>
        <div className="topbar-actions">
          <button onClick={startThread}>New thread</button>
          <button onClick={() => commit({ type: 'ui.toggleDensityOverlay' })}>
            {state.densityOverlay ? 'Hide' : 'Show'} threadlines
          </button>
          <button onClick={resetLog} className="quiet">
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
            <span>Exchanges</span>
            <strong>{metrics.exchangeCount}</strong>
          </section>
          <section className="metric-card">
            <span>Active lanes</span>
            <strong>{metrics.activeExchangeCount}</strong>
          </section>
          <section className="metric-card">
            <span>Density</span>
            <strong>{metrics.density.toFixed(2)}</strong>
          </section>

          <h2>Start a thread</h2>
          <label className="field">
            Thread title
            <input
              value={threadTitleDraft}
              onChange={(event) => setThreadTitleDraft(event.target.value)}
              placeholder="e.g. deployment plan"
            />
          </label>
          <label className="field">
            First exchange summary
            <textarea
              value={exchangeDraft}
              onChange={(event) => setExchangeDraft(event.target.value)}
              placeholder="Short summary of the exchange"
              rows={4}
            />
          </label>
          <button onClick={startThread}>Create thread</button>

          <h2>Threads</h2>
          <div className="thread-list">
            {state.threads.length === 0 ? <p className="muted">No threads yet.</p> : null}
            {state.threads.map((thread) => (
              <button
                key={thread.id}
                className={`thread-chip ${thread.id === activeThread?.id ? 'selected' : ''}`}
                style={{ borderColor: thread.color }}
                onClick={() => selectThread(thread)}
              >
                <span className="dot" style={{ background: thread.color }} />
                <span>
                  {thread.title}
                  <small>{thread.summary}</small>
                </span>
                <small>{thread.exchanges.length} ex</small>
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
            <div className="fabric-stage" style={{ width: canvasWidth, height: canvasHeight }}>
              {lanes.length === 0 ? (
                <div className="empty-state">
                  <p className="eyebrow">Canvas idle</p>
                  <h2>Start a thread to begin the weave</h2>
                  <p>Each exchange becomes a short box on the line; the right sidebar shows the active chat.</p>
                  <button onClick={startThread}>Create first thread</button>
                </div>
              ) : null}

              <svg className="edges-layer" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} preserveAspectRatio="none">
                {lanes.map((lane) => {
                  const lastTop = lane.exchangePositions.at(-1)?.top ?? FIRST_EXCHANGE_TOP;
                  const lineEnd = lastTop + EXCHANGE_HEIGHT;
                  return (
                    <g key={lane.thread.id}>
                      <path
                        d={`M ${lane.spineX} ${HEADER_TOP + HEADER_HEIGHT} L ${lane.spineX} ${lineEnd + 28}`}
                        className={`spine ${lane.thread.id === activeThread?.id ? 'active' : ''}`}
                      />
                      <path
                        d={`M ${lane.spineX} ${HEADER_TOP + HEADER_HEIGHT / 2} L ${lane.spineX + 14} ${HEADER_TOP + HEADER_HEIGHT / 2}`}
                        className="spine-tip"
                      />
                      {lane.exchangePositions.map(({ exchange, top }) => {
                        const centerY = top + EXCHANGE_HEIGHT / 2;
                        return (
                          <g key={exchange.id}>
                            <path d={`M ${lane.spineX} ${centerY} L ${lane.laneX + CARD_OFFSET} ${centerY}`} className="link-line" />
                            <circle cx={lane.spineX} cy={centerY} r="4" className="link-dot" />
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </svg>

              {lanes.map((lane) => {
                const isActiveLane = lane.thread.id === activeThread?.id;
                return (
                  <div key={lane.thread.id} className={`thread-lane ${isActiveLane ? 'active' : ''}`} style={{ left: lane.laneX, top: 0, width: LANE_WIDTH, height: lane.laneHeight }}>
                    <button className="thread-header" style={{ top: HEADER_TOP }} onClick={() => selectThread(lane.thread)}>
                      <span className="thread-header-line" style={{ background: lane.thread.color }} />
                      <div>
                        <strong>{lane.thread.title}</strong>
                        <p>{lane.thread.summary}</p>
                      </div>
                      <small>{lane.thread.exchanges.length} exchanges</small>
                    </button>

                    {lane.exchangePositions.map(({ exchange, top }) => {
                      const isSelected = exchange.id === activeExchange?.id;
                      return (
                        <button
                          key={exchange.id}
                          className={`exchange-card ${isSelected ? 'selected' : ''}`}
                          style={{ top, left: CARD_OFFSET }}
                          onClick={() => selectExchange(lane.thread.id, exchange.id)}
                        >
                          <div className="exchange-head">
                            <span>Exchange</span>
                            <span className={`confidence ${exchange.confidence}`}>{exchange.confidence}</span>
                          </div>
                          <strong>{exchange.summary}</strong>
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
                <h3>{activeThread.summary}</h3>
                <p>{activeThread.exchanges.length} exchanges in this lane.</p>
              </article>

              <section className="chat-panel">
                {activeThread.exchanges.length === 0 ? (
                  <p className="muted">No exchanges yet.</p>
                ) : (
                  activeThread.exchanges.map((exchange) => (
                    <button
                      key={exchange.id}
                      className={`chat-card ${exchange.id === activeExchange?.id ? 'selected' : ''}`}
                      onClick={() => selectExchange(activeThread.id, exchange.id)}
                    >
                      <div className="chat-card-top">
                        <span>{exchange.createdAt.slice(0, 10)}</span>
                        <span className={`confidence ${exchange.confidence}`}>{exchange.confidence}</span>
                      </div>
                      {exchange.messages.map((message) => (
                        <div key={message.id} className={`bubble ${message.role}`}>
                          <strong>{message.role}</strong>
                          <p>{message.text}</p>
                        </div>
                      ))}
                    </button>
                  ))
                )}
              </section>

              <section className="inspector-card">
                <h4>Add exchange</h4>
                <textarea
                  value={exchangeDraft}
                  onChange={(event) => setExchangeDraft(event.target.value)}
                  placeholder="Short exchange summary"
                  rows={4}
                />
                <button onClick={addExchange} disabled={!exchangeDraft.trim()}>
                  Append exchange
                </button>
              </section>
            </>
          ) : (
            <p className="muted">Create a thread or select one to see the chat here.</p>
          )}
        </aside>
      </main>
    </div>
  );
}

function makeExchange(id: string, text: string, confidence: 'low' | 'medium' | 'high', messages: ChatMessage[]): ThreadExchange {
  return {
    id,
    summary: summarize(text, 56),
    messages,
    confidence,
    createdAt: new Date().toISOString(),
  };
}

function pickColor(index: number) {
  const palette = ['#7cf7c2', '#7ea8ff', '#d48bff', '#ffd166', '#ff8f70'];
  return palette[index % palette.length];
}
