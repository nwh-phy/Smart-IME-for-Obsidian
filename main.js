var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SmartIMEPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_view = require("@codemirror/view");
var import_child_process = require("child_process");
var import_promises = require("fs/promises");
var import_util = require("util");
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
var DEFAULT_SETTINGS = {
  enableAutoSwitch: true,
  switchInterval: 2e3,
  switchToEnglishInMath: true,
  spaceToEnglish: true,
  doubleSpaceToChinese: false,
  switchByPreviousChar: true,
  chineseIME: "",
  englishIME: "",
  enableCursorColor: true,
  chineseCursorColor: "#ff0000",
  englishCursorColor: "#000000",
  switchToChineseOnNewline: true,
  switchToChineseOnLeaveMath: true,
  imSelectCustomPath: "",
  newlineSwitchDelayMs: 250,
  newlineCancelOnAscii: true
};
var SmartIMEPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.lastCheckTime = 0;
    // only used for Chinese-char-trigger throttle
    this.currentIME = "";
    this.imSelectPath = "";
    this.newlineTimer = null;
    this.isSwitchingIME = false;
  }
  async onload() {
    await this.loadSettings();
    await this.detectIMEConfig();
    const initialIME = await this.obtainCurrentIME();
    if (initialIME) {
      this.currentIME = initialIME;
    }
    this.styleEl = document.createElement("style");
    document.head.appendChild(this.styleEl);
    this.updateCursorStyle();
    this.statusBarItemEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.addCommand({
      id: "toggle-ime",
      name: "Toggle IME (\u4E2D/\u82F1)",
      callback: () => this.toggleIME()
    });
    this.registerEditorExtension([
      import_view.EditorView.updateListener.of((update) => {
        if (!this.settings.enableAutoSwitch)
          return;
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
      this.styleEl.textContent = "";
      return;
    }
    if (!this.settings.chineseIME || !this.settings.englishIME) {
      this.styleEl.textContent = "";
      return;
    }
    const color = this.currentIME === this.settings.chineseIME ? this.settings.chineseCursorColor : this.settings.englishCursorColor;
    if (!this.isValidCSSColor(color)) {
      console.warn("Invalid cursor color:", color);
      return;
    }
    this.styleEl.textContent = `.cm-cursor { border-left-color: ${color} !important; }`;
  }
  updateStatusBar() {
    if (!this.settings.chineseIME || !this.settings.englishIME) {
      this.statusBarItemEl.setText("IME: --");
      return;
    }
    const isChinese = this.currentIME === this.settings.chineseIME;
    this.statusBarItemEl.setText(isChinese ? "\u4E2D" : "EN");
  }
  async toggleIME() {
    if (!this.settings.chineseIME || !this.settings.englishIME) {
      new import_obsidian.Notice("Please configure Chinese and English IME identifiers first");
      return;
    }
    const target = this.currentIME === this.settings.chineseIME ? "en" : "zh";
    await this.switchIME(target);
    new import_obsidian.Notice(target === "zh" ? "\u5207\u6362\u5230\u4E2D\u6587" : "Switched to English");
  }
  isValidCSSColor(color) {
    if (!color)
      return false;
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color))
      return true;
    const namedColors = /^(transparent|currentcolor|inherit|initial|unset|black|white|red|green|blue|yellow|cyan|magenta|gray|grey|orange|pink|purple|brown)$/i;
    if (namedColors.test(color))
      return true;
    if (/^(rgb|rgba|hsl|hsla)\(\s*[\d.,\s%]+\s*\)$/.test(color))
      return true;
    return false;
  }
  async detectIMEConfig() {
    try {
      const vaultPath = this.app.vault.adapter.basePath;
      const isWin = process.platform === "win32";
      if (this.settings.imSelectCustomPath && this.settings.imSelectCustomPath.trim().length > 0) {
        const p = this.settings.imSelectCustomPath.trim();
        try {
          await (0, import_promises.access)(p);
          this.imSelectPath = p;
          return;
        } catch (e) {
        }
      }
      if (isWin) {
        const localWin = `${vaultPath}\\.obsidian\\plugins\\smart-ime\\im-select.exe`;
        try {
          await (0, import_promises.access)(localWin);
          this.imSelectPath = localWin;
          return;
        } catch (e) {
        }
        this.imSelectPath = "im-select.exe";
        return;
      }
      if (process.platform === "darwin") {
        const candidates = [
          "/opt/homebrew/bin/im-select",
          "/usr/local/bin/im-select",
          `${vaultPath}/.obsidian/plugins/smart-ime/im-select`
        ];
        for (const p of candidates) {
          try {
            await (0, import_promises.access)(p);
            this.imSelectPath = p;
            return;
          } catch (e) {
          }
        }
        this.imSelectPath = "im-select";
        return;
      }
      if (process.platform === "linux") {
        const candidates = [
          "/usr/local/bin/im-select",
          "/usr/bin/im-select",
          `${vaultPath}/.obsidian/plugins/smart-ime/im-select`
        ];
        for (const p of candidates) {
          try {
            await (0, import_promises.access)(p);
            this.imSelectPath = p;
            return;
          } catch (e) {
          }
        }
        this.imSelectPath = "im-select";
        return;
      }
    } catch (e) {
      console.warn("IME config detect failed, using PATH fallback");
      this.imSelectPath = process.platform === "win32" ? "im-select.exe" : "im-select";
    }
  }
  resolveImSelectExecutable() {
    const custom = (this.settings.imSelectCustomPath || "").trim();
    if (custom.length > 0)
      return custom;
    if (this.imSelectPath && this.imSelectPath.length > 0)
      return this.imSelectPath;
    return process.platform === "win32" ? `${this.app.vault.adapter.basePath}\\.obsidian\\plugins\\smart-ime\\im-select.exe` : "im-select";
  }
  async obtainCurrentIME() {
    try {
      await this.detectIMEConfig();
      const exe = this.resolveImSelectExecutable();
      const { stdout } = await execFileAsync(exe, []);
      const id = (stdout || "").trim();
      return id || null;
    } catch (e) {
      console.error("Failed to obtain current IME:", e);
      return null;
    }
  }
  async testIMSelect() {
    await this.detectIMEConfig();
    const exe = this.resolveImSelectExecutable();
    let msg = `im-select: ${exe}`;
    const current = await this.obtainCurrentIME();
    if (current) {
      msg += `
current IME: ${current}`;
      try {
        await execFileAsync(exe, [current]);
        msg += `
argument mode: OK`;
      } catch (e) {
        msg += `
argument mode: FAILED`;
      }
    } else {
      msg += `
current IME: FAILED`;
    }
    new import_obsidian.Notice(msg, 6e3);
  }
  handleDocChange(update) {
    const now = Date.now();
    const view = update.view;
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);
    if (this.isInCodeBlock(view.state.doc, pos)) {
      return;
    }
    let isInsertion = false;
    update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      if (inserted && inserted.length > 0) {
        isInsertion = true;
      }
    });
    if (!isInsertion) {
      return;
    }
    if (this.settings.switchToChineseOnNewline) {
      let insertedNewline = false;
      let insertedText = "";
      update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        try {
          const str = inserted && inserted.toString ? inserted.toString() : "";
          if (str.includes("\n"))
            insertedNewline = true;
          insertedText += str;
        } catch (e) {
        }
      });
      if (!insertedNewline) {
        const prev = update.startState.selection.main.head;
        const prevLineNo = update.startState.doc.lineAt(prev).number;
        const curLineNo = view.state.doc.lineAt(pos).number;
        if (curLineNo === prevLineNo + 1) {
          insertedNewline = true;
        }
      }
      if (this.newlineTimer && this.settings.newlineCancelOnAscii && /[A-Za-z0-9]/.test(insertedText)) {
        this.clearNewlineTimer();
      }
      if (this.newlineTimer && this.containsChinese(insertedText)) {
        this.clearNewlineTimer();
      }
      if (insertedNewline) {
        this.clearNewlineTimer();
        this.newlineTimer = setTimeout(() => {
          this.switchIME("zh");
          this.clearNewlineTimer();
        }, this.settings.newlineSwitchDelayMs);
      }
    }
    const prevPos = update.startState.selection.main.head;
    const prevInMath = this.isInMathContextDoc(update.startState.doc, prevPos);
    const inMath = this.isInMathContextDoc(view.state.doc, pos);
    if (this.settings.switchToChineseOnLeaveMath && prevInMath && !inMath) {
      this.switchIME("zh");
      this.clearNewlineTimer();
      return;
    }
    if (inMath && this.settings.switchToEnglishInMath) {
      this.switchIME("en");
      this.clearNewlineTimer();
      return;
    }
    const lastChar = textBefore.slice(-1);
    const lastTwoChars = textBefore.slice(-2);
    if (this.settings.doubleSpaceToChinese && lastTwoChars === "  " && this.currentIME === this.settings.englishIME) {
      const charBeforeSpaces = textBefore.slice(-3, -2);
      const hasChineseInLine = this.containsChinese(textBefore);
      if (!this.isChinese(charBeforeSpaces) && hasChineseInLine) {
        const from = pos - 1;
        const to = pos;
        if (from >= 0) {
          view.dispatch({ changes: { from, to, insert: "" } });
        }
        this.switchIME("zh");
        return;
      }
    }
    if (lastChar === " " && this.settings.spaceToEnglish) {
      const charBeforeSpace = textBefore.slice(-2, -1);
      if (this.isChinese(charBeforeSpace)) {
        this.switchIME("en");
        return;
      }
    }
    if (this.settings.switchByPreviousChar && this.isChinese(lastChar)) {
      if (now - this.lastCheckTime >= this.settings.switchInterval) {
        this.lastCheckTime = now;
        this.switchIME("zh");
      }
    }
  }
  handleSelectionUpdate(update) {
    const pos = update.view.state.selection.main.head;
    const prevPos = update.startState.selection.main.head;
    const prevInMath = this.isInMathContextDoc(update.startState.doc, prevPos);
    const inMath = this.isInMathContextDoc(update.view.state.doc, pos);
    if (this.settings.switchToChineseOnLeaveMath && prevInMath && !inMath) {
      this.switchIME("zh");
      this.clearNewlineTimer();
      return;
    }
    if (inMath && this.settings.switchToEnglishInMath) {
      this.switchIME("en");
      this.clearNewlineTimer();
      return;
    }
  }
  isInMathContextDoc(doc, pos) {
    const line = doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);
    const textWithoutEscaped = textBefore.replace(/\\\$/g, "");
    const dollarCount = (textWithoutEscaped.match(/\$/g) || []).length;
    if (dollarCount % 2 === 1)
      return true;
    const curLine = line.number;
    let start = -1;
    for (let i = curLine - 1; i >= Math.max(1, curLine - 400); i--) {
      const t = doc.line(i).text.trim();
      if (t === "$$") {
        start = i;
        break;
      }
    }
    if (start !== -1) {
      let end = -1;
      const total = doc.lines || doc.lineCount || 1e6;
      for (let i = curLine + 1; i <= Math.min(total, start + 400); i++) {
        const t = doc.line(i).text.trim();
        if (t === "$$") {
          end = i;
          break;
        }
      }
      if (end !== -1)
        return true;
    }
    const doubleDollarCount = (textBefore.match(/\$\$/g) || []).length;
    if (doubleDollarCount % 2 === 1)
      return true;
    return false;
  }
  isInCodeBlock(doc, pos) {
    const line = doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);
    const backtickCount = (textBefore.match(/`/g) || []).length;
    const tripleBackticks = (textBefore.match(/```/g) || []).length;
    const singleBackticks = backtickCount - tripleBackticks * 3;
    if (singleBackticks % 2 === 1)
      return true;
    const curLine = line.number;
    let start = -1;
    for (let i = curLine - 1; i >= Math.max(1, curLine - 400); i--) {
      const t = doc.line(i).text.trim();
      if (t.startsWith("```")) {
        start = i;
        break;
      }
    }
    if (start !== -1) {
      let end = -1;
      const total = doc.lines || doc.lineCount || 1e6;
      for (let i = curLine + 1; i <= Math.min(total, start + 400); i++) {
        const t = doc.line(i).text.trim();
        if (t === "```") {
          end = i;
          break;
        }
      }
      if (end !== -1)
        return true;
    }
    return false;
  }
  clearNewlineTimer() {
    if (this.newlineTimer) {
      clearTimeout(this.newlineTimer);
      this.newlineTimer = null;
    }
  }
  isChinese(char) {
    if (!char)
      return false;
    const code = char.codePointAt(0);
    if (code === void 0)
      return false;
    if (code >= 19968 && code <= 40959)
      return true;
    if (code >= 13312 && code <= 19903)
      return true;
    if (code >= 131072 && code <= 173791)
      return true;
    if (code >= 12288 && code <= 12351)
      return true;
    if (code >= 65280 && code <= 65519)
      return true;
    return false;
  }
  containsChinese(text) {
    for (const char of text) {
      if (this.isChinese(char))
        return true;
    }
    return false;
  }
  async switchIME(target) {
    const targetIME = target === "zh" ? this.settings.chineseIME : this.settings.englishIME;
    if (!targetIME || this.currentIME === targetIME)
      return;
    if (this.isSwitchingIME)
      return;
    this.isSwitchingIME = true;
    try {
      const custom = (this.settings.imSelectCustomPath || "").trim();
      const exe = custom.length > 0 ? custom : this.imSelectPath && this.imSelectPath.length > 0 ? this.imSelectPath : process.platform === "win32" ? `${this.app.vault.adapter.basePath}\\.obsidian\\plugins\\smart-ime\\im-select.exe` : "im-select";
      await execFileAsync(exe, [targetIME]);
      this.currentIME = targetIME;
      this.updateCursorStyle();
      this.updateStatusBar();
    } catch (e) {
      console.error("Failed to switch IME:", e);
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
};
var SmartIMESettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Chinese IME").setDesc('Chinese input method identifier (run "im-select" to get current)').addText((text) => text.setValue(this.plugin.settings.chineseIME).onChange(async (value) => {
      this.plugin.settings.chineseIME = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("English IME").setDesc("English input method identifier").addText((text) => text.setValue(this.plugin.settings.englishIME).onChange(async (value) => {
      this.plugin.settings.englishIME = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("im-select path (optional)").setDesc("Full path to im-select. Leave empty to auto-detect. Example: C:\\path\\to\\im-select.exe or /opt/homebrew/bin/im-select").addText((text) => text.setPlaceholder("Auto-detect if empty").setValue(this.plugin.settings.imSelectCustomPath).onChange(async (value) => {
      var _a, _b;
      this.plugin.settings.imSelectCustomPath = value;
      await this.plugin.saveSettings();
      try {
        await ((_b = (_a = this.plugin).detectIMEConfig) == null ? void 0 : _b.call(_a));
      } catch (e) {
      }
    }));
    new import_obsidian.Setting(containerEl).setName("Test im-select").setDesc("Run im-select to detect current IME and validate argument mode").addButton((btn) => btn.setButtonText("Run Test").onClick(async () => {
      await this.plugin.testIMSelect();
    }));
    new import_obsidian.Setting(containerEl).setName("Enable auto switch").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableAutoSwitch).onChange(async (value) => {
      this.plugin.settings.enableAutoSwitch = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Switch interval (ms)").addText((text) => text.setValue(String(this.plugin.settings.switchInterval)).onChange(async (value) => {
      const num = parseInt(value);
      if (!isNaN(num) && num > 0) {
        this.plugin.settings.switchInterval = num;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("Switch to English in math").addToggle((toggle) => toggle.setValue(this.plugin.settings.switchToEnglishInMath).onChange(async (value) => {
      this.plugin.settings.switchToEnglishInMath = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Switch to Chinese when leaving math").setDesc("Leave $...$ or $$...$$ \u2192 Chinese").addToggle((toggle) => toggle.setValue(this.plugin.settings.switchToChineseOnLeaveMath).onChange(async (value) => {
      this.plugin.settings.switchToChineseOnLeaveMath = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Space to switch English").setDesc("Chinese + space \u2192 English").addToggle((toggle) => toggle.setValue(this.plugin.settings.spaceToEnglish).onChange(async (value) => {
      this.plugin.settings.spaceToEnglish = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Double space to Chinese").setDesc("English + two spaces \u2192 Chinese").addToggle((toggle) => toggle.setValue(this.plugin.settings.doubleSpaceToChinese).onChange(async (value) => {
      this.plugin.settings.doubleSpaceToChinese = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Switch to Chinese on newline").setDesc("Press Enter \u2192 switch to Chinese").addToggle((toggle) => toggle.setValue(this.plugin.settings.switchToChineseOnNewline).onChange(async (value) => {
      this.plugin.settings.switchToChineseOnNewline = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Newline switch delay (ms)").setDesc("Delay before switching to Chinese after newline").addText((text) => text.setValue(String(this.plugin.settings.newlineSwitchDelayMs)).onChange(async (value) => {
      const num = parseInt(value);
      if (!isNaN(num) && num >= 0) {
        this.plugin.settings.newlineSwitchDelayMs = num;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("Cancel newline switch on ASCII").setDesc("Typing ASCII after newline cancels the switch").addToggle((toggle) => toggle.setValue(this.plugin.settings.newlineCancelOnAscii).onChange(async (value) => {
      this.plugin.settings.newlineCancelOnAscii = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Switch by previous character").setDesc("Auto switch based on last typed character").addToggle((toggle) => toggle.setValue(this.plugin.settings.switchByPreviousChar).onChange(async (value) => {
      this.plugin.settings.switchByPreviousChar = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Enable cursor color").setDesc("Show different cursor colors for different IME states").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableCursorColor).onChange(async (value) => {
      this.plugin.settings.enableCursorColor = value;
      await this.plugin.saveSettings();
      this.plugin.updateCursorStyle();
    }));
    new import_obsidian.Setting(containerEl).setName("Chinese cursor color").addText((text) => text.setValue(this.plugin.settings.chineseCursorColor).onChange(async (value) => {
      this.plugin.settings.chineseCursorColor = value;
      await this.plugin.saveSettings();
      this.plugin.updateCursorStyle();
    }));
    new import_obsidian.Setting(containerEl).setName("English cursor color").addText((text) => text.setValue(this.plugin.settings.englishCursorColor).onChange(async (value) => {
      this.plugin.settings.englishCursorColor = value;
      await this.plugin.saveSettings();
      this.plugin.updateCursorStyle();
    }));
  }
};
