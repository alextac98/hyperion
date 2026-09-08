# Hyperion brand & design guidelines

Open **Settings → Appearance → Brand & design guidelines**, or visit
`http://127.0.0.1:3000/?view=brand` with the development server running.
The guide is available in the browser preview and desktop app, works offline, and includes
light/dark previews, the approved icon download, size specimens, and live controls.
Its theme preview does not change saved vault preferences. Vault editing and
history require the desktop app.

## Identity

Hyperion is a calm, personal space for connected thinking. The orbital H joins
two pillars with a continuous ribbon: an identifiable silhouette with a soft
dimensional finish. Use the approved original-color artwork on both light and
dark surfaces. The wordmark pairs the icon with “Hyperion” in the shared sans
stack, at weight 650 with slightly tight tracking.

- Keep at least one quarter of the icon width clear around the mark.
- Use the icon at 24px or larger in product UI; 16px is reserved for favicons.
- Preserve aspect ratio, colors, transparent corners, and the orbital ribbon.
- Do not redraw, recolor, stretch, add effects, or place it on busy backgrounds.
- Keep illustrations and dimensional effects in identity moments. Reading and
  editing surfaces use quiet fills, borders, and restrained shadows.

## Color and theme

The source of truth is [app/theme/tokens.css](../app/theme/tokens.css).
The application and brand page import it through `globals.css`; BlockSuite's
compatibility theme resolves the same semantic variables.

| Foundation | Value | Role |
| --- | --- | --- |
| Midnight | `#101650` | Identity depth |
| Royal blue | `#315CDE` | Signature color, light-theme primary actions |
| Cornflower | `#7DA6FF` | Dark-theme primary actions and accents |
| Blue mist | `#EDF3FF` | Light-theme informational surfaces |

Use semantic tokens in components instead of copying hex values:

| Purpose | Tokens |
| --- | --- |
| Reading canvas and panels | `--bg`, `--panel`, `--panel-strong` |
| Cards and overlays | `--surface`, `--surface-raised` |
| Text hierarchy | `--text`, `--text-soft`, `--text-faint` |
| Boundaries | `--line`, `--line-strong` |
| Primary action | `--action`, `--on-action`, `--action-hover` |
| Links and selected states | `--accent-text`, `--selected-bg` |
| Quiet informational fills | `--accent-soft` |
| Focus and indicators | `--accent` |
| Status | `--green`, `--yellow`, `--danger` and available soft fills |

Dark mode uses neutral charcoal backgrounds, borders, and text, following the
original app palette. Keep blue in accents, actions, and selected states; do
not tint the full workspace blue. Secondary and muted text use stronger contrast than the
original palette to prioritize legibility.

Keep foreground/background pairs together. Blue identifies actions and
selection; it does not replace success, warning, or destructive semantics.
Filled action buttons use white text on royal blue in light mode and near-black
text on cornflower blue in dark mode. Keep their labels and icons at full opacity.
Always pair status color with a label or meaningful icon. User-selected page
icons and document highlight colors remain personal content.

## Typography, shape, and space

Readability is the first priority. Prefer clear text, strong contrast, and room
to read over compactness or subtle styling. Never fade essential instructions.

- `--font-sans`: Inter when installed, then the native system sans stack. No
  remote font dependency. `--font-mono` is reserved for code and technical values.
- Page titles: approximately 32px / 650; section headings: 22px / 650; reading
  text: 17px / 400 with 1.65 line height; ordinary interface text: 14px / 500.
  The editor retains user-controlled reading size and width.
- Use sentence case. Use `--font-size-ui` (14px) for ordinary interface text
  and `--font-size-caption` (12px) as the minimum for compact metadata.
  Preserve readable type at narrow widths; reflow content instead of shrinking it.
- Use a 4px spacing rhythm: 4, 8, 12, 16, 24, 32. Existing compact editor/tree
  geometry may use optical adjustments.
- Radius scale: `--radius-sm` (6px), `--radius-control` (8px),
  `--radius-card` (12px), `--radius-dialog` (16px).
- Use `--shadow-sm` for raised controls and `--shadow-lg` for overlays. Organize
  ordinary content with borders and spacing.
- Use the existing Phosphor outline icons, normally 16–20px. Keep icon weight
  consistent and give icon-only controls accessible names.

## Interaction and language

Use one primary action per group. Secondary actions use neutral surfaces;
selection uses a soft blue tint. Keyboard focus must remain visible,
including on links, selects, and switches. Standard transitions are 120–180ms;
honor `prefers-reduced-motion`.

Write thoughtfully and directly. Describe what happened and a useful next step:
“No matching pages. Try another search.” Describe device storage accurately:
“Your notes are saved on this device.” Avoid hype, unexplained implementation
language, and promises the product cannot keep. Make destructive actions and
recovery options explicit.

## Assets and maintenance

- Approved master: [public/brand/hyperion-icon-master.png](../public/brand/hyperion-icon-master.png)
- Shared UI mark: [app/components/HyperionMark.tsx](../app/components/HyperionMark.tsx)
- UI raster: `public/brand/hyperion-icon-128.png`
- Web favicon: `public/favicon.png`
- Desktop resources: `build/icon.icns`, `build/icon.ico`, `build/icon.png`
- Original concept and generation prompt: `design/brand/`

To regenerate the size and packaging variants on macOS:

```sh
node scripts/build-brand-icons.mjs
```

This uses the system `sips` tool for resizing and writes PNG-backed ICNS and ICO
containers. The approved master is not modified. Native installer builds remain
the final platform check before release.

When extending the interface, reuse semantic tokens and existing control
classes, check both themes and a narrow viewport, and keep this guide's examples
consistent with the product. Do not introduce a second palette for editor menus.
