# Smart IME for Obsidian

自动切换中英文输入法的 Obsidian 插件，提高数学笔记输入效率。

## 功能特性

- 上一字符为中文：根据上一个字符是否为中文自动切换到中文（带可配置节流，仅对该规则生效）
- 数学环境识别：在 LaTeX 数学公式中自动切换到英文；离开数学环境自动切回中文（可开关）
- 空格快速切换：中文后输入一个空格自动切换到英文
- 双空格细节：英文状态下，行内已有中文，且两空格前为非中文字符时，删除一个末尾空格并切回中文（可开关）
- 换行切中文：插入换行（Enter）后自动切换到中文（可开关）
- 可配置间隔：防止“上一字符为中文”规则频繁触发

## 安装（详见 安装说明.txt）

1. 下载 im-select.exe
2. 复制 main.js、manifest.json 和 im-select.exe 到 Obsidian vault 的 `.obsidian/plugins/smart-ime/` 目录
3. 在 Obsidian 中启用插件
4. 配置中英文输入法 ID

### macOS 说明

- 安装依赖：`brew install im-select`（Apple Silicon 通常位于 `/opt/homebrew/bin/im-select`，Intel 通常位于 `/usr/local/bin/im-select`）
- 插件会自动在上述路径或系统 PATH 中查找 `im-select`；也支持将可执行文件放入插件目录 `.obsidian/plugins/smart-ime/im-select`
- 通过执行 `im-select` 获取当前输入法 ID（如 `com.apple.keylayout.ABC`），将其填入插件设置中的 Chinese/English IME

可选：手动指定 im-select 路径
- 在插件设置中填写 `im-select path (optional)`，可覆盖自动探测。
- Windows 示例：`C:\\Tools\\im-select.exe`；macOS 示例：`/opt/homebrew/bin/im-select`

### 验证 im-select（推荐）

- 在插件设置页点击 `Test im-select` 按钮。
- 弹窗会显示：使用的 im-select 路径、当前 IME 标识、带参数模式是否可用。
- 若测试失败，优先检查 im-select 是否安装或补充 `im-select path (optional)`。

## 设置项（摘）

- Switch to English in math：进入 `$...$` 或 `$$...$$` 中自动切英文（默认开）
- Switch to Chinese when leaving math：离开数学环境自动切中文（默认开）
- Space to switch English：中文后输入空格切英文（默认开）
- Double space to Chinese：英文后输入两个空格切中文，并删除一个多余空格（默认关）
- Switch by previous character：上一字符为中文则切中文（默认开，受 Switch interval 节流）
- Switch interval (ms)：上述“上一字符为中文”规则的节流间隔（默认 2000ms）
- Switch to Chinese on newline：插入换行后切中文（默认开）
- Newline switch delay (ms)：换行后延时再切中文（默认 250ms，输入 ASCII 将取消）
- Cancel newline switch on ASCII：换行后若输入 ASCII（如 d/m），取消切中文（默认开）
