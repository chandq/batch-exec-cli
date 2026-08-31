import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { batchExecute } from '../src/index.js';
import { resolveShell } from '../src/shell.js';
import { safeRm } from './helpers.js';

describe('Windows shell integration', { skip: process.platform !== 'win32' }, () => {
  let tempDir;
  let scriptPath;
  let shellScriptPath;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-exec-windows-shell-'));
    scriptPath = path.join(tempDir, 'print-cwd.mjs');
    shellScriptPath = scriptPath.replace(/\\/g, '/');

    await Promise.all([
      fs.mkdir(path.join(tempDir, 'project1')),
      fs.mkdir(path.join(tempDir, 'project2')),
      fs.writeFile(scriptPath, 'console.log(process.cwd());\n')
    ]);
  });

  afterEach(async () => {
    await safeRm(tempDir);
  });

  it('executes in each subdirectory with every supported Windows shell', async () => {
    for (const shell of ['bash', 'cmd', 'powershell', 'pwsh', 'system']) {
      assert.doesNotThrow(() => resolveShell(shell), `Expected ${shell} to be available`);

      const results = await batchExecute(tempDir, 'node', [shellScriptPath], {
        shell,
        showProgress: false,
        parallel: false
      });

      assert.deepStrictEqual(results.map(result => result.success), [true, true]);
      results.forEach(result => {
        assert.strictEqual(path.basename(result.stdout.trim()), result.directory);
      });
    }
  });

  it('preserves failures and captured output for every supported Windows shell', async () => {
    const failScriptPath = path.join(tempDir, 'fail.mjs');
    await fs.writeFile(failScriptPath, "console.log('failure detail'); process.exit(7);\n");

    for (const shell of ['bash', 'cmd', 'powershell', 'pwsh', 'system']) {
      const results = await batchExecute(tempDir, 'node', [failScriptPath.replace(/\\/g, '/')], {
        shell,
        showProgress: false,
        parallel: false
      });

      results.forEach(result => {
        assert.strictEqual(result.success, false, `${shell} reported a failure as success`);
        assert.match(result.error, /exit code/i);
        assert.match(result.stdout, /failure detail/);
      });
    }
  });
});
