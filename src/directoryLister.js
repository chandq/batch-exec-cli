import fs from 'fs/promises';
import path from 'path';
import { shouldSkipDirectory } from './ignoreParser.js';

export async function listDirectSubdirectories(targetDir, skipPatterns = []) {
  const absoluteTargetDir = path.resolve(targetDir);

  try {
    const entries = await fs.readdir(absoluteTargetDir, { withFileTypes: true });

    const subdirs = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name, skipPatterns)) {
          subdirs.push(entry.name);
        }
      }
    }

    return subdirs.sort();
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Directory not found: ${absoluteTargetDir}`);
    }
    if (error.code === 'ENOTDIR') {
      throw new Error(`Not a directory: ${absoluteTargetDir}`);
    }
    throw error;
  }
}
