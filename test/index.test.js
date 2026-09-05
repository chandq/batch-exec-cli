import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { batchExecute, runInDirectory } from '../src/index.js';
import { safeRm } from './helpers.js';

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
