import Editor, { type Monaco, type OnChange } from '@monaco-editor/react';

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

  return (
    <div className="h-full w-full min-w-0">
      <Editor
        path={path}
        value={value}
        onChange={handleChange}
        beforeMount={beforeMount}
        language={languageFromPath(path)}
        theme={theme === 'light' ? 'vs' : 'vs-dark'}
        options={{
          readOnly: !!readOnly,
          automaticLayout: true,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          fontSize: 13,
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorSmoothCaretAnimation: 'on',
          wordWrap: 'on',
          tabSize: 2,
          insertSpaces: true,
          renderWhitespace: 'selection',
          renderLineHighlight: 'all',
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
