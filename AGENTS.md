# Repository Guidelines

## Project Structure & Module Organization
- Root plugin sources: `main.ts` ( TypeScript), built output: `main.js`.
- Metadata and build config: `manifest.json`, `esbuild.config.mjs`, `tsconfig.json`.
- Docs: `README.md`, `安装说明.txt`.
- Local references (ignored): `third_party/`, `plugins/`.

## Build, Test, and Development Commands
- `npm run dev` — esbuild watch; rebuilds `main.js` on changes.
- `npm run build` — type-checks with `tsc` (no emit) and bundles with esbuild to `main.js`.
- Local run: copy `main.js` and `manifest.json` to your vault at `.obsidian/plugins/smart-ime/`, then enable in Obsidian.

## Coding Style & Naming Conventions
- Language: TypeScript (ES2018, CommonJS bundle). Prefer explicit types; avoid `any`.
- Indentation: 2 spaces; single quotes; semicolons; keep lines concise.
- Use async/await; prefer small, single-responsibility helpers. Log only errors (`console.error`).
- When adding settings, update defaults, UI (settings tab), and docs in both `README.md` and `安装说明.txt`.

## Testing Guidelines
- No unit tests yet. Use a manual checklist across Windows/macOS:
  - Chinese + space → English; English + double space (if enabled) → Chinese with one space removed.
  - Enter/leave math `$...$` and `$$...$$` → switch English/Chinese appropriately (includes Tab selection moves).
  - Newline delay → switches to Chinese unless ASCII typed within delay.
  - Verify im-select path detection and the “Test im-select” button.

## Commit & Pull Request Guidelines
- Commit style: Conventional Commits (e.g., `feat:`, `fix:`, `chore:`, `docs:`). Keep messages imperative and scoped.
- PRs should include:
  - Clear description, repro steps, and platform(s) tested.
  - Linked issue (if any), and before/after notes or short screenshots/gifs for IME behavior.
  - Updated docs when behavior or settings change.

## Security & Configuration Tips
- Do not commit binaries (e.g., `im-select(.exe)`), vault data, or third-party plugin folders.
- Cross‑platform: Windows uses `im-select.exe`; macOS uses Homebrew `im-select`. Users may set a custom path in settings.

## Communication & Language
- 默认使用中文进行沟通与文档撰写；英文亦可。
- Commit message 推荐使用英文 Conventional Commits（如 `feat:`、`fix:`）。
- PR 描述与问题讨论可用中文，保持简洁可复现。
