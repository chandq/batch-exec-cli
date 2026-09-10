import path from 'path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { which, quote, quotePowerShell } from 'zx';

const SHELL_ALIASES = new Map([
  ['cmd', { executable: 'cmd.exe', syntax: 'cmd', label: 'cmd' }],
  [
    'powershell',
    {
      executable: process.platform === 'win32' ? 'powershell.exe' : 'powershell',
      syntax: 'powershell',
      label: 'powershell'
    }
  ],
  ['pwsh', { executable: 'pwsh', syntax: 'powershell', label: 'pwsh' }]
]);

// WSL.exe cannot be used as a shell: zx/Node spawn shells on Windows with the
// cmd-style `/d /s /c` contract, which wsl.exe does not accept. It is handled
// in resolveShell() with an actionable error instead of being listed here.
//
// Fallback install roots for Git for Windows bash. These are only consulted
// when `bash` is not on PATH. The system drive is not always C: (OEM/enterprise
// images) and Git may be installed to a custom drive, so the roots are derived
// from the standard ProgramFiles environment variables with C:\ kept only as a
// last-resort default.
const DEFAULT_GIT_BASH_ROOTS = ['C:\\Program Files', 'C:\\Program Files (x86)'];

/**
 * Candidate paths for Git for Windows `bash.exe`, drive-agnostic.
 *
 * `env` and `platform` are parameters (rather than reading process globals
 * directly) so this stays a pure, testable function; callers omit them to use
 * the live environment.
 */
export function gitBashCandidates(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return [];

  const roots = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramW6432,
    ...DEFAULT_GIT_BASH_ROOTS
  ].filter(Boolean);

  return [...new Set(roots)].map(root => path.join(root, 'Git', 'bin', 'bash.exe'));
}

/**
 * Every `bash.exe` reachable through PATH, in PATH order - not just the first.
 *
 * `which.sync('bash')` stops at the first hit, which on Windows is frequently
 * C:\Windows\System32\bash.exe (the WSL launcher). That single answer would
 * hide a perfectly good Git Bash further down PATH, so the whole list is
 * collected and the shim is filtered out later by isWslBashShim().
 *
 * `exists` is injectable so the scan can be tested without touching the disk.
 */
export function bashCandidatesFromPath(env = process.env, platform = process.platform, exists = existsSync) {
  if (platform !== 'win32') return [];

  const rawPath = env.PATH || env.Path || '';
  const found = [];
  const seen = new Set();

  for (const entry of rawPath.split(path.win32.delimiter)) {
    // PATH entries are occasionally quoted; drop the quotes before joining.
    const dir = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!dir) continue;

    const candidate = path.win32.join(dir, 'bash.exe');
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (exists(candidate)) found.push(candidate);
  }

  return found;
}

/**
 * Git Bash candidates derived from the `git` executable already on PATH, which
 * covers installs outside the standard Program Files roots.
 *
 * Layouts seen in the wild: <root>\cmd\git.exe and <root>\bin\git.exe for a
 * normal install (both under `Git`), <root>\mingw64\bin\git.exe inside
 * MSYS2-style trees.
 */
export function gitRootBashCandidates(gitExecutable, platform = process.platform) {
  if (platform !== 'win32' || typeof gitExecutable !== 'string' || !gitExecutable) return [];

  const dir = path.win32.dirname(gitExecutable);
  const dirName = path.win32.basename(dir).toLowerCase();
  let root = dir;
  if (dirName === 'bin' || dirName === 'cmd') {
    root = path.win32.dirname(dir);
    // MSYS2-style trees nest the shell one level deeper: <root>\mingw64\bin.
    const parentName = path.win32.basename(root).toLowerCase();
    if (parentName === 'mingw64' || parentName === 'mingw32') {
      root = path.win32.dirname(root);
    }
  }

  return [
    path.win32.join(root, 'bin', 'bash.exe'),
    path.win32.join(root, 'usr', 'bin', 'bash.exe')
  ];
}

/**
 * True when `executable` is the WSL bash shim that ships in the Windows system
 * directory (System32\bash.exe).
 *
 * That shim forwards to a WSL distro and cannot serve as a zx/Node Windows
 * shell. It is rejected by path rather than by probing, because probing it
 * boots the WSL VM - seconds of latency, or the full probe timeout - on every
 * invocation, for an answer that is always "unusable".
 *
 * Uses path.win32 explicitly so the check stays correct (and testable) even
 * when evaluated on a non-Windows host. Windows paths are case-insensitive.
 */
