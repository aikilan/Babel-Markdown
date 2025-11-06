# Changelog

All notable changes to the "Babel Markdown Viewer" extension will be documented in this file.

## [0.0.4] - 2025-11-05
- Streamlined build/package scripts and added `pnpm run package` for one-step VSIX generation with Vite-bundled artifacts.
- Added repository metadata and MIT license file to satisfy vsce packaging checks.

## [0.0.3] - 2025-11-05
- Switched build pipeline to Vite so runtime dependencies like markdown-it and sanitize-html are bundled into the extension output.

## [0.0.2] - 2025-11-05
- Added activation events so core preview commands auto-register when Markdown files or command palette usage triggers the extension.

## [0.0.1] - 2025-11-05
- Initial project scaffold with TypeScript, linting, and testing support.
