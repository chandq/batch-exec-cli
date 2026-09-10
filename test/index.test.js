import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { batchExecute, runInDirectory } from '../src/index.js';
import { resolveShell } from '../src/shell.js';
import { safeRm } from './helpers.js';

// True when a real, usable bash can be resolved (Git Bash on Windows, bash on
// Unix). Pipe tests need a POSIX shell to interpret the operators.
function bashAvailable() {
  try {
    resolveShell('bash');
    return true;
  } catch {
    return false;
  }
}

describe('batchExecute', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-exec-test-'));

    await fs.mkdir(path.join(tempDir, 'dir1'));
    await fs.mkdir(path.join(tempDir, 'dir2'));
    await fs.mkdir(path.join(tempDir, 'skip-me'));
  });

  afterEach(async () => {
    await safeRm(tempDir);
  });

  it('should execute command in all subdirectories', async () => {
    const results = await batchExecute(tempDir, 'pwd', []);

    assert.strictEqual(results.length, 3);

    results.forEach(result => {
      assert.strictEqual(result.success, true);
    });
  });

  it('should skip specified directories', async () => {
    const results = await batchExecute(tempDir, 'pwd', [], {
      skipPaths: ['skip-me']
    });

    assert.strictEqual(results.length, 2);

    const dirs = results.map(r => r.directory);
    assert.deepStrictEqual(dirs.sort(), ['dir1', 'dir2'].sort());
  });

  it('should only run in directories matching matchPatterns', async () => {
    await fs.mkdir(path.join(tempDir, 'svc-alpha'));
    await fs.mkdir(path.join(tempDir, 'svc-beta'));
    await fs.mkdir(path.join(tempDir, 'lib-core'));

    const results = await batchExecute(tempDir, 'echo', ['hi'], {
      matchPatterns: ['^svc-'],
      showProgress: false,
      parallel: false
    });

    assert.deepStrictEqual(
      results.map(r => r.directory),
      ['svc-alpha', 'svc-beta']
    );
  });

  it('should intersect matchPatterns with skipPaths', async () => {
    await fs.mkdir(path.join(tempDir, 'svc-alpha'));
    await fs.mkdir(path.join(tempDir, 'svc-beta'));

    const results = await batchExecute(tempDir, 'echo', ['hi'], {
      matchPatterns: ['^svc-'],
      skipPaths: ['svc-alpha'],
      showProgress: false,
      parallel: false
    });

    assert.deepStrictEqual(
      results.map(r => r.directory),
      ['svc-beta']
    );
  });

  it('should reject an invalid match regex before executing', async () => {
    await assert.rejects(
      batchExecute(tempDir, 'echo', ['hi'], { matchPatterns: ['['], showProgress: false }),
      /Invalid --match pattern/
    );
  });

  it('should capture command output', async () => {
    const results = await batchExecute(tempDir, 'echo', ['hello']);

    results.forEach(result => {
      assert.strictEqual(result.success, true);
      assert(result.stdout.includes('hello'));
    });
  });

  it('should handle command failures gracefully', async () => {
    const results = await batchExecute(tempDir, 'this-command-does-not-exist', []);

    results.forEach(result => {
      assert.strictEqual(result.success, false);
      assert(result.error);
    });
  });

  it('should work with multiple arguments', async () => {
    const results = await batchExecute(tempDir, 'echo', ['hello', 'world']);

    results.forEach(result => {
      assert.strictEqual(result.success, true);
      assert(result.stdout.includes('hello world'));
    });
  });

  it('should execute with an explicitly selected shell', async () => {
    const results = await batchExecute(tempDir, 'printf', ['%s', 'shell works'], {
      shell: 'bash',
      showProgress: false,
      parallel: false
    });

    results.forEach(result => {
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.stdout, 'shell works');
    });
  });

  it('should preserve each subdirectory as cwd when a shell is selected', async () => {
    const results = await batchExecute(tempDir, 'pwd', [], {
      shell: 'bash',
      showProgress: false,
      parallel: false
    });

    results.forEach(result => {
      assert.strictEqual(result.success, true);
      assert.strictEqual(path.basename(result.stdout.trim()), result.directory);
    });
  });

  it('should reject an unavailable shell before listing or executing directories', async () => {
    await assert.rejects(
      batchExecute(path.join(tempDir, 'does-not-matter'), 'echo', ['ignored'], {
        shell: 'batch-exec-shell-does-not-exist',
        showProgress: false
      }),
      { message: /Shell not found/ }
    );
  });

  it('should refuse cmd.exe with a UNC target instead of silently running in C:\\Windows', async () => {
    if (process.platform !== 'win32') return;
    await assert.rejects(
      batchExecute('\\\\wsl.localhost\\Ubuntu\\home\\user', 'echo', ['hi'], {
        shell: 'cmd',
        showProgress: false
      }),
      /CMD\.EXE cannot use a UNC path/i
    );
  });

  it('should let non-cmd shells reach directory resolution for a UNC target', async () => {
    if (process.platform !== 'win32') return;
    // PowerShell supports UNC working directories, so the cmd guard must not
    // trigger; the (missing) UNC path then fails during directory resolution.
    // The exact error depends on the host: ENOENT/"Directory not found" when a
    // WSL distro is present, ECONNRESET on a runner without WSL. Only assert
    // that it is NOT the cmd/UNC guard message.
    await assert.rejects(
      batchExecute('\\wsl.localhost\\Ubuntu\\definitely-missing', 'echo', ['hi'], {
        shell: 'powershell',
        showProgress: false
      }),
      error => {
        assert.ok(
          !/CMD\.EXE cannot use a UNC path/i.test(error.message),
          `should pass the cmd guard, got: ${error.message}`
        );
        return true;
      }
    );
  });
});

