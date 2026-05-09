import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { execFile } from 'child_process';
import { access } from 'fs/promises';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
	englishCursorColor: '#000000',
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
	private imSelectPath: string = '';
	private styleEl: HTMLStyleElement;
	private newlineTimer: NodeJS.Timeout | null = null;
	private isSwitchingIME: boolean = false;
	private statusBarItemEl: HTMLElement;

	async onload() {
		await this.loadSettings();
		await this.detectIMEConfig();

		// Initialize currentIME with actual system state
		const initialIME = await this.obtainCurrentIME();
		if (initialIME) {
			this.currentIME = initialIME;
		}

		this.styleEl = document.createElement('style');
		document.head.appendChild(this.styleEl);
		this.updateCursorStyle();

		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar();

		this.addCommand({
			id: 'toggle-ime',
			name: 'Toggle IME (中/英)',
			callback: () => this.toggleIME(),
		});

		this.registerEditorExtension([
			EditorView.updateListener.of((update) => {
				if (!this.settings.enableAutoSwitch) return;
				if (update.docChanged) {
					this.handleDocChange(update);
				} else if (update.selectionSet) {
					this.handleSelectionUpdate(update);
				}
			})
		]);

		this.addSettingTab(new SmartIMESettingTab(this.app, this));
	}

	onunload() {
		if (this.styleEl) {
			this.styleEl.remove();
		}
		this.clearNewlineTimer();
	}

	updateCursorStyle() {
		if (!this.settings.enableCursorColor) {
			this.styleEl.textContent = '';
			return;
		}
		// Skip if IME not configured
		if (!this.settings.chineseIME || !this.settings.englishIME) {
			this.styleEl.textContent = '';
			return;
		}
		const color = this.currentIME === this.settings.chineseIME
			? this.settings.chineseCursorColor
			: this.settings.englishCursorColor;
		// Validate color to prevent CSS injection
		if (!this.isValidCSSColor(color)) {
			console.warn('Invalid cursor color:', color);
			return;
		}
		this.styleEl.textContent = `.cm-cursor { border-left-color: ${color} !important; }`;
	}

	updateStatusBar() {
		if (!this.settings.chineseIME || !this.settings.englishIME) {
			this.statusBarItemEl.setText('IME: --');
			return;
		}
		const isChinese = this.currentIME === this.settings.chineseIME;
		this.statusBarItemEl.setText(isChinese ? '中' : 'EN');
	}

	private async toggleIME() {
		if (!this.settings.chineseIME || !this.settings.englishIME) {
			new Notice('Please configure Chinese and English IME identifiers first');
			return;
		}
		const target = this.currentIME === this.settings.chineseIME ? 'en' : 'zh';
		await this.switchIME(target);
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

	private async detectIMEConfig() {
		try {
			const vaultPath = (this.app.vault.adapter as any).basePath as string;
			const isWin = process.platform === 'win32';
			// Prefer user custom path if provided
			if (this.settings.imSelectCustomPath && this.settings.imSelectCustomPath.trim().length > 0) {
				const p = this.settings.imSelectCustomPath.trim();
				try { await access(p); this.imSelectPath = p; return; } catch {}
			}
			if (isWin) {
				const localWin = `${vaultPath}\\.obsidian\\plugins\\smart-ime\\im-select.exe`;
				try { await access(localWin); this.imSelectPath = localWin; return; } catch {}
				this.imSelectPath = 'im-select.exe';
				return;
			}
			// macOS
			if (process.platform === 'darwin') {
				const candidates = [
					'/opt/homebrew/bin/im-select',
					'/usr/local/bin/im-select',
					`${vaultPath}/.obsidian/plugins/smart-ime/im-select`,
				];
				for (const p of candidates) {
					try { await access(p); this.imSelectPath = p; return; } catch {}
				}
				this.imSelectPath = 'im-select'; // fallback to PATH
				return;
			}
			// Linux
			if (process.platform === 'linux') {
				const candidates = [
					'/usr/local/bin/im-select',
					'/usr/bin/im-select',
					`${vaultPath}/.obsidian/plugins/smart-ime/im-select`,
				];
				for (const p of candidates) {
					try { await access(p); this.imSelectPath = p; return; } catch {}
				}
				this.imSelectPath = 'im-select'; // fallback to PATH
				return;
			}
		} catch (e) {
			console.warn('IME config detect failed, using PATH fallback');
			this.imSelectPath = process.platform === 'win32' ? 'im-select.exe' : 'im-select';
		}
	}

	private resolveImSelectExecutable(): string {
		const custom = (this.settings.imSelectCustomPath || '').trim();
		if (custom.length > 0) return custom;
		if (this.imSelectPath && this.imSelectPath.length > 0) return this.imSelectPath;
		return process.platform === 'win32'
			? `${(this.app.vault.adapter as any).basePath}\\.obsidian\\plugins\\smart-ime\\im-select.exe`
			: 'im-select';
	}

	private async obtainCurrentIME(): Promise<string | null> {
		try {
			await this.detectIMEConfig();
			const exe = this.resolveImSelectExecutable();
			const { stdout } = await execFileAsync(exe, []);
			const id = (stdout || '').trim();
			return id || null;
		} catch (e) {
			console.error('Failed to obtain current IME:', e);
			return null;
		}
	}

	async testIMSelect() {
		await this.detectIMEConfig();
		const exe = this.resolveImSelectExecutable();
		let msg = `im-select: ${exe}`;
		const current = await this.obtainCurrentIME();
		if (current) {
			msg += `\ncurrent IME: ${current}`;
			try {
				await execFileAsync(exe, [current]); // verify argument mode without changing IME
				msg += `\nargument mode: OK`;
			} catch (e) {
				msg += `\nargument mode: FAILED`;
			}
		} else {
			msg += `\ncurrent IME: FAILED`;
		}
		new Notice(msg, 6000);
	}

	private handleDocChange(update: ViewUpdate) {
		const now = Date.now();

		const view = update.view;

		const pos = view.state.selection.main.head;
		const line = view.state.doc.lineAt(pos);
		const textBefore = line.text.slice(0, pos - line.from);

		// Skip if in code block
		if (this.isInCodeBlock(view.state.doc as any, pos)) {
			return;
		}

		// Skip if this is a deletion (no text inserted)
		let isInsertion = false;
		update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
			if (inserted && inserted.length > 0) {
				isInsertion = true;
			}
		});
		if (!isInsertion) {
			return;
		}

		// Newline to Chinese (smart, delayed)
		if (this.settings.switchToChineseOnNewline) {
			let insertedNewline = false;
			let insertedText = '';
			update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
				try {
					const str = inserted && (inserted as any).toString ? (inserted as any).toString() : '';
					if (str.includes('\n')) insertedNewline = true;
					insertedText += str;
				} catch {}
			});
			// Fallback: if doc changed and caret moved to next line start, treat as newline
			if (!insertedNewline) {
				const prev = update.startState.selection.main.head;
				const prevLineNo = (update.startState.doc as any).lineAt(prev).number;
				const curLineNo = (view.state.doc as any).lineAt(pos).number;
				if (curLineNo === prevLineNo + 1) {
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
				this.newlineTimer = setTimeout(() => {
					this.switchIME('zh');
					this.clearNewlineTimer();
				}, this.settings.newlineSwitchDelayMs);
			}
		}

		// Check if in math context
		const prevPos = update.startState.selection.main.head;
		const prevInMath = this.isInMathContextDoc(update.startState.doc as any, prevPos);
		const inMath = this.isInMathContextDoc(view.state.doc as any, pos);
		// Leaving math context → switch to Chinese
		if (this.settings.switchToChineseOnLeaveMath && prevInMath && !inMath) {
			this.switchIME('zh');
			this.clearNewlineTimer();
			return;
		}
		if (inMath && this.settings.switchToEnglishInMath) {
			this.switchIME('en');
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
				this.switchIME('zh');
				return;
			}
		}

		// Single space after Chinese to English
		if (lastChar === ' ' && this.settings.spaceToEnglish) {
			const charBeforeSpace = textBefore.slice(-2, -1);
			if (this.isChinese(charBeforeSpace)) {
				this.switchIME('en');
				return;
			}
		}

		// Switch by previous character (throttled)
		if (this.settings.switchByPreviousChar && this.isChinese(lastChar)) {
			if (now - this.lastCheckTime >= this.settings.switchInterval) {
				this.lastCheckTime = now;
				this.switchIME('zh');
			}
		}
	}

	private handleSelectionUpdate(update: ViewUpdate) {
		const pos = update.view.state.selection.main.head;
		const prevPos = update.startState.selection.main.head;
		const prevInMath = this.isInMathContextDoc(update.startState.doc as any, prevPos);
		const inMath = this.isInMathContextDoc(update.view.state.doc as any, pos);
		// Leaving math → Chinese
		if (this.settings.switchToChineseOnLeaveMath && prevInMath && !inMath) {
			this.switchIME('zh');
			this.clearNewlineTimer();
			return;
		}
		// Entering math → English
		if (inMath && this.settings.switchToEnglishInMath) {
			this.switchIME('en');
			this.clearNewlineTimer();
			return;
		}
	}

	private isInMathContextDoc(doc: any, pos: number): boolean {
		const line = doc.lineAt(pos);
		const textBefore = line.text.slice(0, pos - line.from);
		// Remove escaped \$ before counting
		const textWithoutEscaped = textBefore.replace(/\\\$/g, '');
		// Inline math $...$
		const dollarCount = (textWithoutEscaped.match(/\$/g) || []).length;
		if (dollarCount % 2 === 1) return true;
		// Display math $$...$$ spanning multiple lines: find nearest $$ above and below
		const curLine = line.number;
		let start = -1;
		// Search from previous line to avoid matching current line's $$
		for (let i = curLine - 1; i >= Math.max(1, curLine - 400); i--) {
			const t = doc.line(i).text.trim();
			if (t === '$$') { start = i; break; }
		}
		if (start !== -1) {
			let end = -1;
			const total = (doc as any).lines || (doc as any).lineCount || 1000000;
			// Search from next line
			for (let i = curLine + 1; i <= Math.min(total, start + 400); i++) {
				const t = doc.line(i).text.trim();
				if (t === '$$') { end = i; break; }
			}
			if (end !== -1) return true;
		}
		// Fallback: $$ before cursor on current line (rare)
		const doubleDollarCount = (textBefore.match(/\$\$/g) || []).length;
		if (doubleDollarCount % 2 === 1) return true;
		return false;
	}

	private isInCodeBlock(doc: any, pos: number): boolean {
		const line = doc.lineAt(pos);
		const textBefore = line.text.slice(0, pos - line.from);
		// Inline code `...`
		const backtickCount = (textBefore.match(/`/g) || []).length;
		// Exclude triple backticks from count
		const tripleBackticks = (textBefore.match(/```/g) || []).length;
		const singleBackticks = backtickCount - tripleBackticks * 3;
		if (singleBackticks % 2 === 1) return true;
		// Fenced code block ```...```
		const curLine = line.number;
		let start = -1;
		for (let i = curLine - 1; i >= Math.max(1, curLine - 400); i--) {
			const t = doc.line(i).text.trim();
			if (t.startsWith('```')) { start = i; break; }
		}
		if (start !== -1) {
			let end = -1;
			const total = (doc as any).lines || (doc as any).lineCount || 1000000;
			for (let i = curLine + 1; i <= Math.min(total, start + 400); i++) {
				const t = doc.line(i).text.trim();
				if (t === '```') { end = i; break; }
			}
			if (end !== -1) return true;
		}
		return false;
	}

	private clearNewlineTimer() {
		if (this.newlineTimer) {
			clearTimeout(this.newlineTimer);
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

	private async switchIME(target: 'zh' | 'en') {
		const targetIME = target === 'zh' ? this.settings.chineseIME : this.settings.englishIME;
		if (!targetIME || this.currentIME === targetIME) return;

		// Prevent concurrent IME switches
		if (this.isSwitchingIME) return;
		this.isSwitchingIME = true;

		try {
			const custom = (this.settings.imSelectCustomPath || '').trim();
			const exe = custom.length > 0
				? custom
				: (this.imSelectPath && this.imSelectPath.length > 0
				? this.imSelectPath
				: (process.platform === 'win32'
					? `${(this.app.vault.adapter as any).basePath}\\.obsidian\\plugins\\smart-ime\\im-select.exe`
					: 'im-select'));
			await execFileAsync(exe, [targetIME]);
			this.currentIME = targetIME;
			this.updateCursorStyle();
			this.updateStatusBar();
		} catch (e) {
			console.error('Failed to switch IME:', e);
		} finally {
			this.isSwitchingIME = false;
		}
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
					this.plugin.settings.chineseIME = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('English IME')
			.setDesc('English input method identifier')
			.addText(text => text
				.setValue(this.plugin.settings.englishIME)
				.onChange(async (value) => {
					this.plugin.settings.englishIME = value;
					await this.plugin.saveSettings();
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
					try { await (this.plugin as any).detectIMEConfig?.(); } catch {}
				}));

		new Setting(containerEl)
			.setName('Test im-select')
			.setDesc('Run im-select to detect current IME and validate argument mode')
			.addButton(btn => btn
				.setButtonText('Run Test')
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
			.addText(text => text
				.setValue(this.plugin.settings.chineseCursorColor)
				.onChange(async (value) => {
					this.plugin.settings.chineseCursorColor = value;
					await this.plugin.saveSettings();
					this.plugin.updateCursorStyle();
				}));

		new Setting(containerEl)
			.setName('English cursor color')
			.addText(text => text
				.setValue(this.plugin.settings.englishCursorColor)
				.onChange(async (value) => {
					this.plugin.settings.englishCursorColor = value;
					await this.plugin.saveSettings();
					this.plugin.updateCursorStyle();
				}));
	}
}