export function isWslBashShim(executable, env = process.env, platform = process.platform) {
  if (platform !== 'win32' || typeof executable !== 'string' || !executable) return false;

  const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows';
  const system32 = path.win32.resolve(systemRoot, 'System32').toLowerCase();
  const target = path.win32.resolve(executable).toLowerCase();
  const relative = path.win32.relative(system32, target);

  return relative !== '' && !relative.startsWith('..') && !path.win32.isAbsolute(relative);
}

export function quoteCmd(arg) {
  const value = String(arg);
  if (value.length === 0) return '""';

  if (/^[\w/.+:=@%,-]+$/.test(value)) return value;

  // Follow cmd.exe's quoting rules for spaces, quotes and metacharacters.
  const escaped = value.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/g, '$1$1');
  return `"${escaped}"`.replace(/([()[\]%!^"`<>&|;, *?])/g, '^$1');
}

/**
 * True when a command line uses shell syntax that only works if the shell -
 * rather than the per-argument quoting layer - interprets it. Callers switch
 * to raw mode on a true result so the command line reaches the shell verbatim.
 *
 * The heuristic is deliberately conservative, because a false positive
 * silently changes how a working command runs while a false negative only
 * asks the user for an explicit `--raw`:
 *  - only unquoted text counts - a metacharacter the user quoted belongs to an
 *    argument and must keep its literal meaning;
 *  - `|`, `&`, `;`, `<`, `>` must additionally sit on a token boundary, since
 *    they legitimately appear inside ordinary arguments such as a regex
 *    (`--grep=a|b`) or a URL query string (`https://host/p?a=1&b=2`);
 *  - backticks and `$(` are unambiguous enough to count anywhere.
 */
export function containsShellOperators(cmdLine) {
  if (typeof cmdLine !== 'string' || cmdLine === '') return false;

  let quote = null;
  for (let i = 0; i < cmdLine.length; i++) {
    const char = cmdLine[i];

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '`') return true;
    if (char === '$' && cmdLine[i + 1] === '(') return true;
    if ((char === '|' || char === '&' || char === ';' || char === '<' || char === '>') && isTokenBoundary(cmdLine, i)) {
      return true;
    }
  }
  return false;
}

function isTokenBoundary(cmdLine, index) {
  const before = index === 0 ? ' ' : cmdLine[index - 1];
  const after = index + 1 >= cmdLine.length ? ' ' : cmdLine[index + 1];
  const isSpace = char => char === ' ' || char === '\t' || char === '\n';
  // Doubled operators (`&&`, `;;`) stay operators even when tightly written.
  return isSpace(before) || isSpace(after) || after === cmdLine[index];
}

function inferSyntax(executable) {
  const name = path.basename(executable).toLowerCase();
  if (name === 'cmd' || name === 'cmd.exe') return 'cmd';
  if (name === 'powershell' || name === 'powershell.exe' || name === 'pwsh' || name === 'pwsh.exe') {
    return 'powershell';
  }
  return 'posix';
}

function stripExe(name) {
  return name.toLowerCase().replace(/\.exe$/, '');
}

function isBash(executable) {
  return stripExe(path.basename(executable)) === 'bash';
}

function isBashLike(requested) {
  return stripExe(path.basename(requested)) === 'bash';
}

function runProbe(executable, args, timeout = 5000) {
  try {
    execFileSync(executable, args, { stdio: 'ignore', timeout });
    return true;
  } catch {
    return false;
  }
}

const bashProbeCache = new Map();

/**
 * Probe a bash executable once and cache the answer, since resolution runs on
 * every CLI invocation.
 *
 * `set -o pipefail` doubles as the usability test: a shell that runs it and
 * exits 0 can execute the `-c` contract zx/Node rely on AND supports pipefail.
 * That collapses the previous two spawns (usability probe + `bash --version`)
 * into one for every modern bash.
 *
 * A non-zero exit is ambiguous - an old bash predates pipefail, while a broken
 * shell (e.g. the WSL bash shim) fails everything - so a plain `-c 'exit 0'`
 * probe disambiguates. That second spawn is only paid on hosts whose bash
 * predates pipefail, and never fails a shell that is merely old.
 */
function probeBash(executable) {
  const key = path.resolve(executable);
  if (!bashProbeCache.has(key)) {
    const supportsPipefail = runProbe(key, ['-c', 'set -o pipefail && exit 0']);
    const usable = supportsPipefail || runProbe(key, ['-c', 'exit 0']);
    bashProbeCache.set(key, { usable, pipefail: supportsPipefail && usable });
  }
  return bashProbeCache.get(key);
}

function isUsableBash(executable) {
  return probeBash(executable).usable;
}

function strictBashPrefix(executable) {
  // Older bash builds lack `pipefail`; falling back to set -eu keeps strict
  // mode working there instead of failing on every command.
  return bashHasPipefail(executable) ? 'set -euo pipefail;' : 'set -eu;';
}

function bashHasPipefail(executable) {
  return probeBash(executable).pipefail;
}

function findExecutable(executable, input) {
  try {
    return which.sync(executable);
  } catch (error) {
    throw new Error(`Shell not found or not executable: ${input}`);
  }
}

function resolveSystemShell() {
  if (process.platform === 'win32') {
    try {
      const powershell = which.sync('powershell.exe');
      return { executable: powershell, syntax: 'powershell', label: 'system' };
    } catch {
      const executable = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
      return { executable, syntax: 'cmd', label: 'system' };
    }
  }

  const executable = process.env.SHELL || '/bin/sh';
  return { executable, syntax: inferSyntax(executable), label: 'system' };
}

const WSL_SHELL_GUIDANCE =
  "The 'wsl' shell cannot be launched through the Windows shell contract: zx/Node spawn " +
  'shells with cmd-style /d /s /c arguments, which wsl.exe does not accept. To work with WSL:\n' +
  '  - run this CLI inside WSL (install Node in the distro) and use --shell bash, or\n' +
  '  - from Windows, target the WSL directory via a Windows path (\\\\wsl$\\..., or /mnt/... which ' +
  'is converted automatically) and use a Windows shell such as --shell system/powershell/pwsh.';

/**
 * Resolve a real, usable bash on Windows.
 *
 * `bash` on PATH may resolve to the WSL bash shim (C:\Windows\System32\bash.exe),
 * which cannot run `bash -c` and would break every command. The shim is
 * rejected by path - never spawned, since probing it would boot the WSL VM -
 * and the remaining candidates are probed in order; the first one that actually
 * executes wins.
 *
 * Candidates are gathered from several sources because no single one is
 * reliable: PATH can be dominated by the shim, and Git Bash is not always under
 * Program Files (custom drives, Scoop, per-user installs).
 */
function resolveBashDefinition() {
  if (process.platform !== 'win32') {
    return { executable: findExecutable('bash', 'bash'), syntax: 'posix', label: 'bash' };
  }

  const candidates = [];
  try {
    candidates.push(which.sync('bash'));
  } catch {
    // bash is not on PATH; the PATH scan and the Git-based sources below still
    // get a chance.
  }
  // Every bash.exe on PATH, not only the first - otherwise a shim earlier in
  // PATH hides the Git Bash behind it.
  candidates.push(...bashCandidatesFromPath());
  try {
    for (const candidate of gitRootBashCandidates(which.sync('git'))) {
      if (existsSync(candidate)) candidates.push(candidate);
    }
  } catch {
    // git is not on PATH; the standard install roots below remain.
  }
  for (const candidate of gitBashCandidates()) {
    if (existsSync(candidate)) candidates.push(candidate);
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const executable = path.resolve(candidate);
    // Dedupe case-insensitively: Windows paths differing only in case are the
    // same file, and each distinct probe is a process spawn.
    const key = process.platform === 'win32' ? executable.toLowerCase() : executable;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isWslBashShim(executable)) continue;
    if (isUsableBash(executable)) {
      return { executable, syntax: 'posix', label: 'bash' };
    }
  }

  if (candidates.length > 0) {
    throw new Error(
      `No usable bash found (checked: ${candidates.join(', ')}).\n` +
        'On Windows, `bash` on PATH is frequently C:\\Windows\\System32\\bash.exe. That file exists, ' +
        'but it is the WSL launcher rather than Git Bash: it starts a Linux VM and cannot run inside a ' +
        'Windows working directory, so it is rejected without being probed at all.\n' +
        'Fix it by installing Git Bash, or by pointing at the real one explicitly:\n' +
        '  batch-exec --shell "C:\\Program Files\\Git\\bin\\bash.exe" ...\n' +
        '--shell system/powershell/cmd also works (at the cost of a slower shell start).'
    );
  }
  throw new Error('Shell not found or not executable: bash');
}

