# Architecture

Hyperion is a local-first application with a shared React product surface and
explicit platform adapters. The web and desktop builds use the same editor,
navigation, domain records, backup format, and repository contract. Platform
code decides how those records and BlockSuite documents are persisted.

```text
app/                         shared product UI and domain behavior
├── editor/                  shared BlockSuite editor integration
├── lib/local-database.ts    records, repository contract, web IndexedDB adapter
└── platform/
    ├── runtime.ts           web/desktop composition root and capabilities
    └── desktop/             Electron repository and editor-storage clients

electron/                    desktop-only trusted boundary
├── main.ts                  window, IPC allowlist, dialogs, native services
├── preload.cts              narrow context-isolated renderer bridge
└── database.ts              SQLite, storage migration, documents, and assets
```

The composition root is intentionally small. A later mobile shell can provide
the same `KnowledgeRepository`, editor document source, blob source, and
capability services without forking `HyperionApp`.

## Platform behavior

| Concern | Web | Desktop |
| --- | --- | --- |
| Shell | Browser/Vite | Electron with bundled Chromium |
| Knowledge records | IndexedDB | SQLite |
| BlockSuite/Yjs state | IndexedDB | SQLite BLOB rows |
| Embedded assets | IndexedDB | SQLite BLOB rows |
| Storage location | Browser-managed | User-selectable folder |
| Native local AI | Unavailable | Native capability boundary |

`app/platform/runtime.ts` is the only target-selection point. It detects the
Electron preload bridge and supplies the appropriate repository and editor sources.
Shared UI code must use that runtime or an injected interface instead of
calling native APIs directly.

## Desktop data

The native layer creates `hyperion.sqlite3` in `~/.config/hyperion` by default.
It contains vaults, notes, collections, preferences, Yjs updates, and assets.
The Data settings screen can select another folder. When the target has no
Hyperion database, the native layer copies the existing database with SQLite's
online backup API before switching. When the target already contains
`hyperion.sqlite3`, Hyperion opens that existing database. The selected folder
is remembered in `~/.config/hyperion/storage-location`.

SQLite access stays in Electron's main process. The renderer receives typed
records or base64-encoded document and asset payloads through an explicit
preload API; it never receives arbitrary filesystem, Node.js, or SQL access.
Context isolation and Chromium's renderer sandbox remain enabled, navigation
is restricted to Hyperion's own content, and IPC calls validate their sender.

## Data model

All knowledge data uses the `KnowledgeRepository` interface in
`app/lib/local-database.ts`. Pages form the Organize hierarchy through
`NoteRecord.parentId`, while `NoteRecord.sortOrder` preserves sibling order.
Permanent note IDs keep page links stable through moves and renames. Previous
titles live in `aliases`, and inline and manual links both target IDs.

The desktop tables keep an indexed ID, vault ID, and sorting fields alongside
the complete JSON record. This preserves backup compatibility while allowing
schema-independent record evolution. Editor documents remain Yjs updates, so
the editor semantics are identical across targets.

## Desktop-only capabilities

`platformRuntime.capabilities` distinguishes native features from portable
features. A native local-AI service boundary and status command now exist so a
future speech-to-text or text-to-speech provider can run outside the webview
without changing shared UI code. No model or voice engine is bundled yet; the
status API reports that honestly. Add providers behind this native boundary,
not directly inside React components.
