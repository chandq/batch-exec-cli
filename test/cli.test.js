import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'node:child_process';
import { resolveShell } from '../src/shell.js';
import { safeRm } from './helpers.js';

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function toPosixPath(p) {
  return p.replace(/\\/g, '/');
}

// True when a real, usable bash can be resolved (Git Bash on Windows, bash on
// Unix). CLI tests that run inner commands with --shell bash need it.
function bashAvailable() {
  try {
    resolveShell('bash');
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the CLI directly with node (no shell) so these tests are independent of
 * whichever bash/pwsh is first on PATH (e.g. the Windows WSL bash shim).
 */
function runCli(...args) {
  const cliPath = path.join(process.cwd(), 'src', 'cli.js');
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
  });
}

describe('CLI Integration', () => {
  let tempDir;
  let testProjectsDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-exec-cli-test-'));
    testProjectsDir = path.join(tempDir, 'test-projects');

    await fs.mkdir(testProjectsDir);
    await fs.mkdir(path.join(testProjectsDir, 'project1'));
    await fs.mkdir(path.join(testProjectsDir, 'project2'));
    await fs.mkdir(path.join(testProjectsDir, 'node_modules'));

    await fs.writeFile(path.join(tempDir, '.batchexecignore'), 'node_modules');
  });

  afterEach(async () => {
    await safeRm(tempDir);
  });

  it('should show help message with --help', async () => {
    const result = await runCli('--help');
    assert(result.stdout.includes('Usage:'));
    assert(result.stdout.includes('batch-exec'));
    assert(result.stdout.includes('--shell'));
  });

  it('should execute command in subdirectories', async () => {
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli(targetDir, 'echo', 'test');
    const output = stripAnsi(result.stdout);
    assert(output.includes('Execution Summary'));
    assert(output.includes('Total directories: 2'));
  });

  it('should print successful command stdout in normal mode', async () => {
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--no-progress', '--no-parallel', targetDir, 'echo', 'visible-output');
    const output = stripAnsi(result.stdout);

    assert(output.includes('visible-output'));
    assert(output.includes('=== project1 ==='));
    assert(output.includes('=== project2 ==='));
  });

  it('should respect .batchexecignore file', async () => {
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli(targetDir, 'pwd');
    const output = stripAnsi(result.stdout);
    assert(output.includes('Total directories: 2'));
    assert(!output.includes('node_modules'));
  });

  it('should work with custom ignore file using --skip', async () => {
    const customIgnore = toPosixPath(path.join(tempDir, 'custom-ignore'));
    await fs.writeFile(customIgnore, 'project1\nnode_modules');

    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--skip', customIgnore, targetDir, 'pwd');
    const output = stripAnsi(result.stdout);
    assert(output.includes('Total directories: 1'));
    assert(!output.includes('project1'));
  });

  it('should show verbose output with --verbose', async () => {
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--verbose', targetDir, 'echo', 'hello');
    assert(result.stdout.includes('Target directory:'));
    assert(result.stdout.includes('Command:'));
  });

  it('should execute with --shell bash and show the selected shell', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--shell', 'bash', '--verbose', '--no-progress', targetDir, 'printf', '%s', 'shell');

    assert(result.stdout.includes('Shell:'));
    assert(result.stdout.includes('bash'));
  });

  it('should print stdout in normal mode when --shell bash is selected', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--shell', 'bash', '--no-progress', '--no-parallel', targetDir, 'echo', 'shell-output');
    const output = stripAnsi(result.stdout);

    assert(output.includes('shell-output'));
    assert(output.includes('=== project1 ==='));
    assert(output.includes('=== project2 ==='));
  });

  it('should preserve command flags after the target directory', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--shell', 'bash', '--no-progress', '--no-parallel', targetDir, 'echo', '-g');
    const output = stripAnsi(result.stdout);

    assert(output.includes('-g'));
  });

  it('should show captured stdout when a bash command fails', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');
    const failScript = path.join(tempDir, 'fail-command.mjs');
    await fs.writeFile(failScript, "console.log('stdout failure detail'); process.exit(3);\n");

    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--shell', 'bash', '--no-progress', targetDir, 'node', toPosixPath(failScript));
    const output = stripAnsi(result.stdout);

    assert(output.includes('Failed directories:'));
    assert(output.includes('stdout failure detail'));
  });

  it('should fail with error message when missing arguments', async () => {
    await assert.rejects(runCli(), error => {
      assert(error.stderr.includes('Missing required arguments'));
      return true;
    });
  });
});
