# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart IME is an Obsidian plugin that automatically switches between Chinese and English input methods based on editing context. It uses the external `im-select` tool to control system IME state.

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Development mode with watch (esbuild)
npm run build        # Production build (TypeScript check + esbuild)
```

## Architecture

**Single-file plugin**: All code lives in `main.ts`, which contains:
- `SmartIMEPlugin` - Main plugin class extending Obsidian's `Plugin`
- `SmartIMESettingTab` - Settings UI extending `PluginSettingTab`
- `SmartIMESettings` interface and `DEFAULT_SETTINGS` constant

**Key dependencies**:
- Uses CodeMirror 6 (`@codemirror/view`, `@codemirror/state`) for editor integration
- Calls external `im-select` executable via Node's `child_process.execFile`

**IME switching logic** (in order of priority in `handleDocChange`):
1. Newline detection → delayed switch to Chinese (cancellable by ASCII input)
2. Math context detection (`$...$` or `$$...$$`) → English in math, Chinese when leaving
3. Double space after English (with Chinese in line) → delete one space, switch to Chinese
4. Single space after Chinese character → switch to English
5. Previous character is Chinese (throttled) → switch to Chinese

**Math context detection**: Counts `$` symbols before cursor; for display math (`$$`), scans up to 400 lines above/below to find matching delimiters.

**Platform handling**: Auto-detects `im-select` path on Windows (plugin directory or PATH) and macOS (Homebrew paths or PATH). Custom path configurable in settings.

## Output Files

- `main.js` - Bundled plugin output (committed for distribution)
- `manifest.json` - Obsidian plugin manifest

## Testing

No automated tests. Manual testing requires:
1. Copy `main.js`, `manifest.json`, and `im-select.exe` to `.obsidian/plugins/smart-ime/`
2. Enable plugin in Obsidian
3. Use "Test im-select" button in settings to verify IME tool works
