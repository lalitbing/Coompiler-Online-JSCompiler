import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { MonacoPane } from './editor/MonacoPane';
import { Explorer } from './editor/Explorer';
import { useWorkspace } from './editor/useWorkspace';
import { getNodePath, isFile, type NodeId } from './editor/workspaceTypes';

type TabId = NodeId;
type GroupId = 'left' | 'right';

type ContextMenuState =
  | null
  | {
      x: number;
      y: number;
      type: 'tab';
      tabId: TabId;
      group: GroupId;
    };

function App() {
  const { state: workspace, files, getNode, updateFileContent, resetWorkspace } = useWorkspace();

  const defaultOpen = files[0]?.id ?? 'readme';

  const [leftOpenTabs, setLeftOpenTabs] = useState<TabId[]>([defaultOpen]);
  const [leftActiveTabId, setLeftActiveTabId] = useState<TabId>(defaultOpen);
  const [rightOpenTabs, setRightOpenTabs] = useState<TabId[]>([]);
  const [rightActiveTabId, setRightActiveTabId] = useState<TabId | null>(null);
  const [activeGroup, setActiveGroup] = useState<GroupId>('left');

  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [dragOffsetPx, setDragOffsetPx] = useState<number | null>(null);

  const filteredFiles = useMemo(() => {
    if (!query.trim()) return files;
    const q = query.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q));
  }, [files, query]);

  // Keep the active tab IDs valid if the workspace resets or nodes get deleted.
  useEffect(() => {
    const stillExists = (id: TabId | null) => (id ? !!getNode(id) : true);
    if (!stillExists(leftActiveTabId) && files[0]) setLeftActiveTabId(files[0].id);
    if (!stillExists(rightActiveTabId) && rightActiveTabId !== null) setRightActiveTabId(null);
    setLeftOpenTabs((prev) => prev.filter((id) => !!getNode(id)));
    setRightOpenTabs((prev) => prev.filter((id) => !!getNode(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.rootId, Object.keys(workspace.nodes).length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isResizing || !contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      const offset = dragOffsetPx ?? 0;
      const rawX = e.clientX - rect.left - offset;
      const clampedX = Math.min(Math.max(rawX, 100), rect.width - 100);
      const ratio = clampedX / rect.width;
      setSplitRatio(Math.min(Math.max(ratio, 0.2), 0.8));
    }
    function onUp() {
      setIsResizing(false);
      setDragOffsetPx(null);
    }
    if (isResizing) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect as string;
      document.body.style.cursor = 'col-resize';
      (document.body.style as any).userSelect = 'none';
      return () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = prevCursor || '';
        (document.body.style as any).userSelect = prevSelect || '';
      };
    }
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragOffsetPx, isResizing]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    document.addEventListener('click', closeMenu);
    document.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [contextMenu]);

  function TabContextMenu({
    x,
    y,
    onClose,
    onCloseTab,
    onCloseOthers,
    onCloseRight,
    onCloseAll,
    onSplitLeft,
    onSplitRight,
    showSplit,
  }: {
    x: number;
    y: number;
    onClose: () => void;
    onCloseTab: () => void;
    onCloseOthers: () => void;
    onCloseRight: () => void;
    onCloseAll: () => void;
    onSplitLeft: () => void;
    onSplitRight: () => void;
    showSplit: boolean;
  }) {
    const style: React.CSSProperties = {
      left: Math.min(x, window.innerWidth - 200),
      top: Math.min(y, window.innerHeight - 160),
    };
    return (
      <div className="fixed z-9999" style={style} role="menu">
        <div
          className="rounded-lg shadow-2xl py-1"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.06) 100%)',
            backdropFilter: 'blur(14px) saturate(140%)',
            WebkitBackdropFilter: 'blur(14px) saturate(140%)',
            border: '1px solid rgba(255,255,255,0.18)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45), inset 0 1px rgba(255,255,255,0.08), 0 0 0 0.5px rgba(255,255,255,0.06)',
            width: 160,
          }}
        >
          <button
            onClick={() => {
              onCloseTab();
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] text-white/90 hover:bg-white/15"
            role="menuitem"
          >
            Close
          </button>
          <button
            onClick={() => {
              onCloseOthers();
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] text-white/90 hover:bg-white/15"
            role="menuitem"
          >
            Close Others
          </button>
          <button
            onClick={() => {
              onCloseRight();
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] text-white/90 hover:bg-white/15"
            role="menuitem"
          >
            Close to the Right
          </button>
          <button
            onClick={() => {
              onCloseAll();
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] text-white/90 hover:bg-white/15"
            role="menuitem"
          >
            Close All
          </button>
          {showSplit && (
            <>
              <div className="my-1 h-px bg-white/15" />
              <button
                onClick={() => {
                  onSplitLeft();
                  onClose();
                }}
                className="w-full text-left px-3 py-1.5 text-[13px] text-white/90 hover:bg-white/15"
                role="menuitem"
              >
                Split Left
              </button>
              <button
                onClick={() => {
                  onSplitRight();
                  onClose();
                }}
                className="w-full text-left px-3 py-1.5 text-[13px] text-white/90 hover:bg-white/15"
                role="menuitem"
              >
                Split Right
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  function FileIcon({ filePath, className, size = 18 }: { filePath: string; className?: string; size?: number }) {
    const name = filePath.toLowerCase();
    const ext = name.split('.').pop() || '';

    function Svg({ children }: { children: React.ReactNode }) {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
          {children}
        </svg>
      );
    }

    if (ext === 'tsx' || name.endsWith('.jsx')) {
      return (
        <Svg>
          <circle cx="8" cy="8" r="2" fill="#00d8ff" />
          <g stroke="#00d8ff" strokeWidth="1" fill="none">
            <ellipse cx="8" cy="8" rx="6" ry="2.5" />
            <ellipse cx="8" cy="8" rx="6" ry="2.5" transform="rotate(60 8 8)" />
            <ellipse cx="8" cy="8" rx="6" ry="2.5" transform="rotate(120 8 8)" />
          </g>
        </Svg>
      );
    }

    if (ext === 'ts') {
      return (
        <Svg>
          <rect x="1" y="2" width="14" height="12" rx="2" fill="#2f74c0" />
          <text x="8" y="11" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff" fontFamily="Inter, system-ui, sans-serif">
            TS
          </text>
        </Svg>
      );
    }

    if (name === 'vite.config.ts' || name === 'vite.config.js') {
      return (
        <Svg>
          <path d="M2 3l6 10 6-10z" fill="#ffcc66" />
          <path d="M2.5 3.2L8 12 13.5 3.2" stroke="#7c4dff" strokeWidth="1.3" fill="none" />
        </Svg>
      );
    }

    if (ext === 'html') {
      return (
        <Svg>
          <path d="M2 2h12l-1 11-5 1-5-1z" fill="#e54d26" />
          <path d="M8 3v9" stroke="#fff" strokeWidth="1" />
          <path d="M5 5h3m0 0h3M5 8h6M5 11h6" stroke="#fff" strokeWidth="1" />
        </Svg>
      );
    }

    if (ext === 'css') {
      return (
        <Svg>
          <rect x="1" y="2" width="14" height="12" rx="2" fill="#8a5cf6" />
          <text x="8" y="11" textAnchor="middle" fontSize="6.5" fontWeight="800" fill="#fff" fontFamily="Inter, system-ui, sans-serif">
            CSS
          </text>
        </Svg>
      );
    }

    if (name.includes('eslint') && (ext === 'js' || ext === 'cjs' || ext === 'mjs')) {
      return (
        <Svg>
          <polygon points="8,2 12.9,5 12.9,11 8,14 3.1,11 3.1,5" fill="#4b32c3" />
          <text x="8" y="10.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff" fontFamily="Inter, system-ui, sans-serif">
            ES
          </text>
        </Svg>
      );
    }

    if (name === 'package.json' || name === 'package-lock.json') {
      return (
        <Svg>
          <rect x="1" y="3" width="14" height="10" rx="2" fill="#cb3837" />
          <text x="8" y="10.5" textAnchor="middle" fontSize="6" fontWeight="800" fill="#fff" fontFamily="Inter, system-ui, sans-serif">
            npm
          </text>
        </Svg>
      );
    }

    if (name.startsWith('tsconfig') && ext === 'json') {
      return (
        <Svg>
          <rect x="1" y="2" width="14" height="12" rx="2" fill="#2f74c0" />
          <text x="8" y="10.5" textAnchor="middle" fontSize="6.5" fontWeight="800" fill="#fff" fontFamily="Inter, system-ui, sans-serif">
            TS
          </text>
          <circle cx="12.5" cy="4.5" r="2" stroke="#fff" strokeWidth="1" fill="none" />
          <circle cx="12.5" cy="4.5" r="1" fill="#fff" />
        </Svg>
      );
    }

    if (name === '.gitignore') {
      return (
        <Svg>
          <rect x="2" y="3" width="12" height="10" rx="2" fill="#f05133" />
          <path d="M5 6l6 4M11 6l-6 4" stroke="#fff" strokeWidth="1.2" />
        </Svg>
      );
    }

    if (ext === 'md') {
      return (
        <Svg>
          <rect x="2" y="2" width="12" height="12" rx="2" fill="#ffcc66" />
          <path d="M4 4h8M4 7h8M4 10h5" stroke="#3b2e1a" strokeWidth="1" />
        </Svg>
      );
    }

    if (ext === 'json') {
      return (
        <Svg>
          <rect x="1" y="2" width="14" height="12" rx="2" fill="#f29f3a" />
          <text x="8" y="11" textAnchor="middle" fontSize="7" fontWeight="800" fill="#0b1220" fontFamily="Inter, system-ui, sans-serif">{`{}`}</text>
        </Svg>
      );
    }

    return (
      <Svg>
        <rect x="1" y="2" width="14" height="12" rx="2" fill="#7f8c98" />
        <text
          x="8"
          y="11"
          textAnchor="middle"
          fontSize={ext.length > 3 ? 5.5 : 6.5}
          fontWeight="800"
          fill="#0b1220"
          fontFamily="Inter, system-ui, sans-serif"
        >
          {ext ? ext.toUpperCase() : 'TXT'}
        </text>
      </Svg>
    );
  }

  function handleTabDragStart(index: number, e: React.DragEvent<HTMLDivElement>) {
    setDragIndex(index);
    setDragOverIndex(index);
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', leftOpenTabs[index]);
    } catch {}
  }

  function handleTabDragOver(index: number, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (dragOverIndex !== index) setDragOverIndex(index);
  }

  function handleTabDrop(index: number, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (dragIndex === null) return;
    if (index === dragIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const next = [...leftOpenTabs];
    const [moved] = next.splice(dragIndex, 1);
    const insertIndex = dragIndex < index ? index - 1 : index;
    next.splice(insertIndex, 0, moved);
    setLeftOpenTabs(next);
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function handleTabDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function openFile(tabId: TabId, target: GroupId = activeGroup) {
    const node = getNode(tabId);
    if (!node || !isFile(node)) return;

    if (target === 'left') {
      setLeftOpenTabs((prev) => (prev.includes(tabId) ? prev : [...prev, tabId]));
      setLeftActiveTabId(tabId);
      setActiveGroup('left');
      return;
    }

    setRightOpenTabs((prev) => (prev.includes(tabId) ? prev : [...prev, tabId]));
    setRightActiveTabId(tabId);
    setActiveGroup('right');
  }

  function closeTab(tabId: TabId, group: GroupId) {
    if (group === 'left') {
      setLeftOpenTabs((prev) => {
        const idx = prev.findIndex((t) => t === tabId);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t !== tabId);
        if (leftActiveTabId === tabId) {
          const fallback = next[idx - 1] || next[idx] || files[0]?.id || tabId;
          setLeftActiveTabId(fallback);
        }
        return next;
      });
      return;
    }

    setRightOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t === tabId);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t !== tabId);
      if (rightActiveTabId === tabId) {
        const fallback = next[idx - 1] || next[idx] || null;
        setRightActiveTabId(fallback);
      }
      return next;
    });
  }

  function closeOthers(tabId: TabId, group: GroupId) {
    if (group === 'left') {
      setLeftOpenTabs([tabId]);
      setLeftActiveTabId(tabId);
      return;
    }
    setRightOpenTabs([tabId]);
    setRightActiveTabId(tabId);
  }

  function closeToRight(tabId: TabId, group: GroupId) {
    if (group === 'left') {
      setLeftOpenTabs((prev) => {
        const idx = prev.findIndex((t) => t === tabId);
        if (idx === -1) return prev;
        setLeftActiveTabId(tabId);
        return prev.slice(0, idx + 1);
      });
      return;
    }

    setRightOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t === tabId);
      if (idx === -1) return prev;
      setRightActiveTabId(tabId);
      return prev.slice(0, idx + 1);
    });
  }

  function closeAllTabs() {
    setLeftOpenTabs([]);
    setRightOpenTabs([]);
    setLeftActiveTabId(files[0]?.id ?? leftActiveTabId);
    setRightActiveTabId(null);
  }

  function splitTab(tabId: TabId, direction: GroupId, fromGroup: GroupId) {
    if (direction === 'right') {
      setRightOpenTabs((prev) => (prev.includes(tabId) ? prev : [...prev, tabId]));
      setRightActiveTabId(tabId);
      if (fromGroup === 'left') {
        setLeftOpenTabs((prev) => prev.filter((t) => t !== tabId));
        if (leftActiveTabId === tabId) setLeftActiveTabId(leftOpenTabs.find((t) => t !== tabId) ?? (files[0]?.id ?? tabId));
      }
      setActiveGroup('right');
      return;
    }

    setLeftOpenTabs((prev) => (prev.includes(tabId) ? prev : [...prev, tabId]));
    setLeftActiveTabId(tabId);
    if (fromGroup === 'right') {
      setRightOpenTabs((prev) => prev.filter((t) => t !== tabId));
      if (rightActiveTabId === tabId) setRightActiveTabId(rightOpenTabs.find((t) => t !== tabId) ?? null);
    }
    setActiveGroup('left');
  }

  function renderEditor(group: GroupId, tabId: TabId | null) {
    if (!tabId) {
      return (
        <div className="h-full w-full flex items-center justify-center text-[#8695b7] text-sm">
          Open a file to start editing
        </div>
      );
    }
    const node = getNode(tabId);
    if (!node || !isFile(node)) {
      return (
        <div className="h-full w-full flex items-center justify-center text-[#8695b7] text-sm">
          File not found
        </div>
      );
    }
    const path = getNodePath(workspace, tabId);
    return (
      <div className="h-full w-full" onMouseDown={() => setActiveGroup(group)}>
        <MonacoPane path={path} value={node.content} onChange={(next) => updateFileContent(tabId, next)} />
      </div>
    );
  }

  const activeId = activeGroup === 'left' ? leftActiveTabId : rightActiveTabId;
  const activePath = activeId ? getNodePath(workspace, activeId) : '';

  return (
    <div className="h-full bg-[#171c28] text-[#d7dce2] font-[system-ui] flex flex-col">
      <div className="h-10 border-b border-[#2f3b54] grid grid-cols-[1fr_auto_1fr] items-center p-1.5 gap-3 bg-[#171c28]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label="Toggle Explorer"
            className="group h-7 w-7 grid place-items-center rounded bg-transparent hover:bg-[#2f3b54] transition-colors"
          >
            <svg
              className="row-start-1 col-start-1 transition-opacity duration-150 opacity-100 group-hover:opacity-0 text-[#d7dce2]"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M9 5v14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <svg
              className={`row-start-1 col-start-1 transition-opacity duration-150 opacity-0 group-hover:opacity-100 text-[#d7dce2] ${
                sidebarCollapsed ? '' : '-scale-x-100'
              }`}
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path d="M16.5 3C16.7761 3 17 3.22386 17 3.5V16.5L16.9902 16.6006C16.9437 16.8286 16.7417 17 16.5 17C16.2583 17 16.0563 16.8286 16.0098 16.6006L16 16.5V3.5C16 3.22386 16.2239 3 16.5 3ZM8.12793 5.16504C8.28958 4.98547 8.5524 4.95058 8.75293 5.06836L8.83496 5.12793L13.835 9.62793C13.9403 9.72275 14 9.85828 14 10C14 10.1063 13.9667 10.2093 13.9053 10.2939L13.835 10.3721L8.83496 14.8721C8.62972 15.0568 8.31267 15.0402 8.12793 14.835C7.94322 14.6297 7.95984 14.3127 8.16504 14.1279L12.1963 10.5H3.5C3.22386 10.5 3 10.2761 3 10C3 9.72386 3.22386 9.5 3.5 9.5H12.1963L8.16504 5.87207L8.09766 5.79688C7.95931 5.60979 7.96622 5.34471 8.12793 5.16504Z"></path>
            </svg>
          </button>
          <div className="text-[#d7dce2] text-sm font-medium">VSCode Editor</div>
        </div>

        <div className="w-full max-w-lg justify-self-center relative">
          <div className="flex items-center gap-2 bg-[#2f3b54] rounded px-2 py-1 focus-within:ring-1 focus-within:ring-[#ffcc66]/70">
            <span className="text-[#8695b7] text-xs">⌘K</span>
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const first = filteredFiles[0];
                  if (first) {
                    openFile(first.id);
                    setQuery('');
                  }
                }
              }}
              placeholder="Quick Open..."
              className="bg-transparent outline-none text-sm w-full placeholder:text-[#8695b7] text-[#d7dce2]"
            />
          </div>
          {query.trim() && (
            <div className="absolute left-0 right-0 mt-1 z-50 bg-[#1d2433] border border-[#2f3b54] rounded shadow-lg">
              <ul className="max-h-72 overflow-auto py-1">
                {filteredFiles.length ? (
                  filteredFiles.map((f) => (
                    <li key={f.id}>
                      <button
                        onClick={() => {
                          openFile(f.id);
                          setQuery('');
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-[#2f3b54] text-[#d7dce2] flex items-center gap-2"
                      >
                        <FileIcon filePath={f.name} size={16} />
                        <div className="flex flex-col leading-tight min-w-0">
                          <div className="text-[13px] truncate">{f.path}</div>
                          <div className="text-[11px] text-[#8695b7]">Open file</div>
                        </div>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="px-3 py-2 text-[#8695b7] text-sm">No results</li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pr-1">
          <button
            onClick={() => {
              resetWorkspace();
              setLeftOpenTabs([defaultOpen]);
              setLeftActiveTabId(defaultOpen);
              setRightOpenTabs([]);
              setRightActiveTabId(null);
            }}
            className="h-7 px-2 rounded text-xs text-[#a2aabc] hover:bg-[#2f3b54]"
            title="Reset workspace (clears local changes)"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="flex-1 flex" ref={contentRef}>
        {!sidebarCollapsed && (
          <aside className="w-36 sm:w-48 md:w-56 lg:w-64 border-r border-[#2f3b54] bg-[#171c28]">
            <div className="px-3 py-2 text-xs uppercase tracking-wide text-[#8695b7]">Explorer</div>
            <Explorer
              workspace={workspace}
              activeFileIds={[leftActiveTabId, rightActiveTabId]}
              onOpenFile={(id) => openFile(id)}
              renderFileIcon={(filePath, size) => <FileIcon filePath={filePath} size={size ?? 18} />}
            />
          </aside>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div className="flex flex-col border-r border-[#2f3b54]" style={{ width: rightOpenTabs.length ? `${splitRatio * 100}%` : '100%' }}>
            <div className="h-9 border-b border-[#2f3b54] bg-[#171c28] flex items-stretch overflow-x-auto">
              {leftOpenTabs.map((tab, index) => {
                const node = getNode(tab);
                if (!node || !isFile(node)) return null;
                const path = getNodePath(workspace, tab);
                return (
                  <div
                    key={tab}
                    className={
                      'flex items-center gap-2 px-3 text-sm border-r border-[#2f3b54] select-none cursor-pointer ' +
                      (leftActiveTabId === tab ? 'bg-[#1d2433] text-[#d7dce2] border-b-2 border-b-[#ffcc66]' : 'text-[#8695b7] hover:bg-[#1d2433]')
                    }
                    onClick={() => {
                      setLeftActiveTabId(tab);
                      setActiveGroup('left');
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ x: e.clientX, y: e.clientY, type: 'tab', tabId: tab, group: 'left' });
                    }}
                    draggable
                    onDragStart={(e) => handleTabDragStart(index, e)}
                    onDragOver={(e) => handleTabDragOver(index, e)}
                    onDrop={(e) => handleTabDrop(index, e)}
                    onDragEnd={handleTabDragEnd}
                    role="button"
                    data-tab-id={tab}
                    style={dragOverIndex === index && dragIndex !== null && dragIndex !== index ? { boxShadow: 'inset -2px 0 0 #ffcc66' } : undefined}
                    title={path}
                  >
                    <FileIcon filePath={node.name} size={16} />
                    <span className="max-w-48 truncate">{node.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab, 'left');
                      }}
                      className={leftActiveTabId === tab ? 'text-[#8695b7] hover:text-[#d7dce2]' : 'text-[#6679a4] hover:text-[#a2aabc]'}
                      aria-label={`Close ${node.name}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex-1 min-w-0 bg-[#1d2433]">{renderEditor('left', leftActiveTabId)}</div>
          </div>

          {rightOpenTabs.length ? (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizing(true);
                if (contentRef.current) {
                  const rect = contentRef.current.getBoundingClientRect();
                  const currentSplitterX = rect.left + splitRatio * rect.width;
                  setDragOffsetPx(e.clientX - currentSplitterX);
                }
              }}
              className="w-1.5 cursor-col-resize bg-transparent hover:bg-white/10"
            />
          ) : null}

          <div
            className="flex flex-col"
            style={{ width: rightOpenTabs.length ? `${(1 - splitRatio) * 100}%` : 0, display: rightOpenTabs.length ? 'flex' : 'none' }}
          >
            <div className="h-9 border-b border-[#2f3b54] bg-[#171c28] flex items-stretch overflow-x-auto">
              {rightOpenTabs.map((tab) => {
                const node = getNode(tab);
                if (!node || !isFile(node)) return null;
                const path = getNodePath(workspace, tab);
                return (
                  <div
                    key={tab}
                    className={
                      'flex items-center gap-2 px-3 text-sm border-r border-[#2f3b54] select-none cursor-pointer ' +
                      (rightActiveTabId === tab ? 'bg-[#1d2433] text-[#d7dce2] border-b-2 border-b-[#ffcc66]' : 'text-[#8695b7] hover:bg-[#1d2433]')
                    }
                    onClick={() => {
                      setRightActiveTabId(tab);
                      setActiveGroup('right');
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ x: e.clientX, y: e.clientY, type: 'tab', tabId: tab, group: 'right' });
                    }}
                    role="button"
                    data-tab-id={tab}
                    title={path}
                  >
                    <FileIcon filePath={node.name} size={16} />
                    <span className="max-w-48 truncate">{node.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab, 'right');
                      }}
                      className={rightActiveTabId === tab ? 'text-[#8695b7] hover:text-[#d7dce2]' : 'text-[#6679a4] hover:text-[#a2aabc]'}
                      aria-label={`Close ${node.name}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex-1 min-w-0 bg-[#1d2433]">{renderEditor('right', rightActiveTabId)}</div>
          </div>
        </div>
      </div>

      <footer className="h-7 border-t border-[#2f3b54] bg-[#171c28] flex items-center justify-between px-3 text-[12px] text-[#8695b7] select-none">
        <div className="flex items-center gap-3">
          <span className="text-[#a2aabc]">main</span>
          <span>0 problems</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="truncate max-w-[45vw]" title={activePath}>
            {activePath || 'No file'}
          </span>
          <span>UTF-8</span>
          <span>LF</span>
        </div>
      </footer>

      {contextMenu && contextMenu.type === 'tab' && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onCloseTab={() => closeTab(contextMenu.tabId, contextMenu.group)}
          onCloseOthers={() => closeOthers(contextMenu.tabId, contextMenu.group)}
          onCloseRight={() => closeToRight(contextMenu.tabId, contextMenu.group)}
          onCloseAll={closeAllTabs}
          onSplitLeft={() => splitTab(contextMenu.tabId, 'left', contextMenu.group)}
          onSplitRight={() => splitTab(contextMenu.tabId, 'right', contextMenu.group)}
          showSplit={(contextMenu.group === 'left' ? leftOpenTabs.length : rightOpenTabs.length) >= 2}
        />
      )}
    </div>
  );
}

export default App;
