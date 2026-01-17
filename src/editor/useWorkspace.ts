import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultWorkspace } from './defaultWorkspace';
import type { NodeId, WorkspaceFileDescriptor, WorkspaceNode, WorkspaceState } from './workspaceTypes';
import { isFile, isFolder, listFiles } from './workspaceTypes';

const DRAFT_KEY = 'vscode_editor_workspace_draft_v1';
const SAVED_KEY = 'vscode_editor_workspace_saved_v1';

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
  const [state, setState] = useState<WorkspaceState>(() => safeParseState(localStorage.getItem(DRAFT_KEY)) ?? safeParseState(localStorage.getItem(SAVED_KEY)) ?? defaultWorkspace);
  const savedRef = useRef<WorkspaceState>(safeParseState(localStorage.getItem(SAVED_KEY)) ?? defaultWorkspace);

  useEffect(() => {
    try {
      // Draft autosave so refresh doesn't lose edits.
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
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

  const isDirty = (fileId: NodeId): boolean => {
    const cur = state.nodes[fileId];
    const saved = savedRef.current.nodes[fileId];
    if (!cur || !saved) return false;
    if (!isFile(cur) || !isFile(saved)) return false;
    return cur.content !== saved.content || cur.name !== saved.name || cur.parentId !== saved.parentId;
  };

  const dirtyFileIds = useMemo(() => {
    const out: NodeId[] = [];
    for (const f of files) {
      if (isDirty(f.id)) out.push(f.id);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, state]);

  const saveFile = (fileId: NodeId) => {
    const cur = state.nodes[fileId];
    if (!cur || !isFile(cur)) return;
    try {
      const nextSaved: WorkspaceState = state;
      localStorage.setItem(SAVED_KEY, JSON.stringify(nextSaved));
      savedRef.current = nextSaved;
    } catch {
      // ignore
    }
  };

  const saveAll = () => {
    try {
      const nextSaved: WorkspaceState = state;
      localStorage.setItem(SAVED_KEY, JSON.stringify(nextSaved));
      savedRef.current = nextSaved;
    } catch {
      // ignore
    }
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
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(defaultWorkspace));
      localStorage.setItem(SAVED_KEY, JSON.stringify(defaultWorkspace));
    } catch {
      // ignore
    }
    savedRef.current = defaultWorkspace;
  };

  return {
    state,
    files,
    getNode,
    updateFileContent,
    isDirty,
    dirtyFileIds,
    saveFile,
    saveAll,
    createFile,
    renameNode,
    deleteNode,
    resetWorkspace,
  };
}

