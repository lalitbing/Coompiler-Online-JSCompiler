import { useMemo, useState } from 'react';
import type { NodeId, WorkspaceState } from './workspaceTypes';
import { getNodePath, isFile, isFolder } from './workspaceTypes';

type ExplorerProps = {
  workspace: WorkspaceState;
  activeFileIds: Array<NodeId | null>;
  onOpenFile: (fileId: NodeId) => void;
  renderFileIcon?: (filePath: string, size?: number) => React.ReactNode;
};

function sortChildren(workspace: WorkspaceState, ids: NodeId[]): NodeId[] {
  return [...ids].sort((a, b) => {
    const na = workspace.nodes[a];
    const nb = workspace.nodes[b];
    if (!na || !nb) return 0;
    if (na.type !== nb.type) return na.type === 'folder' ? -1 : 1;
    return na.name.localeCompare(nb.name);
  });
}

export function Explorer({ workspace, activeFileIds, onOpenFile, renderFileIcon }: ExplorerProps) {
  const [expanded, setExpanded] = useState<Record<NodeId, boolean>>(() => ({ src: true }));

  const activeSet = useMemo(() => new Set(activeFileIds.filter(Boolean) as NodeId[]), [activeFileIds]);

  const toggle = (id: NodeId) => {
    if (id === workspace.rootId) return;
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderNode = (id: NodeId, depth: number): React.ReactNode => {
    const node = workspace.nodes[id];
    if (!node) return null;

    if (isFolder(node)) {
      const isRoot = node.parentId === null;
      const isOpen = isRoot ? true : !!expanded[node.id];
      const label = isRoot ? 'WORKSPACE' : node.name;
      const children = sortChildren(workspace, node.childrenIds);

      return (
        <div key={node.id}>
          <button
            type="button"
            onClick={() => toggle(node.id)}
            className={
              'w-full flex items-center gap-2 px-2 py-1 rounded text-left ' +
              (isRoot ? 'text-[#8695b7] uppercase tracking-wide text-xs' : 'text-[#a2aabc] hover:bg-[#1d2433]')
            }
            style={{ paddingLeft: isRoot ? 12 : 8 + depth * 14 }}
            aria-expanded={isOpen}
          >
            {!isRoot ? (
              <span className="w-3 text-[#8695b7] select-none">{isOpen ? '▾' : '▸'}</span>
            ) : (
              <span className="w-3" />
            )}
            <span className="truncate">{label}</span>
          </button>

          {isOpen && (
            <div>
              {children.map((childId) => (
                <div key={childId}>{renderNode(childId, isRoot ? 0 : depth + 1)}</div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (isFile(node)) {
      const path = getNodePath(workspace, node.id);
      const isActive = activeSet.has(node.id);
      return (
        <button
          key={node.id}
          type="button"
          onClick={() => onOpenFile(node.id)}
          className={'w-full text-left flex items-center gap-2 px-2 py-1 rounded ' + (isActive ? 'bg-[#2f3b54] text-[#d7dce2]' : 'hover:bg-[#1d2433] text-[#a2aabc]')}
          style={{ paddingLeft: 8 + depth * 14 }}
          title={path}
        >
          <span className="shrink-0">{renderFileIcon ? renderFileIcon(node.name, 18) : null}</span>
          <span className="truncate">{node.name}</span>
        </button>
      );
    }

    return null;
  };

  return <div className="px-2 pb-4 space-y-0.5">{renderNode(workspace.rootId, 0)}</div>;
}

