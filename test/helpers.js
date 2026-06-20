import fs from 'fs/promises';
import { execSync } from 'child_process';

const isWindows = process.platform === 'win32';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Remove a directory with retry logic for Windows EBUSY errors.
 * On Windows, shell processes spawned by zx may still hold directory
 * handles when afterEach runs, causing EBUSY errors.
 */
export async function safeRm(dirPath, options = { recursive: true, force: true }) {
  if (!isWindows) {
    return fs.rm(dirPath, options);
  }

  // Windows: zx spawns shell processes that may hold directory handles.
  // Wait briefly for shell processes to exit, then retry on lock errors.
  await sleep(300);

  const maxRetries = 10;
  const retryCodes = ['EBUSY', 'EPERM', 'ENOTEMPTY'];

  for (let i = 0; i < maxRetries; i++) {
    try {
      await fs.rm(dirPath, options);
      return;
    } catch (error) {
      if (retryCodes.includes(error.code) && i < maxRetries - 1) {
        await sleep(500 * (i + 1));
        continue;
      }
      // Last resort: use system command to force delete
      try {
        execSync(`rd /s /q "${dirPath}"`, { stdio: 'ignore' });
      } catch {
        throw error;
      }
      return;
    }
  }
}
