# Primary and page window evidence

Recorded remotely on this computer against Hyperion commit `6c633b411b3d78fcdb47b21d8fb256f79f1bd6be`.

[Watch or download the 27-second revised flow](page-window-flow.mp4).

![A tab preview follows the pointer outside the primary window](page-drag-preview.png)

![The primary workspace and its focused page window](page-preview.png)

The video shows an actual X11 mouse drag with a visible native tab preview, a focused page window opening without a sidebar, live edits synchronizing with the primary, returning the page to the primary, and closing all page windows with the primary. It uses the real Electron app and built renderer with an isolated temporary vault and profile on an Xvfb Linux desktop. The drag uses native XTest mouse events; the title edit uses the live editor's Yjs store. ffmpeg captures the desktop directly.

Validation: all 161 standard tests, lint, desktop type checking, native window integration, and the broader desktop smoke test pass. The native suite covers preview visibility/cancellation/focus, split panes, narrow page windows, two-way concurrent edits, vault isolation and backups, failed transfer/save, return to a hidden primary, owned window closure, and save-on-quit. A regression test verifies that navigation history updates before the next input can arrive.

Video: H.264 MP4, 2300×1080, 24 fps, approximately 27 seconds.

SHA-256: `5c8f09ff18f510bfe0321b9d9f1e157c05f1ea3807b7b0f8d3f6d41cd9a02752`

The earlier independent-window recording is retained as `window-support.mp4` for history; the linked revised video demonstrates the current behavior.
