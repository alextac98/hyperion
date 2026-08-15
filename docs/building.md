# Building Hyperion

Both deliverables use the same source under `app/`. Run `pnpm install` before
the first build.

## Web app

```sh
pnpm build:web
```

The deployable static files are written to `dist/`. Preview them locally with:

```sh
pnpm preview
```

The web build is static and has no backend. Knowledge records, editor documents,
and assets remain in that browser's IndexedDB storage.

## Desktop app

Install the platform's normal packaging tools, then run:

```sh
pnpm build:desktop
```

The command builds the shared web assets and Electron processes, then uses
electron-builder to create the installers supported by the current OS. Outputs
are written under `release/`. Electron bundles a known Chromium runtime, so the
desktop editor does not vary with an operating system's installed webview.

Desktop packages must be built on each target operating system unless a
cross-compilation pipeline is deliberately configured. Code signing and
notarization credentials are not stored in this repository; provide them using
electron-builder's platform signing environment variables in the release
pipeline.

To create an unpacked application for quick local inspection, first build the
web and Electron code and then ask electron-builder for a directory target:

```sh
pnpm build:web
pnpm build:electron
pnpm exec electron-builder --dir
```

## Desktop storage behavior

The first run creates:

```text
~/.config/hyperion/hyperion.sqlite3
```

Users can choose another folder under Settings → Data. Hyperion copies the
current database when the selected folder is empty. Selecting a folder that
already has `hyperion.sqlite3` opens that database instead. The SQLite file is
self-contained: it includes metadata, rich editor state, and embedded assets.
Back up the file only while Hyperion is closed, or use the in-app vault export.

The small `~/.config/hyperion/storage-location` file remembers a custom folder.
Removing that pointer makes the next launch use the default folder again; it
does not delete either database.

## Release verification

Before packaging a release, run:

```sh
pnpm test
pnpm lint
pnpm check:desktop
pnpm test:desktop
```

For a signed release, also install the produced package on a clean OS account,
create and edit a note, attach an asset, change the storage folder, relaunch,
and verify the data is still present.
