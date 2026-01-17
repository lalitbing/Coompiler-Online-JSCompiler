import Editor, { type OnChange } from '@monaco-editor/react';

type MonacoPaneProps = {
  path: string;
  value: string;
  onChange: (nextValue: string) => void;
  readOnly?: boolean;
};

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

export function MonacoPane({ path, value, onChange, readOnly }: MonacoPaneProps) {
  const handleChange: OnChange = (next) => onChange(next ?? '');

  return (
    <div className="h-full w-full min-w-0">
      <Editor
        path={path}
        value={value}
        onChange={handleChange}
        language={languageFromPath(path)}
        theme="vs-dark"
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
        }}
      />
    </div>
  );
}

