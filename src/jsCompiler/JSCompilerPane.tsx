import { useEffect, useMemo, useRef, useState } from 'react';
import { MonacoPane } from '../editor/MonacoPane';
import { runnerSrcDoc } from './runnerSrcDoc';
import MoonIcon from '@/components/ui/moon-icon';
import BrightnessDownIcon from '@/components/ui/brightness-down-icon';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowElbowDownLeft,
  Command,
  FileJs,
  Gauge,
  Keyboard,
  Play,
  Terminal,
  X,
} from '@phosphor-icons/react';

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

type RunnerToParentMessage =
  | { type: 'READY' }
  | { type: 'CONSOLE'; level: ConsoleLevel; args: unknown[]; runId: string }
  | { type: 'RUNTIME_ERROR'; message: string; stack?: string; runId: string }
  | { type: 'UNHANDLED_REJECTION'; message: string; stack?: string; runId: string };

type ParentToRunnerMessage = { type: 'RUN'; code: string; runId: string } | { type: 'RESET' };

type OutputLine =
  | { kind: 'console'; level: ConsoleLevel; text: string; ts: number; runId: string }
  | { kind: 'error'; text: string; ts: number; runId: string };

type ComplexityEntry = {
  name: string;
  complexity: string;
  reason: string;
};

type ResolvedTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'jscompiler_theme';
const LEGACY_THEME_MODE_STORAGE_KEY = 'jscompiler_theme_mode';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function parseUserTheme(saved: string | null): ResolvedTheme | null {
  if (saved === 'dark' || saved === 'light') return saved;
  return null;
}

function makeRunId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (typeof a === 'number' || typeof a === 'boolean' || typeof a === 'bigint') return String(a);
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (a instanceof Error) return a.stack || a.message;
      try {
        return JSON.stringify(a);
      } catch {
        try {
          return String(a);
        } catch {
          return '[Unserializable]';
        }
      }
    })
    .join(' ');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function parseRunnerMessage(v: unknown): RunnerToParentMessage | null {
  if (!isRecord(v)) return null;
  const t = v.type;
  if (t === 'READY') return { type: 'READY' };

  if (t === 'CONSOLE') {
    const level = v.level;
    const args = v.args;
    const runId = v.runId;
    if (
      (level === 'log' || level === 'info' || level === 'warn' || level === 'error' || level === 'debug') &&
      Array.isArray(args) &&
      typeof runId === 'string'
    ) {
      return { type: 'CONSOLE', level, args, runId };
    }
    return null;
  }

  if (t === 'RUNTIME_ERROR' || t === 'UNHANDLED_REJECTION') {
    const message = v.message;
    const stack = v.stack;
    const runId = v.runId;
    if (typeof message !== 'string' || typeof runId !== 'string') return null;
    if (stack !== undefined && typeof stack !== 'string') return null;
    return t === 'RUNTIME_ERROR'
      ? { type: 'RUNTIME_ERROR', message, stack, runId }
      : { type: 'UNHANDLED_REJECTION', message, stack, runId };
  }

  return null;
}

function sanitizeRuntimeErrorText(text: string): string {
  return text
    .replace(/\s*\(about:srcdoc:\d+:\d+\)/g, '')
    .replace(/\s*at about:srcdoc:\d+:\d+/g, '')
    .trim();
}

