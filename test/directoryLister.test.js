import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { listDirectSubdirectories } from '../src/directoryLister.js';

describe('directoryLister', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-exec-test-'));
    
    await fs.mkdir(path.join(tempDir, 'dir1'));
    await fs.mkdir(path.join(tempDir, 'dir2'));
    await fs.mkdir(path.join(tempDir, 'node_modules'));
    await fs.mkdir(path.join(tempDir, '.git'));
    
    await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content');
    await fs.writeFile(path.join(tempDir, 'file2.js'), 'content');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('listDirectSubdirectories', () => {
    it('should list only direct subdirectories', async () => {
      const subdirs = await listDirectSubdirectories(tempDir);
      assert.deepStrictEqual(subdirs.sort(), ['.git', 'dir1', 'dir2', 'node_modules'].sort());
    });

    it('should skip directories matching patterns', async () => {
      const subdirs = await listDirectSubdirectories(tempDir, ['node_modules', '.git']);
      assert.deepStrictEqual(subdirs, ['dir1', 'dir2']);
    });

    it('should skip directories with wildcard patterns', async () => {
      const subdirs = await listDirectSubdirectories(tempDir, ['dir*']);
      assert.deepStrictEqual(subdirs.sort(), ['.git', 'node_modules'].sort());
    });

    it('should return sorted directory names', async () => {
      const subdirs = await listDirectSubdirectories(tempDir);
      assert.deepStrictEqual(subdirs, subdirs.slice().sort());
    });

    it('should throw error for non-existent directory', async () => {
      await assert.rejects(
        listDirectSubdirectories(path.join(tempDir, 'non-existent')),
        { message: /Directory not found/ }
      );
    });

    it('should throw error for file path', async () => {
      await assert.rejects(
        listDirectSubdirectories(path.join(tempDir, 'file1.txt')),
        { message: /Not a directory/ }
      );
    });

    it('should work with relative paths', async () => {
      const relativePath = path.relative(process.cwd(), tempDir);
      const subdirs = await listDirectSubdirectories(relativePath);
      assert.deepStrictEqual(subdirs.sort(), ['.git', 'dir1', 'dir2', 'node_modules'].sort());
    });
  });
});
