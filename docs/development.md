# Development

Hyperion is an Electron desktop application using local SQLite. The installed
application requires no server, account or remote database. An opt-in browser
development server is available for UI work.

## Requirements

- Node.js 22.16 or newer (CI uses Node.js 24.21.0 LTS) and pnpm 12.4.0
- Platform build tools are only needed when creating installers: Xcode
  command-line tools on macOS, Visual Studio build tools on Windows, or the
  standard Electron packaging dependencies on Linux

Install JavaScript dependencies once:

```sh
pnpm install
pnpm dev
```

`pnpm dev`, `pnpm dev:desktop`, and `pnpm dev:electron` build Electron, start a
dedicated Vite renderer server, and open the desktop app. Each worktree or checkout
owns its development instance and data. Separate worktrees can run at the same
time, including checkouts with the same branch name; launching the same worktree
again focuses its existing instance. The window title includes the branch name.

Development state lives in the gitignored `.hyperion-dev/` directory at the
worktree root:

- Electron profile and UI preferences: `.hyperion-dev/profile/`.
- Desktop vault registry, SQLite databases, attachments and backups:
  `.hyperion-dev/desktop/`.
- Browser development data: `.hyperion-dev/browser/`.
- Renderer: the first available port starting at 3000, bound to `0.0.0.0`. The launcher
  passes the actual URL to Electron and prints it, along with the branch label and
  worktree path; Electron prints the profile and active data directory.

A new worktree starts with fresh data. Restarts preserve data in that worktree;
switching or renaming its branch also preserves it. Stop development before
switching branches in the same checkout, then restart; a running instance keeps
its original branch label. Detached HEAD uses the commit ID as its label.
Set `HYPERION_DEV_BRANCH` to override the displayed branch label, including outside
Git. This does not change the data directory or create another instance:

```sh
HYPERION_DEV_BRANCH=feature/search-review pnpm dev
```

Each new worktree starts with first-run setup and its own vault registry. The
installed app keeps its registry in `~/.config/hyperion`; new vault folders default
to its `vaults/` subdirectory. Existing single-vault locations stay in place;
legacy shared databases are split into independent folders with their source
retained for recovery. Worktree development never adopts installed-app data or
the previous global branch-development directories. Existing global development
data is left in place. Explicit test and update-preview profiles remain isolated
from worktree development.

Setup can create a vault in a chosen folder. Settings → Data → Move vault moves
only the active vault, including its backups.
Set `HYPERION_DATA_DIRECTORY` to an isolated absolute directory for disposable
data. Keep these overrides and chosen folders separate across running instances;
they bypass the default worktree data location. The application never auto-imports
browser prototype data.

To start fresh in the current worktree, stop its desktop and browser development
instances, then run:

```sh
pnpm dev:reset
```

This removes only the current worktree's `.hyperion-dev/` directory, including its
desktop profile, default vault data and backups. It refuses while a desktop or
browser instance is using those files. Vault folders and data-directory overrides
outside `.hyperion-dev/` are retained. Browser preferences start fresh the next
time its data directory is created. Removing the worktree directory also removes
its local development state.

Schema changes within an existing worktree still require a migration or a reset.
Fresh development data does not replace upgrade testing for installed users;
keep running `pnpm test:migrations` against the frozen database fixtures.

Changes under `app/` update through Vite. Restart development after changing
`electron/` so the main process and preload are rebuilt. `pnpm dev:web` starts
the full browser development environment described below. It is not a supported
standalone web product.

## Browser development

```sh
pnpm dev:web
```

Open the loopback URL printed by the launcher. This runs the same React and
BlockSuite UI with the real SQLite implementation behind a development HTTP API.
Editing, attachments, search, page history, portable vault import/export and
server-side backups use the shared data services. Native folder selection,
opening folders, database-backup restore dialogs, and app updates require Electron.
This mode is excluded from production builds.
Restart the command after changing server scripts or code under `electron/`.
HTTP requests are limited to 32 MiB including JSON/base64 encoding; use desktop
for larger imports or attachments.

The browser data directory is `.hyperion-dev/browser/` in the current worktree.
Browser development data is separate from desktop data.
Set `HYPERION_BROWSER_DATA_DIRECTORY` to an absolute
directory for disposable fixtures. The server uses that exact directory and does
not follow desktop storage-location settings. Browser UI preferences are also
namespaced by a key persisted in that data directory, even when another worktree
later reuses the same port. The key survives server restarts and branch changes;
resetting the data directory starts a fresh preference namespace.
Use a dedicated browser directory; do not point it at a running desktop instance's
database.

Only one editor tab may use an instance at a time. A second tab shows a retry
screen; closing the first releases its session. A disconnected session can be
replaced after two minutes, and the old session is then rejected. For simultaneous
agent and human editing, use separate worktrees and data directories.

