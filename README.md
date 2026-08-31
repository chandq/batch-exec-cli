# batch-exec-cli

高效批量命令执行工具，能够遍历目录内所有直接子目录并执行命令。

[![release status](https://github.com/chandq/batch-exec-cli/actions/workflows/release.yml/badge.svg)](https://github.com/chandq/batch-exec-cli/actions/workflows/release.yml)
[![batch-exec-cli](https://img.shields.io/github/package-json/v/chandq/batch-exec-cli?style=flat-square)](https://www.npmjs.com/package/batch-exec-cli)

## 功能特性

- 🚀 高效遍历目标目录的所有直接子目录, 默认并行执行
- 📁 支持绝对路径和相对路径
- 🚫 可配置忽略目录（支持 `.gitignore` 风格的模式匹配）
- 📊 提供执行摘要和失败目录列表
- 🔧 跨平台支持（Windows、macOS、Linux）
- 💬 详细的 verbose 输出模式
- 🎨 彩色高亮输出，便于识别目录路径和命令
- ⏳ 实时进度条显示，带旋转动画和执行时间
- ✨ 精美的输出格式和摘要展示

## 安装

```bash
npm install -g batch-exec-cli
```

或者克隆项目后本地安装：

```bash
git clone <repository-url>
cd batch-exec-cli
npm install
npm link
```

## 使用方法

### 基本用法

```bash
batch-exec <目录> <命令> [参数...]
```

### 示例

在 `./my-projects` 目录下的所有子目录中执行 `git pull`：

```bash
batch-exec ./my-projects git pull
```

在 `./my-projects` 目录下的所有子目录中更新 lodash 依赖：

```bash
batch-exec ./my-projects npm update lodash -S
```

列出所有子目录的内容：

```bash
batch-exec ./repos ls -la
```

### 选项

| 选项                | 别名 | 描述                                           |
| ------------------- | ---- | ---------------------------------------------- |
| `-s, --skip <文件>` |      | 指定忽略文件路径（默认：`./.batchexecignore`） |
| `--shell <名称或路径>` |      | 指定执行命令使用的 shell：`system`、`bash`、`cmd`、`powershell`、`pwsh` 或可执行文件路径 |
| `-v, --verbose`     |      | 显示详细输出                                   |
| `--no-progress`     |      | 禁用进度条显示                                 |
| `--no-parallel`     |      | 禁用并行执行, 按顺序执行                       |
| `-h, --help`        |      | 显示帮助信息                                   |

### 使用自定义忽略文件

```bash
batch-exec --skip ./custom-ignore.txt ./repos git status
```

### 禁用进度条

```bash
batch-exec --no-progress ./my-projects npm install
```

### 使用指定 Shell

默认模式保持现有的 zx Bash 执行方式。需要使用系统默认终端或其他 shell 时，可以显式指定：

```bash
# 使用当前系统默认 shell（Windows 使用 ComSpec，Unix 使用 SHELL）
batch-exec --shell system ./my-projects npm install

# Windows 使用 PowerShell 或 cmd.exe
batch-exec --shell powershell ./my-projects git status
batch-exec --shell cmd ./my-projects echo hello

# 也可以传入 shell 可执行文件路径
batch-exec --shell /bin/zsh ./my-projects npm test
```

Shell 参数只切换命令解释器，命令仍以非交互方式执行并捕获标准输出和错误输出。

### 显示详细输出

```bash
batch-exec -v ./my-projects git status
```

## 输出示例

### 普通模式（带进度条）

```
⠋ [████████████████████████████░░] 85% (17/20) [5s]
```

### 摘要展示

```
═══════════════════════════════════════════════════════════════
📊 Execution Summary
═══════════════════════════════════════════════════════════════
  Total directories: 20
  Successful:        18
  Failed:            2

❌ Failed directories:
  • project1: Error: Command failed
  • project3: Error: Permission denied
═══════════════════════════════════════════════════════════════
```

## .batchexecignore 文件格式

与 `.gitignore` 文件格式完全相同：

```
node_modules
dist
build
.git
.idea
.vscode
*.tmp
temp-*
```

## API 使用

你也可以作为库使用：

```javascript
import { batchExecute } from 'batch-exec-cli';

const results = await batchExecute('./my-projects', 'git', ['pull'], {
  verbose: false,
  showProgress: true,
  shell: 'system'
});

console.log(results);
```

## 许可证

MIT
