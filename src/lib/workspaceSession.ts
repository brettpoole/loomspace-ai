import type { Dispatch, SetStateAction } from 'react';
import { createWorkspaceEntry, resetWorkspaceState } from './store';
import type { LoomspaceState, PersistedWorkspaceStore } from './types';

interface WorkspaceSessionRuntime {
  state: LoomspaceState;
  workspaceStore: PersistedWorkspaceStore;
  setState: Dispatch<SetStateAction<LoomspaceState>>;
  setWorkspaceStore: Dispatch<SetStateAction<PersistedWorkspaceStore>>;
  resetTransientUi: () => void;
  setWorkspaceDraftTitle: (title: string) => void;
  setNavMenuOpen: (open: boolean) => void;
  setWorkspaceManagerOpen: (open: boolean) => void;
  workspaceCount: number;
}

export class WorkspaceSession {
  constructor(private readonly runtime: WorkspaceSessionRuntime) {}

  get workspaces() {
    return this.runtime.workspaceStore.workspaces;
  }

  get activeWorkspaceId() {
    return this.runtime.state.workspaceId;
  }

  openManager() {
    this.runtime.setWorkspaceDraftTitle('');
    this.runtime.setNavMenuOpen(false);
    this.runtime.setWorkspaceManagerOpen(true);
  }

  closeManager() {
    this.runtime.setWorkspaceDraftTitle('');
    this.runtime.setWorkspaceManagerOpen(false);
  }

  closeManagerAfterAction() {
    window.setTimeout(() => {
      this.runtime.setWorkspaceDraftTitle('');
      this.runtime.setWorkspaceManagerOpen(false);
    }, 0);
  }

  activate(workspaceId: string) {
    if (workspaceId === this.runtime.state.workspaceId) {
      this.closeManagerAfterAction();
      return;
    }
    this.runtime.setWorkspaceStore((current) =>
      current.workspaces.some((entry) => entry.id === workspaceId)
        ? { ...current, activeWorkspaceId: workspaceId }
        : current,
    );
    this.closeManagerAfterAction();
  }

  create(title: string) {
    const workspace = createWorkspaceEntry(title);
    this.runtime.setWorkspaceStore((current) => ({
      activeWorkspaceId: workspace.id,
      workspaces: [...current.workspaces, workspace],
    }));
    this.closeManagerAfterAction();
  }

  delete(workspaceId: string) {
    if (this.runtime.workspaceCount <= 1) return;
    const target = this.runtime.workspaceStore.workspaces.find((entry) => entry.id === workspaceId);
    if (!target) return;
    const title = target.state.title.trim() || 'Untitled workspace';
    const confirmed = window.confirm(
      `Delete workspace "${title}"?\n\nThis removes its threads, messages, and canvas layout from saved data. Your AI provider profiles and remaining workspaces stay intact.`,
    );
    if (!confirmed) return;
    this.runtime.setWorkspaceStore((current) => {
      const index = current.workspaces.findIndex((entry) => entry.id === workspaceId);
      if (index === -1 || current.workspaces.length <= 1) return current;
      const remaining = current.workspaces.filter((entry) => entry.id !== workspaceId);
      const nextActiveWorkspaceId = current.activeWorkspaceId === workspaceId
        ? remaining[Math.min(index, remaining.length - 1)].id
        : current.activeWorkspaceId;
      return { activeWorkspaceId: nextActiveWorkspaceId, workspaces: remaining };
    });
  }

  confirmReset() {
    const title = this.runtime.state.title.trim() || 'Untitled workspace';
    const confirmed = window.confirm(
      `Reset workspace "${title}"?\n\nThis clears its threads, messages, nodes, and canvas layout from saved data. Your AI provider profiles and other workspaces will be kept.`,
    );
    if (confirmed) this.reset();
  }

  reset() {
    this.runtime.setState(resetWorkspaceState(this.runtime.state));
    this.runtime.resetTransientUi();
  }
}
