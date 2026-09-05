import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { shouldSkipDirectory } from './ignoreParser.js';

export function isWslPath(targetDir) {
  if (typeof targetDir !== 'string') return false;
  const normalized = targetDir.replace(/\\/g, '/');
  return (
    normalized.startsWith('/mnt/') ||
    normalized.startsWith('//wsl$/') ||
    normalized.startsWith('//wsl.localhost/')
  );
}

/**
 * True for Windows UNC paths (\\server\share...). Used to refuse shells that
 * cannot run with a UNC working directory (e.g. cmd.exe).
 */
export function isUncWindowsPath(p) {
  if (typeof p !== 'string') return false;
  return /^\\\\[^\\]/.test(p);
}

/**
 * Turn a host-provided target into a path the Windows filesystem can read.
 * - \\wsl$\ and \\wsl.localhost\ UNC paths are already Windows-accessible and
 *   are passed through unchanged.
 * - POSIX-style absolute paths (e.g. /mnt/c/... or /home/user/...) are
 *   converted to a Windows path via `wsl.exe wslpath -w` so the host can
 *   enumerate them. Falls back to path.resolve when WSL is unavailable.
 * - Non-Windows platforms resolve normally (WSL mounts are native there).
 */
export function resolveAccessiblePath(targetDir) {
  if (process.platform !== 'win32') return path.resolve(targetDir);

  const normalized = targetDir.replace(/\\/g, '/');

  // UNC into a WSL distro is already Windows-accessible; no conversion needed.
  if (normalized.startsWith('//wsl$/') || normalized.startsWith('//wsl.localhost/')) {
    return path.resolve(targetDir);
  }

  // POSIX-style absolute path: convert via WSL so the host can read it.
  if (normalized.startsWith('/')) {
    try {
      const converted = execFileSync('wsl.exe', ['wslpath', '-w', normalized], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim();
      if (converted) return converted;
    } catch {
      // Fall through to plain resolve if WSL tooling is unavailable or hangs.
    }
  }

  return path.resolve(targetDir);
}

export async function listDirectSubdirectories(targetDir, skipPatterns = []) {
  const absoluteTargetDir = resolveAccessiblePath(targetDir);
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
