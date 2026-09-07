# Development

Hyperion has web and desktop targets built from one shared React application.
Neither target requires an application server, account system, or remote
database.

## Requirements

- Node.js 22.16 or newer and pnpm 11.1.0
- Platform build tools are only needed when creating installers: Xcode
  command-line tools on macOS, Visual Studio build tools on Windows, or the
  standard Electron packaging dependencies on Linux

Install JavaScript dependencies once:

```sh
pnpm install
```

## Web development

```sh
pnpm dev:web
```

This starts Vite at `http://127.0.0.1:3000`. The web target stores all data in
the browser's IndexedDB databases.

## Desktop development

```sh
pnpm dev:desktop
```

The command compiles the Electron main and preload processes, starts Vite, and
opens the shared app in Electron's bundled Chromium. The default database is
`~/.config/hyperion/hyperion.sqlite3`. Use
Settings → Data → SQLite storage folder to migrate to or open another folder.

Changes under `app/` update through Vite. Restart `pnpm dev:desktop` after
changing files under `electron/` so the trusted processes are recompiled.

## Checks

- `pnpm check:web` checks all first-party TypeScript, including application tests.
  BlockSuite exports TypeScript source with upstream diagnostics; the checker
  excludes diagnostics located inside `node_modules`, while preserving project,
  configuration, and global errors.
- `pnpm build:web` type-checks and builds the portable web assets.
- `pnpm test:app` exercises page operations, search, outlines, editor metadata
  publication, and React interactions in jsdom. Native dialog focus containment
  still requires a browser check; the DOM tests verify the modal API contract.
- `pnpm check:desktop` type-checks Electron's main and preload processes.
- `pnpm test:desktop` exercises SQLite persistence and storage migration.
- `pnpm lint` checks TypeScript and React code with ESLint.
- `pnpm test` builds the web target and validates both target configurations.

See [Building](./building.md) for production packages.

## Application structure

Feature views and dialogs live in `app/components`. Pure page commands live in
`app/application`, with search and hierarchy helpers in `app/lib`. Keep side
effects out of React state updater callbacks; application commands schedule
persistence after calculating and publishing the next records.

The shell accesses editor operations through `app/editor/editor-client.ts`.
That module dynamically loads BlockSuite's document runtime and editor views
separately and preloads them during startup. UI components should use this shared
loader instead of importing either implementation directly. The emoji catalog also loads only when the icon picker opens.

Use `pnpm format` to format application code, tests, scripts, and documentation.
