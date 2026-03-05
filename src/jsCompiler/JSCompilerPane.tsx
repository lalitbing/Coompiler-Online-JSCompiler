import { useEffect, useMemo, useRef, useState } from 'react';
import { MonacoPane } from '../editor/MonacoPane';
import { runnerSrcDoc } from './runnerSrcDoc';
import MoonIcon from '@/components/ui/moon-icon';
import BrightnessDownIcon from '@/components/ui/brightness-down-icon';
import CommandIcon from '@/components/svg/command-icon';

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

function EnterArrowIcon({ className }: { className?: string }) {
  // Down-then-right arrow (Enter-like).
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M7 4v9a2 2 0 0 0 2 2h11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 11l4 4-4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShortcutPill({
  children,
  variant = 'dark',
}: {
  children: React.ReactNode;
  variant?: 'dark' | 'light';
}) {
  const base = 'inline-flex items-center gap-1 px-1.5 h-5 rounded-md border text-[11px] font-mono';
  const theme =
    variant === 'light'
      ? 'border-black/20 bg-black/10 text-[#0b1220]/90'
      : 'border-white/20 bg-white/10 text-white/90';
  return (
    <span className={`${base} ${theme}`}>{children}</span>
  );
}

export function JSCompilerPane() {
  const isDev = import.meta.env.DEV;
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
  const themeButtonTitle = `Theme: ${theme}. Click to switch to ${theme === 'dark' ? 'light' : 'dark'}.`;

  return (
    <div
      className={[
        'h-full font-[system-ui] flex flex-col',
        isLight ? 'bg-[#f6f7fb] text-[#0b1220]' : 'bg-[#0f1420] text-[#d7dce2]',
      ].join(' ')}
    >
      {/* Floating app header */}
      <div
        className={[
          'sticky top-0 z-40 h-12 px-5',
          'border-b backdrop-blur',
          isLight ? 'bg-white/80 border-black/10' : 'bg-[#171c28]/85 border-white/10',
          'shadow-[0_10px_30px_-20px_rgba(0,0,0,0.8)]',
        ].join(' ')}
      >
        <div className="h-full flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            <img
              src="/compiler.svg"
              alt="Coompiler logo"
              className="h-6 w-6 shrink-0"
              draggable={false}
            />
            <div className={['text-sm font-semibold tracking-wide', isLight ? 'text-[#0b1220]/90' : 'text-[#d7dce2]'].join(' ')}>
              Coompiler
            </div>
            <div className={['hidden sm:block text-[12px] truncate', isLight ? 'text-black/50' : 'text-[#8695b7]'].join(' ')}>
              Monaco based JavaScript Compiler
            </div>
          </div>

          <div className="flex items-center gap-2 justify-end">
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
              className={[
                'h-8 w-8 rounded-md grid place-items-center transition-all duration-150 ease-out',
                'hover:-translate-y-px active:translate-y-0 active:scale-[0.99] focus:outline-none focus:ring-2',
                isLight
                  ? 'text-[#0b1220]/70 hover:bg-black/5 focus:ring-black/15'
                  : 'text-[#a2aabc] hover:bg-white/10 focus:ring-white/15',
              ].join(' ')}
              title={themeButtonTitle}
              aria-label={`Theme: ${theme}. Click to toggle theme.`}
            >
              {isLight ? <MoonIcon size={16} /> : <BrightnessDownIcon size={16} />}
            </button>

            <button
              onClick={() => setShortcutsOpen(true)}
              className={[
                'hidden sm:inline-flex items-center gap-2',
                'h-8 px-2.5 rounded-md text-xs transition-all duration-150 ease-out',
                'hover:-translate-y-px active:translate-y-0 active:scale-[0.99] focus:outline-none focus:ring-2',
                isLight
                  ? 'text-[#0b1220]/70 hover:bg-black/5 focus:ring-black/15'
                  : 'text-[#a2aabc] hover:bg-white/10 focus:ring-white/15',
              ].join(' ')}
              title="Keyboard shortcuts"
            >
              <span>Shortcuts</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-2 sm:p-3">
        <div className="h-full grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 overflow-hidden">
          <div
            className={[
              'min-w-0 rounded-xl border overflow-hidden flex flex-col',
              isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#1d2433]',
              'shadow-[0_16px_40px_-32px_rgba(0,0,0,0.9)]',
            ].join(' ')}
          >
            <div
              className={[
                'min-h-10 p-3 sm:py-0 flex flex-wrap items-center justify-between gap-2 border-b',
                isLight ? 'border-black/10 bg-white/70' : 'border-white/10 bg-black/10',
              ].join(' ')}
            >
              <div className="min-w-0 flex items-center gap-2">
                <div className={['text-[12px] font-medium truncate', isLight ? 'text-[#0b1220]/75' : 'text-[#d7dce2]/90'].join(' ')}>
                  main.js
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {share && (
                  <button
                    onClick={() => {
                      try {
                        navigator.clipboard?.writeText(code);
                      } catch {
                        // ignore
                      }
                    }}
                    className={[
                      'h-7 px-2.5 rounded-md text-xs transition-all duration-150 ease-out',
                      'hover:-translate-y-px active:translate-y-0 active:scale-[0.99] focus:outline-none focus:ring-2',
                      isLight
                        ? 'text-[#0b1220]/70 hover:bg-black/5 focus:ring-black/15'
                        : 'text-[#a2aabc] hover:bg-white/10 focus:ring-white/15',
                    ].join(' ')}
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
                  className={[
                    'h-7 px-1.5 rounded-md text-xs transition-all duration-150 ease-out inline-flex items-center gap-2',
                    'hover:-translate-y-px active:translate-y-0 active:scale-[0.99] focus:outline-none focus:ring-2',
                    isLight
                      ? 'text-[#0b1220]/80 hover:bg-black/5 focus:ring-black/15'
                      : 'text-[#d7dce2]/90 hover:bg-white/10 focus:ring-white/15',
                  ].join(' ')}
                  title={`Suggestions ${suggestionsEnabled ? 'on' : 'off'}`}
                >
                  <span className="font-medium">Suggestions</span>
                  <span
                    className={[
                      'inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors duration-200',
                      suggestionsEnabled
                        ? 'bg-[#2563eb]'
                        : isLight
                          ? 'bg-black/20'
                          : 'bg-white/25',
                    ].join(' ')}
                    aria-hidden
                  >
                    <span
                      className={[
                        'h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                        suggestionsEnabled ? 'translate-x-4' : 'translate-x-0',
                      ].join(' ')}
                    />
                  </span>
                </button>
                <button
                  onClick={run}
                  className={[
                    'h-7 px-3 rounded-md text-xs font-semibold transition-all duration-150 ease-out',
                    'hover:-translate-y-px active:translate-y-0 active:scale-[0.99] focus:outline-none focus:ring-2',
                    'bg-[#2563eb] text-white hover:brightness-95 focus:ring-[#2563eb]/35',
                  ].join(' ')}
                  title={isMac ? 'Run (⌘+Enter)' : 'Run (Ctrl+Enter)'}
                >
                  <span className="flex items-center gap-2">
                    <span>Run</span>
                    <span className="hidden sm:inline-flex">
                      <ShortcutPill variant="dark">
                        {isMac ? <CommandIcon size={12} className="opacity-90" /> : <span>Ctrl</span>}
                        <EnterArrowIcon className="opacity-90" />
                      </ShortcutPill>
                    </span>
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
          </div>

          <div ref={splitContainerRef} className="min-w-0 min-h-0 flex flex-col">
            <div
              style={isDev ? { flexBasis: `${outputSplitPercent}%` } : undefined}
              className={[
                'min-h-0 rounded-xl border overflow-hidden flex flex-col',
                isDev ? '' : 'flex-1',
                isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#171c28]',
                'shadow-[0_16px_40px_-32px_rgba(0,0,0,0.9)]',
              ].join(' ')}
            >
              <div
                className={[
                  'min-h-10 p-3 sm:py-0 flex flex-wrap items-center justify-between gap-2 border-b',
                  isLight ? 'border-black/10 bg-white/70' : 'border-white/10 bg-black/10',
                ].join(' ')}
              >
                <div className="min-w-0 flex items-center gap-2">
                  <div className={['text-[12px] font-medium truncate', isLight ? 'text-[#0b1220]/75' : 'text-[#d7dce2]/90'].join(' ')}>
                    Output
                  </div>
                  <div className={['text-[12px]', isLight ? 'text-black/45' : 'text-[#8695b7]'].join(' ')}>
                    <span className={iframeReady ? 'text-[#16a34a]' : isLight ? 'text-[#b45309]' : 'text-[#ffcc66]'}>
                      {iframeReady ? 'ready' : 'loading'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={clear}
                    className={[
                      'h-7 px-3 rounded-md text-xs border transition-all duration-150 ease-out',
                      'hover:-translate-y-px active:translate-y-0 active:scale-[0.99] focus:outline-none focus:ring-2',
                      isLight
                        ? 'border-black/15 text-[#0b1220]/75 hover:bg-black/5 focus:ring-black/15'
                        : 'border-white/15 text-[#a2aabc] hover:bg-white/10 focus:ring-white/15',
                    ].join(' ')}
                    title={isMac ? 'Clear output (⌘+L)' : 'Clear output (Ctrl+L)'}
                  >
                    <span className="flex items-center gap-2">
                      <span>Clear</span>
                      <ShortcutPill variant={isLight ? 'light' : 'dark'}>
                        {isMac ? <CommandIcon size={12} className="opacity-90" /> : <span>Ctrl</span>}
                        <span>L</span>
                      </ShortcutPill>
                    </span>
                  </button>
                </div>
              </div>

              <div
                className={[
                  'flex-1 min-h-0 overflow-auto px-3 py-2 font-mono text-[12px] leading-5 select-text',
                  isLight ? 'text-[#0b1220]' : '',
                ].join(' ')}
              >
                {output.length === 0 ? (
                  <div className={isLight ? 'text-black/50' : 'text-[#8695b7]'}>No output</div>
                ) : (
                  <ul className="space-y-1">
                    {output.map((line, idx) => {
                      const color = isLight
                        ? line.kind === 'error'
                          ? 'text-[#b91c1c]'
                          : line.level === 'error'
                            ? 'text-[#b91c1c]'
                            : line.level === 'warn'
                              ? 'text-[#b45309]'
                              : line.level === 'info'
                                ? 'text-black/55'
                                : 'text-[#0b1220]'
                        : line.kind === 'error'
                          ? 'text-[#ff7b72]'
                          : line.level === 'error'
                            ? 'text-[#ff7b72]'
                            : line.level === 'warn'
                              ? 'text-[#ffcc66]'
                              : line.level === 'info'
                                ? 'text-[#a2aabc]'
                                : 'text-[#d7dce2]';
                      return (
                        <li key={idx} className={`whitespace-pre-wrap wrap-break-word ${color}`}>
                          <span className={['mr-2 select-none', isLight ? 'text-black/40' : 'text-[#6679a4]'].join(' ')}>
                            [{formatTime(line.ts)}]
                          </span>
                          {line.text}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {isDev && (
              <div
                className={[
                  'h-4 shrink-0 flex items-center justify-center',
                ].join(' ')}
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
                    'h-1.5 w-20 rounded-full border cursor-row-resize transition-colors',
                    isLight
                      ? 'border-black/10 bg-black/[0.08] hover:bg-black/[0.14]'
                      : 'border-white/15 bg-white/[0.15] hover:bg-white/[0.24]',
                  ].join(' ')}
                />
              </div>
            )}

            {isDev && (
              <div
                style={{ flexBasis: `${100 - outputSplitPercent}%` }}
                className={[
                  'min-h-0 rounded-xl border overflow-hidden flex flex-col',
                  isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#171c28]',
                  'shadow-[0_16px_40px_-32px_rgba(0,0,0,0.9)]',
                ].join(' ')}
              >
                <div
                  className={[
                    'min-h-10 p-3 sm:py-0 flex items-center justify-between gap-2 border-b',
                    isLight ? 'border-black/10 bg-white/70' : 'border-white/10 bg-black/10',
                  ].join(' ')}
                >
                  <div className={['text-[12px] font-medium truncate', isLight ? 'text-[#0b1220]/75' : 'text-[#d7dce2]/90'].join(' ')}>
                    Time Complexity Indicator
                  </div>
                  <span
                    className={[
                      'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      isLight ? 'bg-[#fef3c7] text-[#92400e] border border-[#f59e0b]/30' : 'bg-[#78350f] text-[#fde68a] border border-[#f59e0b]/30',
                    ].join(' ')}
                  >
                    Beta
                  </span>
                </div>

                <div className="flex-1 min-h-0 overflow-auto px-3 py-2 text-[12px] leading-5">
                  {complexityEntries.length === 0 ? (
                    <div className={isLight ? 'text-black/50' : 'text-[#8695b7]'}>
                      No function complexity data yet. Run code to analyze.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {complexityEntries.map((entry) => {
                        const bandClass = isLight
                          ? entry.complexity === 'O(1)'
                            ? 'bg-[#dcfce7] text-[#166534]'
                            : entry.complexity === 'O(n)'
                              ? 'bg-[#dbeafe] text-[#1d4ed8]'
                              : entry.complexity === 'O(n^2)'
                                ? 'bg-[#fef3c7] text-[#92400e]'
                                : 'bg-[#fee2e2] text-[#991b1b]'
                          : entry.complexity === 'O(1)'
                            ? 'bg-[#14532d] text-[#bbf7d0]'
                            : entry.complexity === 'O(n)'
                              ? 'bg-[#1e3a8a] text-[#bfdbfe]'
                              : entry.complexity === 'O(n^2)'
                                ? 'bg-[#78350f] text-[#fde68a]'
                                : 'bg-[#7f1d1d] text-[#fecaca]';

                        return (
                          <li
                            key={entry.name}
                            className={[
                              'rounded-md border p-2',
                              isLight ? 'border-black/10 bg-black/[0.015]' : 'border-white/10 bg-black/10',
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={['font-mono font-semibold', isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'].join(' ')}>
                                {entry.name}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${bandClass}`}>{entry.complexity}</span>
                            </div>
                            <div className={['mt-1', isLight ? 'text-black/65' : 'text-[#a2aabc]'].join(' ')}>
                              {entry.reason}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
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
      </div>

      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          onMouseDown={() => setShortcutsOpen(false)}
        >
          <div className="absolute inset-0 bg-black/55" />
          <div
            className={[
              'relative w-[min(560px,calc(100vw-24px))] rounded-xl border shadow-2xl',
              isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#1d2433]',
            ].join(' ')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={['flex items-center justify-between px-4 py-3 border-b', isLight ? 'border-black/10' : 'border-white/10'].join(' ')}>
              <div className="min-w-0">
                <div className={['text-sm font-semibold', isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'].join(' ')}>
                  Keyboard shortcuts
                </div>
                <div className={['text-[12px]', isLight ? 'text-black/50' : 'text-[#8695b7]'].join(' ')}>
                  Press Esc to close
                </div>
              </div>
              <button
                className={[
                  'h-7 w-7 grid place-items-center rounded',
                  isLight ? 'hover:bg-black/5 text-black/60' : 'hover:bg-white/10 text-[#a2aabc]',
                ].join(' ')}
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close shortcuts"
              >
                ×
              </button>
            </div>

            <div className="px-4 py-3 text-[13px]">
              <div className="space-y-4">
                <div>
                  <div className={['text-[11px] font-semibold uppercase tracking-wide', isLight ? 'text-black/50' : 'text-[#8695b7]'].join(' ')}>
                    App
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
                    <div className={isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'}>Run code</div>
                    <div
                      className={[
                        'font-mono flex items-center gap-1',
                        isLight ? 'text-[#2563eb]' : 'text-[#ffcc66]',
                      ].join(' ')}
                    >
                      {isMac ? <CommandIcon size={14} /> : <span>Ctrl</span>}
                      <span>Enter</span>
                    </div>

                    <div className={isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'}>Clear output</div>
                    <div
                      className={[
                        'font-mono flex items-center gap-1',
                        isLight ? 'text-[#2563eb]' : 'text-[#ffcc66]',
                      ].join(' ')}
                    >
                      {isMac ? <CommandIcon size={14} /> : <span>Ctrl</span>}
                      <span>L</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className={['text-[11px] font-semibold uppercase tracking-wide', isLight ? 'text-black/50' : 'text-[#8695b7]'].join(' ')}>
                    Editor (Monaco)
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
                    <div className={isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'}>Command palette</div>
                    <div className={['font-mono', isLight ? 'text-[#2563eb]' : 'text-[#ffcc66]'].join(' ')}>
                      {isMac ? 'F1 or ⇧⌘ P' : 'F1 or Ctrl Shift P'}
                    </div>

                    <div className={isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'}>Find</div>
                    <div className={['font-mono', isLight ? 'text-[#2563eb]' : 'text-[#ffcc66]'].join(' ')}>
                      {isMac ? '⌘ F' : 'Ctrl F'}
                    </div>

                    <div className={isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'}>Replace</div>
                    <div className={['font-mono', isLight ? 'text-[#2563eb]' : 'text-[#ffcc66]'].join(' ')}>
                      {isMac ? '⌥⌘ F' : 'Ctrl H'}
                    </div>

                    <div className={isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'}>Go to line</div>
                    <div className={['font-mono', isLight ? 'text-[#2563eb]' : 'text-[#ffcc66]'].join(' ')}>Ctrl G</div>

                    <div className={isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'}>Format document</div>
                    <div className={['font-mono', isLight ? 'text-[#2563eb]' : 'text-[#ffcc66]'].join(' ')}>
                      {isMac ? '⇧⌥ F' : 'Alt Shift F'}
                    </div>

                    <div className={isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'}>Toggle line comment</div>
                    <div className={['font-mono', isLight ? 'text-[#2563eb]' : 'text-[#ffcc66]'].join(' ')}>
                      {isMac ? '⌘ /' : 'Ctrl /'}
                    </div>

                    <div className={isLight ? 'text-[#0b1220]' : 'text-[#d7dce2]'}>Autocomplete / suggestions</div>
                    <div className={['font-mono', isLight ? 'text-[#2563eb]' : 'text-[#ffcc66]'].join(' ')}>Ctrl Space</div>
                  </div>
                </div>
              </div>

              <div className={['mt-4 text-[12px]', isLight ? 'text-black/55' : 'text-[#8695b7]'].join(' ')}>
                Note: code runs in a sandboxed iframe. Infinite loops can still freeze the tab (no “stop” yet).
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