function findMatchingBrace(code: string, openBraceIndex: number): number {
  if (openBraceIndex < 0 || code[openBraceIndex] !== '{') return -1;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = openBraceIndex; i < code.length; i += 1) {
    const ch = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function estimateMaxImperativeLoopDepth(body: string): number {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  let loopDepth = 0;
  let maxLoopDepth = 0;
  let pendingLoopBlock = false;
  let pendingLoopStatement = false;
  let loopHeaderDepth = 0;
  let waitingForLoopHeader = false;

  const blockStack: number[] = [];

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const next = body[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (
      (body.startsWith('for', i) || body.startsWith('while', i) || body.startsWith('do', i)) &&
      (i === 0 || !/[A-Za-z0-9_$]/.test(body[i - 1] ?? '')) &&
      !/[A-Za-z0-9_$]/.test(body[i + (body.startsWith('while', i) ? 5 : body.startsWith('for', i) ? 3 : 2)] ?? '')
    ) {
      loopDepth += 1;
      maxLoopDepth = Math.max(maxLoopDepth, loopDepth);
      pendingLoopBlock = true;
      pendingLoopStatement = true;
      waitingForLoopHeader = !body.startsWith('do', i);
      i += body.startsWith('while', i) ? 4 : body.startsWith('for', i) ? 2 : 1;
      continue;
    }

    if (waitingForLoopHeader && ch === '(') {
      loopHeaderDepth = 1;
      waitingForLoopHeader = false;
      continue;
    }
    if (loopHeaderDepth > 0) {
      if (ch === '(') loopHeaderDepth += 1;
      if (ch === ')') loopHeaderDepth -= 1;
      continue;
    }

    if (ch === '{') {
      if (pendingLoopBlock) {
        blockStack.push(1);
        pendingLoopBlock = false;
        pendingLoopStatement = false;
      } else {
        blockStack.push(0);
      }
      continue;
    }

    if (ch === '}') {
      const delta = blockStack.pop() ?? 0;
      if (delta > 0) {
        loopDepth = Math.max(0, loopDepth - delta);
      }
      continue;
    }

    if (pendingLoopStatement && ch === ';') {
      loopDepth = Math.max(0, loopDepth - 1);
      pendingLoopStatement = false;
      pendingLoopBlock = false;
      continue;
    }
  }

  return maxLoopDepth;
}

function estimateFunctionComplexity(name: string, body: string): ComplexityEntry {
  const imperativeLoopDepth = estimateMaxImperativeLoopDepth(body);
  const iteratorMatches = body.match(/\.(forEach|map|filter|reduce|some|every|find|flatMap)\s*\(/g) ?? [];
  const iteratorDepth = iteratorMatches.length > 0 ? 1 : 0;
  const maxLoopDepth = Math.max(imperativeLoopDepth, iteratorDepth);
  const recursionMatches = body.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) ?? [];
  const recursionCalls = Math.max(0, recursionMatches.length - 1);

  if (recursionCalls > 1) {
    return {
      name,
      complexity: 'O(2^n)',
      reason: 'Multiple self-calls suggest branching recursion.',
    };
  }

  if (maxLoopDepth >= 3) {
    return {
      name,
      complexity: 'O(n^3)',
      reason: 'Three or more nested loop levels detected.',
    };
  }

  if (recursionCalls === 1 && maxLoopDepth >= 1) {
    return {
      name,
      complexity: 'O(n^2)',
      reason: 'Single recursion combined with looping work detected.',
    };
  }

  if (maxLoopDepth === 2) {
    return {
      name,
      complexity: 'O(n^2)',
      reason: 'Two nested loop levels detected.',
    };
  }

  if (maxLoopDepth === 1 || recursionCalls === 1) {
    return {
      name,
      complexity: 'O(n)',
      reason: recursionCalls === 1 ? 'Single recursive self-call detected.' : 'Single loop-like operation detected.',
    };
  }

  return {
    name,
    complexity: 'O(1)',
    reason: 'No loops or recursion detected.',
  };
}

function analyzeFunctionComplexity(code: string): ComplexityEntry[] {
  const entries: ComplexityEntry[] = [];
  const seen = new Set<string>();

  const functionDeclarationRegex = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = functionDeclarationRegex.exec(code)) !== null) {
    const name = match[1];
    const openBraceIndex = code.indexOf('{', match.index);
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex < 0 || seen.has(name)) continue;
    const body = code.slice(openBraceIndex + 1, closeBraceIndex);
    entries.push(estimateFunctionComplexity(name, body));
    seen.add(name);
  }

  const variableArrowOrFunctionRegex =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{)/g;
  while ((match = variableArrowOrFunctionRegex.exec(code)) !== null) {
    const name = match[1];
    if (seen.has(name)) continue;
    const openBraceIndex = code.indexOf('{', match.index);
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex < 0) continue;
    const body = code.slice(openBraceIndex + 1, closeBraceIndex);
    entries.push(estimateFunctionComplexity(name, body));
    seen.add(name);
  }

  const variableArrowExpressionRegex =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*([^;\n]+)/g;
  while ((match = variableArrowExpressionRegex.exec(code)) !== null) {
    const name = match[1];
    if (seen.has(name)) continue;
    const body = match[2] ?? '';
    entries.push(estimateFunctionComplexity(name, body));
    seen.add(name);
  }

  return entries;
}

