# Smart IME

[English](#english) | [中文](#中文)

## English

Smart IME switches your system input method between Chinese and English automatically while you type in Obsidian, based on the editing context. It is designed for notes that mix Chinese prose with math and code.

### Features

- **Math aware**: switches to English inside `$...$` and `$$...$$`, and back to Chinese when you leave. Detection uses Obsidian's own markdown syntax tree, so text between two formula blocks is handled correctly.
- **Code aware**: never switches inside fenced code blocks or inline code.
- **Space rules**: Chinese + space → English. Optional: English + two spaces → Chinese (one space is removed).
- **Newline**: Enter → Chinese, after a short delay that is cancelled if you keep typing letters or digits.
- **Status bar indicator** (`中` / `EN`) and a **Toggle IME (中/英)** command you can bind to a hotkey.
- **Cursor color** per input method (optional; empty = theme color).

### Requirement: im-select

This plugin runs the external command-line program [im-select](https://github.com/daipeihust/im-select) to read and switch the system input method. **It is not bundled with the plugin** — install it yourself:

- **Windows**: download `im-select.exe` (see the [im-select README](https://github.com/daipeihust/im-select#windows) for x86/x64 builds) and put it in the plugin folder `<vault>/.obsidian/plugins/smart-ime/`, in a folder on your `PATH`, or anywhere and set **im-select path** in the plugin settings.
- **macOS**:
  ```bash
  brew tap daipeihust/tap
  brew install im-select
  ```
  The plugin looks in `/opt/homebrew/bin`, `/usr/local/bin`, the plugin folder and `PATH`.
- **Linux**: im-select itself does not support Linux. Any command that prints the current input method when run without arguments and switches when given one argument can be set as **im-select path**.

### Installation

- **Community plugins** (once approved): Settings → Community plugins → Browse → search "Smart IME".
- **Beta via [BRAT](https://github.com/TfTHacker/obsidian42-brat)**: add `nwh-phy/Smart-IME-for-Obsidian`.
- **Manual**: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/nwh-phy/Smart-IME-for-Obsidian/releases) into `<vault>/.obsidian/plugins/smart-ime/`, then enable the plugin.

### Setup

1. Switch to your English input method and run `im-select` in a terminal; note the output. Do the same with your Chinese input method.
   - Windows: usually `1033` (English – US keyboard) and `2052` (Chinese). You need an English keyboard layout installed, because Microsoft Pinyin's internal English mode still reports `2052`.
   - macOS: e.g. `com.apple.keylayout.ABC` and `com.apple.inputmethod.SCIM.ITABC`.
2. Enter the two identifiers in Settings → Smart IME.
3. Click **Run test** to check that im-select is found and works.

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| Switch to English in math | on | English inside `$...$` / `$$...$$` |
| Switch to Chinese when leaving math | on | Chinese after leaving a formula |
| Space to switch English | on | Chinese + space → English |
| Double space to Chinese | off | English + two spaces → Chinese, removes one space |
| Switch to Chinese on newline | on | Enter → Chinese |
| Newline switch delay (ms) | 250 | Delay before the newline switch |
| Cancel newline switch on ASCII | on | Typing letters/digits within the delay cancels it |
| Switch by previous character | on | Chinese character just typed → Chinese (throttled) |
| Switch interval (ms) | 2000 | Throttle for the rule above |
| Enable cursor color | on | Cursor color per input method |
| Chinese / English cursor color | `#ff0000` / empty | Empty = theme color |
| im-select path | empty | Override auto-detection |

### Disclosures

- Runs a local executable (im-select, or the program set in **im-select path**) with an input method identifier as its only argument.
- Checks whether im-select exists in the plugin folder and the common install locations listed above. It reads and writes no other files outside your vault.
- No network access, no telemetry. Desktop only.

---

## 中文

自动切换中英文输入法的 Obsidian 插件，适合中文正文里夹杂公式和代码的笔记。

### 功能

- **公式识别**：进入 `$...$` 或 `$$...$$` 自动切英文，离开后切回中文。基于 Obsidian 自身的语法树判断，两个公式块之间的正文不会被误判。
- **代码识别**：代码块和行内代码里不做任何切换。
- **空格规则**：中文后输入空格 → 英文；可选：英文后连按两个空格 → 中文（自动删掉一个空格）。
- **换行切中文**：回车后延时切到中文，延时内继续输入字母/数字则取消。
- **状态栏指示**（`中` / `EN`）和 **Toggle IME (中/英)** 命令，可绑定快捷键。
- **光标颜色**随输入法变化（可选，留空 = 使用主题颜色）。

### 依赖：im-select

插件通过调用外部命令行程序 [im-select](https://github.com/daipeihust/im-select) 读取和切换系统输入法，**插件本身不附带 im-select**，需要自行安装：

- **Windows**：从 [im-select 的说明](https://github.com/daipeihust/im-select#windows) 下载 `im-select.exe`（有 x86 / x64 版本），放到插件目录 `<vault>/.obsidian/plugins/smart-ime/`、`PATH` 里的任意目录，或在设置中填写 **im-select path**。
- **macOS**：
  ```bash
  brew tap daipeihust/tap
  brew install im-select
  ```
  插件会在 `/opt/homebrew/bin`、`/usr/local/bin`、插件目录和 `PATH` 中查找。
- **Linux**：im-select 不支持 Linux。任何"无参数运行时输出当前输入法、带一个参数时切换到该输入法"的命令，都可以填到 **im-select path** 使用。

### 安装

- **社区插件市场**（审核通过后）：设置 → 第三方插件 → 浏览 → 搜索 "Smart IME"。
- **用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 安装测试版**：添加 `nwh-phy/Smart-IME-for-Obsidian`。
- **手动安装**：从 [最新 Release](https://github.com/nwh-phy/Smart-IME-for-Obsidian/releases) 下载 `main.js`、`manifest.json`、`styles.css`，放到 `<vault>/.obsidian/plugins/smart-ime/`，然后启用插件。

### 配置

1. 切到英文输入法，在终端运行 `im-select` 记下输出；再切到中文输入法运行一次。
   - Windows：通常英文为 `1033`（英语-美国键盘），中文为 `2052`。需要系统里装有英文键盘布局，因为微软拼音内部的"英文模式"仍然显示为 `2052`。
   - macOS：例如 `com.apple.keylayout.ABC` 和 `com.apple.inputmethod.SCIM.ITABC`。
2. 在 设置 → Smart IME 中填入两个标识。
3. 点击 **Run test** 检查 im-select 能否找到并正常工作。

### 设置项

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| Switch to English in math | 开 | 公式内切英文 |
| Switch to Chinese when leaving math | 开 | 离开公式切中文 |
| Space to switch English | 开 | 中文 + 空格 → 英文 |
| Double space to Chinese | 关 | 英文 + 两个空格 → 中文，并删掉一个空格 |
| Switch to Chinese on newline | 开 | 回车 → 中文 |
| Newline switch delay (ms) | 250 | 换行后延时多久切中文 |
| Cancel newline switch on ASCII | 开 | 延时内输入字母/数字则取消 |
| Switch by previous character | 开 | 刚输入的是汉字 → 中文（受节流限制） |
| Switch interval (ms) | 2000 | 上一条规则的节流间隔 |
| Enable cursor color | 开 | 光标颜色随输入法变化 |
| Chinese / English cursor color | `#ff0000` / 空 | 留空 = 主题颜色 |
| im-select path | 空 | 手动指定路径，覆盖自动探测 |

### 说明（Disclosures）

- 插件会运行本地程序（im-select，或 **im-select path** 中指定的程序），唯一的参数是输入法标识。
- 会检查插件目录和上面列出的常见安装位置里是否存在 im-select，除此之外不读写库外的任何文件。
- 不联网，不收集任何数据。仅支持桌面端。

## License

[MIT](LICENSE)
