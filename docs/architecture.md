# Architecture

Hyperion is browser-first and local-first. It keeps knowledge data on the
user's device and does not depend on an application server or remote database.

## Data model

All knowledge data is accessed through the `KnowledgeRepository` interface in
`app/lib/local-database.ts`. The browser implementation stores vault metadata
in IndexedDB. BlockSuite stores each vault's Yjs editor documents and local
assets in separate IndexedDB databases.

The repository boundary can support other storage implementations in the
future. For example, a desktop shell could provide SQLite and filesystem
adapters without changing the editor and navigation surfaces.
