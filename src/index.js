import path from 'path';
import { stat as fsStat } from 'node:fs/promises';
import { $, within, cd } from 'zx';
import { parseIgnoreFile } from './ignoreParser.js';
import { listDirectSubdirectories, resolveAccessiblePath, isUncWindowsPath } from './directoryLister.js';
import { resolveShell, resolveDefaultConfig, normalizeCommandOutput, decodeCmdOutput } from './shell.js';
import { cyan, red, ProgressBar, clearLine } from './utils/colors.js';

export { parseIgnoreFile };
export { listDirectSubdirectories };

function resolveShellConfig(shellOption) {
  // On Windows the zx default (bash from PATH) may resolve to the broken WSL
  // bash shim, so an explicit default is resolved here when no shell is given.
  return shellOption == null || shellOption === '' ? resolveDefaultConfig() : resolveShell(shellOption);
}

/**
 * cmd.exe refuses UNC paths (e.g. \\wsl.localhost\..., \\server\share) as the
 * working directory and silently falls back to C:\Windows. Fail fast instead
 * of running the command against the wrong directory.
 */
function assertCmdSupportsTarget(shellConfig, absoluteTargetDir) {
  if (process.platform === 'win32' && shellConfig?.syntax === 'cmd' && isUncWindowsPath(absoluteTargetDir)) {
    throw new Error(
      `CMD.EXE cannot use a UNC path (${absoluteTargetDir}) as the working directory and would silently ` +
        'run in C:\\Windows. Use --shell system/powershell/pwsh (PowerShell supports UNC working ' +
        'directories), or run this CLI inside WSL for WSL-native paths.'
    );
  }
}

/**
 * Compile positive include (--match) regex patterns. Throws a clear error on
 * an invalid pattern so typos fail before any directory work happens.
 */
function compileMatchPatterns(patterns) {
  if (!patterns || patterns.length === 0) return [];
  return patterns.map(pattern => {
    try {
      return new RegExp(pattern);
    } catch (error) {
      throw new Error(`Invalid --match pattern ${JSON.stringify(pattern)}: ${error.message}`);
    }
  });
}

function captureOutput(output, shellConfig, stream) {
  if (shellConfig?.syntax === 'cmd') {
    return normalizeCommandOutput(decodeCmdOutput(output, stream), shellConfig.syntax);
  }
  return normalizeCommandOutput(output?.[stream] ?? '', shellConfig?.syntax);
}

async function executeInDirectory(subdirPath, command, args, verbose, shellConfig) {
  try {
    if (verbose) {
      console.log(`=== Executing in: ${cyan(subdirPath)} ===`);
    }

    let result;
    let stdout = '';
    let stderr = '';

    await within(async () => {
      cd(subdirPath);
      // Create the configured zx executor after cd(): zx captures the current
      // AsyncLocalStorage cwd when a local executor is created.
      const execute = shellConfig
        ? $({
            shell: shellConfig.executable,
            prefix: shellConfig.prefix,
            postfix: shellConfig.postfix,
            quote: shellConfig.quote
          })
        : $;

      if (verbose) {
        result = await execute`${command} ${args}`;
      } else {
        result = await execute`${command} ${args}`.quiet();
      }
      stdout = captureOutput(result, shellConfig, 'stdout');
      stderr = captureOutput(result, shellConfig, 'stderr');
      if (verbose) {
        console.log(`${cyan(subdirPath)}: `, stdout);
        if (stderr) {
          console.error(`${cyan(subdirPath)}: `, stderr);
        }
      }
    });

    return {
      success: true,
      stdout,
      stderr
    };
  } catch (error) {
    const stdout = captureOutput(error, shellConfig, 'stdout');
    const stderr = captureOutput(error, shellConfig, 'stderr');
    // zx builds ProcessOutput.message from UTF-8-decoded stderr, which is
    // lossy for cmd.exe (OEM code page). Rebuild a clean, single-line message
    // from the exit code and expose the correctly-decoded stderr separately.
    const message = error.exitCode != null ? `Command failed with exit code ${error.exitCode}` : error.message;
    if (verbose) {
      console.error(red(`Error in ${cyan(subdirPath)}: ${message}`));
      if (stdout) {
        console.log(`${cyan(subdirPath)}: `, stdout);
      }
      if (stderr) {
        console.error(`${cyan(subdirPath)}: `, stderr);
      }
    }
    return {
      success: false,
      error: message,
      stdout,
      stderr
    };
  }
}

