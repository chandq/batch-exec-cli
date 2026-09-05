# AGENTS.md

This is the canonical repository instruction file. Read it before planning or editing.
A more specific `AGENTS.md` in a descendant directory overrides this file for that subtree.
`CLAUDE.md` is an adapter only; it must not redefine these rules.

## Scope And Precedence

- Root `AGENTS.md` governs the whole repository.
- If instructions conflict, more specific files (descendant `AGENTS.md`) win over
  this file, and this file wins over `CLAUDE.md`.
- User-visible behavior is documented in `README.md`; keep it in sync with code.

## Project Facts

- `batch-exec-cli` is a small Node CLI (no build step) built on
  [`zx`](https://github.com/google/zx) and `minimist`. It iterates over the direct
  subdirectories of a target and runs a command in each, cross-platform
  (Windows / Linux / macOS), with progress display and optional parallelism.
- Pure ESM (`"type": "module"`); Node LTS (CI: 18 / 20 / 22).
- Runtime deps are intentionally tiny: `minimist` + `zx` only.
- `main` branch is the release branch: a push touching `src/**` or `test/**`
  auto-releases (see `.github/workflows/release.yml`).

### Repo map

- `src/cli.js` — CLI entry: minimist parsing (`--dir`, `--match/-m`, `--skip`,
  `--shell`, `--no-progress`, `--no-parallel`, `--verbose`, `--version`, `--help`)
  and output rendering.
- `src/index.js` — public API: `batchExecute()`, `runInDirectory()`,
  `parseIgnoreFile`, `listDirectSubdirectories`. Shell resolution, WSL-path
  handling and the cmd/UNC safety guard live here.
- `src/shell.js` — shell resolution/validation (`system|bash|cmd|powershell|pwsh`
  or a path), per-shell prefix/postfix/quote, cmd OEM (GBK etc.) output decoding.
- `src/directoryLister.js` — WSL/UNC path handling, subdirectory listing.
- `src/ignoreParser.js` — `.batchexecignore` parsing and skip matching.
- `src/utils/colors.js` — ANSI colors and the progress bar.
- `bin/` — launcher shims (`batch-exec`, `batch-exec.cmd`) used by package
  managers; `package.json` `bin` points at `bin/batch-exec`.
- `scripts/publish-package-managers.js` — renders/pushes the Homebrew formula
  and Scoop manifest to the external `chandq/homebrew-tap` / `chandq/scoop-bucket`.
- `test/` — Node built-in test runner (`node --test`).

## Development Workflow

- Use the package manager lockfile that already exists (`npm`).
- Install: `npm install`; test: `npm test` (`node --test`);
  coverage: `npm run test:coverage`.
- There is no lint configuration committed yet; match the existing code style
  (2-space indent, single quotes, trailing commas, ~100 cols) and keep files
  consistent.
- Manually smoke CLI changes: `node src/cli.js --help`, `node src/cli.js --dir <dir> <cmd>`,
  `node src/cli.js --match '^<pattern>' <dir> <cmd>`, `node src/cli.js --version`.

## Code Rules

- Keep dependencies minimal. Do not add a framework, bundler or runtime dep for
  a task that Node built-ins can do.
- Platform-aware: changes must not break Windows, Linux or macOS. Windows quirks
  that matter here: the WSL bash shim on PATH (`System32\bash.exe`) is not a real
  bash and must not be selected; `cmd.exe` cannot use UNC paths as a working
  directory (guard in `src/index.js`); `cmd.exe` writes OEM (GBK) output to pipes.
- `src/` is the source of truth; `node_modules/`, coverage output and any log
  files are generated — never commit them.
- Prefer small pure functions and keep public exports documented.

## Tests

- `test/` mirrors `src/`. Add tests with new behavior.
- `node --test` runs all files; each file is isolated.
- Some shells are optional on a machine (bash on Windows, pwsh, WSL). Guard
  shell-dependent tests: skip cleanly when the shell is unavailable rather than
  failing the suite.
- CLI tests spawn `node src/cli.js` via `execFile` (no outer shell dependency).
- Do not weaken an existing assertion to make CI pass; fix the root cause.

## Security And Compatibility

- Shell commands are user-provided by design; never add hidden remote code paths.
- Preserve the cmd/UNC guard and the usable-bash probing in `src/shell.js`.
- Do not regress OEM decoding for CJK Windows (`decodeCmdOutput`, codepage 936/…).

## Releases And Package Managers

- Do NOT hand-edit `package.json` `version` or `CHANGELOG.md` — `standard-version`
  owns them during the release workflow.
- Pushing to `main` with `src/**`/`test/**` changes triggers `release.yml`
  (tests → version bump → GitHub Release → `npm publish`).
- Homebrew/Scoop manifests live in EXTERNAL repos and are updated by the separate
  `sync-package-managers` workflow after a release. Never modify
  `chandq/homebrew-tap` or `chandq/scoop-bucket` from routine work; test the
  generator locally with `node scripts/publish-package-managers.js --dry-run`.

## Definition Of Done

- `npm test` passes (new behavior has new tests; no unrelated failures/skips).
- CLI/docs/API stay consistent (`--help`, `README.md`, `src/index.js` exports).
- No generated files, debris (`repro.mjs` etc.) or secrets are committed.
