import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { $ } from 'zx';
import { safeRm } from './helpers.js';

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function toPosixPath(p) {
  return p.replace(/\\/g, '/');
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
    const cliPath = toPosixPath(path.join(process.cwd(), 'src/cli.js'));
    const result = await $`node ${cliPath} --help`;
    assert(result.stdout.includes('Usage:'));
    assert(result.stdout.includes('batch-exec'));
  });

  it('should execute command in subdirectories', async () => {
    const cliPath = toPosixPath(path.join(process.cwd(), 'src/cli.js'));
    const targetDir = toPosixPath(testProjectsDir);
    const result = await $`node ${cliPath} ${targetDir} echo test`;
    const output = stripAnsi(result.stdout);
    assert(output.includes('Execution Summary'));
    assert(output.includes('Total directories: 2'));
  });

  it('should respect .batchexecignore file', async () => {
    const cliPath = toPosixPath(path.join(process.cwd(), 'src/cli.js'));
    const targetDir = toPosixPath(testProjectsDir);
    const result = await $`node ${cliPath} ${targetDir} pwd`;
    const output = stripAnsi(result.stdout);
    assert(output.includes('Total directories: 2'));
    assert(!output.includes('node_modules'));
  });

  it('should work with custom ignore file using --skip', async () => {
    const cliPath = toPosixPath(path.join(process.cwd(), 'src/cli.js'));
    const customIgnore = toPosixPath(path.join(tempDir, 'custom-ignore'));
    await fs.writeFile(customIgnore, 'project1\nnode_modules');

    const targetDir = toPosixPath(testProjectsDir);
    const result = await $`node ${cliPath} --skip ${customIgnore} ${targetDir} pwd`;
    const output = stripAnsi(result.stdout);
    assert(output.includes('Total directories: 1'));
    assert(!output.includes('project1'));
  });

  it('should show verbose output with --verbose', async () => {
    const cliPath = toPosixPath(path.join(process.cwd(), 'src/cli.js'));
    const targetDir = toPosixPath(testProjectsDir);
    const result = await $`node ${cliPath} --verbose ${targetDir} echo hello`;
    assert(result.stdout.includes('Target directory:'));
    assert(result.stdout.includes('Command:'));
  });

  it('should fail with error message when missing arguments', async () => {
    const cliPath = toPosixPath(path.join(process.cwd(), 'src/cli.js'));
    await assert.rejects($`node ${cliPath}`, error => {
      assert(error.stderr.includes('Missing required arguments'));
      return true;
    });
  });
});
