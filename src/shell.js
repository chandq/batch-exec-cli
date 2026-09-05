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
const GIT_BASH_CANDIDATES = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'];

export function quoteCmd(arg) {
  const value = String(arg);
  if (value.length === 0) return '""';

  if (/^[\w/.+:=@%,-]+$/.test(value)) return value;

  // Follow cmd.exe's quoting rules for spaces, quotes and metacharacters.
  const escaped = value.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/g, '$1$1');
  return `"${escaped}"`.replace(/([()[\]%!^"`<>&|;, *?])/g, '^$1');
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

const usableBashCache = new Map();

/**
 * A real bash accepts `bash -c 'exit 0'`. On Windows, the WSL bash shim
 * (C:\Windows\System32\bash.exe) sits on PATH ahead of Git Bash but cannot
 * execute the `-c` contract that zx/Node rely on, so it must never be picked
 * as the bash shell. Cache per executable since this is called often.
 */
function isUsableBash(executable) {
  const key = path.resolve(executable);
  if (!usableBashCache.has(key)) {
    usableBashCache.set(key, runProbe(key, ['-c', 'exit 0']));
  }
  return usableBashCache.get(key);
}

const pipefailCache = new Map();

function bashHasPipefail(executable) {
  try {
    const out = execFileSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = out.match(/version\s+(\d+)/i);
    const major = match ? Number(match[1]) : NaN;
    return Number.isFinite(major) ? major >= 4 : true;
  } catch {
    // Unknown version: assume a modern bash.
    return true;
  }
}

function strictBashPrefix(executable) {
  const key = path.resolve(executable);
  if (!pipefailCache.has(key)) {
    pipefailCache.set(key, bashHasPipefail(key));
  }
  // macOS ships bash 3.2 which lacks `pipefail`; falling back to set -eu keeps
  // strict mode working there instead of failing on every command.
  return pipefailCache.get(key) ? 'set -euo pipefail;' : 'set -eu;';
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
 * which cannot run `bash -c` and would break every command. Candidates are
 * probed in order (PATH bash, then standard Git for Windows installs) and the
 * first one that actually executes is returned.
 */
function resolveBashDefinition() {
  if (process.platform !== 'win32') {
    return { executable: findExecutable('bash', 'bash'), syntax: 'posix', label: 'bash' };
  }

  const candidates = [];
  try {
    candidates.push(which.sync('bash'));
  } catch {
    // bash is not on PATH; fall back to Git for Windows install locations.
  }
  for (const candidate of GIT_BASH_CANDIDATES) {
    if (existsSync(candidate)) candidates.push(candidate);
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const executable = path.resolve(candidate);
    if (seen.has(executable)) continue;
    seen.add(executable);
    if (isUsableBash(executable)) {
      return { executable, syntax: 'posix', label: 'bash' };
    }
  }

  if (candidates.length > 0) {
    throw new Error(
      `No usable bash found (checked: ${candidates.join(', ')}). The Windows WSL bash shim ` +
        'cannot execute commands. Install Git Bash or use --shell system/powershell/cmd.'
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
    postfix:
      syntax === 'powershell'
        ? '; $ok=$?; $be=$LASTEXITCODE; if ($be) { exit $be }; if (-not $ok) { exit 1 }; exit 0'
        : '',
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

function detectOemCodePage() {
  if (oemCodePage) return oemCodePage;
  if (process.platform !== 'win32') {
    oemCodePage = 65001;
    return oemCodePage;
  }
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', '[System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const value = parseInt(out.trim(), 10);
    oemCodePage = Number.isFinite(value) && value > 0 ? value : 65001;
  } catch {
    oemCodePage = 65001;
  }
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

/**
 * Decode a zx ProcessOutput's captured stream as the Windows OEM code page.
 *
 * zx decodes every captured chunk as UTF-8, which corrupts cmd.exe output on
 * CJK systems (it writes to pipes using the OEM code page). The only way to get
 * the original bytes is the `_dto` internal, which is private to zx 8.x. This
 * is used defensively:
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
  return decodeWithCodePage(raw, codePage ?? detectOemCodePage());
}

export function shellDisplayName(shellConfig, defaultExecutable) {
  if (shellConfig) return `${shellConfig.label} (${shellConfig.executable})`;
  if (typeof defaultExecutable === 'string') return `default (${defaultExecutable})`;
  return process.platform === 'win32' ? 'default (system shell)' : 'default (zx Bash)';
}
