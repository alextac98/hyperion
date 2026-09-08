# Development

Hyperion is an Electron desktop application using local SQLite. No application
server, account or remote database is required.

## Requirements

- Node.js 22.16 or newer and pnpm 11.1.0
- Platform build tools are only needed when creating installers: Xcode
  command-line tools on macOS, Visual Studio build tools on Windows, or the
  standard Electron packaging dependencies on Linux

Install JavaScript dependencies once:

```sh
pnpm install
pnpm dev
```

`pnpm dev` and `pnpm dev:desktop` build Electron, start the Vite renderer server,
and open the desktop app. The default database is
`~/.config/hyperion/hyperion.sqlite3`. Settings → Data can choose another folder.
Set `HYPERION_DATA_DIRECTORY` to an isolated absolute directory for development
with disposable data. The application never auto-imports browser prototype data.

Changes under `app/` update through Vite. Restart development after changing
`electron/` so the main process and preload are rebuilt. `pnpm dev:web` starts
only the renderer server; visiting it in a browser shows a desktop-only message.
It is not a supported standalone web product.

## Checks

- `pnpm check:web` checks all first-party TypeScript, including application tests.
  BlockSuite exports TypeScript source with upstream diagnostics; the checker
  excludes diagnostics located inside `node_modules`, while preserving project,
  configuration, and global errors.
- `pnpm build:web` type-checks and builds the desktop renderer assets.
- `pnpm test:app` exercises page operations, search, outlines, editor metadata
  publication (including same-turn history/close barriers), and React interactions in jsdom. Native dialog focus containment
  still requires a browser check; the DOM tests verify the modal API contract.
- `pnpm check:desktop`: checks the native boundary and data implementation types.
- `pnpm test:migrations`: runs the frozen-database upgrade, preservation and rollback suite.
- `pnpm test:desktop`: validates SQLite persistence, migration, backup and history behavior.
- `pnpm test`: builds the renderer and runs application behavior, database, semantic page diff, save coordinator and configuration tests.
- `pnpm lint`: checks TypeScript and React code.
- `pnpm test:integration`: builds both processes and runs the native Electron smoke test
  against a temporary isolated vault, including sidebar history, pending-edit diffs,
  read-only previews, native recovery dialogs and both restore paths; requires a graphical desktop session.

See [Database migration regression tests](migration-tests.md) for fixture contents,
what the migration checks verify, and how to add coverage for future releases.

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
