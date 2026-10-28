import { App, FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { execFile } from 'child_process';
import { access } from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Trust the cached IME state for this long; after that, re-check with im-select
// before skipping a switch, since the user may have toggled the IME manually.
const IME_CACHE_TTL_MS = 1000;
const IM_SELECT_TIMEOUT_MS = 2000;

type IMETarget = 'zh' | 'en';
type EditContext = 'code' | 'math' | 'text';

interface SmartIMESettings {
	enableAutoSwitch: boolean;
	switchInterval: number;
	switchToEnglishInMath: boolean;
	spaceToEnglish: boolean;
	doubleSpaceToChinese: boolean;
	switchByPreviousChar: boolean;
	chineseIME: string;
	englishIME: string;
	enableCursorColor: boolean;
	chineseCursorColor: string;
	englishCursorColor: string;
	switchToChineseOnNewline: boolean;
	switchToChineseOnLeaveMath: boolean;
	imSelectCustomPath: string;
	newlineSwitchDelayMs: number;
	newlineCancelOnAscii: boolean;
}

const DEFAULT_SETTINGS: SmartIMESettings = {
	enableAutoSwitch: true,
	switchInterval: 2000,
	switchToEnglishInMath: true,
	spaceToEnglish: true,
	doubleSpaceToChinese: false,
	switchByPreviousChar: true,
	chineseIME: '',
	englishIME: '',
	enableCursorColor: true,
	chineseCursorColor: '#ff0000',
	englishCursorColor: '', // empty = theme default
	switchToChineseOnNewline: true,
	switchToChineseOnLeaveMath: true,
	imSelectCustomPath: '',
	newlineSwitchDelayMs: 250,
	newlineCancelOnAscii: true,
}

export default class SmartIMEPlugin extends Plugin {
	settings: SmartIMESettings;
	private lastCheckTime: number = 0; // only used for Chinese-char-trigger throttle
	private currentIME: string = '';
	private currentIMEAt: number = 0; // when currentIME was last confirmed
	private imeStateVersion: number = 0;
	private imSelectPath: string = '';
	private imSelectFailureNotified: boolean = false;
	private newlineTimer: number | null = null;
	private pendingTarget: IMETarget | null = null;
	private switchLoop: Promise<boolean> | null = null;
	private statusBarItemEl: HTMLElement;
	private styledDocs = new Set<Document>();

	async onload() {
		await this.loadSettings();

		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar();

		// Cursor color is applied per window so popout windows get it too
		this.styledDocs.add(document);
		this.registerEvent(this.app.workspace.on('window-open', (win) => {
			this.styledDocs.add(win.doc);
			this.updateCursorStyle();
		}));
		this.registerEvent(this.app.workspace.on('window-close', (win) => {
			this.clearCursorStyle(win.doc);
			this.styledDocs.delete(win.doc);
		}));
		this.updateCursorStyle();

		this.addCommand({
			id: 'toggle-ime',
			name: 'Toggle IME (中/英)',
			callback: () => this.toggleIME(),
		});

		this.registerEditorExtension([
			EditorView.updateListener.of((update) => {
				if (!this.settings.enableAutoSwitch) return;
				// Ignore background views (e.g. the same note open in another pane)
				// and never switch IME in the middle of a composition
				if (!update.view.hasFocus || update.view.composing) return;
				if (update.docChanged) {
					if (this.isTypingUpdate(update)) this.handleDocChange(update);
				} else if (update.selectionSet) {
					this.handleSelectionUpdate(update);
				}
			})
		]);

		// The IME may have been changed in another app while Obsidian was in the background
		this.registerDomEvent(window, 'focus', () => { void this.syncCurrentIME(); });

		this.addSettingTab(new SmartIMESettingTab(this.app, this));

		// Spawning im-select is slow; keep it off the plugin load path
		this.app.workspace.onLayoutReady(async () => {
			await this.detectIMEConfig();
			await this.syncCurrentIME();
		});
	}

	onunload() {
		this.clearNewlineTimer();
		for (const doc of this.styledDocs) {
			this.clearCursorStyle(doc);
		}
		this.styledDocs.clear();
	}

	updateCursorStyle() {
		const { enableCursorColor, chineseIME, englishIME } = this.settings;
		let color = '';
		if (enableCursorColor && chineseIME && englishIME) {
			if (this.currentIME === chineseIME) color = this.settings.chineseCursorColor.trim();
			else if (this.currentIME === englishIME) color = this.settings.englishCursorColor.trim();
		}
		// Empty or invalid color → fall back to the theme's cursor color
		if (!this.isValidCSSColor(color)) color = '';
		for (const doc of this.styledDocs) {
			if (color) {
				doc.body.classList.add('smart-ime-cursor');
				doc.body.style.setProperty('--smart-ime-cursor-color', color);
			} else {
				this.clearCursorStyle(doc);
			}
		}
	}

	private clearCursorStyle(doc: Document) {
		doc.body.classList.remove('smart-ime-cursor');
		doc.body.style.removeProperty('--smart-ime-cursor-color');
	}

	updateStatusBar() {
		const { chineseIME, englishIME } = this.settings;
		let label = 'IME: --';
		if (chineseIME && englishIME) {
			if (this.currentIME === chineseIME) label = '中';
			else if (this.currentIME === englishIME) label = 'EN';
		}
		this.statusBarItemEl.setText(label);
	}

	private async toggleIME() {
		if (!this.settings.chineseIME || !this.settings.englishIME) {
			new Notice('Please configure Chinese and English IME identifiers first');
			return;
		}
		// Read the real state first: the user may have switched manually
		await this.syncCurrentIME();
		const target = this.currentIME === this.settings.chineseIME ? 'en' : 'zh';
		const ok = await this.switchIME(target);
		if (!ok) {
			new Notice('Smart IME: failed to switch IME');
			return;
		}
		new Notice(target === 'zh' ? '切换到中文' : 'Switched to English');
	}

	private isValidCSSColor(color: string): boolean {
		if (!color) return false;
		// Allow hex colors: #RGB, #RRGGBB, #RRGGBBAA
		if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color)) return true;
		// Allow named colors (common ones)
		const namedColors = /^(transparent|currentcolor|inherit|initial|unset|black|white|red|green|blue|yellow|cyan|magenta|gray|grey|orange|pink|purple|brown)$/i;
		if (namedColors.test(color)) return true;
		// Allow rgb/rgba/hsl/hsla with numbers only
		if (/^(rgb|rgba|hsl|hsla)\(\s*[\d.,\s%]+\s*\)$/.test(color)) return true;
		return false;
	}

	private getPluginDirPath(): string | null {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter) || !this.manifest.dir) return null;
		// manifest.dir is vault-relative and follows the user's config folder name
		return path.join(adapter.getBasePath(), this.manifest.dir);
	}

	async detectIMEConfig() {
		this.imSelectFailureNotified = false;
		const custom = this.settings.imSelectCustomPath.trim();
		if (custom.length > 0) {
			this.imSelectPath = custom;
			return;
		}
		const exeName = process.platform === 'win32' ? 'im-select.exe' : 'im-select';
		const candidates: string[] = [];
		const pluginDir = this.getPluginDirPath();
		if (pluginDir) candidates.push(path.join(pluginDir, exeName));
		if (process.platform === 'darwin') {
			candidates.push('/opt/homebrew/bin/im-select', '/usr/local/bin/im-select');
		} else if (process.platform === 'linux') {
			candidates.push('/usr/local/bin/im-select', '/usr/bin/im-select');
		}
		for (const p of candidates) {
			try { await access(p); this.imSelectPath = p; return; } catch { /* try next */ }
		}
		this.imSelectPath = exeName; // fallback to PATH
	}

	private resolveImSelectExecutable(): string {
		const custom = this.settings.imSelectCustomPath.trim();
		if (custom.length > 0) return custom;
		if (this.imSelectPath.length > 0) return this.imSelectPath;
		return process.platform === 'win32' ? 'im-select.exe' : 'im-select';
	}

	private async execImSelect(args: string[]): Promise<string> {
		const { stdout } = await execFileAsync(this.resolveImSelectExecutable(), args, {
			timeout: IM_SELECT_TIMEOUT_MS,
			windowsHide: true,
		});
		return (stdout || '').trim();
	}

	// Like execImSelect, but tells the user once when im-select can't be run
	private async runImSelect(args: string[]): Promise<string> {
		try {
			return await this.execImSelect(args);
		} catch (e) {
			const exe = this.resolveImSelectExecutable();
			console.error(`Smart IME: im-select failed (${exe})`, e);
			if (!this.imSelectFailureNotified) {
				this.imSelectFailureNotified = true;
				new Notice(`Smart IME: failed to run im-select (${exe}). Check "im-select path" in settings.`, 8000);
			}
			throw e;
		}
	}

	private setCurrentIME(id: string) {
		this.currentIME = id;
		this.currentIMEAt = Date.now();
		this.imeStateVersion++;
		this.updateCursorStyle();
		this.updateStatusBar();
	}

	// Read the actual system IME into the cache
	private async syncCurrentIME(): Promise<string | null> {
		const version = this.imeStateVersion;
		let id: string;
		try {
			id = await this.runImSelect([]);
		} catch {
			return null;
		}
		// A switch that finished while we were reading is newer than this result
		if (id && version === this.imeStateVersion) this.setCurrentIME(id);
		return id || null;
	}

	async testIMSelect() {
		await this.detectIMEConfig();
		let msg = `im-select: ${this.resolveImSelectExecutable()}`;
		try {
			const current = await this.execImSelect([]);
			if (!current) throw new Error('empty output');
			this.setCurrentIME(current);
			msg += `\ncurrent IME: ${current}`;
			try {
				await this.execImSelect([current]); // verify argument mode without changing IME
				msg += `\nargument mode: OK`;
			} catch (e) {
				msg += `\nargument mode: FAILED`;
			}
		} catch (e) {
			msg += `\ncurrent IME: FAILED (${e instanceof Error ? e.message : String(e)})`;
		}
		new Notice(msg, 8000);
	}

	// Paste, drop, undo/redo and similar bulk edits are not typing
	private isTypingUpdate(update: ViewUpdate): boolean {
		return !update.transactions.some(tr =>
			tr.isUserEvent('input.paste') ||
			tr.isUserEvent('input.drop') ||
			tr.isUserEvent('move') ||
			tr.isUserEvent('undo') ||
			tr.isUserEvent('redo'));
	}

	private handleDocChange(update: ViewUpdate) {
		const now = Date.now();

		const view = update.view;
		const state = update.state;

		const pos = state.selection.main.head;
		const line = state.doc.lineAt(pos);
		const textBefore = line.text.slice(0, pos - line.from);

		// Skip if in code block
		const context = this.getEditContext(state, pos);
		if (context === 'code') {
			return;
		}

		// Skip if this is a deletion (no text inserted)
		let insertedText = '';
		update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
			insertedText += inserted.toString();
		});
		if (insertedText.length === 0) {
			return;
		}

		// Newline to Chinese (smart, delayed)
		if (this.settings.switchToChineseOnNewline) {
			let insertedNewline = insertedText.includes('\n');
			// Fallback: if caret moved to next line, treat as newline
			if (!insertedNewline) {
				const prev = update.startState.selection.main.head;
				const prevLineNo = update.startState.doc.lineAt(prev).number;
				if (line.number === prevLineNo + 1) {
					insertedNewline = true;
				}
			}
			// cancel pending newline if user typed ASCII after newline
			if (this.newlineTimer && this.settings.newlineCancelOnAscii && /[A-Za-z0-9]/.test(insertedText)) {
				this.clearNewlineTimer();
			}
			// cancel pending newline if user typed Chinese (user already in Chinese mode)
			if (this.newlineTimer && this.containsChinese(insertedText)) {
				this.clearNewlineTimer();
			}
			if (insertedNewline) {
				this.clearNewlineTimer();
				this.newlineTimer = window.setTimeout(() => {
					this.newlineTimer = null;
					void this.switchIME('zh');
				}, this.settings.newlineSwitchDelayMs);
			}
		}

		// Check if in math context
		const prevPos = update.startState.selection.main.head;
		const prevInMath = this.getEditContext(update.startState, prevPos) === 'math';
		const inMath = context === 'math';
		// Leaving math context → switch to Chinese
		if (this.settings.switchToChineseOnLeaveMath && prevInMath && !inMath) {
			void this.switchIME('zh');
			this.clearNewlineTimer();
			return;
		}
		if (inMath && this.settings.switchToEnglishInMath) {
			void this.switchIME('en');
			this.clearNewlineTimer();
			return;
		}

		// Check last character
		const lastChar = textBefore.slice(-1);
		const lastTwoChars = textBefore.slice(-2);

		// Double space to Chinese (after English)
		// Match VS Code reference behavior:
		// - Only when enabled via settings
		// - Current line (before cursor) contains any Chinese character
		// - The character before the two spaces is non-Chinese (ASCII)
		// - Delete one trailing space, then switch to Chinese IME
		if (
			this.settings.doubleSpaceToChinese &&
			lastTwoChars === '  ' &&
			this.currentIME === this.settings.englishIME
		) {
			const charBeforeSpaces = textBefore.slice(-3, -2);
			const hasChineseInLine = this.containsChinese(textBefore);
			if (!this.isChinese(charBeforeSpaces) && hasChineseInLine) {
				// delete one trailing space
				const from = pos - 1;
				const to = pos;
				if (from >= 0) {
					view.dispatch({ changes: { from, to, insert: '' } });
				}
				void this.switchIME('zh');
				return;
			}
		}

		// Single space after Chinese to English
		if (lastChar === ' ' && this.settings.spaceToEnglish) {
			const charBeforeSpace = textBefore.slice(-2, -1);
			if (this.isChinese(charBeforeSpace)) {
				void this.switchIME('en');
				return;
			}
		}

		// Switch by previous character (throttled)
		if (this.settings.switchByPreviousChar && this.isChinese(lastChar)) {
			if (now - this.lastCheckTime >= this.settings.switchInterval) {
				this.lastCheckTime = now;
				void this.switchIME('zh');
			}
		}
	}

	private handleSelectionUpdate(update: ViewUpdate) {
		const pos = update.state.selection.main.head;
		const context = this.getEditContext(update.state, pos);
		if (context === 'code') return;
		const prevPos = update.startState.selection.main.head;
		const prevInMath = this.getEditContext(update.startState, prevPos) === 'math';
		const inMath = context === 'math';
		// Leaving math → Chinese
		if (this.settings.switchToChineseOnLeaveMath && prevInMath && !inMath) {
			void this.switchIME('zh');
			this.clearNewlineTimer();
			return;
		}
		// Entering math → English
		if (inMath && this.settings.switchToEnglishInMath) {
			void this.switchIME('en');
			this.clearNewlineTimer();
			return;
		}
	}

	// Classify the cursor position with Obsidian's markdown syntax tree, which pairs
	// $$ and ``` delimiters exactly like the renderer does. Current-line heuristics
	// additionally catch $ and ` that have been typed but not closed yet.
	private getEditContext(state: EditorState, pos: number): EditContext {
		const tree = ensureSyntaxTree(state, pos, 20) ?? syntaxTree(state);
		const doc = state.doc;
		// Obsidian's tree is flat: styled tokens are children of the top node, while
		// plain text and line breaks resolve to the top node itself (no parent)
		const tokenBefore = (p: number): string => {
			if (p < 0 || p > doc.length) return '';
			const node = tree.resolveInner(p, -1);
			return node.parent ? node.name : '';
		};
		const tokenAfter = (p: number): string => {
			if (p < 0 || p > doc.length) return '';
			const node = tree.resolveInner(p, 1);
			return node.parent ? node.name : '';
		};

		const line = doc.lineAt(pos);
		const textBefore = line.text.slice(0, pos - line.from);
		const before = tokenBefore(pos);
		const after = tokenAfter(pos);
		const isEmptyLine = line.length === 0;
		// Neighbouring tokens for an empty line: end of previous line, start of next line
		const prevLineEnd = isEmptyLine ? tokenBefore(line.from - 1) : '';
		const nextLineStart = isEmptyLine ? tokenAfter(line.to + 1) : '';

		// Code: fenced blocks and inline code
		const isCodeblock = (name: string) => name.includes('codeblock');
		const isInlineCode = (name: string) => name.includes('inline-code');
		if (before) {
			if (isCodeblock(before) || isInlineCode(before)) return 'code';
		} else if (pos === line.from && after) {
			// Start of a non-empty line: inside a block unless this is its opening fence
			if (isCodeblock(after) && !after.includes('codeblock-begin')) return 'code';
		} else if (isEmptyLine) {
			if (isCodeblock(prevLineEnd) && !prevLineEnd.includes('codeblock-end') &&
				isCodeblock(nextLineStart) && !nextLineStart.includes('codeblock-begin')) return 'code';
		}
		// Unclosed inline code on the current line
		const backtickCount = (textBefore.match(/`/g) || []).length;
		const tripleBackticks = (textBefore.match(/```/g) || []).length;
		if ((backtickCount - tripleBackticks * 3) % 2 === 1) return 'code';

		// Math: $...$ and $$...$$
		if (before) {
			if (before.includes('math-end')) return 'text';
			if (before.includes('math')) return 'math';
		} else if (after) {
			if (!after.includes('math-begin') && after.includes('math')) return 'math';
		} else if (isEmptyLine) {
			if (prevLineEnd.includes('math') && !prevLineEnd.includes('math-end') &&
				nextLineStart.includes('math')) return 'math';
		}
		// Unclosed inline math on the current line (escaped \$ ignored)
		const dollarCount = (textBefore.replace(/\\\$/g, '').match(/\$/g) || []).length;
		if (dollarCount % 2 === 1) return 'math';

		return 'text';
	}

	private clearNewlineTimer() {
		if (this.newlineTimer) {
			window.clearTimeout(this.newlineTimer);
			this.newlineTimer = null;
		}
	}

	private isChinese(char: string): boolean {
		if (!char) return false;
		const code = char.codePointAt(0);
		if (code === undefined) return false;
		// CJK Unified Ideographs
		if (code >= 0x4E00 && code <= 0x9FFF) return true;
		// CJK Extension A
		if (code >= 0x3400 && code <= 0x4DBF) return true;
		// CJK Extension B
		if (code >= 0x20000 && code <= 0x2A6DF) return true;
		// Chinese punctuation (，。！？、；：""''【】等)
		if (code >= 0x3000 && code <= 0x303F) return true;
		// Fullwidth punctuation (！＂＃等)
		if (code >= 0xFF00 && code <= 0xFFEF) return true;
		return false;
	}

	private containsChinese(text: string): boolean {
		for (const char of text) {
			if (this.isChinese(char)) return true;
		}
		return false;
	}

	// Requests are coalesced instead of dropped: while a switch is running, the
	// latest requested target is remembered and applied right after it.
	private switchIME(target: IMETarget): Promise<boolean> {
		this.pendingTarget = target;
		if (!this.switchLoop) {
			this.switchLoop = this.drainSwitchQueue();
		}
		return this.switchLoop;
	}

	private async drainSwitchQueue(): Promise<boolean> {
		let ok = false;
		try {
			while (this.pendingTarget) {
				const target = this.pendingTarget;
				this.pendingTarget = null;
				ok = await this.applyIME(target);
			}
		} finally {
			this.switchLoop = null;
		}
		return ok;
	}

	private async applyIME(target: IMETarget): Promise<boolean> {
		const targetIME = target === 'zh' ? this.settings.chineseIME : this.settings.englishIME;
		if (!targetIME) return false;
		if (this.currentIME === targetIME) {
			if (Date.now() - this.currentIMEAt < IME_CACHE_TTL_MS) return true;
			// Cached state is old; confirm before skipping
			if (await this.syncCurrentIME() === targetIME) return true;
		}
		try {
			await this.runImSelect([targetIME]);
		} catch {
			return false;
		}
		this.setCurrentIME(targetIME);
		return true;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SmartIMESettingTab extends PluginSettingTab {
	plugin: SmartIMEPlugin;

	constructor(app: App, plugin: SmartIMEPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Chinese IME')
			.setDesc('Chinese input method identifier (run "im-select" to get current)')
			.addText(text => text
				.setValue(this.plugin.settings.chineseIME)
				.onChange(async (value) => {
					this.plugin.settings.chineseIME = value.trim();
					await this.plugin.saveSettings();
					this.plugin.updateStatusBar();
					this.plugin.updateCursorStyle();
				}));

		new Setting(containerEl)
			.setName('English IME')
			.setDesc('English input method identifier')
			.addText(text => text
				.setValue(this.plugin.settings.englishIME)
				.onChange(async (value) => {
					this.plugin.settings.englishIME = value.trim();
					await this.plugin.saveSettings();
					this.plugin.updateStatusBar();
					this.plugin.updateCursorStyle();
				}));

		new Setting(containerEl)
			.setName('im-select path (optional)')
			.setDesc('Full path to im-select. Leave empty to auto-detect. Example: C:\\path\\to\\im-select.exe or /opt/homebrew/bin/im-select')
			.addText(text => text
				.setPlaceholder('Auto-detect if empty')
				.setValue(this.plugin.settings.imSelectCustomPath)
				.onChange(async (value) => {
					this.plugin.settings.imSelectCustomPath = value;
					await this.plugin.saveSettings();
					// re-detect to apply immediately
					await this.plugin.detectIMEConfig();
				}));

		new Setting(containerEl)
			.setName('Test im-select')
			.setDesc('Run im-select to detect current IME and validate argument mode')
			.addButton(btn => btn
				.setButtonText('Run test')
				.onClick(async () => {
					await this.plugin.testIMSelect();
				}));

		new Setting(containerEl)
			.setName('Enable auto switch')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAutoSwitch)
				.onChange(async (value) => {
					this.plugin.settings.enableAutoSwitch = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Switch interval (ms)')
			.addText(text => text
				.setValue(String(this.plugin.settings.switchInterval))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.switchInterval = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Switch to English in math')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.switchToEnglishInMath)
				.onChange(async (value) => {
					this.plugin.settings.switchToEnglishInMath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Switch to Chinese when leaving math')
			.setDesc('Leave $...$ or $$...$$ → Chinese')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.switchToChineseOnLeaveMath)
				.onChange(async (value) => {
					this.plugin.settings.switchToChineseOnLeaveMath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Space to switch English')
			.setDesc('Chinese + space → English')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.spaceToEnglish)
				.onChange(async (value) => {
					this.plugin.settings.spaceToEnglish = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Double space to Chinese')
			.setDesc('English + two spaces → Chinese')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.doubleSpaceToChinese)
				.onChange(async (value) => {
					this.plugin.settings.doubleSpaceToChinese = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Switch to Chinese on newline')
			.setDesc('Press Enter → switch to Chinese')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.switchToChineseOnNewline)
				.onChange(async (value) => {
					this.plugin.settings.switchToChineseOnNewline = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Newline switch delay (ms)')
			.setDesc('Delay before switching to Chinese after newline')
			.addText(text => text
				.setValue(String(this.plugin.settings.newlineSwitchDelayMs))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num >= 0) {
						this.plugin.settings.newlineSwitchDelayMs = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Cancel newline switch on ASCII')
			.setDesc('Typing ASCII after newline cancels the switch')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.newlineCancelOnAscii)
				.onChange(async (value) => {
					this.plugin.settings.newlineCancelOnAscii = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Switch by previous character')
			.setDesc('Auto switch based on last typed character')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.switchByPreviousChar)
				.onChange(async (value) => {
					this.plugin.settings.switchByPreviousChar = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable cursor color')
			.setDesc('Show different cursor colors for different IME states')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCursorColor)
				.onChange(async (value) => {
					this.plugin.settings.enableCursorColor = value;
					await this.plugin.saveSettings();
					this.plugin.updateCursorStyle();
				}));

		new Setting(containerEl)
			.setName('Chinese cursor color')
			.setDesc('Hex, rgb() or a color name. Leave empty to use the theme color.')
			.addText(text => text
				.setPlaceholder('Theme default')
				.setValue(this.plugin.settings.chineseCursorColor)
				.onChange(async (value) => {
					this.plugin.settings.chineseCursorColor = value;
					await this.plugin.saveSettings();
					this.plugin.updateCursorStyle();
				}));

		new Setting(containerEl)
			.setName('English cursor color')
			.setDesc('Hex, rgb() or a color name. Leave empty to use the theme color.')
			.addText(text => text
				.setPlaceholder('Theme default')
				.setValue(this.plugin.settings.englishCursorColor)
				.onChange(async (value) => {
					this.plugin.settings.englishCursorColor = value;
					await this.plugin.saveSettings();
					this.plugin.updateCursorStyle();
				}));
	}
}