function Kbd({ children, onAccent = false }: { children: React.ReactNode; onAccent?: boolean }) {
  return (
    <kbd
      className={[
        'inline-flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded px-1 font-mono text-[10.5px] leading-none',
        onAccent ? 'bg-white/20 text-accent-fg' : 'border border-line bg-surface-2 text-fg-2',
      ].join(' ')}
    >
      {children}
    </kbd>
  );
}

function ModKey({ isMac, size = 11 }: { isMac: boolean; size?: number }) {
  return isMac ? <Command size={size} weight="bold" aria-label="Command" /> : <span>Ctrl</span>;
}

const COMPLEXITY_BADGE: Record<string, string> = {
  'O(1)': 'bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] text-ok',
  'O(n)': 'bg-accent-soft text-accent',
  'O(n^2)': 'bg-warn-soft text-warn',
};

const ICON_BUTTON =
  'h-8 inline-flex items-center justify-center gap-2 rounded-lg text-fg-2 transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-fg active:scale-[0.97]';

const PANE = 'min-h-0 min-w-0 flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pane';

const PANE_HEADER = 'h-11 shrink-0 px-2 flex items-center justify-between gap-2 border-b border-line';

export function JSCompilerPane() {
  const isDev = import.meta.env.DEV;
  const reduceMotion = useReducedMotion();
  const [userTheme, setUserTheme] = useState<ResolvedTheme | null>(() => {
    // Follow system theme ONLY if user has never explicitly changed theme.
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      const parsed = parseUserTheme(saved);
      if (parsed) return parsed;

      // Migration from the previous implementation (theme mode).
      // - 'dark'/'light' => treat as user-set theme
      // - 'system' or missing => treat as never changed
      const legacyMode = localStorage.getItem(LEGACY_THEME_MODE_STORAGE_KEY);
      const legacyParsed = parseUserTheme(legacyMode);
      if (legacyParsed) return legacyParsed;

      return null;
    } catch {
      return null;
    }
  });

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      if (userTheme !== null) return; // user explicitly chose a theme; ignore system changes
      setSystemTheme(mql.matches ? 'dark' : 'light');
    };

    // On mount, sync system theme once (only if userTheme is unset).
    if (userTheme === null) setSystemTheme(mql.matches ? 'dark' : 'light');

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    }

    // Safari (older) fallback
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, [userTheme]);

  const theme: ResolvedTheme = userTheme ?? systemTheme;

  const [code, setCode] = useState(() => `// JSCompiler (browser)\n\nconsole.log('Hello from JSCompiler');\n`);

  const [output, setOutput] = useState<OutputLine[]>([]);
  const [iframeKey, setIframeKey] = useState(() => makeRunId());
  const [iframeReady, setIframeReady] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string>(iframeKey);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);
  const [complexityEntries, setComplexityEntries] = useState<ComplexityEntry[]>([]);
  const [outputSplitPercent, setOutputSplitPercent] = useState(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const pendingRunRef = useRef<{ code: string; runId: string } | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const srcDoc = useMemo(() => runnerSrcDoc(), []);
  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
    return /mac/i.test(String(platform));
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frameWindow = iframeRef.current?.contentWindow ?? null;
      if (!frameWindow || event.source !== frameWindow) return;
      // `srcDoc` + `sandbox="allow-scripts"` results in an opaque origin ("null").
      // If we ever switch to a same-origin runner, allow that too.
      if (event.origin !== 'null' && event.origin !== window.location.origin) return;

      const msg = parseRunnerMessage(event.data);
      if (!msg) return;
      if (msg.type === 'READY') {
        setIframeReady(true);
        const pending = pendingRunRef.current;
        if (pending && iframeRef.current?.contentWindow) {
          const run: ParentToRunnerMessage = { type: 'RUN', code: pending.code, runId: pending.runId };
          iframeRef.current.contentWindow.postMessage(run, '*');
          pendingRunRef.current = null;
        }
        return;
      }

      if ('runId' in msg && msg.runId && msg.runId !== activeRunId) return;

      if (msg.type === 'CONSOLE') {
        setOutput((prev) => [
          ...prev,
          {
            kind: 'console',
            level: msg.level,
            text: formatArgs(msg.args),
            ts: Date.now(),
            runId: msg.runId,
          },
        ]);
        return;
      }

      if (msg.type === 'RUNTIME_ERROR' || msg.type === 'UNHANDLED_REJECTION') {
        const headline = msg.type === 'UNHANDLED_REJECTION' ? `Unhandled rejection: ${msg.message}` : msg.message;
        setOutput((prev) => [
          ...prev,
          {
            kind: 'error',
            text: sanitizeRuntimeErrorText(headline),
            ts: Date.now(),
            runId: msg.runId,
          },
        ]);
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [activeRunId]);

  useEffect(() => {
    if (!isDraggingSplit) return;

    function onPointerMove(e: PointerEvent) {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;
      const rawPercent = ((e.clientY - rect.top) / rect.height) * 100;
      const nextPercent = Math.max(20, Math.min(80, rawPercent));
      setOutputSplitPercent(nextPercent);
    }

    function onPointerUp() {
      setIsDraggingSplit(false);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isDraggingSplit]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Run: Cmd+Enter (mac) / Ctrl+Enter (win/linux)
      const isEnter = e.key === 'Enter';
      const runCombo = isEnter && (isMac ? e.metaKey : e.ctrlKey);

      // Clear output: Cmd+L (mac) / Ctrl+L (win/linux)
      const clearCombo = e.key.toLowerCase() === 'l' && (isMac ? e.metaKey : e.ctrlKey);

      if (runCombo) {
        e.preventDefault();
        e.stopPropagation();
        setShortcutsOpen(false);
        run();
        return;
      }

      if (clearCombo) {
        e.preventDefault();
        e.stopPropagation();
        clear();
        return;
      }

      if (e.key === 'Escape') {
        setShortcutsOpen(false);
      }
    }

    // Capture phase so it still works when Monaco is focused.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMac, code]);

  const run = () => {
    const runId = makeRunId();
    setOutput([]);
    if (isDev) {
      setComplexityEntries(analyzeFunctionComplexity(code));
    } else {
      setComplexityEntries([]);
    }
    setIframeReady(false);
    setActiveRunId(runId);
    pendingRunRef.current = { code, runId };
    setIframeKey(runId); // remount iframe to reset state per run
  };

  const clear = () => {
    setOutput([]);
    setComplexityEntries([]);
  };


  useEffect(() => {
    try {
      if (userTheme === null) {
        // If user never changed theme, keep storage empty and remove legacy keys.
        localStorage.removeItem(THEME_STORAGE_KEY);
        localStorage.removeItem(LEGACY_THEME_MODE_STORAGE_KEY);
        return;
      }

      localStorage.setItem(THEME_STORAGE_KEY, userTheme);
      localStorage.removeItem(LEGACY_THEME_MODE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [userTheme]);

  const isLight = theme === 'light';
  const share = false;
  const themeButtonTitle = `Switch to ${isLight ? 'dark' : 'light'} theme`;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="h-full flex flex-col bg-bg text-fg font-sans">
      <header className="h-12 shrink-0 px-4 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2.5">
          <img src="/compiler.svg" alt="Coompiler logo" className="h-5 w-5 shrink-0" draggable={false} />
          <span className="text-[14px] font-semibold tracking-tight">Coompiler</span>
          <span className="hidden sm:block h-4 w-px bg-line-strong" aria-hidden />
          <span className="hidden sm:block text-[13px] text-fg-3 truncate">JavaScript playground, powered by Monaco</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShortcutsOpen(true)}
            className={`${ICON_BUTTON} max-sm:hidden px-2.5 text-[13px]`}
            title="Keyboard shortcuts"
          >
            <Keyboard size={16} />
            <span>Shortcuts</span>
          </button>
          {/*
            Theme follows system only until the user toggles.
            After first toggle, we persist the user's choice (dark/light).
          */}
          <button
            onClick={() => {
              setUserTheme((prev) => {
                const current = prev ?? systemTheme;
                return current === 'dark' ? 'light' : 'dark';
              });
            }}
            className={`${ICON_BUTTON} w-8`}
            title={themeButtonTitle}
            aria-label={themeButtonTitle}
          >
            {isLight ? <MoonIcon size={16} strokeWidth={1.75} /> : <BrightnessDownIcon size={17} strokeWidth={1.75} />}
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 px-3 pb-3">
        <div className="h-full grid grid-cols-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-1 gap-3">
          {/* Editor */}
          <section className={PANE} aria-label="Editor">
            <div className={PANE_HEADER}>
              <div className="min-w-0 h-8 px-2 flex items-center gap-2 text-[13px] font-medium">
                <FileJs size={16} weight="duotone" className="shrink-0 text-accent" />
                <span className="truncate">main.js</span>
              </div>
              <div className="flex items-center gap-1">
                {share && (
                  <button
                    onClick={() => {
                      try {
                        navigator.clipboard?.writeText(code);
                      } catch {
                        // ignore
                      }
                    }}
                    className={`${ICON_BUTTON} px-2.5 text-[13px]`}
                    title="Copy code to clipboard"
                  >
                    Share
                  </button>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={suggestionsEnabled}
                  onClick={() => setSuggestionsEnabled((prev) => !prev)}
                  className={`${ICON_BUTTON} px-2.5 text-[13px]`}
                  title={`Suggestions ${suggestionsEnabled ? 'on' : 'off'}`}
                >
                  <span>Suggestions</span>
                  <span
                    className={[
                      'inline-flex h-[18px] w-8 items-center rounded-full p-0.5 transition-colors duration-200',
                      suggestionsEnabled ? 'bg-accent' : 'bg-line-strong',
                    ].join(' ')}
                    aria-hidden
                  >
                    <span
                      className={[
                        'h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out',
                        suggestionsEnabled ? 'translate-x-3.5' : 'translate-x-0',
                      ].join(' ')}
                    />
                  </span>
                </button>
                <button
                  onClick={run}
                  className={[
                    'ml-1 h-8 pl-2.5 pr-1.5 rounded-lg inline-flex items-center gap-2 text-[13px] font-medium',
                    'bg-accent text-accent-fg hover:bg-accent-hover',
                    'shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]',
                  ].join(' ')}
                  title={isMac ? 'Run (⌘ Enter)' : 'Run (Ctrl Enter)'}
                >
                  <Play size={13} weight="fill" />
                  <span>Run</span>
                  <span className="hidden sm:inline-flex gap-0.5">
                    <Kbd onAccent>
                      <ModKey isMac={isMac} />
                    </Kbd>
                    <Kbd onAccent>
                      <ArrowElbowDownLeft size={11} weight="bold" aria-label="Enter" />
                    </Kbd>
                  </span>
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0">
              <MonacoPane
                path="/main.js"
                value={code}
                onChange={setCode}
                theme={theme}
                suggestionsEnabled={suggestionsEnabled}
              />
            </div>
          </section>

          <div ref={splitContainerRef} className="min-w-0 min-h-0 flex flex-col">
            {/* Output */}
            <section
              style={isDev ? { flexBasis: `${outputSplitPercent}%` } : undefined}
              className={`${PANE} ${isDev ? '' : 'flex-1'}`}
              aria-label="Output"
            >
              <div className={PANE_HEADER}>
                <div className="min-w-0 h-8 px-2 flex items-center gap-2 text-[13px]">
                  <Terminal size={16} className="shrink-0 text-fg-3" />
                  <span className="font-medium">Output</span>
                  {output.length > 0 && (
                    <span className="font-mono text-[11px] text-fg-3 tabular-nums">{output.length}</span>
                  )}
                  {!iframeReady && <span className="text-[12px] text-fg-3">Running…</span>}
                </div>
                <button
                  onClick={clear}
                  disabled={output.length === 0 && complexityEntries.length === 0}
                  className={`${ICON_BUTTON} px-2.5 text-[13px] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-2 disabled:active:scale-100`}
                  title={isMac ? 'Clear output (⌘ L)' : 'Clear output (Ctrl L)'}
                >
                  <span>Clear</span>
                  <span className="inline-flex gap-0.5">
                    <Kbd>
                      <ModKey isMac={isMac} />
                    </Kbd>
                    <Kbd>L</Kbd>
                  </span>
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-auto py-2 font-mono text-[12.5px] leading-[20px] select-text">
                {output.length === 0 ? (
                  <div className="h-full min-h-24 grid place-items-center px-6 text-center font-sans">
                    <div className="space-y-2">
                      <p className="text-[13px] text-fg-2">Console output will show up here.</p>
                      <p className="text-[12px] text-fg-3 inline-flex items-center gap-1.5">
                        Press
                        <Kbd>
                          <ModKey isMac={isMac} />
                        </Kbd>
                        <Kbd>
                          <ArrowElbowDownLeft size={11} weight="bold" aria-label="Enter" />
                        </Kbd>
                        to run
                      </p>
                    </div>
                  </div>
                ) : (
                  <ul>
                    {output.map((line, idx) => {
                      const tone =
                        line.kind === 'error' || line.level === 'error'
                          ? 'error'
                          : line.level === 'warn'
                            ? 'warn'
                            : line.level === 'info' || line.level === 'debug'
                              ? 'muted'
                              : 'default';
                      const rowClass =
                        tone === 'error'
                          ? 'bg-error-soft text-error border-error'
                          : tone === 'warn'
                            ? 'bg-warn-soft text-warn border-warn'
                            : tone === 'muted'
                              ? 'text-fg-2 border-transparent'
                              : 'text-fg border-transparent';
                      return (
                        <li
                          key={idx}
                          className={`grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-l-2 pl-[10px] pr-3 py-0.5 ${rowClass}`}
                        >
                          <span className="select-none text-fg-3 tabular-nums">{formatTime(line.ts)}</span>
                          <span className="whitespace-pre-wrap wrap-break-word">{line.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>

            {isDev && (
              <div
                className="group h-3 shrink-0 flex items-center justify-center cursor-row-resize"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setIsDraggingSplit(true);
                }}
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize output and complexity panels"
              >
                <div
                  className={[
                    'h-1 w-10 rounded-full transition-colors',
                    isDraggingSplit ? 'bg-accent' : 'bg-line-strong group-hover:bg-fg-3',
                  ].join(' ')}
                />
              </div>
            )}

            {isDev && (
              <section
                style={{ flexBasis: `${100 - outputSplitPercent}%` }}
                className={PANE}
                aria-label="Time complexity"
              >
                <div className={PANE_HEADER}>
                  <div className="min-w-0 h-8 px-2 flex items-center gap-2 text-[13px]">
                    <Gauge size={16} className="shrink-0 text-fg-3" />
                    <span className="font-medium truncate">Time complexity</span>
                    <span className="shrink-0 rounded-md border border-line px-1.5 py-px text-[11px] text-fg-3">Beta</span>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto p-2 text-[13px]">
                  {complexityEntries.length === 0 ? (
                    <div className="h-full min-h-20 grid place-items-center px-6 text-center text-[13px] text-fg-3">
                      Run your code to estimate the complexity of each function.
                    </div>
                  ) : (
                    <ul className="divide-y divide-line">
                      {complexityEntries.map((entry) => (
                        <li key={entry.name} className="px-2 py-2.5 flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="font-mono text-[12.5px] font-medium truncate">{entry.name}</div>
                            <div className="mt-0.5 text-[12.5px] text-fg-2">{entry.reason}</div>
                          </div>
                          <span
                            className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-medium ${
                              COMPLEXITY_BADGE[entry.complexity] ?? 'bg-error-soft text-error'
                            }`}
                          >
                            {entry.complexity}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}

            {/* Hidden-ish runner: sandboxed iframe */}
            <iframe
              key={iframeKey}
              ref={iframeRef}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              title="JSCompiler Runner"
              className="h-0 w-0 border-0 opacity-0 pointer-events-none"
            />
          </div>
        </div>
      </main>

      <AnimatePresence>
        {shortcutsOpen && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center p-3"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onMouseDown={() => setShortcutsOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
            <motion.div
              className="relative w-full max-w-[440px] rounded-xl border border-line bg-surface shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
              initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <div className="flex items-center justify-between pl-5 pr-3 h-14 border-b border-line">
                <h2 className="text-[15px] font-semibold tracking-tight">Keyboard shortcuts</h2>
                <button
                  className={`${ICON_BUTTON} w-8`}
                  onClick={() => setShortcutsOpen(false)}
                  aria-label="Close shortcuts"
                  autoFocus
                >
                  <X size={16} />
                </button>
              </div>

              <div className="px-5 py-4 space-y-5 text-[13px]">
                {[
                  {
                    group: 'App',
                    items: [
                      { label: 'Run code', keys: [<ModKey key="m" isMac={isMac} />, 'Enter'] },
                      { label: 'Clear output', keys: [<ModKey key="m" isMac={isMac} />, 'L'] },
                    ],
                  },
                  {
                    group: 'Editor',
                    items: [
                      { label: 'Command palette', keys: isMac ? ['⇧', '⌘', 'P'] : ['Ctrl', 'Shift', 'P'] },
                      { label: 'Find', keys: [<ModKey key="m" isMac={isMac} />, 'F'] },
                      { label: 'Replace', keys: isMac ? ['⌥', '⌘', 'F'] : ['Ctrl', 'H'] },
                      { label: 'Go to line', keys: ['Ctrl', 'G'] },
                      { label: 'Format document', keys: isMac ? ['⇧', '⌥', 'F'] : ['Shift', 'Alt', 'F'] },
                      { label: 'Toggle line comment', keys: [<ModKey key="m" isMac={isMac} />, '/'] },
                      { label: 'Trigger suggestions', keys: ['Ctrl', 'Space'] },
                    ],
                  },
                ].map((section) => (
                  <div key={section.group}>
                    <h3 className="mb-1.5 text-[12px] font-medium text-fg-3">{section.group}</h3>
                    <dl>
                      {section.items.map((item) => (
                        <div key={item.label} className="flex items-center justify-between gap-4 py-1.5">
                          <dt className="text-fg">{item.label}</dt>
                          <dd className="flex items-center gap-1">
                            {item.keys.map((k, i) => (
                              <Kbd key={i}>{k}</Kbd>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>

              <p className="px-5 py-3 border-t border-line text-[12px] text-fg-3">
                Code runs in a sandboxed iframe. Infinite loops can still freeze the tab.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