Wait for **Saved to development server** before reloading or closing. Pending or
failed saves trigger the browser's leave-page warning where supported. Network
failures keep failed writes available for the existing Retry action while the tab
stays open. A browser cannot guarantee completion of asynchronous saves during
close, and there is no offline store. After restarting the server, reload the page
to establish a new session; finish saving before intentionally stopping the server.

The data directory has a `.browser-development.lock` file to prevent two browser
servers from opening it. Normal shutdown removes it. After a forced kill or crash,
verify that the recorded PID is no longer running before removing the stale lock.

For a Linux server, run the command in a persistent terminal session on that
server. Forward its printed port from your laptop, for example:

```sh
ssh -N -L 4300:127.0.0.1:3001 your-server
```

Then open `http://127.0.0.1:4300`. Use the actual server port in place of `3001`.
The server binds to `0.0.0.0` by default; the API requires an allowed same-origin
request and a per-start token. To test directly from another machine, configure
the desktop hostname and origin in `.env.local` (or an environment variable):

```sh
HYPERION_BROWSER_ORIGINS=http://your-desktop.example:3000
```

Run `pnpm dev:web`, then open that exact origin on the other machine. Only the configured origins and
loopback origins may use the API; cross-origin requests remain rejected. Multiple
origins can be comma-separated. An explicit remote origin fixes the port at 3000
so the launcher cannot silently switch away from the advertised URL. Browser
sessions still share one editor lease. The dependency cache is isolated by worktree.
HTTP supports editing and importing audio; microphone capture requires a secure
context, such as trusted HTTPS or the localhost SSH-forwarding URL above. A graphical desktop is not required for the browser server or
its API tests. Server provisioning and agent process supervision are separate.

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
- `pnpm test:blocks`: checks custom block contracts, migrations, references and retirement.
- `pnpm test:migrations`: runs the frozen-database upgrade, preservation and rollback suite.
- `pnpm test:desktop`: validates worktree isolation, development reset and renderer URL handling, plus
  SQLite persistence, migration, backup and history behavior.
- `pnpm test:browser`: tests the development HTTP API with temporary databases,
  including persistence across restart, editor leases, origin/token validation,
  operation validation and data-directory locking. Also included in `pnpm test`.
- `pnpm test:development`: launches three worktree instances and verifies separate
  renderer URLs, profiles and data, same-worktree single-instance behavior, and
  continued operation after one instance closes, plus launcher shutdown cleanup.
  Requires a graphical desktop
  session (or Xvfb on Linux).
- `pnpm test:clipboard`: runs native copy, cut, and paste against the built renderer
  and a fresh Vite development server. Verifies that copying text replaces an old
  screenshot, pastes below the source with formatting, and respects native fields
  and retained tabs. Requires a graphical desktop session (or Xvfb on Linux).
- `pnpm test`: builds the renderer and runs application behavior, database, semantic page diff, save coordinator and configuration tests.
- `pnpm lint`: checks TypeScript and React code.
- `pnpm test:integration`: builds both processes and runs the native Electron smoke test
  against a temporary isolated vault, including sidebar history, pending-edit diffs,
  read-only previews, native clipboard commands and retained-tab isolation, custom
  blocks, block dragging, columns, meetings, vault setup, native recovery dialogs
  and both restore paths; requires a graphical desktop session.

Pull requests run lint, unit tests and type checks, plus the full desktop
integration suite in a separate Ubuntu job under Xvfb. Failed desktop runs upload
their screenshots as the `desktop-integration-failures` artifact. To run the same
suite on a Linux machine without a graphical session, install Xvfb and use:

```sh
xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" pnpm test:integration
```

Run individual Electron smoke tests through
`node scripts/run-electron-test.mjs tests/blocks-smoke.mjs`. The launcher sets the
application version from `package.json` before importing the test, so the updater
can initialize in a standalone Electron process. The test process stays alive
after the last window closes to finish assertions and cleanup; tests exit
explicitly with `app.exit()` so failures return a nonzero status.

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

See [Adding a block](developer/blocks.md) for the bundled block contract and inline date implementation.
Changes to shared `blocks/` definitions also require rebuilding Electron.

## Desktop name and icon

`pnpm dev:desktop` uses the Hyperion name and approved icon. On macOS the
launcher prepares a locally signed `Hyperion.app` copy in
`node_modules/.cache/hyperion-runtime/`, so the Dock and app switcher also show
Hyperion. The installed Electron distribution remains unchanged. The copy is
regenerated when Electron, the icon, or the launcher changes.

Restart the desktop development process after changing the name or icon.
Packaged builds use the same artwork through `electron-builder.yml`.
