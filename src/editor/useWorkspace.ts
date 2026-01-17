import { useEffect, useMemo, useState } from 'react';
import { defaultWorkspace } from './defaultWorkspace';
import type { NodeId, WorkspaceFileDescriptor, WorkspaceNode, WorkspaceState } from './workspaceTypes';
import { isFile, isFolder, listFiles } from './workspaceTypes';

const STORAGE_KEY = 'vscode_editor_workspace_v1';

function safeParseState(raw: string | null): WorkspaceState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkspaceState;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.rootId !== 'string') return null;
    if (!parsed.nodes || typeof parsed.nodes !== 'object') return null;
    if (!parsed.nodes[parsed.rootId]) return null;
    return parsed;
  } catch {
    return null;
  }
}

function makeId(prefix = 'node'): NodeId {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function removeNodeRecursive(state: WorkspaceState, nodeId: NodeId): WorkspaceState {
  const node = state.nodes[nodeId];
  if (!node) return state;

  const next: WorkspaceState = { ...state, nodes: { ...state.nodes } };

  const unlinkFromParent = (n: WorkspaceNode) => {
    if (!n.parentId) return;
    const parent = next.nodes[n.parentId];
    if (!parent || !isFolder(parent)) return;
    parent.childrenIds = parent.childrenIds.filter((id) => id !== n.id);
    next.nodes[parent.id] = { ...parent };
  };

  const del = (id: NodeId) => {
    const n = next.nodes[id];
    if (!n) return;
    if (isFolder(n)) n.childrenIds.forEach(del);
    delete next.nodes[id];
  };

  unlinkFromParent(node);
  del(nodeId);
  return next;
}

export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>(() => safeParseState(localStorage.getItem(STORAGE_KEY)) ?? defaultWorkspace);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore persistence failures (quota, privacy mode, etc.)
    }
  }, [state]);

  const files = useMemo<WorkspaceFileDescriptor[]>(() => listFiles(state), [state]);

  const getNode = (id: NodeId) => state.nodes[id];

  const updateFileContent = (fileId: NodeId, content: string) => {
    setState((prev) => {
      const node = prev.nodes[fileId];
      if (!node || !isFile(node)) return prev;
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [fileId]: { ...node, content },
        },
      };
    });
  };

  const createFile = (parentFolderId: NodeId, name: string, content = ''): NodeId | null => {
    const parent = state.nodes[parentFolderId];
    if (!parent || !isFolder(parent)) return null;

    const trimmed = name.trim();
    if (!trimmed) return null;

    const existingNames = new Set(
      parent.childrenIds
        .map((id) => state.nodes[id])
        .filter(Boolean)
        .map((n) => n.name.toLowerCase())
    );

    let finalName = trimmed;
    if (existingNames.has(finalName.toLowerCase())) {
      const dot = finalName.lastIndexOf('.');
      const base = dot > 0 ? finalName.slice(0, dot) : finalName;
      const ext = dot > 0 ? finalName.slice(dot) : '';
      let i = 1;
      while (existingNames.has(`${base}_${i}${ext}`.toLowerCase())) i += 1;
      finalName = `${base}_${i}${ext}`;
    }

    const id = makeId('file');
    setState((prev) => {
      const p = prev.nodes[parentFolderId];
      if (!p || !isFolder(p)) return prev;
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [id]: { type: 'file', id, parentId: parentFolderId, name: finalName, content },
          [parentFolderId]: { ...p, childrenIds: [...p.childrenIds, id] },
        },
      };
    });
    return id;
  };

  const renameNode = (nodeId: NodeId, nextName: string) => {
    const name = nextName.trim();
    if (!name) return;
    setState((prev) => {
      const node = prev.nodes[nodeId];
      if (!node) return prev;
      return { ...prev, nodes: { ...prev.nodes, [nodeId]: { ...node, name } } };
    });
  };

  const deleteNode = (nodeId: NodeId) => {
    if (nodeId === state.rootId) return;
    setState((prev) => removeNodeRecursive(prev, nodeId));
  };

  const resetWorkspace = () => {
    setState(defaultWorkspace);
  };

  return {
    state,
    files,
    getNode,
    updateFileContent,
    createFile,
    renameNode,
    deleteNode,
    resetWorkspace,
  };
}

