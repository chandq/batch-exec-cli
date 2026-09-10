import fs from 'fs/promises';
import path from 'path';

export async function parseIgnoreFile(ignoreFilePath) {
  if (!ignoreFilePath) {
    return [];
  }

  try {
    const content = await fs.readFile(ignoreFilePath, 'utf-8');
    const lines = content.split(/\r?\n/);

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

// Compiled wildcard patterns, keyed by the original ignore-file pattern. Every
// directory is tested against every pattern, so recompiling the same RegExp in
// the loop cost work proportional to directories x patterns. Compilation errors
// are deliberately not cached: an invalid pattern keeps throwing, as before.
const wildcardRegexCache = new Map();

function wildcardRegex(pattern) {
  if (!wildcardRegexCache.has(pattern)) {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    wildcardRegexCache.set(pattern, new RegExp(`^${regexPattern}$`));
  }
  return wildcardRegexCache.get(pattern);
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
      return wildcardRegex(pattern).test(dirName);
    }

    return false;
  });
}
