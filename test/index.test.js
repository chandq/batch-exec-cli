import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { batchExecute } from '../src/index.js';
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
});
