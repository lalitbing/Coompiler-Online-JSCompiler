# Coompiler

A modern, browser-based JavaScript compiler and playground powered by Monaco Editor.

<img src="public/compiler.svg" alt="Coompiler Logo" width="64" height="64" />

## Features

- **Monaco Editor** - The same powerful code editor that powers VS Code, with syntax highlighting, IntelliSense, and more
- **Instant Execution** - Run JavaScript code directly in your browser with a sandboxed iframe runner
- **Console Output** - View `console.log`, warnings, errors, and runtime exceptions with timestamps
- **Dark/Light Theme** - Automatically follows your system preference, with manual toggle option
- **Keyboard Shortcuts** - Optimized workflow with intuitive shortcuts
- **Responsive Design** - Works seamlessly on desktop and mobile devices

## Keyboard Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Run code | `⌘ + Enter` | `Ctrl + Enter` |
| Clear output | `⌘ + L` | `Ctrl + L` |
| Command palette | `F1` or `⇧⌘P` | `F1` or `Ctrl+Shift+P` |
| Find | `⌘F` | `Ctrl+F` |
| Replace | `⌥⌘F` | `Ctrl+H` |
| Go to line | `Ctrl+G` | `Ctrl+G` |
| Format document | `⇧⌥F` | `Alt+Shift+F` |
| Toggle comment | `⌘/` | `Ctrl+/` |
| Autocomplete | `Ctrl+Space` | `Ctrl+Space` |

## Tech Stack

- **React 19** - UI framework
- **Vite 7** - Build tool and dev server
- **Monaco Editor** - Code editing component
- **Tailwind CSS 4** - Styling
- **TypeScript** - Type safety

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd vscode_editor

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:5173`.

### Build for Production

```bash
# Build the app
npm run build

# Preview the production build
npm run preview
```

## Project Structure

```
src/
├── App.tsx                 # Root component
├── main.tsx                # Entry point
├── index.css               # Global styles
├── jsCompiler/
│   ├── JSCompilerPane.tsx  # Main compiler UI component
│   └── runnerSrcDoc.ts     # Sandboxed iframe runner
├── editor/
│   ├── MonacoPane.tsx      # Monaco editor wrapper
│   ├── Explorer.tsx        # File explorer component
│   ├── useWorkspace.ts     # Workspace state management
│   └── workspaceTypes.ts   # Type definitions
└── components/
    ├── ui/                 # UI components & icons
    └── svg/                # SVG icon components
```

## How It Works

1. **Code Editing** - Write JavaScript in the Monaco-powered editor with full syntax highlighting and IntelliSense
2. **Execution** - When you run your code, it's executed in a sandboxed iframe for security
3. **Output Capture** - Console methods (`log`, `warn`, `error`, etc.) are intercepted and displayed in the output panel
4. **Error Handling** - Runtime errors and unhandled promise rejections are caught and displayed

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
