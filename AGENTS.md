# Repository Instructions

## Project Shape
- Single-package Obsidian community plugin; source entrypoint is `main.mts`, bundled output is root `main.js`.
- Runtime plugin code is CommonJS (`package.json` has `type: "commonjs"`); esbuild bundles `main.mts` to `main.js` with `format: "cjs"` and Obsidian/Electron/CodeMirror/Node builtins externalized.
- Source files use `.mts` but import repo-local modules with `.mjs` specifiers. Preserve that pattern; do not rewrite imports to `.mts`.
- Main wiring lives in `main.mts`; article publishing/downloading logic lives in `src/service/publisher.mts` and `src/service/downloader.mts`; persisted settings schema is `src/schema/plugin-data.mts`.

## Commands
- Install/use pnpm; `packageManager` is `pnpm@9.15.6` and the lockfile is `pnpm-lock.yaml`.
- `pnpm build` runs `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`.
- `pnpm dev` starts `node esbuild.config.mjs` in watch mode and does not run typecheck.
- `pnpm format` runs `prettier --write .`; Prettier is configured only with 2-space indentation and no tabs.
- There is no test script or checked-in test suite despite `vitest` being installed.

## Verification Gotchas
- As of this file, `pnpm build` fails during TypeScript checking because current Applesauce/Nostr dependency types do not match imports used by the code. Do not report a clean build unless this is fixed and rerun.
- `main.js` is generated and gitignored; avoid hand-editing it. Release artifacts are `main.js`, `manifest.json`, `styles.css`, and `nostr-publisher.zip`.
- `data.json` is gitignored but currently present in the worktree with Obsidian plugin account/signer data. Do not copy from it into docs, tests, examples, or commits.

## Versioning And Releases
- Changesets are configured for a private package named `nostr-publisher`, base branch `master`, access `restricted`.
- For user-facing changes, add a one-line changeset under `.changeset/`; skip for docs/test/tooling-only changes.
- Release workflow runs only on tags, builds with Node 20 and pnpm, zips `main.js manifest.json styles.css`, then creates a draft GitHub release.
- `package.json` has a `version` script that calls missing `version-bump.mjs`; do not assume `pnpm version` or Changesets versioning updates `manifest.json`/`versions.json` until that script is restored or replaced.
