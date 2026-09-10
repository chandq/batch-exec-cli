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

/**
 * Split stdout into trimmed, non-empty lines. `wc -l` right-aligns its count to
 * a column (8 wide on BSD/macOS, narrower on GNU), so whole-string trim() would
 * only strip the padding of the first line.
 */
function outputLines(stdout) {
  return stripAnsi(stdout)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function toPosixPath(p) {
  return p.replace(/\\/g, '/');
}

// True when a real, usable bash can be resolved (Git Bash on Windows, bash  on
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

/**
 * Like runCli, but resolves with the exit code instead of rejecting, so tests
 * can assert the CLI's own exit status.
 */
function runCliWithCode(...args) {
  const cliPath = path.join(process.cwd(), 'src', 'cli.js');
  return new Promise(resolve => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ stdout, stderr, code: error ? (error.code ?? 1) : 0 });
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
    assert(result.stdout.includes('--match'));
    assert(result.stdout.includes('--dir'));
    assert(result.stdout.includes('--version'));
  });

  it('should print the version with --version', async () => {
    const result = await runCli('--version');
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  it('should run once in a single directory with --dir', async () => {
    const projectDir = toPosixPath(path.join(testProjectsDir, 'project1'));
    const result = await runCli('--dir', projectDir, 'echo', 'single-ok');
    const output = stripAnsi(result.stdout);

    assert(output.includes('single-ok'));
    assert(/Total directories:\s+1/.test(output));
    assert(!output.includes('project2'));
  });

  it('should filter subdirectories with --match regex', async () => {
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--no-progress', '--no-parallel', '--match', '^project', targetDir, 'echo', 'm');
    const output = stripAnsi(result.stdout);

    assert(/Total directories:\s+2/.test(output));
    assert(output.includes('=== project1 ==='));
    assert(output.includes('=== project2 ==='));
    assert(!output.includes('node_modules'));
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
    // Captures the code instead of rejecting: failing directories now make the
    // CLI exit 1, which is asserted in the quiet-mode suite.
    const result = await runCliWithCode(
      '--shell', 'bash', '--no-progress', targetDir, 'node', toPosixPath(failScript)
    );
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

  it('should document the new flags in --help', async () => {
    const result = await runCli('--help');
    assert(result.stdout.includes('--raw'));
    assert(result.stdout.includes('--no-raw'));
    assert(result.stdout.includes('--concurrency'));
    assert(result.stdout.includes('--quiet'));
  });

  it('should accept --concurrency and still run every directory', async () => {
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--no-progress', '--concurrency', '2', targetDir, 'echo', 'c');
    const output = stripAnsi(result.stdout);

    assert(/Total directories:\s+2/.test(output));
    assert(output.includes('=== project1 ==='));
    assert(output.includes('=== project2 ==='));
  });

  it('should reject a non-numeric --concurrency', async () => {
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCliWithCode('--concurrency', 'abc', targetDir, 'echo', 'x');

    assert.strictEqual(result.code, 1);
    assert(result.stderr.includes('--concurrency must be a non-negative integer'));
  });
});

describe('CLI quiet mode and exit codes', () => {
  let tempDir;
  let testProjectsDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-exec-cli-quiet-'));
    testProjectsDir = path.join(tempDir, 'test-projects');

    await fs.mkdir(testProjectsDir);
    await fs.mkdir(path.join(testProjectsDir, 'project1'));
  });

  afterEach(async () => {
    await safeRm(tempDir);
  });

  it('should print only command output in --quiet mode', async () => {
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--quiet', targetDir, 'echo', 'payload');
    const output = stripAnsi(result.stdout);

    assert(output.includes('payload'));
    assert(!output.includes('==='), 'no per-directory header expected');
    assert(!output.includes('Execution Summary'), 'no summary expected');
    assert(!output.includes('Total directories'));
  });

  it('should not pollute stdout with a summary in --quiet --dir mode', async () => {
    const targetDir = toPosixPath(path.join(testProjectsDir, 'project1'));
    const result = await runCli('--quiet', '--dir', targetDir, 'echo', 'line');

    // Exactly the command's own output - this is what makes `| wc -l` agree
    // with running the command directly.
    assert.strictEqual(stripAnsi(result.stdout), 'line\n');
    assert.strictEqual(stripAnsi(result.stderr), '');
  });

  it('should exit 0 when every command succeeds', async () => {
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCliWithCode('--no-progress', targetDir, 'echo', 'ok');

    assert.strictEqual(result.code, 0);
  });

  it('should exit 1 and report the directory on stderr when a command fails', async () => {
    const failScript = path.join(tempDir, 'fail.mjs');
    await fs.writeFile(failScript, "console.log('detail'); process.exit(3);\n");

    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCliWithCode('--quiet', targetDir, 'node', toPosixPath(failScript));

    assert.strictEqual(result.code, 1);
    assert(stripAnsi(result.stderr).includes('project1'), 'failure names the directory');
    // The command's own stdout is still data, so it stays on stdout.
    assert(stripAnsi(result.stdout).includes('detail'));
  });

  it('should exit 1 in --dir mode when the command fails', async () => {
    const failScript = path.join(tempDir, 'fail-dir.mjs');
    await fs.writeFile(failScript, 'process.exit(4);\n');

    const targetDir = toPosixPath(path.join(testProjectsDir, 'project1'));
    const result = await runCliWithCode('--quiet', '--dir', targetDir, 'node', toPosixPath(failScript));

    assert.strictEqual(result.code, 1);
  });
});

describe('CLI raw mode', () => {
  let tempDir;
  let testProjectsDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-exec-cli-raw-'));
    testProjectsDir = path.join(tempDir, 'test-projects');

    await fs.mkdir(testProjectsDir);
    await fs.mkdir(path.join(testProjectsDir, 'project1'));
    await fs.mkdir(path.join(testProjectsDir, 'project2'));
  });

  afterEach(async () => {
    await safeRm(tempDir);
  });

  it('should run a pipeline inside each directory when operators are detected', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli(
      '--shell', 'bash', '--quiet', '--no-parallel',
      targetDir, 'echo', 'hi', '|', 'wc', '-l'
    );

    // One `1` per directory: the pipe ran inside each one.
    assert.deepStrictEqual(outputLines(result.stdout), ['1', '1']);
  });

  it('should keep operators literal with --no-raw', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli(
      '--shell', 'bash', '--quiet', '--no-parallel', '--no-raw',
      targetDir, 'echo', 'hi', '|', 'wc', '-l'
    );

    assert.deepStrictEqual(outputLines(result.stdout), ['hi | wc -l', 'hi | wc -l']);
  });

  it('should force raw mode with --raw even without operators', async t => {
    if (!bashAvailable()) return t.skip('bash is not installed or not on PATH');
    const targetDir = toPosixPath(testProjectsDir);
    const result = await runCli('--shell', 'bash', '--quiet', '--no-parallel', '--raw', targetDir, 'echo', 'plain');

    assert.deepStrictEqual(outputLines(result.stdout), ['plain', 'plain']);
  });
});
