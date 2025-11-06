# Progressive Translation Optimization Plan

## Context
- Current pipeline translates Markdown sequentially per paragraph, emitting progressive updates via `TranslationPreviewManager` and the webview.
- Goals are to reduce end-to-end latency, improve resilience, and reuse previous work while keeping UX stable.
- Each workstream below lists concrete tasks meant for individual approvals before implementation.

## Phase 1 – Segment Sizing & Planning
**Objective:** Reduce request overhead by adapting segment granularity without breaking progressive updates.

**Tasks:**
1. Instrument `TranslationService.splitIntoSegments` to collect metrics (segment count, average length) and log under a feature flag.
2. Prototype adaptive batching strategy (e.g., merge consecutive short segments while respecting code fences and max token limits).
3. Add configuration toggle for enabling adaptive batching and document default behavior.
4. Update unit/integration tests to cover mixed-size documents (short paragraphs, long code fences).
5. Validate with staged rollout: measure latency, regression-test streaming order, verify localization stays intact.

**Dependencies:** Requires access to representative Markdown samples and logging review in `ExtensionLogger` output channel.

## Phase 2 – Controlled Parallel Translation
**Objective:** Shorten total translation time while keeping ordered delivery.

**Tasks:**
1. Abstract segment translation loop into a scheduler that accepts a concurrency limit (initially 2) while preserving sequential emission.
2. Introduce in-memory buffer so `TranslationPreviewManager` only pushes `translationChunk` when earlier segments are ready.
3. Extend cancellation logic to cancel pending promises in the new scheduler.
4. Add configuration keys for concurrency limit and safety guard (fall back to serial execution on failure).
5. Benchmark latency vs. resource usage; document findings in `docs/performance.md`.

**Dependencies:** Builds on Phase 1 instrumentation and requires updates to `TranslationCache` invalidation logic if per-segment caching is introduced later.

## Phase 3 – Fine-Grained Caching
**Objective:** Reuse previous translations for unchanged segments to avoid redundant API calls.

**Tasks:**
1. Design segment fingerprinting scheme (hash over normalized markdown + target language + model).
2. Extend `TranslationCache` to store per-segment results with expiration and size limits.
3. Modify translation scheduler to check cache before invoking the provider and emit cached chunks immediately with `wasCached` metadata.
4. Update UI status messaging to differentiate cached vs. fresh segments (reuse existing localization entries).
5. Add automated tests covering cache hits, invalidation on edit, and blending cached plus fresh segments.

**Dependencies:** Requires Phase 1’s adaptive segments to be stable; interfaces with Phase 2 scheduler.

## Phase 4 – Error Resilience & Recovery
**Objective:** Prevent single-segment failures from aborting the entire translation run.

**Tasks:**
1. Categorize retryable vs. terminal errors in `TranslationService` and surface structured error codes.
2. Implement retry policy with exponential backoff for retryable categories (configurable max attempts).
3. Allow fallback to cached segment when retries exhaust, and display localized notice in webview.
4. Update VS Code notifications to offer context-aware quick fixes (e.g., open settings, view logs).
5. Expand test coverage to simulate rate limits, network drops, and partial successes.

**Dependencies:** Builds on Phase 4 cache metadata and Phase 2 scheduler control flow.

## Cross-Cutting Deliverables
- Update `docs/architecture.md` with final pipeline diagrams after each phase.
- Maintain changelog entries and localization updates for new settings/tooltips.
- Ensure `pnpm run typecheck`, `pnpm run build`, and relevant tests are executed after each implementation step.

## Review & Approval Checklist
- Confirm scope and priority ordering with stakeholders.
- Validate that telemetry/logging additions comply with privacy guidelines.
- Align rollout plan with extension versioning (e.g., bump minor version per phase).

> Execute phases sequentially unless otherwise approved. Each phase should return to review after implementation for user confirmation before proceeding.
