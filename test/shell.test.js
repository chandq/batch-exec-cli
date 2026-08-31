import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { quoteCmd, resolveShell, shellDisplayName } from '../src/shell.js';

describe('shell configuration', () => {
  it('resolves bash and preserves strict bash settings', () => {
    const config = resolveShell('bash');

    assert.strictEqual(config.syntax, 'posix');
    assert.strictEqual(path.basename(config.executable).toLowerCase().replace(/\.exe$/, ''), 'bash');
    assert.strictEqual(config.prefix, 'set -euo pipefail;');
  });

  it('propagates PowerShell native and command-not-found failures', () => {
    let config;
    for (const shell of ['pwsh', 'powershell']) {
      try {
        config = resolveShell(shell);
        break;
      } catch {
        // Try the next PowerShell executable available on this platform.
      }
    }

    if (!config) return;

    assert.strictEqual(config.postfix.includes('$LastExitCode'), true);
    assert.strictEqual(config.postfix.includes('-not $?'), true);
  });

  it('resolves a custom shell path and infers its syntax', () => {
    const config = resolveShell(process.platform === 'win32' ? process.env.ComSpec : '/bin/sh');

    assert.strictEqual(config.syntax, process.platform === 'win32' ? 'cmd' : 'posix');
    assert(config.executable);
  });

  it('resolves the system shell from the current platform', () => {
    const config = resolveShell('system');

    assert(config.executable);
    assert.strictEqual(config.syntax, process.platform === 'win32' ? 'cmd' : 'posix');
    assert.strictEqual(shellDisplayName(config).startsWith('system ('), true);
  });

  it('provides cmd-safe quoting for shell metacharacters', () => {
    assert.strictEqual(quoteCmd('plain'), 'plain');
    assert.strictEqual(quoteCmd('a b'), '^"a^ b^"');
    assert.strictEqual(quoteCmd('a&b'), '^"a^&b^"');
  });

  it('rejects an unavailable shell before execution', () => {
    assert.throws(() => resolveShell('batch-exec-shell-does-not-exist'), /Shell not found/);
  });
});
