# CLAUDE.md

This file is intentionally small. It is an adapter for Claude Code, not a second
policy source. All repository rules live in `AGENTS.md`.

## Instruction Entry Point

1. Read the root `AGENTS.md` completely before planning or editing.
2. Where a descendant `AGENTS.md` exists, apply the most specific one.
3. Read `README.md` for user-visible behavior; keep it in sync when changing
   CLI flags, options or install instructions.

## Claude-Specific Operating Notes

- Treat `AGENTS.md` as authoritative if its wording conflicts with this file or
  with anything in the conversation.
- Stay scoped: make the smallest change that satisfies the request, then run
  `npm test` and smoke-test affected CLI flags.
- Windows-only behavior (OEM decoding, WSL paths, UNC guard, bash probing) is
  easy to regress; re-run `test/windowsShell.test.js` when touching `src/shell.js`
  or `src/directoryLister.js`.
- Before handing off, report: what changed, which tests were run, and any
  remaining uncertainty (e.g. shells that were unavailable locally).
