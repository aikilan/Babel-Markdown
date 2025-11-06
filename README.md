# Babel Markdown

![Babel Markdown logo](assets/icons/logo.png)

Babel Markdown is a VS Code extension that renders Markdown files through a Babel-powered transformation pipeline before displaying them inside a preview webview. This repository is initialized with a clean TypeScript setup, testing scaffold, and opinionated linting so you can focus on feature work.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the extension:
   ```bash
   npm run compile
   ```
3. Launch the extension host (Run Extension configuration) and start iterating.

## Project Structure

```
.
├── assets/              # Static assets such as icons
│   └── icons/
├── docs/                # Long form documentation and design notes
├── scripts/             # Automation scripts (formatting, release helpers, etc.)
├── src/                 # Extension source code (TypeScript)
│   ├── activation/      # Activation wiring and command registration helpers
│   ├── commands/        # VS Code command implementations
│   ├── panel/           # Webview panel orchestration
│   ├── services/        # Core business logic (Babel transforms, data access)
│   ├── types/           # Shared TypeScript types/interfaces
│   └── utils/           # Reusable helpers (logging, config)
├── test/                # Automated tests using @vscode/test-electron
│   ├── fixtures/        # Sample documents used in tests
│   └── suite/           # Test suite entrypoints
├── .vscode/             # Debugging and task configuration
├── dist/                # Compiled extension output (generated)
└── dist-test/           # Compiled test output (generated)
```

## Scripts

- `npm run compile` – Type-checks and emits the extension into `dist/`.
- `npm run watch` – Incremental compilation while you edit.
- `npm run compile-tests` – Builds the test workspace into `dist-test/`.
- `npm run test` – Runs the compiled test suite through `@vscode/test-electron`.
- `npm run lint` – Lints the codebase with ESLint.
- `npm run check` – Convenience script that lints and tests.

## Next Steps

- Flesh out `BabelMarkdownService` with real transformation logic.
- Implement a custom webview panel UI for rendering Markdown alongside raw source.
- Add integration tests that exercise the preview panel and command flow.

Happy hacking!
