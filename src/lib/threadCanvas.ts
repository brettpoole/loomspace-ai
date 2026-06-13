import type { Dispatch, SetStateAction } from 'react';
import { threadWithActiveNode } from './store';
import type { LoomspaceState, ThreadLane, ThreadNode } from './types';

interface ThreadCanvasRuntime {
  state: LoomspaceState;
  setState: Dispatch<SetStateAction<LoomspaceState>>;
  viewportRef: { current: HTMLDivElement | null };
  chatPanelState: { isOpen: boolean; openThreadIds: string[]; activeThreadId: string | null };
  setChatPanelState: Dispatch<SetStateAction<{ isOpen: boolean; openThreadIds: string[]; activeThreadId: string | null }>>;
  setLeftPanelOpen: (open: boolean) => void;
  rightPanelOpen: boolean;
  bounds: {
    minZoom: number;
    maxZoom: number;
    edgePadding: number;
    canvasMinWidth: number;
    canvasMinHeight: number;
    laneWidth: number;
    laneGap: number;
    leftPad: number;
    topPad: number;
    nodeGap: number;
  };
  nodeHeight: (thread: ThreadLane, node: ThreadNode) => number;
  createThread: (title: string, description: string, index: number) => ThreadLane;
}

export class ThreadCanvas {
  constructor(private readonly runtime: ThreadCanvasRuntime) {}

  get canvasWidth() {
    const { state, bounds } = this.runtime;
    return Math.max(
      bounds.canvasMinWidth,
      bounds.leftPad * 2 + Math.max(0, state.threads.length - 1) * (bounds.laneWidth + bounds.laneGap) + bounds.laneWidth,
    );
  }

  get lanes() {
    const { state, bounds } = this.runtime;
    const canvasWidth = this.canvasWidth;
    const threadGroupWidth = state.threads.length * bounds.laneWidth + Math.max(0, state.threads.length - 1) * (bounds.laneGap);
    const groupLeft = canvasWidth / 2 - threadGroupWidth / 2;
    return state.threads.map((thread, index) => {
      const centerX = groupLeft + index * (bounds.laneWidth + bounds.laneGap) + bounds.laneWidth / 2;
      const nodes: Array<{ node: ThreadNode; top: number }> = [];
      let cursorTop = bounds.topPad;
      for (const node of thread.nodes) {
        nodes.push({ node, top: cursorTop });
        cursorTop += this.runtime.nodeHeight(thread, node) + bounds.nodeGap;
      }
      return { thread, centerX, nodes, height: cursorTop + 72 };
    });
  }

  get canvasHeight() {
    return Math.max(this.runtime.bounds.canvasMinHeight, ...this.lanes.map((lane) => lane.height));
  }

