export type NodeId = string;

export type WorkspaceFolderNode = {
  type: 'folder';
  id: NodeId;
  parentId: NodeId | null;
  name: string;
  childrenIds: NodeId[];
};

export type WorkspaceFileNode = {
  type: 'file';
  id: NodeId;
  parentId: NodeId;
  name: string;
  content: string;
};

export type WorkspaceNode = WorkspaceFolderNode | WorkspaceFileNode;

export type WorkspaceState = {
  rootId: NodeId;
  nodes: Record<NodeId, WorkspaceNode>;
};

export type WorkspaceFileDescriptor = {
  id: NodeId;
  name: string;
  path: string;
};

export function isFolder(node: WorkspaceNode): node is WorkspaceFolderNode {
  return node.type === 'folder';
}

export function isFile(node: WorkspaceNode): node is WorkspaceFileNode {
  return node.type === 'file';
}

export function getNodePath(state: WorkspaceState, nodeId: NodeId): string {
  const parts: string[] = [];
  let cur: WorkspaceNode | undefined = state.nodes[nodeId];
  while (cur) {
    if (cur.parentId === null) break; // root
    parts.push(cur.name);
    cur = state.nodes[cur.parentId];
  }
  return parts.reverse().join('/');
}

export function listFiles(state: WorkspaceState): WorkspaceFileDescriptor[] {
  const out: WorkspaceFileDescriptor[] = [];
  const walk = (id: NodeId) => {
    const node = state.nodes[id];
    if (!node) return;
    if (node.type === 'file') {
      out.push({ id: node.id, name: node.name, path: getNodePath(state, node.id) });
      return;
    }
    node.childrenIds.forEach(walk);
  };
  walk(state.rootId);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

