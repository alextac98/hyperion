/**
 * Hyperion-owned compatibility tokens for the MIT BlockSuite editor modules.
 * This module intentionally replaces the differently licensed AFFiNE theme package.
 */
import { themeToken } from "./palette";

export type AffineCssVariables = Record<string, string>;
export type AffineTheme = "light" | "dark";

export const baseTheme = {
  fontSansFamily: "var(--font-sans)",
};

const semanticVariables: Record<string, string> = {
  "--affine-background-overlay-panel-color": "var(--surface-raised)",
  "--affine-background-error-color": "var(--danger-soft)",
  "--affine-background-primary-color": "var(--bg)",
  "--affine-background-secondary-color": "var(--panel)",
  "--affine-background-tertiary-color": "var(--panel-strong)",
  "--affine-icon-color": "var(--text)",
  "--affine-icon-secondary": "var(--text-soft)",
  "--affine-border-color": "var(--line-strong)",
  "--affine-divider-color": "var(--line)",
  "--affine-text-primary-color": "var(--text)",
  "--affine-text-secondary-color": "var(--text-soft)",
  "--affine-hover-color": "var(--hover)",
  "--affine-hover-color-filled": "var(--active)",
  "--affine-placeholder-color": "var(--text-faint)",
  "--affine-link-color": "var(--accent)",
  "--affine-v2-layer-background-overlayPanel": "var(--surface-raised)",
  "--affine-v2-layer-insideBorder-blackBorder": "var(--line-strong)",
  "--affine-v2-icon-primary": "var(--text)",
};

function resolvedVariables(theme: AffineTheme) {
  return new Proxy(semanticVariables, {
    get: (target, key: string) => themeToken((target[key] ?? "var(--text-soft)").slice(4, -1), theme),
  });
}
export const combinedLightCssVariables = resolvedVariables("light");
export const combinedDarkCssVariables = resolvedVariables("dark");

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
