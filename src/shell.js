import path from 'path';
import { which, quote, quotePowerShell } from 'zx';

const SHELL_ALIASES = new Map([
  ['bash', { executable: 'bash', syntax: 'posix', strict: true, label: 'bash' }],
  ['cmd', { executable: 'cmd.exe', syntax: 'cmd', label: 'cmd' }],
  ['powershell', {
    executable: process.platform === 'win32' ? 'powershell.exe' : 'powershell',
    syntax: 'powershell',
    label: 'powershell'
  }],
  ['pwsh', { executable: 'pwsh', syntax: 'powershell', label: 'pwsh' }]
]);

export function quoteCmd(arg) {
  const value = String(arg);
  if (value.length === 0) return '""';

  if (/^[\w/.+:=@%,-]+$/.test(value)) return value;

  // Follow cmd.exe's quoting rules for spaces, quotes and metacharacters.
  const escaped = value
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/g, '$1$1');
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

function isBash(executable) {
  return path.basename(executable).toLowerCase() === 'bash' || path.basename(executable).toLowerCase() === 'bash.exe';
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
    const executable = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    return { executable, syntax: 'cmd', label: 'system' };
  }

  const executable = process.env.SHELL || '/bin/sh';
  return { executable, syntax: inferSyntax(executable), label: 'system' };
}

/**
 * Resolve and validate a shell option before any directory command starts.
 * Undefined keeps zx's existing global configuration unchanged.
 */
export function resolveShell(shellOption) {
  if (shellOption == null || shellOption === '') return null;
  if (typeof shellOption !== 'string') {
    throw new Error('Shell must be a string');
  }

  const requested = shellOption.trim();
  if (!requested) return null;

  let definition;
  if (requested.toLowerCase() === 'system') {
    definition = resolveSystemShell();
  } else {
    const alias = SHELL_ALIASES.get(requested.toLowerCase());
    definition = alias || {
      executable: requested,
      syntax: inferSyntax(requested),
      label: requested
    };
  }

  const executable = findExecutable(definition.executable, requested);
  const syntax = definition.syntax;
  const strict = definition.strict ?? (syntax === 'posix' && isBash(executable));

  return {
    requested,
    executable,
    syntax,
    label: definition.label,
    prefix: strict ? 'set -euo pipefail;' : '',
    // PowerShell can report command-not-found as a non-terminating error while
    // leaving $LastExitCode at zero, so also propagate the previous $? state.
    postfix: syntax === 'powershell'
      ? '; if ($LastExitCode -ne 0) { exit $LastExitCode }; if (-not $?) { exit 1 }; exit 0'
      : '',
    quote: syntax === 'powershell' ? quotePowerShell : syntax === 'cmd' ? quoteCmd : quote
  };
}

export function shellDisplayName(shellConfig, defaultExecutable) {
  if (shellConfig) return `${shellConfig.label} (${shellConfig.executable})`;
  if (typeof defaultExecutable === 'string') return `default (${defaultExecutable})`;
  return process.platform === 'win32' ? 'default (system shell)' : 'default (zx Bash)';
}
