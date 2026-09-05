# Conventional Commits message template

Follow Conventional Commits for every commit — the commit type drives the
release version (`feat` → minor, `fix` → patch) in the release workflow.

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

- `<type>`: `feat` | `fix` | `docs` | `style` | `refactor` | `test` | `chore`
- `<scope>`: optional short area, e.g. `cli`, `shell`, `dir`, `packaging`
- `<subject>`: imperative verb first, ~50 chars, no trailing period
- `<body>`: wrapped at ~72 chars; explain _why_, _how_, and side effects
- `<footer>`: `BREAKING CHANGE: ...` or `Fixes #123`

## Examples

```
feat(cli): support single-directory execution via --dir

feat(cli): filter subdirectories by regex with --match

fix(shell): never select the WSL bash shim as the default bash

chore(packaging): publish Homebrew formula and Scoop manifest
```

Do not hand-edit `package.json` `version` or `CHANGELOG.md` — the release
workflow (standard-version) owns them.
