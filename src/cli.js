#!/usr/bin/env node

import path from 'path';
import minimist from 'minimist';
import { $ } from 'zx';
import { batchExecute, parseIgnoreFile } from './index.js';
import { cyan, yellow, green, red, gray, bold, dim, magenta, blue } from './utils/colors.js';

$.verbose = false;

async function main() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['v', 'verbose', 'h', 'help', 'no-progress', 'no-parallel'],
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
    console.log(bold('\n🚀 Batch Executor\n'));
    console.log(`Target directory: ${cyan(targetDir)}`);
    console.log(`Command: ${yellow(command)} ${args.join(' ')}`);
    console.log(`Parallel mode: ${argv.parallel === false ? red('Disabled') : green('Enabled')}`);
    if (skipPaths.length > 0) {
      console.log(`Skipping directories: ${gray(skipPaths.join(', '))}`);
    }
    console.log(gray('----------------------------------------\n'));
  }

  try {
    const results = await batchExecute(targetDir, command, args, {
      skipPaths,
      verbose: argv.verbose,
      showProgress: argv.progress !== false,
      parallel: argv.parallel !== false
    });

    printSummary(results);
  } catch (error) {
    console.error(red(`\nError: ${error.message}\n`));
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
${bold('Batch Executor')} ${dim('v1.3.0')}

${cyan('Usage:')} batch-exec [options] <directory> <command> [args...]

Efficiently iterate through all direct subdirectories of a directory and execute a command.

${blue('Arguments:')}
  ${cyan('<directory>')}    Target directory (absolute or relative path)
  ${yellow('<command>')}      Command to execute in each subdirectory
  [args...]      Optional arguments for the command

${magenta('Options:')}
  -s, --skip <file>  Ignore file path (default: ./.batchexecignore)
  -v, --verbose      Show verbose output
      --no-progress  Disable progress bar
      --no-parallel  Disable parallel execution (use sequential mode)
  -h, --help         Show this help message

${green('Examples:')}
  ${green('batch-exec')} ./my-projects git pull
  ${green('batch-exec')} ./my-projects npm update lodash -S
  ${green('batch-exec')} --skip ./custom-ignore.txt ./repos ls -la
  ${green('batch-exec')} --no-parallel ./my-projects npm install
`);
}

function printSummary(results) {
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;

  console.log(bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(bold('📊 Execution Summary'));
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total directories: ${bold(results.length.toString())}`);
  console.log(`  Successful:        ${green(bold(successCount.toString()))}`);
  console.log(`  Failed:            ${failureCount > 0 ? red(bold(failureCount.toString())) : '0'}`);

  if (failureCount > 0) {
    console.log('\n' + red(bold('❌ Failed directories:')));
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`  ${cyan('•')} ${cyan(r.directory)}: ${red(r.error)}`);
      });
  }

  if (successCount > 0 && failureCount === 0) {
    console.log('\n' + green(bold('✅ All operations completed successfully!')));
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(error => {
  console.error(red('Fatal error:'), error);
  process.exit(1);
});
