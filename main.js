var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SmartIMEPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_view = require("@codemirror/view");
var import_language = require("@codemirror/language");
var import_child_process = require("child_process");
var import_promises = require("fs/promises");
var path = __toESM(require("path"));
var import_util = require("util");
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
var IME_CACHE_TTL_MS = 1e3;
var IM_SELECT_TIMEOUT_MS = 2e3;
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
  englishCursorColor: "",
  // empty = theme default
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
    this.currentIMEAt = 0;
    // when currentIME was last confirmed
    this.imeStateVersion = 0;
    this.imSelectPath = "";
    this.imSelectFailureNotified = false;
    this.newlineTimer = null;
    this.pendingTarget = null;
    this.switchLoop = null;
    this.styledDocs = /* @__PURE__ */ new Set();
  }
  async onload() {
    await this.loadSettings();
    this.statusBarItemEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.styledDocs.add(document);
    this.registerEvent(this.app.workspace.on("window-open", (win) => {
      this.styledDocs.add(win.doc);
      this.updateCursorStyle();
    }));
    this.registerEvent(this.app.workspace.on("window-close", (win) => {
      this.clearCursorStyle(win.doc);
      this.styledDocs.delete(win.doc);
    }));
    this.updateCursorStyle();
    this.addCommand({
      id: "toggle-ime",
      name: "Toggle IME (\u4E2D/\u82F1)",
      callback: () => this.toggleIME()
    });
    this.registerEditorExtension([
      import_view.EditorView.updateListener.of((update) => {
        if (!this.settings.enableAutoSwitch)
          return;
        if (!update.view.hasFocus || update.view.composing)
          return;
        if (update.docChanged) {
          if (this.isTypingUpdate(update))
            this.handleDocChange(update);
        } else if (update.selectionSet) {
          this.handleSelectionUpdate(update);
        }
      })
    ]);
    this.registerDomEvent(window, "focus", () => {
      void this.syncCurrentIME();
    });
    this.addSettingTab(new SmartIMESettingTab(this.app, this));
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
    let color = "";
    if (enableCursorColor && chineseIME && englishIME) {
      if (this.currentIME === chineseIME)
        color = this.settings.chineseCursorColor.trim();
      else if (this.currentIME === englishIME)
        color = this.settings.englishCursorColor.trim();
    }
    if (!this.isValidCSSColor(color))
      color = "";
    for (const doc of this.styledDocs) {
      if (color) {
        doc.body.classList.add("smart-ime-cursor");
        doc.body.style.setProperty("--smart-ime-cursor-color", color);
      } else {
        this.clearCursorStyle(doc);
      }
    }
  }
  clearCursorStyle(doc) {
    doc.body.classList.remove("smart-ime-cursor");
    doc.body.style.removeProperty("--smart-ime-cursor-color");
  }
  updateStatusBar() {
    const { chineseIME, englishIME } = this.settings;
    let label = "IME: --";
    if (chineseIME && englishIME) {
      if (this.currentIME === chineseIME)
        label = "\u4E2D";
      else if (this.currentIME === englishIME)
        label = "EN";
    }
    this.statusBarItemEl.setText(label);
  }
  async toggleIME() {
    if (!this.settings.chineseIME || !this.settings.englishIME) {
      new import_obsidian.Notice("Please configure Chinese and English IME identifiers first");
      return;
    }
    await this.syncCurrentIME();
    const target = this.currentIME === this.settings.chineseIME ? "en" : "zh";
    const ok = await this.switchIME(target);
    if (!ok) {
      new import_obsidian.Notice("Smart IME: failed to switch IME");
      return;
    }
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
  getPluginDirPath() {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian.FileSystemAdapter) || !this.manifest.dir)
      return null;
    return path.join(adapter.getBasePath(), this.manifest.dir);
  }
  async detectIMEConfig() {
    this.imSelectFailureNotified = false;
    const custom = this.settings.imSelectCustomPath.trim();
    if (custom.length > 0) {
      this.imSelectPath = custom;
      return;
    }
    const exeName = process.platform === "win32" ? "im-select.exe" : "im-select";
    const candidates = [];
    const pluginDir = this.getPluginDirPath();
    if (pluginDir)
      candidates.push(path.join(pluginDir, exeName));
    if (process.platform === "darwin") {
      candidates.push("/opt/homebrew/bin/im-select", "/usr/local/bin/im-select");
    } else if (process.platform === "linux") {
      candidates.push("/usr/local/bin/im-select", "/usr/bin/im-select");
    }
    for (const p of candidates) {
      try {
        await (0, import_promises.access)(p);
        this.imSelectPath = p;
        return;
      } catch (e) {
      }
    }
    this.imSelectPath = exeName;
  }
  resolveImSelectExecutable() {
    const custom = this.settings.imSelectCustomPath.trim();
    if (custom.length > 0)
      return custom;
    if (this.imSelectPath.length > 0)
      return this.imSelectPath;
    return process.platform === "win32" ? "im-select.exe" : "im-select";
  }
  async execImSelect(args) {
    const { stdout } = await execFileAsync(this.resolveImSelectExecutable(), args, {
      timeout: IM_SELECT_TIMEOUT_MS,
      windowsHide: true
    });
    return (stdout || "").trim();
  }
  // Like execImSelect, but tells the user once when im-select can't be run
  async runImSelect(args) {
    try {
      return await this.execImSelect(args);
    } catch (e) {
      const exe = this.resolveImSelectExecutable();
      console.error(`Smart IME: im-select failed (${exe})`, e);
      if (!this.imSelectFailureNotified) {
        this.imSelectFailureNotified = true;
        new import_obsidian.Notice(`Smart IME: failed to run im-select (${exe}). Check "im-select path" in settings.`, 8e3);
      }
      throw e;
    }
  }
  setCurrentIME(id) {
    this.currentIME = id;
    this.currentIMEAt = Date.now();
    this.imeStateVersion++;
    this.updateCursorStyle();
    this.updateStatusBar();
  }
  // Read the actual system IME into the cache
  async syncCurrentIME() {
    const version = this.imeStateVersion;
    let id;
    try {
      id = await this.runImSelect([]);
    } catch (e) {
      return null;
    }
    if (id && version === this.imeStateVersion)
      this.setCurrentIME(id);
    return id || null;
  }
  async testIMSelect() {
    await this.detectIMEConfig();
    let msg = `im-select: ${this.resolveImSelectExecutable()}`;
    try {
      const current = await this.execImSelect([]);
      if (!current)
        throw new Error("empty output");
      this.setCurrentIME(current);
      msg += `
current IME: ${current}`;
      try {
        await this.execImSelect([current]);
        msg += `
argument mode: OK`;
      } catch (e) {
        msg += `
argument mode: FAILED`;
      }
    } catch (e) {
      msg += `
current IME: FAILED (${e instanceof Error ? e.message : String(e)})`;
    }
    new import_obsidian.Notice(msg, 8e3);
  }
  // Paste, drop, undo/redo and similar bulk edits are not typing
  isTypingUpdate(update) {
    return !update.transactions.some((tr) => tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop") || tr.isUserEvent("move") || tr.isUserEvent("undo") || tr.isUserEvent("redo"));
  }
  handleDocChange(update) {
    const now = Date.now();
    const view = update.view;
    const state = update.state;
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);
    const context = this.getEditContext(state, pos);
    if (context === "code") {
      return;
    }
    let insertedText = "";
    update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      insertedText += inserted.toString();
    });
    if (insertedText.length === 0) {
      return;
    }
    if (this.settings.switchToChineseOnNewline) {
      let insertedNewline = insertedText.includes("\n");
      if (!insertedNewline) {
        const prev = update.startState.selection.main.head;
        const prevLineNo = update.startState.doc.lineAt(prev).number;
        if (line.number === prevLineNo + 1) {
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
        this.newlineTimer = window.setTimeout(() => {
          this.newlineTimer = null;
          void this.switchIME("zh");
        }, this.settings.newlineSwitchDelayMs);
      }
    }
    const prevPos = update.startState.selection.main.head;
    const prevInMath = this.getEditContext(update.startState, prevPos) === "math";
    const inMath = context === "math";
    if (this.settings.switchToChineseOnLeaveMath && prevInMath && !inMath) {
      void this.switchIME("zh");
      this.clearNewlineTimer();
      return;
    }
    if (inMath && this.settings.switchToEnglishInMath) {
      void this.switchIME("en");
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
        void this.switchIME("zh");
        return;
      }
    }
    if (lastChar === " " && this.settings.spaceToEnglish) {
      const charBeforeSpace = textBefore.slice(-2, -1);
      if (this.isChinese(charBeforeSpace)) {
        void this.switchIME("en");
        return;
      }
    }
    if (this.settings.switchByPreviousChar && this.isChinese(lastChar)) {
      if (now - this.lastCheckTime >= this.settings.switchInterval) {
        this.lastCheckTime = now;
        void this.switchIME("zh");
      }
    }
  }
  handleSelectionUpdate(update) {
    const pos = update.state.selection.main.head;
    const context = this.getEditContext(update.state, pos);
    if (context === "code")
      return;
    const prevPos = update.startState.selection.main.head;
    const prevInMath = this.getEditContext(update.startState, prevPos) === "math";
    const inMath = context === "math";
    if (this.settings.switchToChineseOnLeaveMath && prevInMath && !inMath) {
      void this.switchIME("zh");
      this.clearNewlineTimer();
      return;
    }
    if (inMath && this.settings.switchToEnglishInMath) {
      void this.switchIME("en");
      this.clearNewlineTimer();
      return;
    }
  }
  // Classify the cursor position with Obsidian's markdown syntax tree, which pairs
  // $$ and ``` delimiters exactly like the renderer does. Current-line heuristics
  // additionally catch $ and ` that have been typed but not closed yet.
  getEditContext(state, pos) {
    var _a;
    const tree = (_a = (0, import_language.ensureSyntaxTree)(state, pos, 20)) != null ? _a : (0, import_language.syntaxTree)(state);
    const doc = state.doc;
    const tokenBefore = (p) => {
      if (p < 0 || p > doc.length)
        return "";
      const node = tree.resolveInner(p, -1);
      return node.parent ? node.name : "";
    };
    const tokenAfter = (p) => {
      if (p < 0 || p > doc.length)
        return "";
      const node = tree.resolveInner(p, 1);
      return node.parent ? node.name : "";
    };
    const line = doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);
    const before = tokenBefore(pos);
    const after = tokenAfter(pos);
    const isEmptyLine = line.length === 0;
    const prevLineEnd = isEmptyLine ? tokenBefore(line.from - 1) : "";
    const nextLineStart = isEmptyLine ? tokenAfter(line.to + 1) : "";
    const isCodeblock = (name) => name.includes("codeblock");
    const isInlineCode = (name) => name.includes("inline-code");
    if (before) {
      if (isCodeblock(before) || isInlineCode(before))
        return "code";
    } else if (pos === line.from && after) {
      if (isCodeblock(after) && !after.includes("codeblock-begin"))
        return "code";
    } else if (isEmptyLine) {
      if (isCodeblock(prevLineEnd) && !prevLineEnd.includes("codeblock-end") && isCodeblock(nextLineStart) && !nextLineStart.includes("codeblock-begin"))
        return "code";
    }
    const backtickCount = (textBefore.match(/`/g) || []).length;
    const tripleBackticks = (textBefore.match(/```/g) || []).length;
    if ((backtickCount - tripleBackticks * 3) % 2 === 1)
      return "code";
    if (before) {
      if (before.includes("math-end"))
        return "text";
      if (before.includes("math"))
        return "math";
    } else if (after) {
      if (!after.includes("math-begin") && after.includes("math"))
        return "math";
    } else if (isEmptyLine) {
      if (prevLineEnd.includes("math") && !prevLineEnd.includes("math-end") && nextLineStart.includes("math"))
        return "math";
    }
    const dollarCount = (textBefore.replace(/\\\$/g, "").match(/\$/g) || []).length;
    if (dollarCount % 2 === 1)
      return "math";
    return "text";
  }
  clearNewlineTimer() {
    if (this.newlineTimer) {
      window.clearTimeout(this.newlineTimer);
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
  // Requests are coalesced instead of dropped: while a switch is running, the
  // latest requested target is remembered and applied right after it.
  switchIME(target) {
    this.pendingTarget = target;
    if (!this.switchLoop) {
      this.switchLoop = this.drainSwitchQueue();
    }
    return this.switchLoop;
  }
  async drainSwitchQueue() {
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
  async applyIME(target) {
    const targetIME = target === "zh" ? this.settings.chineseIME : this.settings.englishIME;
    if (!targetIME)
      return false;
    if (this.currentIME === targetIME) {
      if (Date.now() - this.currentIMEAt < IME_CACHE_TTL_MS)
        return true;
      if (await this.syncCurrentIME() === targetIME)
        return true;
    }
    try {
      await this.runImSelect([targetIME]);
    } catch (e) {
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
      this.plugin.settings.chineseIME = value.trim();
      await this.plugin.saveSettings();
      this.plugin.updateStatusBar();
      this.plugin.updateCursorStyle();
    }));
    new import_obsidian.Setting(containerEl).setName("English IME").setDesc("English input method identifier").addText((text) => text.setValue(this.plugin.settings.englishIME).onChange(async (value) => {
      this.plugin.settings.englishIME = value.trim();
      await this.plugin.saveSettings();
      this.plugin.updateStatusBar();
      this.plugin.updateCursorStyle();
    }));
    new import_obsidian.Setting(containerEl).setName("im-select path (optional)").setDesc("Full path to im-select. Leave empty to auto-detect. Example: C:\\path\\to\\im-select.exe or /opt/homebrew/bin/im-select").addText((text) => text.setPlaceholder("Auto-detect if empty").setValue(this.plugin.settings.imSelectCustomPath).onChange(async (value) => {
      this.plugin.settings.imSelectCustomPath = value;
      await this.plugin.saveSettings();
      await this.plugin.detectIMEConfig();
    }));
    new import_obsidian.Setting(containerEl).setName("Test im-select").setDesc("Run im-select to detect current IME and validate argument mode").addButton((btn) => btn.setButtonText("Run test").onClick(async () => {
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
    new import_obsidian.Setting(containerEl).setName("Chinese cursor color").setDesc("Hex, rgb() or a color name. Leave empty to use the theme color.").addText((text) => text.setPlaceholder("Theme default").setValue(this.plugin.settings.chineseCursorColor).onChange(async (value) => {
      this.plugin.settings.chineseCursorColor = value;
      await this.plugin.saveSettings();
      this.plugin.updateCursorStyle();
    }));
    new import_obsidian.Setting(containerEl).setName("English cursor color").setDesc("Hex, rgb() or a color name. Leave empty to use the theme color.").addText((text) => text.setPlaceholder("Theme default").setValue(this.plugin.settings.englishCursorColor).onChange(async (value) => {
      this.plugin.settings.englishCursorColor = value;
      await this.plugin.saveSettings();
      this.plugin.updateCursorStyle();
    }));
  }
};
