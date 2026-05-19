import { useMemo, useRef, useState } from 'react';
import { appendEvent, applyEvent, computeMetrics, getNodeLabel, loadLog } from './lib/store';
import { sampleState } from './lib/sample';
import type { FabricNode, LoomspaceEvent, LoomspaceState, WorkspaceThread } from './lib/types';

export default function App() {
  const [events, setEvents] = useState<LoomspaceEvent[]>(() => loadLog().events);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const state = useMemo<LoomspaceState>(() => {
    return events.reduce(applyEvent, structuredClone(sampleState));
  }, [events]);

  const metrics = useMemo(() => computeMetrics(state), [state]);
  const selected = state.nodes.find((node) => node.id === state.selectedId) ?? null;
  const relatedEdges = selected
    ? state.edges.filter((edge) => edge.from === selected.id || edge.to === selected.id)
    : [];
  const relatedNodeIds = new Set(relatedEdges.flatMap((edge) => [edge.from, edge.to]));

  function commit(event: LoomspaceEvent) {
    setEvents((current) => appendEvent(current, event));
  }

  function createThread() {
    const id = `thread-${crypto.randomUUID().slice(0, 8)}`;
    const thread: WorkspaceThread = {
      id,
      title: 'New side thread',
      color: '#ffd166',
      status: 'active',
    };

    commit({ type: 'thread.add', thread });
    commit({
      type: 'node.add',
      node: {
        id: `node-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'thread',
        threadId: id,
        title: 'Untitled thread',
        summary: 'Spawned from the canvas.',
        x: 120 + Math.random() * 900,
        y: 120 + Math.random() * 500,
        confidence: 'medium',
        provenance: ['User created thread'],
      },
    });
  }

  function promoteToStitch() {
    if (!selected) return;
    const stitchId = `stitch-${crypto.randomUUID().slice(0, 8)}`;
    commit({
      type: 'node.add',
      node: {
        id: stitchId,
        kind: 'stitch',
        title: `Stitch from ${selected.title}`,
        summary: 'Promoted into the main fabric for review.',
        x: selected.x + 180,
        y: selected.y + 40,
        confidence: 'high',
        provenance: [`Promoted from ${selected.id}`],
      },
    });
    commit({
      type: 'edge.add',
      edge: {
        id: `edge-${crypto.randomUUID().slice(0, 8)}`,
        from: selected.id,
        to: stitchId,
        kind: 'promotes',
        label: 'stitches',
      },
    });
  }

  function addContradiction() {
    if (!selected || state.nodes.length < 2) return;
    const peer = state.nodes.find((node) => node.id !== selected.id);
    if (!peer) return;
    commit({
      type: 'edge.add',
      edge: {
        id: `edge-${crypto.randomUUID().slice(0, 8)}`,
        from: selected.id,
        to: peer.id,
        kind: 'contradicts',
        label: 'fray',
      },
    });
  }

  function resetLog() {
    localStorage.removeItem('loomspace.fabric-log.v1');
    setEvents([]);
  }

  function onNodePointerDown(node: FabricNode, event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    commit({ type: 'ui.select', id: node.id });
    setDragId(node.id);
    dragOffset.current = {
      x: event.clientX - node.x,
      y: event.clientY - node.y,
    };
    (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
  }

  function onCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    commit({
      type: 'node.move',
      id: dragId,
      x: event.clientX - rect.left - dragOffset.current.x,
      y: event.clientY - rect.top - dragOffset.current.y,
    });
  }

  function onCanvasPointerUp() {
    setDragId(null);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Loomspace</p>
          <h1>{state.title}</h1>
        </div>
        <div className="topbar-actions">
          <button onClick={createThread}>New thread</button>
          <button onClick={promoteToStitch} disabled={!selected}>
            Stitch selected
          </button>
          <button onClick={addContradiction} disabled={!selected}>
            Mark contradiction
          </button>
          <button onClick={() => commit({ type: 'ui.toggleDensityOverlay' })}>
            {state.densityOverlay ? 'Hide' : 'Show'} density
          </button>
          <button onClick={resetLog} className="quiet">
            Reset fabric
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="panel left">
          <section className="metric-card accent">
            <span>Fabric density</span>
            <strong>{metrics.density.toFixed(2)}</strong>
          </section>
          <section className="metric-card">
            <span>Stitches</span>
            <strong>{metrics.stitchedCount}</strong>
          </section>
          <section className="metric-card">
            <span>Contradictions</span>
            <strong>{metrics.contradictionCount}</strong>
          </section>

          <h2>Threads</h2>
          <div className="thread-list">
            {state.threads.map((thread) => (
              <button
                key={thread.id}
                className="thread-chip"
                style={{ borderColor: thread.color }}
                onClick={() => commit({ type: 'ui.select', id: state.nodes.find((n) => n.threadId === thread.id)?.id ?? null })}
              >
                <span className="dot" style={{ background: thread.color }} />
                <span>{thread.title}</span>
                <small>{thread.status}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <span>{state.densityOverlay ? 'Fabric overlay on' : 'Overlay off'}</span>
            <span>{Math.round(state.zoom * 100)}%</span>
          </div>
          <div
            ref={canvasRef}
            className={`fabric-canvas ${state.densityOverlay ? 'overlay' : ''}`}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerLeave={onCanvasPointerUp}
          >
            <svg className="edges-layer" viewBox="0 0 1200 760" preserveAspectRatio="none">
              {state.edges.map((edge) => {
                const from = state.nodes.find((node) => node.id === edge.from);
                const to = state.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                const ctrlX = (from.x + to.x) / 2;
                const ctrlY = Math.min(from.y, to.y) - 80;
                const stroke = edge.kind === 'contradicts' ? '#ff7b89' : edge.kind === 'promotes' ? '#7cf7c2' : '#8db0ff';
                return (
                  <g key={edge.id} opacity={state.selectedId && state.selectedId !== edge.from && state.selectedId !== edge.to ? 0.4 : 1}>
                    <path
                      d={`M ${from.x} ${from.y} Q ${ctrlX} ${ctrlY} ${to.x} ${to.y}`}
                      className={`edge ${edge.kind}`}
                      stroke={stroke}
                    />
                    <text x={ctrlX} y={ctrlY - 10} className="edge-label">
                      {edge.label}
                    </text>
                  </g>
                );
              })}
            </svg>

            {state.nodes.map((node) => {
              const isSelected = node.id === state.selectedId;
              const isRelated = relatedNodeIds.has(node.id);
              return (
                <button
                  key={node.id}
                  className={`node ${node.kind} ${isSelected ? 'selected' : ''} ${isRelated || !selected ? '' : 'dimmed'}`}
                  style={{ left: node.x, top: node.y }}
                  onPointerDown={(event) => onNodePointerDown(node, event)}
                  onClick={() => commit({ type: 'ui.select', id: node.id })}
                  onDoubleClick={() => commit({ type: 'node.toggleCollapse', id: node.id })}
                >
                  <div className="node-head">
                    <span>{getNodeLabel(node.kind)}</span>
                    <span className={`confidence ${node.confidence}`}>{node.confidence}</span>
                  </div>
                  <strong>{node.title}</strong>
                  {!node.collapsed && <p>{node.summary}</p>}
                  {node.threadId && <small>thread · {node.threadId}</small>}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="panel right">
          <h2>Inspector</h2>
          {selected ? (
            <article className="inspector-card">
              <p className="eyebrow">{getNodeLabel(selected.kind)}</p>
              <h3>{selected.title}</h3>
              <p>{selected.summary}</p>
              <div className="meta-row">
                <span>confidence {selected.confidence}</span>
                <span>{selected.pinned ? 'pinned' : 'movable'}</span>
              </div>
              <h4>Why this exists</h4>
              <ul>
                {selected.provenance.map((source) => (
                  <li key={source}>{source}</li>
                ))}
              </ul>
              <h4>Connected weave</h4>
              <ul>
                {relatedEdges.map((edge) => (
                  <li key={edge.id}>
                    {edge.kind} · {edge.label}
                  </li>
                ))}
              </ul>
            </article>
          ) : (
            <p className="muted">Select a node to see provenance and connections.</p>
          )}

          <section className="inspector-card">
            <h4>System view</h4>
            <ul>
              <li>{metrics.nodeCount} nodes</li>
              <li>{metrics.edgeCount} edges</li>
              <li>{Math.round(metrics.saturation * 100)}% saturation</li>
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}
