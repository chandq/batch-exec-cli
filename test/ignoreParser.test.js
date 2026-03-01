import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { parseIgnoreFile, shouldSkipDirectory } from '../src/ignoreParser.js';

describe('ignoreParser', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-exec-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('parseIgnoreFile', () => {
    it('should parse ignore file correctly', async () => {
      const ignoreFilePath = path.join(tempDir, '.testignore');
      await fs.writeFile(ignoreFilePath, `
# This is a comment
node_modules
dist/
*.tmp
test-*

# Another comment
build
      `.trim());

      const patterns = await parseIgnoreFile(ignoreFilePath);
      assert.deepStrictEqual(patterns, [
        'node_modules',
        'dist/',
        '*.tmp',
        'test-*',
        'build'
      ]);
    });

    it('should return empty array for non-existent file', async () => {
      const patterns = await parseIgnoreFile(path.join(tempDir, 'non-existent'));
      assert.deepStrictEqual(patterns, []);
    });

    it('should return empty array for null or undefined', async () => {
      const patterns1 = await parseIgnoreFile(null);
      const patterns2 = await parseIgnoreFile(undefined);
      assert.deepStrictEqual(patterns1, []);
      assert.deepStrictEqual(patterns2, []);
    });
  });

  describe('shouldSkipDirectory', () => {
    it('should return false when no patterns provided', () => {
      assert.strictEqual(shouldSkipDirectory('dir1', []), false);
      assert.strictEqual(shouldSkipDirectory('dir1', null), false);
      assert.strictEqual(shouldSkipDirectory('dir1', undefined), false);
    });

    it('should match exact directory names', () => {
      assert.strictEqual(shouldSkipDirectory('node_modules', ['node_modules']), true);
      assert.strictEqual(shouldSkipDirectory('dist', ['node_modules']), false);
    });

    it('should match directory names with trailing slash', () => {
      assert.strictEqual(shouldSkipDirectory('dist', ['dist/']), true);
      assert.strictEqual(shouldSkipDirectory('node_modules', ['dist/']), false);
    });

    it('should match wildcard patterns', () => {
      assert.strictEqual(shouldSkipDirectory('test-123', ['test-*']), true);
      assert.strictEqual(shouldSkipDirectory('test-abc', ['test-*']), true);
      assert.strictEqual(shouldSkipDirectory('other', ['test-*']), false);
    });

    it('should match extension wildcards', () => {
      assert.strictEqual(shouldSkipDirectory('file.tmp', ['*.tmp']), true);
      assert.strictEqual(shouldSkipDirectory('test.tmp', ['*.tmp']), true);
      assert.strictEqual(shouldSkipDirectory('test.txt', ['*.tmp']), false);
    });

    it('should match any of the patterns', () => {
      const patterns = ['node_modules', 'dist/', '*.tmp'];
      assert.strictEqual(shouldSkipDirectory('node_modules', patterns), true);
      assert.strictEqual(shouldSkipDirectory('dist', patterns), true);
      assert.strictEqual(shouldSkipDirectory('test.tmp', patterns), true);
      assert.strictEqual(shouldSkipDirectory('src', patterns), false);
    });
  });
});
