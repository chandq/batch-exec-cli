# Contributing to batch-exec-cli

Thanks for taking the time to contribute! `batch-exec-cli` is a small,
dependency-light Node CLI for running a command across many directories.

## Quick links

- [README.md](./README.md) — user-facing features and usage
- [gitmessage.md](./gitmessage.md) — commit message template
- [SECURITY.md](./SECURITY.md) — how to report vulnerabilities
- [AGENTS.md](./AGENTS.md) — codebase orientation (also consumed by AI tools)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — community standards

## Project at a glance

- Pure ESM, no build step; runtime deps: `minimist` + `zx`.
- `src/index.js` is the public API (`batchExecute`, `runInDirectory`);
  `src/cli.js` is the CLI; `src/shell.js` handles shell resolution/decoding.
- Cross-platform: Windows, Linux and macOS are first-class. See the Windows
  notes in `AGENTS.md` (OEM decoding, WSL paths, UNC guard).

## Development setup

Requirements: Node.js LTS (18+).

```bash
npm install
npm test          # node --test (all suites)
npm run test:coverage
```

### Useful commands

| Command                                              | What it does                                          |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `npm test`                                           | Run the full test suite with the Node built-in runner |
| `npm run test:coverage`                              | Run tests with coverage over `src/**`                 |
| `node src/cli.js --help`                             | Print current CLI help                                |
| `node scripts/publish-package-managers.js --dry-run` | Render the Homebrew formula / Scoop manifest locally  |

### Everyday loop

1. Make a focused change with a test.
2. `npm test` until green.
3. If you touched CLI parsing/output, smoke-test the affected flags manually.

## Where things live

| Area                               | Location                                        |
| ---------------------------------- | ----------------------------------------------- |
| CLI parsing & output               | `src/cli.js`                                    |
| Public API                         | `src/index.js`                                  |
| Shell resolution & output decoding | `src/shell.js`                                  |
| Directory / WSL path handling      | `src/directoryLister.js`, `src/ignoreParser.js` |
| Colors & progress bar              | `src/utils/colors.js`                           |
| Homebrew/Scoop publishing          | `scripts/publish-package-managers.js`           |
| Tests                              | `test/`                                         |

## Conventions

### Code style

No committed lint config yet — match the existing style: 2-space indent, single
quotes, trailing commas, ~100 columns, descriptive names.

### Tests

- Node's built-in test runner, one file per `src` module plus `cli.test.js`.
- Shell-dependent tests must skip cleanly when the shell is unavailable
  (e.g. bash or pwsh not installed on Windows).

### Commit messages

Follow Conventional Commits (`gitmessage.md`):

```
<type>(<scope>): <subject>          # type: feat|fix|docs|style|refactor|test|chore
                                    # subject: verb first, ~50 chars
<body>                              # 72-char wrap; why, how, side effects
```

### Versioning and releases (important)

- Merging to `main` with `src/**` or `test/**` changes triggers an automatic
  release (`.github/workflows/release.yml`).
- Never hand-edit `package.json` `version` or `CHANGELOG.md`; `standard-version`
  owns them.
- The commit type drives the next version: `feat` → minor, `fix` → patch,
  `docs`/`chore`/`test` → no release bump.
- Homebrew/Scoop manifests are synchronized to external repos by a separate
  `sync-package-managers` workflow after each release — do not edit them by hand.

## Adding a feature or CLI flag (checklist)

- [ ] Update `src/cli.js` parsing + `--help` text.
- [ ] Add/update the API surface in `src/index.js` and export it.
- [ ] Add tests (`test/cli.test.js` and/or `test/index.test.js`).
- [ ] Update `README.md` (features / usage / options table).
- [ ] `npm test` green and manual smoke test done.
- [ ] Commit message uses Conventional Commits.

## Reporting bugs / requesting features

- Bugs: open an issue with OS, shell, Node version and a minimal reproduction.
- Features: describe the problem and the proposed CLI/behavior change.
- Security issues: do **not** open a public issue — use
  [SECURITY.md](./SECURITY.md).

## License

By contributing you agree your contributions are licensed under the
[MIT License](./LICENSE).
