# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Shape

- Single-package Obsidian community plugin (publish/manage nostr long-form articles, kind 30023). Source entrypoint is `main.mts`, bundled output is root `main.js`.
- Runtime plugin code is CommonJS (`package.json` has `type: "commonjs"`); esbuild bundles `main.mts` to `main.js` with `format: "cjs"`, `platform: "node"`, and Obsidian/Electron/CodeMirror/Node builtins externalized (see `esbuild.config.mjs`).
- Source files use `.mts` but import repo-local modules with `.mjs` specifiers. Preserve that pattern; do not rewrite imports to `.mts`.

## Commands

- Install/use pnpm; `packageManager` is `pnpm@9.15.6` and the lockfile is `pnpm-lock.yaml`.
- `pnpm build` runs `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`.
- `pnpm dev` starts `node esbuild.config.mjs` in watch mode and does not run typecheck.
- `pnpm format` runs `prettier --write .`; Prettier is configured only with 2-space indentation and no tabs.
- There is no test script or checked-in test suite despite `vitest` being installed.

## Architecture

The plugin is built on [applesauce](https://github.com/hzrd149/applesauce) (a reactive, RxJS-based nostr SDK) and [blossom-client-sdk](https://github.com/hzrd149/blossom-client-sdk) for media. Understanding the wiring in `main.mts` is the key to the codebase.

- **Shared singletons (constructed once in `main.mts`):** one `RelayPool` (relay I/O), one `EventStore` (in-memory event cache + reactive query layer — there must be exactly one), one `AccountManager` (accounts/signers, including NIP-46 bunker via `NostrConnectSigner`), one `ActionRunner` (executes list-mutation actions like add/remove blossom server and outbox relay). The two service classes `Publisher` and `Downloader` hold a back-reference to the plugin and reach these singletons through it.
- **Reactive state:** plugin settings live in RxJS `BehaviorSubject`s (`data`, `localRelay`, `pluginRelays`, `lookupRelays`). Derived observables (`mailboxes`, `publishRelays`, `blossomServers`) are computed with `shareReplay(1)`. Persistence is a `data` subject `debounceTime(1000)` → `saveData`. All long-lived subscriptions are pushed to `this.cleanup` and torn down in `onunload`.
- **Article identity:** a vault note is "an article" when its frontmatter has both `pubkey` and `identifier`; these map to an `AddressPointer` (kind 30023). See `Publisher.getArticleNostrAddress` and `src/schema/frontmatter.mts`.
- **Publish flow** (`PublishModal` → `Publisher`): read note → convert Obsidian wikilinks/`![[embeds]]` to markdown → upload embedded media to the user's Blossom servers → build the kind 30023 event → sign → publish to outbox relays. Media upload uses Obsidian's `requestUrl` rather than the Blossom SDK's fetch-based upload, deliberately, to bypass the `app://obsidian.md` browser CORS policy.
- **Download flow** (`DownloadArticleModal` → `Downloader` → `fetcher.mts`): resolve an `naddr`/URL/pointer → fetch the latest matching events from a relay group with a hard timeout → dedup into the `EventStore` → write markdown to the vault and download referenced images.

### applesauce v6 idioms (follow these when editing)

The repo is on applesauce 6.x. v6 removed/relocated several v4-era APIs — keep all `applesauce-*` packages on the same major version.

- **Querying the store is model/cast based.** `EventStore` has no reactive query methods. Use `events.model(Model, …)` (e.g. `ReplaceableModel`, `FiltersModel` from `applesauce-core/models`) and the `User` cast — `castUser(pubkey, events)` from `applesauce-common/casts` exposes `profile$`, `mailboxes$`, `outboxes$`, `blossomServers$`, etc. as outbox-aware observables. Prefer the `User` cast for per-user data.
- **One unified loader.** Missing events are fetched lazily through a single `events.eventLoader`, attached via `createEventLoaderForStore(events, pool, { lookupRelays, cacheRequest })`. `cacheRequest` reads from the configured local relay first.
- **Event creation uses the Promise-based fluent `EventFactory`** from `applesauce-core/factories` (`EventFactory.fromKind(...)` / `.fromEvent(existing)` → `.content().modifyPublicTags(...).stamp(signer)`). There is no `applesauce-factory` package and no `ArticleFactory`; build kind 30023 with the base factory. Sign via `accounts.signer.signEvent(...)`.
- **Relay reads:** `pool.request` / `pool.subscription` / `group.request` emit `NostrEvent` directly. The low-level `pool.req` / `group.req` emit structured `{ type }` messages — only for advanced lifecycle control.

When working with applesauce, use the `applesauce` skill and the applesauce MCP docs/examples tools — they carry the v4→v5 and v5→v6 migration guides and working examples.

## Verification Gotchas

- `main.js` is generated and gitignored; avoid hand-editing it. Release artifacts are `main.js`, `manifest.json`, `styles.css`, and `nostr-publisher.zip`.
- `data.json` is gitignored but may be present in the worktree with real Obsidian plugin account/signer data. Do not copy from it into docs, tests, examples, or commits.
- The bundle externalizes Obsidian/Electron/CodeMirror; the plugin can only truly run inside Obsidian, so verification is typecheck + build, not a runnable app.

## Versioning And Releases

- Changesets are configured for a private package named `nostr-publisher`, base branch `master`, access `restricted`.
- For user-facing changes, add a one-line changeset under `.changeset/`; skip for docs/test/tooling-only changes.
- Release workflow runs only on tags, builds with Node 20 and pnpm, zips `main.js manifest.json styles.css`, then creates a draft GitHub release.
- `package.json` has a `version` script that calls a missing `version-bump.mjs`; do not assume `pnpm version` or Changesets versioning updates `manifest.json`/`versions.json` until that script is restored or replaced.
