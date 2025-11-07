# Changelog

All notable changes to the "Babel Markdown" extension will be documented in this file.

## [1.0.7] - 2025-11-07
- Rebranded the extension as “Babel Markdown”, refreshed README with bilingual product overview and new preview imagery.
- Added a generated logo asset, wired it into the manifest, and exposed a user-facing translation preview command in the editor context menu.
- Published updated packages via `pnpm run package` / `vsce publish` with the `aikilan` publisher metadata.

## [0.0.4] - 2025-11-05
- Streamlined build/package scripts and added `pnpm run package` for one-step VSIX generation with Vite-bundled artifacts.
- Added repository metadata and MIT license file to satisfy vsce packaging checks.

## [0.0.3] - 2025-11-05
- Switched build pipeline to Vite so runtime dependencies like markdown-it and sanitize-html are bundled into the extension output.

## [0.0.2] - 2025-11-05
- Added activation events so core preview commands auto-register when Markdown files or command palette usage triggers the extension.

## [0.0.1] - 2025-11-05
- Initial project scaffold with TypeScript, linting, and testing support.
