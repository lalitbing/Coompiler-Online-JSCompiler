import Editor, { type Monaco, type OnChange, type OnMount } from '@monaco-editor/react';

type MonacoPaneProps = {
  path: string;
  value: string;
  onChange: (nextValue: string) => void;
  readOnly?: boolean;
  theme?: 'dark' | 'light';
  suggestionsEnabled?: boolean;
};

let didConfigureMonaco = false;

function languageFromPath(path: string): string {
  const lower = path.toLowerCase();
  const ext = lower.split('.').pop() ?? '';

  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'md':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    default:
      return 'plaintext';
  }
}

export function MonacoPane({
  path,
  value,
  onChange,
  readOnly,
  theme = 'dark',
  suggestionsEnabled = true,
}: MonacoPaneProps) {
  const handleChange: OnChange = (next) => onChange(next ?? '');

  const beforeMount = (monaco: Monaco) => {
    if (didConfigureMonaco) return;
    didConfigureMonaco = true;

    // Editor chrome matches the app tokens in src/index.css (--surface, --border, --accent).
    monaco.editor.defineTheme('coompiler-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6b6b75', fontStyle: 'italic' },
        { token: 'string', foreground: '9ece8a' },
        { token: 'keyword', foreground: '8fb3ff' },
        { token: 'number', foreground: 'e0af68' },
      ],
      colors: {
        'editor.background': '#131316',
        'editor.foreground': '#ececef',
        'editorLineNumber.foreground': '#45454d',
        'editorLineNumber.activeForeground': '#a1a1aa',
        'editor.lineHighlightBackground': '#1a1a1e',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': '#3b82f640',
        'editorCursor.foreground': '#3b82f6',
        'editorIndentGuide.background1': '#232327',
        'editorWidget.background': '#1a1a1e',
        'editorWidget.border': '#303036',
        'editorSuggestWidget.background': '#1a1a1e',
        'editorSuggestWidget.border': '#303036',
        'editorSuggestWidget.selectedBackground': '#3b82f62e',
        'scrollbarSlider.background': '#ffffff14',
        'scrollbarSlider.hoverBackground': '#ffffff24',
      },
    });
    monaco.editor.defineTheme('coompiler-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '8a8a94', fontStyle: 'italic' },
        { token: 'string', foreground: '3f7a1c' },
        { token: 'keyword', foreground: '1d4ed8' },
        { token: 'number', foreground: 'a45a00' },
      ],
      colors: {
        'editor.background': '#fcfcfc',
        'editor.foreground': '#18181b',
        'editorLineNumber.foreground': '#c4c4ca',
        'editorLineNumber.activeForeground': '#52525b',
        'editor.lineHighlightBackground': '#f4f4f5',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': '#2563eb2e',
        'editorCursor.foreground': '#2563eb',
        'editorIndentGuide.background1': '#e4e4e7',
        'editorWidget.background': '#ffffff',
        'editorWidget.border': '#d4d4d8',
        'editorSuggestWidget.background': '#ffffff',
        'editorSuggestWidget.border': '#d4d4d8',
        'editorSuggestWidget.selectedBackground': '#2563eb1f',
        'scrollbarSlider.background': '#18181b14',
        'scrollbarSlider.hoverBackground': '#18181b24',
      },
    });

    // Make TS/TSX feel closer to a typical React/Vite project.
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: false,
      strict: true,
      target: monaco.languages.typescript.ScriptTarget.ES2022,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      esModuleInterop: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      skipLibCheck: true,
      lib: ['es2022', 'dom', 'dom.iterable'],
      types: [],
    });

    // Monaco can’t automatically read your node_modules types in this sandboxed, in-browser workspace.
    // Add minimal stubs so common React/Vite imports don’t explode with “Cannot find module …”.
    const reactStub = `
declare module 'react' {
  export type ReactNode = any;
  export type FC<P = {}> = (props: P) => any;
  export const StrictMode: any;
  export function useState<T>(v: T): [T, (n: T) => void];
  export function useEffect(cb: any, deps?: any[]): void;
  export function useMemo(cb: any, deps?: any[]): any;
  export function useRef<T>(v: T): { current: T };
  const React: any;
  export default React;
}
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}
`;

    const reactDomStub = `
declare module 'react-dom/client' {
  export function createRoot(el: any): { render: (node: any) => void };
}
`;

    const viteStub = `
declare module 'vite/client' {}
`;

    monaco.languages.typescript.typescriptDefaults.addExtraLib(reactStub, 'file:///node_modules/@types/react/index.d.ts');
    monaco.languages.typescript.typescriptDefaults.addExtraLib(reactDomStub, 'file:///node_modules/@types/react-dom/client.d.ts');
    monaco.languages.typescript.typescriptDefaults.addExtraLib(viteStub, 'file:///node_modules/vite/client.d.ts');
  };

  // Geist Mono is a web font; re-measure once it loads so the cursor lines up.
  const handleMount: OnMount = (_editor, monaco) => {
    document.fonts?.ready.then(() => monaco.editor.remeasureFonts());
  };

  return (
    <div className="h-full w-full min-w-0">
      <Editor
        path={path}
        value={value}
        onChange={handleChange}
        beforeMount={beforeMount}
        onMount={handleMount}
        language={languageFromPath(path)}
        theme={theme === 'light' ? 'coompiler-light' : 'coompiler-dark'}
        options={{
          readOnly: !!readOnly,
          automaticLayout: true,
          fontFamily: "'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13.5,
          lineHeight: 22,
          padding: { top: 14, bottom: 14 },
          lineNumbersMinChars: 3,
          renderLineHighlightOnlyWhenFocus: true,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          fontLigatures: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorSmoothCaretAnimation: 'on',
          wordWrap: 'on',
          tabSize: 2,
          insertSpaces: true,
          renderWhitespace: 'selection',
          renderLineHighlight: 'line',
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          quickSuggestions: suggestionsEnabled ? { other: true, comments: false, strings: false } : false,
          suggestOnTriggerCharacters: suggestionsEnabled,
          wordBasedSuggestions: suggestionsEnabled ? 'matchingDocuments' : 'off',
          inlineSuggest: { enabled: suggestionsEnabled },
          parameterHints: { enabled: suggestionsEnabled },
          acceptSuggestionOnCommitCharacter: suggestionsEnabled,
          snippetSuggestions: suggestionsEnabled ? 'inline' : 'none',
          tabCompletion: suggestionsEnabled ? 'on' : 'off',
        }}
      />
    </div>
  );
}
