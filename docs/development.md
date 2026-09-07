# Development

Hyperion is an Electron desktop application using local SQLite. No application
server, account or remote database is required.

Use Node.js 22.16 or newer and pnpm 11.1.0, then run:

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

- `pnpm build:web`: builds the renderer assets (the historical script name is retained).
- `pnpm check:desktop`: checks the native boundary and data implementation types.
- `pnpm test:desktop`: validates SQLite persistence, migration, backup and history behavior.
- `pnpm test`: builds the renderer and runs database, save coordinator and configuration tests.
- `pnpm lint`: checks TypeScript and React code.
- `pnpm test:integration`: builds both processes and runs the native Electron smoke test
  against a temporary isolated vault; requires a graphical desktop session.

The renderer currently uses the repository's existing `noCheck` configuration
because BlockSuite exports dependency sources with upstream type errors. Native
TypeScript checking remains strict. Do not interpret the renderer build alone as
proof of complete TypeScript coverage.
