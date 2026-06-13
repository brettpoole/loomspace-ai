import type { Dispatch, SetStateAction } from 'react';
import { appendContextInjection, createContextNode } from './store';
import type { ChatMessage, ForkDraft, ThreadLane } from './types';

export interface ForkSelectionPart {
  nodeId: string;
  parts: { user: boolean; assistant: boolean };
}

interface ThreadForkDraftRuntime {
  forkDraft: ForkDraft | null;
  threads: ThreadLane[];
  setForkDraft: (draft: ForkDraft | null) => void;
  setContextLinkMode: (mode: {
    intent: 'link' | 'fork';
    sourceThreadId: string;
    dotNodeId: string;
    selectedNodes: ForkSelectionPart[];
    side: 'left' | 'right';
  } | null) => void;
  setContextLinkPointer: (pointer: { x: number; y: number } | null) => void;
  setContextLinkSnapTarget: (target: { threadId: string; nodeId: string } | null) => void;
  setRightPanelOpen: (open: boolean) => void;
  setState: Dispatch<SetStateAction<any>>;
  focusCanvasOnThread: (threads: ThreadLane[], thread: ThreadLane, threadIndex: number, zoom: number) => { panX: number; panY: number };
  zoom: number;
  openChatThread: (threadId: string) => void;
  setError: (message: string | null) => void;
  createThread: (title: string, description: string, index: number) => ThreadLane;
}

export class ThreadForkDraftSession {
  constructor(private readonly runtime: ThreadForkDraftRuntime) {}

  buildContextSelection(thread: ThreadLane, nodeId: string) {
    const selectableNodes = thread.nodes.filter((n) => (n.kind === 'chat' && n.messages.length > 0) || n.kind === 'context');
    const idx = selectableNodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return null;
    return selectableNodes.slice(0, idx + 1).map((n) => ({
      nodeId: n.id,
      parts: { user: true, assistant: true },
    }));
  }

  collectSelectedMessages(sourceThread: ThreadLane, selectedNodes: ForkDraft['selectedNodes']) {
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

  countSelectedMessages(sourceThread: ThreadLane, selectedNodes: ForkDraft['selectedNodes']) {
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

  buildForkThread(baseThread: ThreadLane, sourceThread: ThreadLane, selectedNodes: ForkDraft['selectedNodes']) {
    const injectedMessages = this.collectSelectedMessages(sourceThread, selectedNodes);
    if (injectedMessages.length === 0) return baseThread;
    const contextNode = createContextNode(sourceThread, selectedNodes.map((entry) => entry.nodeId), injectedMessages);
    return appendContextInjection(baseThread, contextNode, injectedMessages);
  }

  openForkThreadEditor(thread: ThreadLane, nodeId: string, side: 'left' | 'right') {
    const forkSelection = this.buildContextSelection(thread, nodeId);
    if (!forkSelection) return;
    this.runtime.setForkDraft({
      sourceThreadId: thread.id,
      sourceThreadTitle: thread.title,
      sourceThreadColor: thread.color,
      selectedNodes: forkSelection,
    });
    this.runtime.setContextLinkMode({ intent: 'fork', sourceThreadId: thread.id, dotNodeId: nodeId, selectedNodes: forkSelection, side });
    this.runtime.setRightPanelOpen(false);
  }

  cancel() {
    this.runtime.setForkDraft(null);
    this.runtime.setContextLinkMode(null);
    this.runtime.setContextLinkPointer(null);
    this.runtime.setContextLinkSnapTarget(null);
  }

  commit() {
    const forkDraft = this.runtime.forkDraft;
    if (!forkDraft) return;
    const sourceThread = this.runtime.threads.find((entry) => entry.id === forkDraft.sourceThreadId);
    if (!sourceThread) {
      this.cancel();
      return;
    }
    const selectedCount = this.countSelectedMessages(sourceThread, forkDraft.selectedNodes);
    if (selectedCount === 0) return;
    const baseThread = this.runtime.createThread(`Fork of ${forkDraft.sourceThreadTitle}`, sourceThread.description, this.runtime.threads.length);
    const thread = this.buildForkThread(baseThread, sourceThread, forkDraft.selectedNodes);
    this.runtime.setState((current: any) => {
      const nextThreads = [...current.threads, thread];
      return {
        ...current,
        version: current.version + 1,
        threads: nextThreads,
        selectedThreadId: thread.id,
        selectedNodeId: thread.activeNodeId,
        ...this.runtime.focusCanvasOnThread(nextThreads, thread, current.threads.length, current.zoom),
      };
    });
    this.runtime.openChatThread(thread.id);
    this.cancel();
    this.runtime.setError(null);
  }
}
