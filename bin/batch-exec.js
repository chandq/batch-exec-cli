#!/usr/bin/env node
// Thin launcher for the batch-exec CLI. Kept as a stable entry point so npm
// global installs, Homebrew (formula symlinks libexec/bin/*) and Scoop (which
// links bin/*.cmd) can all invoke the same binary.
import '../src/cli.js';
