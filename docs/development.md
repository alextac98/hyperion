# Development

Hyperion has web and desktop targets built from one shared React application.
Neither target requires an application server, account system, or remote
database.

## Requirements

- Node.js 22.13 or newer and npm
- Platform build tools are only needed when creating installers: Xcode
  command-line tools on macOS, Visual Studio build tools on Windows, or the
  standard Electron packaging dependencies on Linux

Install JavaScript dependencies once:

```sh
npm install
```

## Web development

```sh
npm run dev:web
```

This starts Vite at `http://127.0.0.1:3000`. The web target stores all data in
the browser's IndexedDB databases.

## Desktop development

```sh
npm run dev:desktop
```

The command compiles the Electron main and preload processes, starts Vite, and
opens the shared app in Electron's bundled Chromium. The default database is
`~/.config/hyperion/hyperion.sqlite3`. Use
Settings → Data → SQLite storage folder to migrate to or open another folder.

Changes under `app/` update through Vite. Restart `npm run dev:desktop` after
changing files under `electron/` so the trusted processes are recompiled.

## Checks

- `npm run build:web` type-checks and builds the portable web assets.
- `npm run check:desktop` type-checks Electron's main and preload processes.
- `npm run test:desktop` exercises SQLite persistence and storage migration.
- `npm run lint` checks TypeScript and React code with ESLint.
- `npm test` builds the web target and validates both target configurations.

See [Building](./building.md) for production packages.
