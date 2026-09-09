# Development app icon

The H wears a large yellow construction hard hat spanning both uprights when Electron runs unpackaged,
including `pnpm dev` and the update preview. The window icon, macOS Dock icon,
and About panel share `build/icon-development.png`. Packaged apps retain the
standard release icon.

Master: `design/brand/hyperion-icon-development-master.png`.
Regenerate the 1024px runtime asset on macOS with
`node scripts/build-brand-icons.mjs`.

The development master composites a generated hat onto the original production
PNG. All pixels outside the hat overlay and the entire original alpha channel
are preserved exactly, including the transparent corners. The H, ribbon, tile,
and colors are taken directly from the original, rather than regenerated.

Hat artwork was created with the built-in image generation tool using the
approved production master as a reference. Prompt: Add one golden yellow
construction hard hat perched naturally on top of the H, spanning its upper
area, with a rounded dome, raised central ridge and short brim. Keep the white
H and orbital ribbon recognizable. Match the polished satin style.

The isolated hat was scaled uniformly in both dimensions and positioned to
cover both uprights of the original H, preserving its natural proportions.

The generated result was used only as a source for the hat. Its surrounding
pixels were discarded before compositing onto the original PNG.
