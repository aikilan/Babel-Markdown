# Architecture Overview

This document captures architectural decisions for the Babel Markdown Viewer AI translation extension.

## Goals
- Provide a clean separation between VS Code integration (commands, activation) and domain logic (Markdown translation pipeline).
- Keep the preview panel self-contained so the UI layer can evolve independently while supporting rich interactions (scroll sync, loading states).
- Support automated testing with minimal manual setup and heavy reliance on mocks for external APIs.

## Layering

1. **Activation Layer (`src/activation`)**
   - Wires up the extension entry point.
   - Registers commands and disposables.
   - Initializes shared singletons (logger, translation service, secret manager).

2. **Command Layer (`src/commands`)**
   - Each command is encapsulated in its own module.∏
   - Commands validate prerequisites (configuration present) before delegating to services and UI.
   - Includes command context used by toolbar buttons and command palette.

3. **Service Layer (`src/services`)**
   - Houses translation-specific logic (prompt building, API client, caching, timeout handling).
   - Provides abstractions (`TranslationService`, `ConfigService`, `SecretStorageService`).
   - Keeps VS Code specific APIs at the edges so services remain testable.
   - Implements retry policies and structured error handling with cache/placeholder fallbacks for segment failures.

4. **Presentation Layer (`src/panel`)**
   - Manages the translation preview webview, message passing, scroll synchronization, and state transitions (idle/loading/result/error).
   - Abstracts webview HTML/template rendering from translation outputs for easier theming.

5. **Utilities and Types (`src/utils`, `src/types`)**
   - Thin helpers for logging, configuration access, secure storage wrappers, and shared TypeScript contracts (API request/response shapes).

6. **Integration Layer (`src/messaging`)** *(planned)*
   - Houses message channel contracts used between the extension host and webview to keep scroll positions synchronized.
   - Provides rate limiting/debouncing utilities for high-frequency scroll events.

## Testing Strategy
- Lightweight unit tests cover services and utilities.
- Integration tests (via `@vscode/test-electron`) validate command behavior, configuration flows, and webview wiring.
- Fixtures under `test/fixtures` provide sample Markdown inputs and translated responses for regression coverage.
- Webview messaging is tested via mocked message bus to avoid depending on actual DOM APIs.

## Build and Packaging
- TypeScript compiler emits sources into `dist/` for runtime and `dist-test/` for tests.
- ESLint with `@typescript-eslint` enforces consistency.
- Secret storage relies on VS Code's `SecretStorage`; fallback for environments without secret support is documented.
- Future enhancements can introduce bundling (e.g., esbuild) if the webview UI grows complex.