function buildShellConfig(requested, definition) {
  const executable = findExecutable(definition.executable, requested);
  const syntax = definition.syntax;
  const strict = definition.strict ?? (syntax === 'posix' && isBash(executable));

  return {
    requested,
    executable,
    syntax,
    label: definition.label,
    // cmd.exe writes to pipes using the system OEM code page (e.g. GBK on
    // Chinese Windows), regardless of `chcp`. We therefore keep the prefix
    // empty and decode captured output with the OEM code page instead.
    prefix: strict
      ? strictBashPrefix(executable)
      : syntax === 'powershell'
        ? '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; '
        : '',
    // PowerShell reports cmdlet errors (e.g. "dir: cannot find path") as
    // non-terminating, leaving $LASTEXITCODE empty. Capture $? immediately
    // after the command (later statements reset it) and exit with the native
    // code when present, otherwise 1 for cmdlet errors.
    // NOTE: never append a trailing `exit 0` here. PowerShell's `exit` stops
    // the runspace before the formatting engine flushes deferred Format-Table
    // output, so any trailing `exit` silently drops table-formatted results
    // (e.g. `Get-ExecutionPolicy -List`, `Get-Process`). Ending without exit
    // lets tables render and the process still exits 0 on success.
    postfix:
      syntax === 'powershell' ? '; $ok=$?; $be=$LASTEXITCODE; if ($be) { exit $be }; if (-not $ok) { exit 1 }' : '',
    quote: syntax === 'powershell' ? quotePowerShell : syntax === 'cmd' ? quoteCmd : quote
  };
}

