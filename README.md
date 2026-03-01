# batch-exec

基于 zx 实现的高效批量命令执行工具，能够遍历目录内所有直接子目录并执行命令。

## 功能特性

- 🚀 高效遍历目标目录的所有直接子目录
- 📁 支持绝对路径和相对路径
- 🚫 可配置忽略目录（支持 `.gitignore` 风格的模式匹配）
- 📊 提供执行摘要和失败目录列表
- 🔧 跨平台支持（Windows、macOS、Linux）
- 💬 详细的 verbose 输出模式
- 🎨 彩色高亮输出，便于识别目录路径和命令
- ⏳ 实时进度条显示，带旋转动画和执行时间
- ✨ 精美的输出格式和摘要展示

## Node.js 版本要求

本工具要求 **Node.js >= 16.0.0**，主要原因包括：

1. **ESM (ECMAScript Modules) 支持**：

   - 项目使用 `"type": "module"` 配置，这需要 Node.js 12+ 才能完全支持
   - Node.js 16 提供了更稳定的 ESM 实现

2. **`fs/promises` API**：

   - 使用 `fs/promises` 进行异步文件操作
   - 这个模块在 Node.js 14+ 开始稳定，但 Node.js 16 提供了更好的性能和错误处理

3. **zx 库依赖**：

   - zx 8.x 版本要求 Node.js 16+
   - zx 提供了强大的 shell 脚本能力，是本工具的核心依赖

4. **现代 JavaScript 特性**：
   - 使用可选链、空值合并等现代语法
   - 这些特性在 Node.js 14+ 支持，但在 16+ 中更加稳定

如果你的 Node.js 版本低于 16.0.0，建议使用 nvm (Node Version Manager) 升级：

```bash
nvm install 16
nvm use 16
```

## 安装

```bash
npm install -g batch-exec
```

或者克隆项目后本地安装：

```bash
git clone <repository-url>
cd batch-exec
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
| `-v, --verbose`     |      | 显示详细输出                                   |
| `--no-progress`     |      | 禁用进度条显示                                 |
| `-h, --help`        |      | 显示帮助信息                                   |

### 使用自定义忽略文件

```bash
batch-exec --skip ./custom-ignore.txt ./repos git status
```

### 禁用进度条

```bash
batch-exec --no-progress ./my-projects npm install
```

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
import { batchExecute } from 'batch-exec';

const results = await batchExecute('./my-projects', 'git', ['pull'], {
  verbose: false,
  showProgress: true
});

console.log(results);
```

## 许可证

MIT
