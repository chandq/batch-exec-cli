# batch-exec-cli

高效批量命令执行工具，能够遍历目录内所有直接子目录并执行命令。

[![release status](https://github.com/chandq/batch-exec-cli/actions/workflows/release.yml/badge.svg)](https://github.com/chandq/batch-exec-cli/actions/workflows/release.yml)
[![batch-exec-cli](https://img.shields.io/github/package-json/v/chandq/batch-exec-cli?style=flat-square)](https://www.npmjs.com/package/batch-exec-cli)

## 功能特性

- 🚀 高效遍历目标目录的所有直接子目录, 默认并行执行
- 🎯 支持单目录执行（`--dir`）与按正则匹配子目录（`--match`）
- 🪄 支持管道与 shell 运算符（`|`、`>`、`&&` 等，自动检测或 `--raw` 显式开启）
- 🧮 并发上限可调（`--concurrency`），避免大规模目录下的进程风暴
- 🤫 `--quiet` 模式：stdout 只含命令原始输出，可直接接管道
- 📁 支持绝对路径和相对路径
- 🚫 可配置忽略目录（精确匹配与 `*`/`?` 通配）
- 📊 提供执行摘要和失败目录列表
- 🔧 跨平台支持（Windows、macOS、Linux）
- 💬 详细的 verbose 输出模式
- 🎨 彩色高亮输出，便于识别目录路径和命令
- ⏳ 实时进度条显示，带旋转动画和执行时间
- ✨ 精美的输出格式和摘要展示

## 安装

```bash
# npm
npm install -g batch-exec-cli

# 免安装直接运行
npx batch-exec-cli --help

# Homebrew (macOS / Linux)
brew tap chandq/tap
brew install batch-exec-cli

# Scoop (Windows)
scoop bucket add chandq https://github.com/chandq/scoop-bucket
scoop install batch-exec-cli
```

或者克隆项目后本地安装：

```bash
git clone <repository-url>
cd batch-exec-cli
npm install
npm link
```

> Homebrew 公式与 Scoop manifest 在每次发布后由 CI 自动同步到 `chandq/tap`
> 与 `chandq/scoop-bucket`，新版本可能需要等待片刻才能 `brew upgrade` / `scoop update`。

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

### 单目录执行（--dir）

不想遍历，只想在某个目录里执行一次时使用 `--dir`（跳过子目录遍历，跨平台、复用
同一套 shell 逻辑）：

```bash
batch-exec --dir ./my-project npm test
batch-exec --dir ./pkg/cmd build
```

### 按正则匹配子目录（--match / -m）

只执行名称匹配正则的子目录。可重复指定，多个模式取并集；与 `--skip`/忽略文件
取交集。正则按 JS `RegExp` 对目录名匹配，需要完整匹配时请加 `^...$`：

```bash
# 只执行 service- 开头的子目录
batch-exec --match '^service-' ./monorepo git pull

# 多个模式取并集
batch-exec -m 'pkg-.*' -m 'app-.*' ./workspace npm install

# 精确整名匹配
batch-exec --match '^project1$' ./my-projects echo hi
```

### 选项

| 选项                          | 别名 | 描述                                                                                     |
| ----------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `-s, --skip <文件>`           |      | 指定忽略文件路径（默认：`./.batchexecignore`）                                           |
| `-m, --match <正则>`          | `m`  | 只执行名称匹配正则的子目录（可重复，OR 合并）                                            |
| `--dir <路径>`                |      | 只在指定目录执行一次（跳过子目录遍历）                                                   |
| `--shell <名称或路径>`        |      | 指定执行命令使用的 shell：`system`、`bash`、`cmd`、`powershell`、`pwsh` 或可执行文件路径 |
| `--raw` / `--no-raw`          |      | 强制开关「原始命令行」模式（见下文「管道与 shell 运算符」）                              |
| `--concurrency <n>`           |      | 并行上限，`0` 表示不限制（默认 0，见下文「并发上限」）                                     |
| `--quiet`                     |      | 只输出命令的 stdout，失败信息走 stderr（隐含关闭进度条）                                 |
| `--version`                   |      | 显示版本号                                                                               |
| `-v, --verbose`               |      | 显示详细输出                                                                             |
| `--no-progress`               |      | 禁用进度条显示                                                                           |
| `--no-parallel`               |      | 禁用并行执行, 按顺序执行                                                                 |
| `-h, --help`                  |      | 显示帮助信息                                                                             |

### 管道与 shell 运算符（--raw）

默认情况下每个参数都会被逐字引用后传给程序，所以 `|`、`>`、`&&` 这类字符**不会**被
shell 解释。需要管道时把整条命令用引号括起来即可——CLI 会自动识别未加引号的运算符
并切换到「原始命令行」模式：

```bash
# 自动检测：整条带管道的命令是一个参数
batch-exec ./my-projects 'git branch | wc -l'
batch-exec ./my-projects 'ls *.js | head -3'

# 显式开启
batch-exec --raw ./my-projects ls '>' out.txt

# 关闭自动检测（恢复「参数永远不被 shell 解释」的旧行为）
batch-exec --no-raw ./my-projects echo 'a|b'
```

自动检测是保守的，只把**未加引号**且位于词边界上的 `|`、`&`、`;`、`<`、`>` 视为
shell 语法，因此 `--grep='a|b'` 和 `https://host/p?a=1&b=2` 这类参数不会被误判；
反引号和 `$(` 出现即视为运算符。原始模式下命令按空格重新拼接后交给 shell，包含
空格的参数需要自行加引号。

> **Windows cmd.exe 只能用双引号。** cmd 不把单引号或反引号当引号，`|` 会被 cmd
> 自己当作管道符截断，命令根本到不了 batch-exec：`batch-exec --dir . 'ls -l | wc -l'`
> 会被 cmd 拆成 `node ... 'ls -l` 和 `wc -l'` 两段并接管道，于是你看到的是后一段的
> 报错 `'wc' is not recognized as an internal or external command`；写成
> `` `ls -l | wc -l` `` 同样会被拆开，反引号还会原样留在参数里。正确写法是
> `batch-exec --dir . "ls -l | wc -l"`。PowerShell 和 Git Bash 用单引号没问题
> （两者都真的把引号内的 `|` 当字面量）。

原始模式**不会额外创建进程**：命令行本来就由每个目录各自的 shell 执行，只是不再
逐参数转义。bash 的 `pipefail`、PowerShell 的退出码处理、cmd 的 OEM 解码均保持
不变。

### 并发上限（--concurrency）

默认为 `0`，即**不限制**：所有子目录同时启动，Windows 上也一样。曾经按 CPU 核数封顶
（Windows 4），实测反而慢得多——Windows 上 spawn 一个 shell 是延迟瓶颈而不是 CPU 瓶颈
（进程创建比 Unix 贵 10–50 倍，且被杀软实时扫描串行化），交给系统排队不如把延迟重叠起来。

子进程很重（比如每个目录都跑 `npm install`）时可以显式限量：

```bash
batch-exec --concurrency 16 ./repos git fetch
batch-exec --concurrency 1 ./repos npm install   # 完全串行
```

`--no-parallel` 仍然表示完全顺序执行，此时 `--concurrency` 无效。

### 脚本/管道模式（--quiet）

`--quiet` 下 stdout 只包含各目录命令的原始输出（按目录顺序），没有 `=== 目录 ===`
头、没有摘要、没有进度条，可以直接接入管道；失败目录以 `目录: 错误信息` 形式
输出到 stderr：

```bash
# 只统计所有子目录的 .js 文件总数
batch-exec --quiet --dir ./my-project 'ls *.js' | wc -l

# 配合退出码在脚本中判断
if ! batch-exec --quiet ./my-projects git fetch 2> errors.log; then
  echo "存在失败的目录，详见 errors.log"
fi
```

### 退出码

任一目录的命令失败时，CLI 以退出码 `1` 退出；全部成功为 `0`。参数错误（缺少参数、
无效正则等）同样为 `1`。这是脚本化使用的惯例行为，依赖旧版「总是 0」的脚本请改用
`--quiet` 并检查 stderr。

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
# 使用当前系统默认 shell（Windows 优先 PowerShell，Unix 使用 SHELL）
batch-exec --shell system ./my-projects npm install

# Windows 使用 PowerShell 或 cmd.exe
batch-exec --shell powershell ./my-projects git status
batch-exec --shell cmd ./my-projects echo hello

# 也可以传入 shell 可执行文件路径
batch-exec --shell /bin/zsh ./my-projects npm test
```

Shell 参数只切换命令解释器，命令仍以非交互方式执行并捕获标准输出和错误输出。CLI 普通模式会在进度完成后按目录打印成功命令的输出；库 API 则通过返回值提供这些内容。

### 显示详细输出

```bash
batch-exec -v ./my-projects git status
```

## 输出示例

### 普通模式（带进度条）

```
- [###########--------------------] 55% (11/20) [3s]
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
import { batchExecute, runInDirectory } from 'batch-exec-cli';

// 遍历 ./my-projects 下匹配的子目录并执行命令
const results = await batchExecute('./my-projects', 'git', ['pull'], {
  verbose: false,
  showProgress: true,
  shell: 'system',
  skipPaths: ['node_modules'],
  matchPatterns: ['^service-'], // 可选：只执行名称匹配的子目录（正则）
  concurrency: 8, // 可选：并行上限，0 表示不限制（默认 0，见「并发上限」）
  raw: false // 可选：true 时命令行原样交给 shell（启用管道等）
});

// 只在单个目录执行一次
const single = await runInDirectory('./service-a', 'npm', ['test'], { shell: 'system' });

// 原始命令行模式：命令与参数按空格拼接后交给 shell 解析
const piped = await runInDirectory('./my-project', 'git branch | wc -l', [], {
  shell: 'system',
  raw: true
});

console.log(results, single, piped);
```

## 🤝 贡献

欢迎提交 PR 与 Issue！请先阅读：

- [CONTRIBUTING.md](./CONTRIBUTING.md) — 开发与贡献流程
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — 社区行为准则
- [SECURITY.md](./SECURITY.md) — 安全漏洞上报
- [AGENTS.md](./AGENTS.md) — 代码库约定（供 AI 工具读取）

Issue / PR 模板见仓库 `.github/` 目录。

## 许可证

MIT
