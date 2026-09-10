import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import {
  quoteCmd,
  gitBashCandidates,
  bashCandidatesFromPath,
  gitRootBashCandidates,
  isWslBashShim,
  resolveShell,
  resolveDefaultConfig,
  shellDisplayName,
  normalizeCommandOutput,
  decodeCmdOutput,
  decodeWithCodePage,
  codePageToEncodingLabel,
  containsShellOperators,
  parseOemCodePage
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

  it('derives Git Bash candidates from ProgramFiles instead of hardcoding C:', () => {
    // Non-Windows platforms resolve no Git Bash candidates.
    assert.deepStrictEqual(gitBashCandidates({}, 'linux'), []);

    // With no ProgramFiles env vars set, fall back to the C: defaults.
    assert.deepStrictEqual(gitBashCandidates({}, 'win32'), [
      path.join('C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      path.join('C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe')
    ]);

    // A non-C: system drive surfaces from the standard env vars, with C:
    // kept as a fallback. ProgramW6432 duplicating ProgramFiles is deduped.
    assert.deepStrictEqual(
      gitBashCandidates(
        {
          ProgramFiles: 'D:\\Program Files',
          'ProgramFiles(x86)': 'D:\\Program Files (x86)',
          ProgramW6432: 'D:\\Program Files'
        },
        'win32'
      ),
      [
        path.join('D:\\Program Files', 'Git', 'bin', 'bash.exe'),
        path.join('D:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
        path.join('C:\\Program Files', 'Git', 'bin', 'bash.exe'),
        path.join('C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe')
      ]
    );

    // On a normal 64-bit system the C: env vars coincide with the defaults,
    // so dedup keeps exactly two candidates.
    assert.deepStrictEqual(
      gitBashCandidates(
        {
          ProgramFiles: 'C:\\Program Files',
          'ProgramFiles(x86)': 'C:\\Program Files (x86)',
          ProgramW6432: 'C:\\Program Files'
        },
        'win32'
      ),
      [
        path.join('C:\\Program Files', 'Git', 'bin', 'bash.exe'),
        path.join('C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe')
      ]
    );
  });
});

describe('Windows bash candidate discovery', () => {
  it('lists every bash.exe on PATH, not just the first hit', () => {
    // which.sync() stops at the WSL shim; the Git Bash behind it must still be
    // found, otherwise --shell bash fails on a machine that has both.
    const env = { PATH: 'C:\\Windows\\System32;C:\\Program Files\\Git\\usr\\bin;D:\\tools' };
    const exists = candidate =>
      candidate === 'C:\\Windows\\System32\\bash.exe' ||
      candidate === 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';

    assert.deepStrictEqual(bashCandidatesFromPath(env, 'win32', exists), [
      'C:\\Windows\\System32\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
    ]);
  });

  it('unquotes PATH entries and dedupes case-insensitively', () => {
    const env = { PATH: '"C:\\Program Files\\Git\\bin";c:\\program files\\git\\BIN' };

    assert.deepStrictEqual(bashCandidatesFromPath(env, 'win32', () => true), [
      'C:\\Program Files\\Git\\bin\\bash.exe'
    ]);
  });

  it('reads the Path spelling and stays inert off Windows', () => {
    assert.deepStrictEqual(bashCandidatesFromPath({ Path: 'C:\\only' }, 'win32', () => true), [
      'C:\\only\\bash.exe'
    ]);
    assert.deepStrictEqual(bashCandidatesFromPath({}, 'win32', () => true), []);
    assert.deepStrictEqual(bashCandidatesFromPath({ PATH: 'C:\\x' }, 'darwin', () => true), []);
  });

  it('derives the Git root from a git.exe found on PATH', () => {
    // A normal Git for Windows install.
    assert.deepStrictEqual(gitRootBashCandidates('C:\\Program Files\\Git\\cmd\\git.exe', 'win32'), [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
    ]);
    // MSYS2-style tree, where the shell lives under mingw64.
    assert.deepStrictEqual(gitRootBashCandidates('D:\\Git\\mingw64\\bin\\git.exe', 'win32'), [
      'D:\\Git\\bin\\bash.exe',
      'D:\\Git\\usr\\bin\\bash.exe'
    ]);
    // MSYS2 itself: usr\bin\git.exe sits beside the shell.
    assert.deepStrictEqual(gitRootBashCandidates('C:\\msys64\\usr\\bin\\git.exe', 'win32'), [
      'C:\\msys64\\usr\\bin\\bash.exe',
      'C:\\msys64\\usr\\usr\\bin\\bash.exe'
    ]);
  });

  it('ignores unusable git paths and other platforms', () => {
    assert.deepStrictEqual(gitRootBashCandidates('/usr/bin/git', 'win32'), [
      '\\usr\\bin\\bash.exe',
      '\\usr\\usr\\bin\\bash.exe'
    ]);
    assert.deepStrictEqual(gitRootBashCandidates('C:\\Git\\cmd\\git.exe', 'linux'), []);
    assert.deepStrictEqual(gitRootBashCandidates(null, 'win32'), []);
    assert.deepStrictEqual(gitRootBashCandidates('', 'win32'), []);
  });
});

describe('WSL bash shim detection', () => {
  const windowsEnv = { SystemRoot: 'C:\\Windows' };

  it('rejects the System32 bash shim regardless of case or separators', () => {
    // Probing this binary boots the WSL VM (seconds, or the full probe
    // timeout), so it must be rejected by path instead of being spawned.
    assert.strictEqual(isWslBashShim('C:\\Windows\\System32\\bash.exe', windowsEnv, 'win32'), true);
    assert.strictEqual(isWslBashShim('c:\\WINDOWS\\system32\\bash.exe', windowsEnv, 'win32'), true);
    assert.strictEqual(isWslBashShim('C:/Windows/System32/bash.exe', windowsEnv, 'win32'), true);
  });

  it('derives System32 from windir when SystemRoot is unset', () => {
    assert.strictEqual(isWslBashShim('D:\\Win\\System32\\bash.exe', { windir: 'D:\\Win' }, 'win32'), true);
  });

  it('keeps a real Git Bash install', () => {
    assert.strictEqual(isWslBashShim('C:\\Program Files\\Git\\bin\\bash.exe', windowsEnv, 'win32'), false);
  });

  it('does not match a sibling directory that merely shares the prefix', () => {
    assert.strictEqual(isWslBashShim('C:\\Windows\\System32x\\bash.exe', windowsEnv, 'win32'), false);
  });

  it('ignores the check outside Windows and for unusable input', () => {
    assert.strictEqual(isWslBashShim('C:\\Windows\\System32\\bash.exe', windowsEnv, 'darwin'), false);
    assert.strictEqual(isWslBashShim('/bin/bash', {}, 'linux'), false);
    assert.strictEqual(isWslBashShim('', windowsEnv, 'win32'), false);
    assert.strictEqual(isWslBashShim(null, windowsEnv, 'win32'), false);
  });
});

describe('containsShellOperators', () => {
  it('detects bare shell operators', () => {
    for (const line of [
      'ls | wc -l',
      'a && b',
      'a || b',
      'echo hi > out.txt',
      'cat < in.txt',
      'a; b',
      'echo `date`',
      'echo $(date)',
      'ls |wc'
    ]) {
      assert.strictEqual(containsShellOperators(line), true, `expected ${JSON.stringify(line)} to be raw`);
    }
  });

  it('detects doubled operators even when tightly written', () => {
    assert.strictEqual(containsShellOperators('a&&b'), true);
    assert.strictEqual(containsShellOperators('echo hi>>log'), true);
  });

  it('ignores operators inside quotes', () => {
    assert.strictEqual(containsShellOperators('echo "a | b"'), false);
    assert.strictEqual(containsShellOperators("echo 'a | b'"), false);
    assert.strictEqual(containsShellOperators('git log --grep="a|b"'), false);
  });

  it('leaves arguments that merely contain an operator alone', () => {
    // A false positive here would silently change how a working command runs,
    // so these must stay on the quoted (default) path.
    assert.strictEqual(containsShellOperators('git log --grep=a|b'), false);
    assert.strictEqual(containsShellOperators('curl https://host/p?a=1&b=2'), false);
    assert.strictEqual(containsShellOperators('echo a;b'), false);
  });

  it('returns false for plain commands and unusable input', () => {
    assert.strictEqual(containsShellOperators('echo hi'), false);
    assert.strictEqual(containsShellOperators('ls -la'), false);
    assert.strictEqual(containsShellOperators(''), false);
    assert.strictEqual(containsShellOperators(null), false);
    assert.strictEqual(containsShellOperators(undefined), false);
  });
});

describe('OEM code page detection', () => {
  it('parses the OEMCP value out of reg.exe output', () => {
    // The value name and type are not localized, so this holds on any display
    // language. Real output has a header line and a blank line around it.
    const output = [
      '',
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage',
      '    OEMCP    REG_SZ    936',
      ''
    ].join('\r\n');

    assert.strictEqual(parseOemCodePage(output), 936);
    assert.strictEqual(parseOemCodePage('    OEMCP    REG_SZ    65001'), 65001);
  });

  it('returns null when OEMCP is absent or unusable', () => {
    // reg.exe writes an error to stderr and exits non-zero for a missing key,
    // so a non-matching body must not be mistaken for a code page.
    assert.strictEqual(parseOemCodePage('ERROR: The system was unable to find the specified registry key'), null);
    assert.strictEqual(parseOemCodePage('    OEMCP    REG_SZ    0'), null);
    assert.strictEqual(parseOemCodePage(''), null);
    assert.strictEqual(parseOemCodePage(null), null);
    assert.strictEqual(parseOemCodePage(undefined), null);
  });
});

describe('decodeCmdOutput fast path', () => {
  it('returns pure-ASCII buffers verbatim without a code page', () => {
    const fakeOutput = {
      _dto: { store: { stdout: [Buffer.from('M src/app.js\n')], stderr: [] } },
      stdout: 'lossy-utf8-fallback'
    };

    assert.strictEqual(decodeCmdOutput(fakeOutput, 'stdout', 936), 'M src/app.js\n');
  });

  it('joins multiple ASCII chunks in order', () => {
    const fakeOutput = {
      _dto: { store: { stdout: [Buffer.from('one\n'), Buffer.from('two\n')], stderr: [] } },
      stdout: ''
    };

    assert.strictEqual(decodeCmdOutput(fakeOutput, 'stdout', 936), 'one\ntwo\n');
  });

  it('still decodes non-ASCII buffers with the requested code page', () => {
    // Guards the fast path against swallowing the CJK regression: one byte
    // above 0x7f must fall back to code-page decoding.
    const gbkWithAscii = Buffer.concat([Buffer.from('C:'), Buffer.from([0xc7, 0xfd, 0xb6, 0xaf])]);
    const fakeOutput = { _dto: { store: { stdout: [gbkWithAscii], stderr: [] } }, stdout: '' };

    assert.strictEqual(decodeCmdOutput(fakeOutput, 'stdout', 936), 'C:驱动');
  });
});
