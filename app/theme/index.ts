/**
 * Hyperion-owned compatibility tokens for the MIT BlockSuite editor modules.
 * This module intentionally replaces the differently licensed AFFiNE theme package.
 */
export type AffineCssVariables = Record<string, string>;
export type AffineTheme = "light" | "dark";

export const baseTheme = {
  fontSansFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const light: Record<string, string> = {
  "--affine-background-overlay-panel-color": "#ffffff",
  "--affine-background-error-color": "#fff0ef",
  "--affine-background-primary-color": "#ffffff",
  "--affine-background-secondary-color": "#f7f7f6",
  "--affine-background-tertiary-color": "#f0f0ee",
  "--affine-icon-color": "#242522",
  "--affine-icon-secondary": "#696b65",
  "--affine-border-color": "#dcded8",
  "--affine-divider-color": "#e8e8e4",
  "--affine-text-primary-color": "#242522",
  "--affine-text-secondary-color": "#696b65",
  "--affine-hover-color": "#eeeeeb",
  "--affine-hover-color-filled": "#e8e8e4",
  "--affine-placeholder-color": "#9a9c96",
  "--affine-link-color": "#4b65d1",
  "--affine-v2-layer-background-overlayPanel": "#ffffff",
  "--affine-v2-layer-insideBorder-blackBorder": "#dcded8",
  "--affine-v2-icon-primary": "#242522",
};

const dark: Record<string, string> = {
  "--affine-background-overlay-panel-color": "#252623",
  "--affine-background-error-color": "#422827",
  "--affine-background-primary-color": "#191a18",
  "--affine-background-secondary-color": "#20211f",
  "--affine-background-tertiary-color": "#292a27",
  "--affine-icon-color": "#f0f1ed",
  "--affine-icon-secondary": "#adafa8",
  "--affine-border-color": "#3d3f3a",
  "--affine-divider-color": "#30322e",
  "--affine-text-primary-color": "#f0f1ed",
  "--affine-text-secondary-color": "#adafa8",
  "--affine-hover-color": "#2a2b28",
  "--affine-hover-color-filled": "#343631",
  "--affine-placeholder-color": "#777a73",
  "--affine-link-color": "#92a5ff",
  "--affine-v2-layer-background-overlayPanel": "#252623",
  "--affine-v2-layer-insideBorder-blackBorder": "#3d3f3a",
  "--affine-v2-icon-primary": "#f0f1ed",
};

export const combinedLightCssVariables = new Proxy(light, {
  get: (target, key: string) => target[key] ?? "#696b65",
});

export const combinedDarkCssVariables = new Proxy(dark, {
  get: (target, key: string) => target[key] ?? "#adafa8",
});

const legacyAliases: Record<string, string> = {
  activeShadow: "--affine-shadow-2",
  black10: "--affine-border-color",
  blue: "--affine-link-color",
  borderColor: "--affine-border-color",
  brandColor: "--affine-link-color",
  buttonShadow: "--affine-shadow-1",
  dividerColor: "--affine-divider-color",
  fontFamily: "--affine-font-family",
  fontSansFamily: "--affine-font-family",
  fontSm: "--affine-font-sm",
  hoverColor: "--affine-hover-color",
  lineHeight: "--affine-line-height",
  shadow2: "--affine-shadow-2",
  textPrimaryColor: "--affine-text-primary-color",
  toolbarShadow: "--affine-shadow-2",
  warningColor: "--affine-background-error-color",
  white: "--affine-background-primary-color",
  zIndexPopover: "--affine-z-index-popover",
};

export function cssVar(key: string, fallback?: string) {
  const variable = key.startsWith("--")
    ? key
    : legacyAliases[key] ?? `--affine-${key.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)}`;
  return `var(${variable}${fallback ? `, ${fallback}` : ""})`;
}