/**
 * Resolve and validate a shell option before any directory command starts.
 * Undefined keeps the platform default (see resolveDefaultConfig) unchanged.
 */
export function resolveShell(shellOption) {
  if (shellOption == null || shellOption === '') return null;
  if (typeof shellOption !== 'string') {
    throw new Error('Shell must be a string');
  }

  const requested = shellOption.trim();
  if (!requested) return null;
  const lowered = requested.toLowerCase();

  let definition;
  if (lowered === 'system') {
    definition = resolveSystemShell();
  } else if (isBashLike(requested)) {
    // 'bash' (or an explicit path to a bash-like binary). Validate on Windows
    // so the WSL bash shim is never selected; on other platforms it resolves
    // directly.
    if (process.platform === 'win32' && !path.isAbsolute(requested)) {
      definition = resolveBashDefinition();
    } else {
      definition = { executable: requested, syntax: 'posix', label: requested };
    }
  } else if (
    requested === 'wsl' ||
    requested === 'wsl.exe' ||
    path.basename(lowered) === 'wsl' ||
    path.basename(lowered) === 'wsl.exe'
  ) {
    // wsl.exe is on PATH but cannot act as a zx/Node Windows shell.
    throw new Error(WSL_SHELL_GUIDANCE);
  } else {
    const alias = SHELL_ALIASES.get(lowered);
    definition = alias || {
      executable: requested,
      syntax: inferSyntax(requested),
      label: requested
    };
  }

  return buildShellConfig(requested, definition);
}

/**
 * The platform default shell used when no --shell is given.
 * Non-Windows keeps zx's own default (bash). On Windows, zx's default resolves
 * `bash` from PATH which may be the broken WSL shim, so we resolve a usable
 * bash ourselves and fall back to the system shell (PowerShell) if none exists.
 * Returns null (keep zx default) only outside Windows.
 */
export function resolveDefaultConfig() {
  if (process.platform !== 'win32') return null;
  try {
    return buildShellConfig('default', resolveBashDefinition());
  } catch {
    // No usable bash -> rely on the system shell (PowerShell preferred).
    return buildShellConfig('system', resolveSystemShell());
  }
}

