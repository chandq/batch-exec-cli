import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import {
  quoteCmd,
  resolveShell,
  resolveDefaultConfig,
  shellDisplayName,
  normalizeCommandOutput,
  decodeCmdOutput,
  decodeWithCodePage,
  codePageToEncodingLabel
} from '../src/shell.js';

describe('shell configuration', () => {
  it('resolves bash and preserves strict bash settings', t => {
    let config;
    try {
      config = resolveShell('bash');
    } catch {
      // bash (e.g. Git Bash) may not be on PATH on every machine.
      t.skip('bash is not installed or not on PATH');
      return;
    }

    assert.strictEqual(config.syntax, 'posix');
    assert.strictEqual(
      path
        .basename(config.executable)
        .toLowerCase()
        .replace(/\.exe$/, ''),
      'bash'
    );
    // Strict mode enables -e and -u always; pipefail only where bash >= 4
    // supports it (macOS ships bash 3.2 which does not).
    assert.match(config.prefix, /^set -e/);
    assert.match(config.prefix, /set -eu/);
  });

  it('keeps the cmd prefix empty and decodes OEM output instead of relying on chcp', t => {
    let config;
    try {
      config = resolveShell('cmd');
    } catch {
      // cmd.exe only exists on Windows; skip cleanly elsewhere.
      t.skip('cmd.exe is not available on this platform');
      return;
    }

    assert.strictEqual(config.syntax, 'cmd');
    assert.strictEqual(config.prefix, '');
  });

  it('decodes GBK bytes as the Windows OEM code page', () => {
    // GBK bytes for 驱动器 (driver/volume in drive).
    const gbkBytes = Buffer.from([0xc7, 0xfd, 0xb6, 0xaf, 0xc6, 0xf7]);
    assert.strictEqual(codePageToEncodingLabel(936), 'gbk');
    assert.strictEqual(decodeWithCodePage(gbkBytes, 936), '驱动器');
  });

  it('decodes zx raw cmd output buffers with the OEM code page', () => {
    const gbkBytes = Buffer.from([0xc7, 0xfd, 0xb6, 0xaf, 0xc6, 0xf7]);
    const fakeOutput = {
      _dto: { store: { stdout: [gbkBytes], stderr: [] } },
      stdout: 'lossy-utf8-fallback'
    };
    assert.strictEqual(decodeCmdOutput(fakeOutput, 'stdout', 936), '驱动器');
  });

  it('falls back to the captured string when raw buffers are unavailable', () => {
    const fakeOutput = { stdout: 'plain text', stderr: '' };
    assert.strictEqual(decodeCmdOutput(fakeOutput, 'stdout', 936), 'plain text');
  });

  it('forces UTF-8 pipe encoding for PowerShell output', t => {
    let config;
    try {
      config = resolveShell(process.platform === 'win32' ? 'powershell' : 'pwsh');
    } catch {
      // PowerShell (powershell) / pwsh is not installed on this machine.
      t.skip('PowerShell is not installed or not on PATH');
      return;
    }

    assert.strictEqual(config.syntax, 'powershell');
    assert.match(config.prefix, /\[Console\]::OutputEncoding=.*UTF8/i);
    assert.match(config.prefix, /\$OutputEncoding=.*UTF8/i);
  });

  it('rejects the WSL shell with actionable guidance', () => {
    // wsl.exe is on PATH but cannot act as a zx/Node Windows shell, so it must
    // fail fast with guidance instead of resolving to a shell that breaks at
    // runtime.
    assert.throws(() => resolveShell('wsl'), /wsl.*shell contract|WSL/i);
  });

  it('rejects an explicit path to wsl.exe with actionable guidance', () => {
    assert.throws(() => resolveShell('C:\\Windows\\System32\\wsl.exe'), /WSL/i);
  });

  it('resolves a usable platform default shell outside zx', () => {
    const config = resolveDefaultConfig();
    if (process.platform === 'win32') {
      // Windows must never fall through to zx's default (which can be the
      // broken WSL bash shim); it resolves to a validated shell instead.
      assert.ok(config, 'expected a resolved default config on Windows');
      assert.ok(['posix', 'powershell', 'cmd'].includes(config.syntax));
      assert.ok(config.executable);
    } else {
      assert.strictEqual(config, null);
    }
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

    // $? is captured immediately because later statements reset it; the
    // native exit code is preserved when present, otherwise cmdlet errors
    // exit with 1.
    assert.strictEqual(config.postfix.includes('$ok=$?'), true);
    assert.strictEqual(config.postfix.includes('$be=$LASTEXITCODE'), true);
    assert.strictEqual(config.postfix.includes('-not $ok'), true);
  });

  it('resolves a custom shell path and infers its syntax', () => {
    const config = resolveShell(process.platform === 'win32' ? process.env.ComSpec : '/bin/sh');

    assert.strictEqual(config.syntax, process.platform === 'win32' ? 'cmd' : 'posix');
    assert(config.executable);
  });

  it('resolves the system shell from the current platform', () => {
    const config = resolveShell('system');

    assert(config.executable);
    assert.strictEqual(config.syntax, process.platform === 'win32' ? 'powershell' : 'posix');
    assert.strictEqual(shellDisplayName(config).startsWith('system ('), true);
  });

  it('provides cmd-safe quoting for shell metacharacters', () => {
    assert.strictEqual(quoteCmd('plain'), 'plain');
    assert.strictEqual(quoteCmd('a b'), '^"a^ b^"');
    assert.strictEqual(quoteCmd('a&b'), '^"a^&b^"');
  });

  it('removes nul bytes from cmd unicode output', () => {
    const garbled = 'V\0o\0l\0u\0m\0e\0 \0i\0n\0 \0d\0r\0i\0v\0e\0';
    assert.strictEqual(normalizeCommandOutput(garbled, 'cmd'), 'Volume in drive');
  });

  it('rejects an unavailable shell before execution', () => {
    assert.throws(() => resolveShell('batch-exec-shell-does-not-exist'), /Shell not found/);
  });
});
