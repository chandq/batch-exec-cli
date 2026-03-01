import fs from 'fs/promises';
import path from 'path';

export async function parseIgnoreFile(ignoreFilePath) {
  if (!ignoreFilePath) {
    return [];
  }

  try {
    const content = await fs.readFile(ignoreFilePath, 'utf-8');
    const lines = content.split('\n');

    return lines
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export function shouldSkipDirectory(dirName, skipPatterns) {
  if (!skipPatterns || skipPatterns.length === 0) {
    return false;
  }

  return skipPatterns.some(pattern => {
    if (pattern === dirName) {
      return true;
    }

    if (pattern.endsWith('/')) {
      const patternWithoutSlash = pattern.slice(0, -1);
      if (patternWithoutSlash === dirName) {
        return true;
      }
    }

    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(dirName);
    }

    return false;
  });
}
