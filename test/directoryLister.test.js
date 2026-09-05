import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  listDirectSubdirectories,
  isWslPath,
  isUncWindowsPath,
  resolveAccessiblePath
} from '../src/directoryLister.js';
import { safeRm } from './helpers.js';

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
    await safeRm(tempDir);
  });

  describe('WSL path handling', () => {
    it('detects WSL-style paths', () => {
      assert.strictEqual(isWslPath('/mnt/c/projects'), true);
      assert.strictEqual(isWslPath('\\\\wsl$\\Ubuntu\\home\\user'), true);
      assert.strictEqual(isWslPath('\\\\wsl.localhost\\Ubuntu\\home\\user'), true);
      assert.strictEqual(isWslPath('C:\\projects'), false);
      assert.strictEqual(isWslPath('./relative'), false);
      assert.strictEqual(isWslPath(null), false);
    });

    it('detects UNC paths used for the cmd guard', () => {
      assert.strictEqual(isUncWindowsPath('\\\\wsl.localhost\\Ubuntu\\home\\user'), true);
      assert.strictEqual(isUncWindowsPath('\\\\wsl$\\Ubuntu\\home'), true);
      assert.strictEqual(isUncWindowsPath('\\\\server\\share\\dir'), true);
      assert.strictEqual(isUncWindowsPath('C:\\projects'), false);
      assert.strictEqual(isUncWindowsPath('/mnt/c/projects'), false);
      assert.strictEqual(isUncWindowsPath('./relative'), false);
      assert.strictEqual(isUncWindowsPath(null), false);
      assert.strictEqual(isUncWindowsPath(''), false);
    });

    it('passes WSL UNC paths through without requiring WSL tooling', () => {
      if (process.platform !== 'win32') return;
      const resolved = resolveAccessiblePath('\\\\wsl$\\Ubuntu\\home\\user\\project');
      assert.strictEqual(resolved, '\\\\wsl$\\Ubuntu\\home\\user\\project');
    });

    it('falls back to plain resolve for POSIX paths when WSL is unavailable', () => {
      const resolved = resolveAccessiblePath('/mnt/c/projects');
      assert.strictEqual(typeof resolved, 'string');
      assert(resolved.length > 0);
    });
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
