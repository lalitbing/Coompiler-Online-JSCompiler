import type { WorkspaceState } from './workspaceTypes';

export const defaultWorkspace: WorkspaceState = {
  rootId: 'root',
  nodes: {
    root: { type: 'folder', id: 'root', parentId: null, name: '', childrenIds: ['readme', 'pkg', 'vite', 'src'] },

    readme: {
      type: 'file',
      id: 'readme',
      parentId: 'root',
      name: 'README.md',
      content: `# VSCode Editor (Demo)\n\nThis is a lightweight VSCode-like editor UI built with React + Vite.\n\n- Explore files in the left Explorer\n- Open files into tabs\n- Edit with Monaco\n- Changes persist via localStorage\n`,
    },
    pkg: {
      type: 'file',
      id: 'pkg',
      parentId: 'root',
      name: 'package.json',
      content: `{\n  "name": "sample-workspace",\n  "private": true,\n  "type": "module"\n}\n`,
    },
    vite: {
      type: 'file',
      id: 'vite',
      parentId: 'root',
      name: 'vite.config.ts',
      content: `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n})\n`,
    },

    src: { type: 'folder', id: 'src', parentId: 'root', name: 'src', childrenIds: ['main', 'app', 'styles'] },
    main: {
      type: 'file',
      id: 'main',
      parentId: 'src',
      name: 'main.tsx',
      content: `import React from 'react'\nimport { createRoot } from 'react-dom/client'\n\nfunction App() {\n  return <div>Hello editor</div>\n}\n\ncreateRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n)\n`,
    },
    app: {
      type: 'file',
      id: 'app',
      parentId: 'src',
      name: 'App.tsx',
      content: `export function App() {\n  return (\n    <main style={{ padding: 24, fontFamily: 'system-ui' }}>\n      <h1>Welcome</h1>\n      <p>Open files from the Explorer and start editing.</p>\n    </main>\n  )\n}\n`,
    },
    styles: {
      type: 'file',
      id: 'styles',
      parentId: 'src',
      name: 'index.css',
      content: `:root {\n  color-scheme: dark;\n}\n\nbody {\n  margin: 0;\n}\n`,
    },
  },
};