  clientToCanvasPoint(clientX: number, clientY: number) {
    const viewport = this.runtime.viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.runtime.state.panX) / this.runtime.state.zoom,
      y: (clientY - rect.top - this.runtime.state.panY) / this.runtime.state.zoom,
    };
  }

  openChatThread(threadId: string) {
    this.runtime.setChatPanelState((current) => ({
      isOpen: true,
      openThreadIds: current.openThreadIds.includes(threadId) ? current.openThreadIds : [...current.openThreadIds, threadId],
      activeThreadId: threadId,
    }));
    this.runtime.setState((current) => ({
      ...current,
      selectedThreadId: threadId,
      selectedNodeId: current.threads.find((thread) => thread.id === threadId)?.activeNodeId ?? null,
    }));
  }

  closeChatThread(threadId: string) {
    this.runtime.setChatPanelState((current) => {
      const openThreadIds = current.openThreadIds.filter((entry) => entry !== threadId);
      const nextActiveThreadId = current.activeThreadId === threadId ? openThreadIds.at(-1) ?? null : current.activeThreadId;
      if (current.activeThreadId === threadId && nextActiveThreadId) {
        this.runtime.setState((currentState) => ({
          ...currentState,
          selectedThreadId: nextActiveThreadId,
          selectedNodeId: currentState.threads.find((thread) => thread.id === nextActiveThreadId)?.activeNodeId ?? null,
        }));
      }
      return { isOpen: openThreadIds.length > 0 ? current.isOpen : false, openThreadIds, activeThreadId: nextActiveThreadId };
    });
  }

  toggleChatPanelVisibility() {
    const state = this.runtime.state;
    this.runtime.setChatPanelState((current) => {
      if (current.isOpen) return { ...current, isOpen: false };
      const fallbackThreadId = current.activeThreadId ?? current.openThreadIds.at(-1) ?? state.selectedThreadId ?? state.threads[0]?.id ?? null;
      const openThreadIds = fallbackThreadId && !current.openThreadIds.includes(fallbackThreadId)
        ? [...current.openThreadIds, fallbackThreadId]
        : current.openThreadIds;
      if (fallbackThreadId) {
        this.runtime.setState((currentState) => ({
          ...currentState,
          selectedThreadId: fallbackThreadId,
          selectedNodeId: currentState.threads.find((thread) => thread.id === fallbackThreadId)?.activeNodeId ?? null,
        }));
      }
      return { isOpen: true, openThreadIds, activeThreadId: fallbackThreadId };
    });
  }

  selectThread(threadId: string, nodeId?: string | null) {
    if (this.runtime.rightPanelOpen) this.openChatThread(threadId);
    this.runtime.setLeftPanelOpen(false);
    this.runtime.setState((current) => ({
      ...current,
      selectedThreadId: threadId,
      selectedNodeId: nodeId ?? current.threads.find((thread) => thread.id === threadId)?.activeNodeId ?? null,
      threads: current.threads.map((thread) => {
        if (thread.id !== threadId) return threadWithActiveNode(thread, thread.activeNodeId);
        const nextNodeId = nodeId ?? thread.activeNodeId;
        return { ...threadWithActiveNode(thread, nextNodeId) };
      }),
    }));
  }

  threadLaneHeight(thread: ThreadLane) {
    let cursorTop = this.runtime.bounds.topPad;
    for (const node of thread.nodes) {
      cursorTop += this.runtime.nodeHeight(thread, node) + this.runtime.bounds.nodeGap;
    }
    return cursorTop + 72;
  }

  focusCanvasOnThread(threads: ThreadLane[], thread: ThreadLane, threadIndex: number, zoom: number) {
    const viewport = this.runtime.viewportRef.current;
    const width = viewport?.clientWidth ?? window.innerWidth;
    const height = viewport?.clientHeight ?? window.innerHeight;
    const bounds = this.runtime.bounds;
    const threadCount = threads.length;
    const nextCanvasWidth = Math.max(
      bounds.canvasMinWidth,
      bounds.leftPad * 2 + Math.max(0, threadCount - 1) * (bounds.laneWidth + bounds.laneGap) + bounds.laneWidth,
    );
    const nextCanvasHeight = Math.max(bounds.canvasMinHeight, ...threads.map((entry) => this.threadLaneHeight(entry)));
    const threadGroupWidth = threadCount * bounds.laneWidth + Math.max(0, threadCount - 1) * (bounds.laneGap);
    const groupLeft = nextCanvasWidth / 2 - threadGroupWidth / 2;
    const centerX = groupLeft + threadIndex * (bounds.laneWidth + bounds.laneGap) + bounds.laneWidth / 2;
    const centerY = this.threadLaneHeight(thread) / 2;
    const panX = width / 2 - centerX * zoom;
    const panY = height / 2 - centerY * zoom;
    return boundedPan(panX, panY, zoom, width, height, nextCanvasWidth, nextCanvasHeight);
  }

  focusNewThread() {
    const state = this.runtime.state;
    const baseThread = this.runtime.createThread('New chat', '', state.threads.length);
    this.runtime.setState((current) => {
      const nextThreads = [...current.threads, baseThread];
      return {
        ...current,
        version: current.version + 1,
        threads: nextThreads,
        selectedThreadId: baseThread.id,
        selectedNodeId: baseThread.activeNodeId,
        ...this.focusCanvasOnThread(nextThreads, baseThread, current.threads.length, current.zoom),
      };
    });
  }

  clampViewport(next?: Partial<Pick<LoomspaceState, 'panX' | 'panY' | 'zoom'>>) {
    const state = this.runtime.state;
    const viewport = this.runtime.viewportRef.current;
    const width = viewport?.clientWidth ?? window.innerWidth;
    const height = viewport?.clientHeight ?? window.innerHeight;
    const zoom = clamp(next?.zoom ?? state.zoom, this.runtime.bounds.minZoom, this.runtime.bounds.maxZoom);
    const panX = next?.panX ?? state.panX;
    const panY = next?.panY ?? state.panY;
    const nextBounds = boundedPan(panX, panY, zoom, width, height, this.canvasWidth, this.canvasHeight);
    if (nextBounds.panX === state.panX && nextBounds.panY === state.panY && zoom === state.zoom && !next) return;
    this.runtime.setState((current) => ({ ...current, ...nextBounds, zoom }));
  }

  zoomAt(clientX: number, clientY: number, nextZoom: number) {
    const viewport = this.runtime.viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const zoom = clamp(nextZoom, this.runtime.bounds.minZoom, this.runtime.bounds.maxZoom);
    const pointX = clientX - rect.left;
    const pointY = clientY - rect.top;

    this.runtime.setState((current) => {
      const scale = zoom / current.zoom;
      const transformed = {
        panX: pointX - (pointX - current.panX) * scale,
        panY: pointY - (pointY - current.panY) * scale,
      };
      return {
        ...current,
        zoom,
        ...boundedPan(transformed.panX, transformed.panY, zoom, rect.width, rect.height, this.canvasWidth, this.canvasHeight),
      };
    });
  }

  zoomFromButton(direction: 1 | -1) {
    const viewport = this.runtime.viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, this.runtime.state.zoom + direction * 0.1);
  }

  resetView() {
    const viewport = this.runtime.viewportRef.current;
    if (!viewport) {
      this.runtime.setState((current) => ({ ...current, zoom: 1, panX: 0, panY: 0 }));
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const centered = boundedPan(
      (rect.width - this.canvasWidth) / 2,
      this.runtime.bounds.edgePadding,
      1,
      rect.width,
      rect.height,
      this.canvasWidth,
      this.canvasHeight,
    );
    this.runtime.setState((current) => ({ ...current, zoom: 1, ...centered }));
  }
}

function boundedPan(
  panX: number,
  panY: number,
  zoom: number,
  viewportW: number,
  viewportH: number,
  canvasW: number,
  canvasH: number,
) {
  const minPanX = viewportW - canvasW * zoom;
  const minPanY = viewportH - canvasH * zoom;
  return {
    panX: clamp(panX, Math.min(0, minPanX), 0),
    panY: clamp(panY, Math.min(0, minPanY), 0),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