describe('runInDirectory', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-exec-run-'));
    await fs.mkdir(path.join(tempDir, 'dir1'));
  });

  afterEach(async () => {
    await safeRm(tempDir);
  });

  it('should run the command exactly once in the given directory', async () => {
    const target = path.join(tempDir, 'dir1');
    const result = await runInDirectory(target, 'pwd', [], { showProgress: false });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.directory, target);
    assert.strictEqual(path.basename(result.stdout.trim()), 'dir1');
  });

  it('should report a missing directory clearly', async () => {
    await assert.rejects(
      runInDirectory(path.join(tempDir, 'does-not-exist'), 'echo', ['x'], { showProgress: false }),
      /Directory not found/
    );
  });
});

describe('concurrency ordering', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-exec-conc-'));
    // Names sort already; the pool must return them in this order even though
    // completion order varies.
    for (const name of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) {
      await fs.mkdir(path.join(tempDir, name));
    }
  });

  afterEach(async () => {
    await safeRm(tempDir);
  });

  for (const concurrency of [1, 2, 3, 0, 100]) {
    it(`should keep directory order with concurrency ${concurrency}`, async () => {
      const results = await batchExecute(tempDir, 'pwd', [], {
        showProgress: false,
        concurrency
      });

      assert.deepStrictEqual(
        results.map(r => r.directory),
        ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']
      );
      results.forEach(result => assert.strictEqual(result.success, true));
    });
  }
});

describe('raw mode', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-exec-raw-'));
    await fs.mkdir(path.join(tempDir, 'dir1'));
    await fs.mkdir(path.join(tempDir, 'dir2'));
  });

  afterEach(async () => {
    await safeRm(tempDir);
  });

  it('should pass shell operators through to the shell when raw is set', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');

    const results = await batchExecute(tempDir, 'echo', ['hi', '|', 'wc', '-l'], {
      shell: 'bash',
      raw: true,
      showProgress: false,
      parallel: false
    });

    results.forEach(result => {
      assert.strictEqual(result.success, true);
      // `echo hi | wc -l` prints exactly one line, so the pipeline really ran.
      assert.strictEqual(result.stdout.trim(), '1');
    });
  });

  it('should keep operators literal when raw is not set', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');

    const results = await batchExecute(tempDir, 'echo', ['hi', '|', 'wc', '-l'], {
      shell: 'bash',
      showProgress: false,
      parallel: false
    });

    results.forEach(result => {
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.stdout.trim(), 'hi | wc -l');
    });
  });

  it('should run a pipeline in a single directory with --dir-style invocation', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');

    const target = path.join(tempDir, 'dir1');
    await fs.writeFile(path.join(target, 'a.txt'), '');
    await fs.writeFile(path.join(target, 'b.txt'), '');

    const result = await runInDirectory(target, 'ls', ['|', 'wc', '-l'], {
      shell: 'bash',
      raw: true
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.stdout.trim(), '2');
  });

  it('should preserve argument boundaries that contain spaces when quoting normally', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');

    const results = await runInDirectory(tempDir, 'printf', ['%s', 'a b'], { shell: 'bash' });

    assert.strictEqual(results.stdout, 'a b');
  });
});
