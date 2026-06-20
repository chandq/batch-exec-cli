import fs from 'fs/promises';

const isWindows = process.platform === 'win32';

/**
 * Remove a directory with retry logic for Windows EBUSY errors.
 * On Windows, shell processes spawned by zx may still hold directory
 * handles when afterEach runs, causing EBUSY errors.
 */
export async function safeRm(dirPath, options = { recursive: true, force: true }) {
  const maxRetries = isWindows ? 5 : 1;
  const retryDelay = isWindows ? 200 : 0;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await fs.rm(dirPath, options);
      return;
    } catch (error) {
      if (error.code === 'EBUSY' && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * (i + 1)));
        continue;
      }
      throw error;
    }
  }
}
