#!/usr/bin/env node

import path from 'path';
import minimist from 'minimist';
import { $ } from 'zx';
import { batchExecute, parseIgnoreFile } from './index.js';
import { cyan, yellow, green, red, gray, bold } from './utils/colors.js';

$.verbose = false;

async function main() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['v', 'verbose', 'h', 'help'],
    string: ['s', 'skip'],
    alias: {
      s: 'skip',
      v: 'verbose',
      h: 'help'
    }
  });

  if (argv.help) {
    printHelp();
    process.exit(0);
  }

  const [targetDir, command, ...args] = argv._;

  if (!targetDir || !command) {
    console.error(red('Error: Missing required arguments'));
    printHelp();
    process.exit(1);
  }

  let ignoreFilePath = argv.skip;

  if (!ignoreFilePath) {
    const defaultIgnorePath = path.join(process.cwd(), '.batchexecignore');
    ignoreFilePath = defaultIgnorePath;
  }

  const skipPaths = await parseIgnoreFile(ignoreFilePath);

  if (argv.verbose) {
    console.log(`Target directory: ${cyan(targetDir)}`);
    console.log(`Command: ${yellow(command)} ${args.join(' ')}`);
    if (skipPaths.length > 0) {
      console.log(`Skipping directories: ${gray(skipPaths.join(', '))}`);
    }
    console.log(gray('----------------------------------------'));
  }

  try {
    const results = await batchExecute(targetDir, command, args, {
      skipPaths,
      verbose: argv.verbose
    });

    printSummary(results);
  } catch (error) {
    console.error(red(`Error: ${error.message}`));
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Usage: batch-exec [options] <directory> <command> [args...]

Efficiently iterate through all direct subdirectories of a directory and execute a command.

Arguments:
  ${cyan('<directory>')}    Target directory (absolute or relative path)
  ${yellow('<command>')}      Command to execute in each subdirectory
  [args...]      Optional arguments for the command

Options:
  -s, --skip <file>  Ignore file path (default: ./.batchexecignore)
  -v, --verbose      Show verbose output
  -h, --help         Show this help message

Examples:
  ${green('batch-exec')} ./my-projects git pull
  ${green('batch-exec')} ./my-projects npm update lodash -S
  ${green('batch-exec')} --skip ./custom-ignore.txt ./repos ls -la
`);
}

function printSummary(results) {
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;

  console.log('\n========================================');
  console.log(bold('Summary:'));
  console.log(`  Total directories: ${results.length}`);
  console.log(`  Successful: ${green(successCount)}`);
  console.log(`  Failed: ${failureCount > 0 ? red(failureCount) : '0'}`);

  if (failureCount > 0) {
    console.log('\nFailed directories:');
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`  - ${cyan(r.directory)}: ${red(r.error)}`);
      });
  }

  console.log('========================================\n');
}

main().catch(error => {
  console.error(red('Fatal error:'), error);
  process.exit(1);
});
