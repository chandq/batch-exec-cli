import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { $ } from 'zx';

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
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should show help message with --help', async () => {
    const result = await $`node ${path.join(process.cwd(), 'src/cli.js')} --help`;
    assert(result.stdout.includes('Usage:'));
    assert(result.stdout.includes('batch-exec'));
  });

  it('should execute command in subdirectories', async () => {
    const result = await $`node ${path.join(process.cwd(), 'src/cli.js')} ${testProjectsDir} echo test`;
    assert(result.stdout.includes('Summary:'));
    assert(result.stdout.includes('Total directories: 2'));
  });

  it('should respect .batchexecignore file', async () => {
    const result = await $`node ${path.join(process.cwd(), 'src/cli.js')} ${testProjectsDir} pwd`;
    assert(result.stdout.includes('Total directories: 2'));
    assert(!result.stdout.includes('node_modules'));
  });

  it('should work with custom ignore file using --skip', async () => {
    const customIgnore = path.join(tempDir, 'custom-ignore');
    await fs.writeFile(customIgnore, 'project1\nnode_modules');

    const result = await $`node ${path.join(
      process.cwd(),
      'src/cli.js'
    )} --skip ${customIgnore} ${testProjectsDir} pwd`;
    assert(result.stdout.includes('Total directories: 1'));
    assert(!result.stdout.includes('project1'));
  });

  it('should show verbose output with --verbose', async () => {
    const result = await $`node ${path.join(process.cwd(), 'src/cli.js')} --verbose ${testProjectsDir} echo hello`;
    assert(result.stdout.includes('Target directory:'));
    assert(result.stdout.includes('Command:'));
  });

  it('should fail with error message when missing arguments', async () => {
    await assert.rejects($`node ${path.join(process.cwd(), 'src/cli.js')}`, error => {
      assert(error.stderr.includes('Missing required arguments'));
      return true;
    });
  });
});