export function normalizeCommandOutput(output, syntax) {
  if (typeof output !== 'string') return output;
  if (syntax !== 'cmd' && !output.includes('\0')) return output;
  return output.replace(/\0/g, '');
}

let oemCodePage = null;

const OEM_CODE_PAGE_REGISTRY_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage';

/**
 * Pull the OEM code page out of `reg.exe query ... /v OEMCP` output, e.g.
 * `    OEMCP    REG_SZ    936`. The value name and type are not localized, so
 * the match is stable across Windows display languages.
 */
export function parseOemCodePage(regOutput) {
  const match = /OEMCP\s+REG_SZ\s+(\d+)/i.exec(regOutput ?? '');
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * OEMCP is the registry source of GetOEMCP() - the same value the PowerShell
 * CultureInfo query reports - but `reg.exe` is a small stub (~30ms) while
 * starting PowerShell costs 0.3-1.5s. The cheap read is therefore tried first
 * and PowerShell is kept only as a fallback.
 */
function readOemCodePageFromRegistry() {
  const out = execFileSync('reg.exe', ['query', OEM_CODE_PAGE_REGISTRY_KEY, '/v', 'OEMCP'], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return parseOemCodePage(out);
}

function readOemCodePageFromPowerShell() {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', '[System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage'],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const value = parseInt(out.trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function detectOemCodePage() {
  if (oemCodePage) return oemCodePage;
  if (process.platform !== 'win32') {
    oemCodePage = 65001;
    return oemCodePage;
  }
  for (const read of [readOemCodePageFromRegistry, readOemCodePageFromPowerShell]) {
    try {
      const value = read();
      if (value) {
        oemCodePage = value;
        return oemCodePage;
      }
    } catch {
      // Try the next source; fall through to the UTF-8 default.
    }
  }
  oemCodePage = 65001;
  return oemCodePage;
}

export function codePageToEncodingLabel(codePage) {
  switch (codePage) {
    case 936:
      return 'gbk';
    case 950:
      return 'big5';
    case 932:
      return 'shift_jis';
    case 949:
      return 'euc-kr';
    case 1252:
      return 'windows-1252';
    case 437:
      return 'ibm437';
    case 850:
      return 'ibm850';
    case 866:
      return 'ibm866';
    case 65001:
      return 'utf-8';
    default:
      return 'utf-8';
  }
}

export function decodeWithCodePage(raw, codePage) {
  const label = codePageToEncodingLabel(codePage);
  try {
    const decoded = new TextDecoder(label).decode(raw);
    return decoded.includes('\uFFFD') ? raw.toString('utf8') : decoded;
  } catch {
    return raw.toString('utf8');
  }
}

function isAsciiBuffer(buffer) {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] > 0x7f) return false;
  }
  return true;
}

/**
 * Decode a zx ProcessOutput's captured stream as the Windows OEM code page.
 *
 * zx decodes every captured chunk as UTF-8, which corrupts cmd.exe output on
 * CJK systems (it writes to pipes using the OEM code page). The only way to get
 * the original bytes is the `_dto` internal, which is private to zx 8.x. This
 * is used defensively:
 *  - the code page only changes how bytes >= 0x80 decode, so pure-ASCII output
 *    (the common case for git/npm) is decoded directly and skips the code-page
 *    probe entirely - on Windows that probe is the most expensive step here;
 *  - raw Buffers/Uint8Arrays are re-decoded with the OEM code page;
 *  - when the raw buffers are unavailable (a future zx change) or decoding
 *    yields replacement characters, it falls back to zx's own lossy strings.
 * Regression coverage lives in test/shell.test.js and test/windowsShell.test.js.
 */
export function decodeCmdOutput(output, stream = 'stdout', codePage) {
  const chunks = output?._dto?.store?.[stream];
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return output?.[stream] ?? '';
  }
  const raw = Buffer.concat(chunks.map(chunk => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))));
  if (isAsciiBuffer(raw)) return raw.toString('utf8');
  return decodeWithCodePage(raw, codePage ?? detectOemCodePage());
}

export function shellDisplayName(shellConfig, defaultExecutable) {
  if (shellConfig) return `${shellConfig.label} (${shellConfig.executable})`;
  if (typeof defaultExecutable === 'string') return `default (${defaultExecutable})`;
  return process.platform === 'win32' ? 'default (system shell)' : 'default (zx Bash)';
}
