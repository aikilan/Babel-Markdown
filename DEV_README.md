# Dev README

This file describes the `package.json` scripts by platform.

## macOS / Linux

General (VS Code extension)
- `pnpm typecheck`: TypeScript typecheck.
- `pnpm dev:server`: Run the local dev server.
- `pnpm build:extension`: Build the VS Code extension bundle.
- `pnpm build:webview`: Build the webview bundles (preview + export bridge).
- `pnpm build`: Typecheck + extension build + webview build.
- `pnpm compile`: Alias of `build`.
- `pnpm vscode:prepublish`: VS Code packaging hook (runs `build`).
- `pnpm vsc:package`: Build and package VS Code extension (`.vsix`).
- `pnpm vsc:publish`: Package and publish to VS Code Marketplace.
- `pnpm compile-tests`: Build test TS sources.
- `pnpm watch`: Watch TypeScript build.
- `pnpm watch-tests`: Watch test TypeScript build.
- `pnpm lint`: ESLint for `src` and `test`.
- `pnpm test`: Build + run extension tests.
- `pnpm check`: Lint + test.

JetBrains plugin (under `jb/`)
- `pnpm jb:setup`: Download JDK 21 + Gradle 8.8 into `jb/.tools/` and generate `jb/.env`.
- `pnpm jb:build`: Build the JetBrains plugin (`jb/build/distributions/*.zip`).

## Windows

General (VS Code extension)
- All scripts above work in a standard Node.js shell.

JetBrains plugin (under `jb/`)
- `pnpm jb:setup` and `pnpm jb:build` require `bash`, `curl`, `tar`, and `unzip`.
- Recommended: run these two in WSL or Git Bash.
