import fs from 'fs/promises';
import path from 'path';
import { $, cd } from 'zx';
import { parseIgnoreFile } from './ignoreParser.js';
import { listDirectSubdirectories } from './directoryLister.js';
import { cyan, red, yellow } from './utils/colors.js';

export { parseIgnoreFile };
export { listDirectSubdirectories };

export async function batchExecute(targetDir, command, args, options = {}) {
  const { skipPaths = [], verbose = false } = options;

  const absoluteTargetDir = path.resolve(targetDir);

  const subdirs = await listDirectSubdirectories(absoluteTargetDir, skipPaths);

  const results = [];

  for (const subdir of subdirs) {
    const subdirPath = path.join(absoluteTargetDir, subdir);
    try {
      if (verbose) {
        console.log(`\n=== Executing in: ${cyan(subdirPath)} ===`);
      }

      let result;

      cd(subdirPath);

      if (verbose) {
        result = await $`${command} ${args}`;
      } else {
        result = await $`${command} ${args}`.quiet();
      }

      results.push({
        directory: subdir,
        success: true,
        stdout: result.stdout,
        stderr: result.stderr
      });

      if (verbose) {
        console.log(result.stdout);
        if (result.stderr) {
          console.error(result.stderr);
        }
      }
    } catch (error) {
      results.push({
        directory: subdir,
        success: false,
        error: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || ''
      });

      if (verbose) {
        console.error(red(`Error in ${cyan(subdir)}: ${error.message}`));
        if (error.stdout) {
          console.log(error.stdout);
        }
        if (error.stderr) {
          console.error(error.stderr);
        }
      }
    }
  }

  return results;
}
