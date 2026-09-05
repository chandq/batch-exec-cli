# Security Policy

## Supported versions

Only the latest release is supported. We do not backport fixes to older
versions — please upgrade to the newest `batch-exec-cli`.

## Reporting a vulnerability

Do **not** open a public issue for a security vulnerability. Instead, report it
privately via GitHub's Security tab:

**https://github.com/chandq/batch-exec-cli/security/advisories/new**

Please include:

- the version (`batch-exec-cli --version`) and how you installed it
  (npm / npx / Homebrew / Scoop / from source);
- the OS and shell you used;
- a minimal reproduction;
- the impact you observed and any suggested fix.

The maintainer is reachable through the GitHub profile linked above.

## Security notes for users

- `batch-exec-cli` executes arbitrary user-supplied commands in the target
  directories. Only run it on directories and with commands you trust — the
  same caution applies as running a shell script.
- WSL/UNC handling converts paths for the host filesystem; be aware of which
  shell and working directory a command will actually run in (see `--help`).

## Scope

- Source code and published artifacts (npm package, Homebrew formula, Scoop
  manifest) for `batch-exec-cli`.
- Issues in third-party dependencies should be reported to their maintainers.
