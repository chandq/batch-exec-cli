import path from 'path';
import { $, within, cd } from 'zx';
import { parseIgnoreFile } from './ignoreParser.js';
import { listDirectSubdirectories } from './directoryLister.js';
import { cyan, red, ProgressBar, clearLine } from './utils/colors.js';

export { parseIgnoreFile };
export { listDirectSubdirectories };

async function executeInDirectory(subdirPath, command, args, verbose) {
  try {
    if (verbose) {
      console.log(`=== Executing in: ${cyan(subdirPath)} ===`);
    }

    let result;

    await within(async () => {
      cd(subdirPath);
      if (verbose) {
        result = await $`${command} ${args}`;
      } else {
        result = await $`${command} ${args}`.quiet();
      }
      if (verbose) {
        console.log(`${cyan(subdirPath)}: `, result.stdout);
        if (result.stderr) {
          console.error(`${cyan(subdirPath)}: `, result.stderr);
        }
      }
    });

    return {
      success: true,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    if (verbose) {
      console.error(red(`Error in ${cyan(subdirPath)}: ${error.message}`));
      if (error.stdout) {
        console.log(`${cyan(subdirPath)}: `, error.stdout);
      }
      if (error.stderr) {
        console.error(`${cyan(subdirPath)}: `, error.stderr);
      }
    }
    return {
      success: false,
      error: error.message,
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    };
  }
}

export async function batchExecute(targetDir, command, args, options = {}) {
  const { skipPaths = [], verbose = false, showProgress = true, parallel = true } = options;

  const absoluteTargetDir = path.resolve(targetDir);

  const subdirs = await listDirectSubdirectories(absoluteTargetDir, skipPaths);

  const results = [];
  let progressBar = null;

  if (showProgress && subdirs.length > 0) {
    progressBar = new ProgressBar(subdirs.length);
    progressBar.start();
  }

  if (parallel) {
    const promises = subdirs.map(async (subdir, index) => {
      const subdirPath = path.join(absoluteTargetDir, subdir);
      const result = await executeInDirectory(subdirPath, command, args, verbose);

      if (progressBar) {
        progressBar.increment();
      }

      return { directory: subdir, ...result };
    });

    const resolvedResults = await Promise.all(promises);

    for (const subdir of subdirs) {
      const result = resolvedResults.find(r => r.directory === subdir);
      if (result) {
        results.push(result);
      }
    }
  } else {
    for (let i = 0; i < subdirs.length; i++) {
      const subdir = subdirs[i];
      const subdirPath = path.join(absoluteTargetDir, subdir);
      const result = await executeInDirectory(subdirPath, command, args, verbose);

      results.push({ directory: subdir, ...result });

      // if (verbose) {
      //   if (result.success) {
      //     console.log(result.stdout);
      //     if (result.stderr) {
      //       console.error(result.stderr);
      //     }
      //   } else {
      //     console.error(red(`Error in ${cyan(subdir)}: ${result.error}`));
      //     if (result.stdout) {
      //       console.log(result.stdout);
      //     }
      //     if (result.stderr) {
      //       console.error(result.stderr);
      //     }
      //   }
      // }

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
