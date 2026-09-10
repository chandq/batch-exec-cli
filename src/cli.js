#!/usr/bin/env node

import { createRequire } from 'module';
import path from 'path';
import minimist from 'minimist';
import { $ } from 'zx';
import { batchExecute, runInDirectory, parseIgnoreFile } from './index.js';
import { resolveShell, resolveDefaultConfig, shellDisplayName, containsShellOperators } from './shell.js';
import { cyan, yellow, green, red, gray, bold, dim, magenta, blue } from './utils/colors.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

$.verbose = false;

/**
 * Parse --concurrency. Returns undefined when the flag is absent, so
 * batchExecute applies its platform default; 0 means unlimited.
 */
function parseConcurrency(value) {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(red(`Error: --concurrency must be a non-negative integer (got ${JSON.stringify(value)})`));
    printHelp();
    process.exit(1);
  }
  return parsed;
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    // Everything after the first positional (or after --dir) belongs to the
    // command. This is required for command flags such as `npm ls -g`.
    stopEarly: true,
    // A boolean entry makes --no-<name> work too: --raw / --no-raw decide
    // explicitly whether the command line is passed to the shell verbatim.
    boolean: ['v', 'verbose', 'h', 'help', 'version', 'no-progress', 'no-parallel', 'raw', 'quiet'],
    string: ['s', 'skip', 'shell', 'dir', 'match', 'concurrency'],
    // minimist defaults every boolean to false, which would make --raw
    // indistinguishable from "not given". null marks "absent" so the
    // shell-operator auto-detection still gets a say.
    default: { raw: null },
    alias: {
      s: 'skip',
      v: 'verbose',
      h: 'help',
      m: 'match'
    }
  });

  if (argv.help) {
    printHelp();
    process.exit(0);
  }

  if (argv.version) {
    console.log(version);
    process.exit(0);
  }

  let targetDir;
  let command;
  let args;

  if (argv.dir) {
    // --dir: run once in that single directory (no subdirectory iteration).
    targetDir = argv.dir;
    [command, ...args] = argv._;
  } else {
    [targetDir, command, ...args] = argv._;
  }

  if (!targetDir || !command) {
    console.error(red('Error: Missing required arguments'));
    printHelp();
    process.exit(1);
  }

  // Positive include filter (regex, repeatable): a directory is executed when
  // its name matches any provided pattern. Not used in --dir (single) mode.
  const matchPatterns = argv.match == null ? [] : [].concat(argv.match);

  // Pipes, redirects and the like only reach the shell when the command line is
  // passed through verbatim (see rawQuote in index.js). Detect them from the
  // reconstructed command line; an explicit --raw / --no-raw always wins
  // (argv.raw is null when neither was given).
  const commandLine = [command, ...args].join(' ');
  const raw = argv.raw === true || (argv.raw == null && containsShellOperators(commandLine));

  const concurrency = parseConcurrency(argv.concurrency);

  // Ignore/exclude patterns only apply when iterating over subdirectories.
  let skipPaths = [];
  if (!argv.dir) {
    let ignoreFilePath = argv.skip;
    if (!ignoreFilePath) {
      ignoreFilePath = path.join(process.cwd(), '.batchexecignore');
    }
    skipPaths = await parseIgnoreFile(ignoreFilePath);
  }

  let shellConfig;
  try {
    shellConfig = argv.shell ? resolveShell(argv.shell) : resolveDefaultConfig();
  } catch (error) {
    console.error(red(`\nError: ${error.message}\n`));
    process.exit(1);
  }

  if (argv.verbose) {
    console.log(bold('\n🚀 Batch Executor\n'));
    console.log(`Target directory: ${cyan(targetDir)}`);
    console.log(`Command: ${yellow(command)} ${args.join(' ')}`);
    console.log(`Parallel mode: ${argv.parallel === false ? red('Disabled') : green('Enabled')}`);
    if (argv.parallel !== false) {
      console.log(`Concurrency: ${cyan(concurrency ?? 'auto')}`);
    }
    console.log(`Raw command line: ${raw ? green('Enabled') : 'Disabled'}`);
    console.log(`Shell: ${cyan(shellDisplayName(shellConfig, $.shell))}`);
    if (skipPaths.length > 0) {
      console.log(`Skipping directories: ${gray(skipPaths.join(', '))}`);
    }
    if (matchPatterns.length > 0) {
      console.log(`Matching directories: ${gray(matchPatterns.join(', '))}`);
    }
    console.log(gray('----------------------------------------\n'));
  }

  try {
    let results;
    if (argv.dir) {
      // Single-directory mode: run the command exactly once inside the target.
      const result = await runInDirectory(targetDir, command, args, {
        verbose: argv.verbose,
        raw,
        shell: argv.shell
      });
      results = [result];
    } else {
      results = await batchExecute(targetDir, command, args, {
        skipPaths,
        matchPatterns,
        verbose: argv.verbose,
        // --quiet means "stdout is data": no progress frames either, whatever
        // the terminal capabilities are.
        showProgress: argv.progress !== false && !argv.quiet,
        parallel: argv.parallel !== false,
        concurrency,
        raw,
        shell: argv.shell
      });
    }

    if (!argv.verbose) {
      if (argv.quiet) {
        printQuietOutputs(results);
      } else {
        printCommandOutputs(results);
        printSummary(results);
      }
    }

    // Signal failure through the exit code so scripts and pipelines can react.
    // exitCode (not process.exit) so stdout/stderr are flushed before exiting -
    // process.exit() can truncate a piped stream.
    if (results.some(result => !result.success)) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(red(`\nError: ${error.message}\n`));
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
${bold('Batch Executor')} ${dim(`v${version}`)}

${cyan('Usage:')} batch-exec [options] <directory> <command> [args...]
${cyan('       ')} batch-exec [options] --dir <directory> <command> [args...]

Efficiently iterate through all direct subdirectories of a directory and execute a command.
Use --dir to run once in a single directory instead of iterating.
Options should be placed before the command; all arguments after <directory> are passed to the command unchanged.

${blue('Arguments:')}
  ${cyan('<directory>')}    Target directory (absolute or relative path)
  ${yellow('<command>')}      Command to execute in each subdirectory
  [args...]      Optional arguments for the command

${magenta('Options:')}
  -s, --skip <file>  Ignore file path (default: ./.batchexecignore)
  -m, --match <regex>  Only run in subdirectories whose name matches the regex (repeatable)
      --dir <path>   Run once in this single directory (skips subdirectory iteration)
      --shell <name-or-path>  Shell to use: system, bash, cmd, powershell, pwsh, or a path
      --raw          Pass the command line to the shell verbatim (enables pipes, &&, redirects)
      --no-raw       Never use raw mode, even when shell operators are detected
      --concurrency <n>  Max commands to run at once (default 0 = unlimited)
      --quiet        Print only command stdout; failures go to stderr (implies no progress)
      --version      Show the version number
  -v, --verbose      Show verbose output
      --no-progress  Disable progress bar
      --no-parallel  Disable parallel execution (use sequential mode)
  -h, --help         Show this help message

${yellow('Pipes:')} shell operators (${cyan('|')}, ${cyan('>')}, ${cyan('&&')}, ${cyan(';')}, ...) are detected
  automatically and switch on raw mode. Quote them to pass them through literally,
  or use --no-raw to turn the detection off. Raw mode is opt-in per argument only when
  detected, so an argument that merely contains ${cyan('|')} or ${cyan('&')} is left alone.
  In ${cyan('cmd.exe')} only double quotes work: cmd treats neither single quotes nor
  backticks as quoting, so ${cyan("'ls | wc -l'")} and ${cyan('`ls | wc -l`')} are split by cmd
  itself and never reach this CLI.

${yellow('Exit code:')} 1 when any directory fails, 0 when all succeed.

${yellow('WSL:')} run this CLI inside WSL with --shell bash for native paths,
  or from Windows point at /mnt/... (converted automatically) or \\\\wsl.localhost\\...
  and use --shell system/powershell/pwsh (cmd cannot use UNC working directories).

${green('Examples:')}
  ${green('batch-exec')} ./my-projects git pull
  ${green('batch-exec')} ./my-projects npm update lodash -S
  ${green('batch-exec')} --skip ./custom-ignore.txt ./repos ls -la
  ${green('batch-exec')} --no-parallel ./my-projects npm install
  ${green('batch-exec')} --shell powershell ./my-projects git status
  ${green('batch-exec')} --shell pwsh "\\\\wsl.localhost\\Ubuntu\\home\\user\\repos" git status  ${green('batch-exec')} --dir ./my-project npm test
  ${green('batch-exec')} --match '^service-' ./monorepo git pull
  ${green('batch-exec')} -m 'pkg-.*' -m 'app-.*' ./workspace npm install
  ${green('batch-exec')} ./my-projects 'git branch | wc -l'
  ${green('batch-exec')} --quiet --dir ./my-project ls | wc -l`);
}

function printCommandOutputs(results) {
  results
    .filter(result => result.success && (result.stdout || result.stderr))
    .forEach(result => {
      console.log(`\n=== ${cyan(result.directory)} ===`);
      if (result.stdout) {
        process.stdout.write(result.stdout);
        if (!result.stdout.endsWith('\n')) process.stdout.write('\n');
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
        if (!result.stderr.endsWith('\n')) process.stderr.write('\n');
      }
    });
}

/**
 * --quiet output: stdout carries nothing but the commands' own stdout, so it
 * can be piped straight into `wc -l` and friends. Failures are reported on
 * stderr as a single `dir: message` line, and no decoration is printed at all.
 */
function printQuietOutputs(results) {
  for (const result of results) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
      if (!result.stdout.endsWith('\n')) process.stdout.write('\n');
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
      if (!result.stderr.endsWith('\n')) process.stderr.write('\n');
    }

    if (!result.success) {
      const errorMessage = result.error || 'Command failed';
      // Skip the marker when the captured stderr already carries that text.
      const alreadySeen = [result.stdout, result.stderr].some(
        output => output && output.includes(errorMessage.trim())
      );
      if (!alreadySeen) {
        process.stderr.write(`${result.directory}: ${errorMessage}\n`);
      }
    }
  }
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
        const errorMessage = r.error || 'Command failed';
        console.log(`  ${cyan('•')} ${cyan(r.directory)}: ${red(errorMessage)}`);

        const capturedOutput = [r.stdout, r.stderr]
          .filter(output => output && !errorMessage.includes(output.trim()))
          .join('');
        if (capturedOutput) {
          console.log(gray(`    Output:\n${capturedOutput.trimEnd()}`));
        }
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
