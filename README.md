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

## Node.js 版本要求

本工具要求 **Node.js >= 16.0.0**，主要原因包括：

1. **ESM (ECMAScript Modules) 支持**：

   - 项目使用 `"type": "module"` 配置，这需要 Node.js 12+ 才能完全支持
   - Node.js 16 提供了更稳定的 ESM 实现

2. **`fs/promises` API**：

   - 使用 `fs/promises` 进行异步文件操作
   - 这个模块在 Node.js 14+ 开始稳定，但 Node.js 16 提供了更好的性能和错误处理

3. **zx 库依赖**：

   - zx 7.x 版本要求 Node.js 16+
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
| `-h, --help`        |      | 显示帮助信息                                   |

### 使用自定义忽略文件

```bash
batch-exec --skip ./custom-ignore.txt ./repos git status
```

### 详细输出模式

```bash
batch-exec -v ./my-projects npm install
```

## 忽略文件

默认情况下，`batch-exec` 会读取当前执行目录下的 `.batchexecignore` 文件。该文件支持 `.gitignore` 风格的语法：

```bash
# 注释
node_modules
dist/
build
*.tmp
test-*
```

### 忽略规则

- `#` 开头的行为注释
- 支持通配符 `*` 和 `?`
- 以 `/` 结尾的模式只匹配目录
- 空行会被忽略

## API 使用

除了作为 CLI 工具使用外，你也可以在代码中直接使用：

```javascript
import { batchExecute, parseIgnoreFile, listDirectSubdirectories } from 'batch-exec';

// 批量执行命令
const results = await batchExecute('./my-projects', 'git', ['pull'], {
  skipPaths: ['node_modules'],
  verbose: true
});

// 解析忽略文件
const patterns = await parseIgnoreFile('./.batchexecignore');

// 列出直接子目录
const subdirs = await listDirectSubdirectories('./my-projects', patterns);
```

### batchExecute(targetDir, command, args, options)

在目标目录的所有直接子目录中执行命令。

**参数：**

- `targetDir` (string): 目标目录路径
- `command` (string): 要执行的命令
- `args` (string[]): 命令参数数组
- `options` (object): 可选配置
  - `skipPaths` (string[]): 要跳过的目录模式数组
  - `verbose` (boolean): 是否显示详细输出

**返回值：**
返回结果数组，每个结果包含：

- `directory` (string): 目录名
- `success` (boolean): 是否成功
- `stdout` (string): 标准输出
- `stderr` (string): 标准错误
- `error` (string, 可选): 错误信息（如果失败）

## 开发

### 安装依赖

```bash
npm install
```

### 运行测试

**注意：** 测试需要 Node.js >= 18.0.0

```bash
npm test
```

### 代码检查

```bash
npm run lint
```

## 项目结构

```
batch-exec/
├── src/
│   ├── index.js          # 主模块和导出
│   ├── cli.js            # 命令行入口
│   ├── ignoreParser.js   # 忽略文件解析
│   └── directoryLister.js # 目录列表
├── test/
│   ├── ignoreParser.test.js
│   ├── directoryLister.test.js
│   ├── index.test.js
│   └── cli.test.js
├── package.json
├── README.md
└── .batchexecignore
```

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！