export async function batchExecute(targetDir, command, args, options = {}) {
  const {
    skipPaths = [],
    matchPatterns = [],
    verbose = false,
    showProgress = true,
    parallel = true,
    shell: shellOption
  } = options;

  // Validate regexes up front so a typo fails fast, even with no directories.
  const matchRegexes = compileMatchPatterns(matchPatterns);
  const shellConfig = resolveShellConfig(shellOption);

  // Resolve the target through WSL-aware path handling BEFORE path.resolve,
  // otherwise /mnt/... or \\wsl$\... paths would be mangled into D:\mnt\...
  // and become unreachable on the Windows host.
  const absoluteTargetDir = resolveAccessiblePath(targetDir);

  assertCmdSupportsTarget(shellConfig, absoluteTargetDir);

  let subdirs = await listDirectSubdirectories(absoluteTargetDir, skipPaths);
  if (matchRegexes.length > 0) {
    // Positive include filter: keep only directories whose name matches at
    // least one --match pattern (applied in addition to the --skip excludes).
    subdirs = subdirs.filter(name => matchRegexes.some(regex => regex.test(name)));
  }

  const results = [];
  let progressBar = null;

  if (showProgress && subdirs.length > 0) {
    progressBar = new ProgressBar(subdirs.length);
    progressBar.start();
  }

  if (parallel) {
    const promises = subdirs.map(async (subdir, index) => {
      const subdirPath = path.join(absoluteTargetDir, subdir);
      const result = await executeInDirectory(subdirPath, command, args, verbose, shellConfig);

      if (progressBar) {
        progressBar.increment();
      }

      return { directory: subdir, ...result };
    });

    // Promise.all preserves input order, so index i matches subdirs[i].
    const resolvedResults = await Promise.all(promises);
    for (let i = 0; i < subdirs.length; i++) {
      results.push(resolvedResults[i]);
    }
  } else {
    for (let i = 0; i < subdirs.length; i++) {
      const subdir = subdirs[i];
      const subdirPath = path.join(absoluteTargetDir, subdir);
      const result = await executeInDirectory(subdirPath, command, args, verbose, shellConfig);

      results.push({ directory: subdir, ...result });

      if (progressBar) {
        progressBar.update(i + 1);
      }
    }
  }

  if (progressBar) {
    progressBar.stop();
  } else if (!verbose) {
    clearLine();
  }

  return results;
}

/**
 * Run a command exactly once inside a single directory (no subdirectory
 * iteration). Cross-platform: the same shell resolution, OEM output decoding
 * and cmd/UNC safety checks as batchExecute() are applied.
 *
 * Returns a single result object `{ directory, success, stdout, stderr, error? }`
 * where `directory` is the target path as given.
 */
export async function runInDirectory(targetDir, command, args, options = {}) {
  const { verbose = false, shell: shellOption } = options;
  const shellConfig = resolveShellConfig(shellOption);

  // Resolve the target through WSL-aware path handling BEFORE path.resolve,
  // otherwise /mnt/... or \\wsl$\... paths would be mangled into D:\mnt\...
  const absoluteTargetDir = resolveAccessiblePath(targetDir);

  assertCmdSupportsTarget(shellConfig, absoluteTargetDir);

  // Existence check so a typo yields a clear error instead of a generic one.
  try {
    const targetStat = await fsStat(absoluteTargetDir);
    if (!targetStat.isDirectory()) {
      throw new Error(`Not a directory: ${absoluteTargetDir}`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Directory not found: ${absoluteTargetDir}`);
    }
    if (error.code === 'ENOTDIR') {
      throw new Error(`Not a directory: ${absoluteTargetDir}`);
    }
    throw error;
  }

  const result = await executeInDirectory(absoluteTargetDir, command, args, verbose, shellConfig);
  return { directory: targetDir, ...result };
}
