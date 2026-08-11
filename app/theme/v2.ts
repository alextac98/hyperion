export type AffineThemeKeyV2 = string;

const token = (name: string) => `var(--hyperion-bs-${name})`;

const cssVarTree = {
  button: { primary: token("button-primary") },
  database: { border: token("database-border") },
  icon: { primary: token("icon-primary"), secondary: token("icon-secondary") },
  layer: {
    background: Object.assign(token("layer-background"), {
      hoverOverlay: token("layer-background-hover"),
      overlayPanel: token("layer-background-overlay"),
      primary: token("layer-background"),
    }),
    insideBorder: {
      border: token("inside-border"),
      primaryBorder: token("inside-border"),
    },
  },
  table: {
    border: token("table-border"),
    headerBackground: {
      default: token("table-header"),
      blue: "#e8efff",
      green: "#e6f3eb",
      grey: "#eeeeec",
      orange: "#f8eadc",
      purple: "#eeeafd",
      red: "#fae6e5",
      teal: "#e2f2f1",
      yellow: "#f7f0d7",
    },
    indicator: {
      activated: token("indicator-active"),
      drag: token("indicator-drag"),
      pointerActive: token("indicator-pointer"),
    },
  },
  text: { primary: token("text-primary"), secondary: token("text-secondary") },
  tooltips: { background: token("tooltip-background"), foreground: token("tooltip-foreground") },
};

function fallbackFor(key: string) {
  if (key.includes("red")) return "#d65c58";
  if (key.includes("magenta")) return "#c15f91";
  if (key.includes("orange")) return "#c77b38";
  if (key.includes("yellow")) return "#aa8427";
  if (key.includes("green")) return "#4f8f68";
  if (key.includes("teal")) return "#3d8f8a";
  if (key.includes("blue")) return "#5575c9";
  if (key.includes("purple")) return "#7565c7";
  if (key.includes("white")) return "#ffffff";
  if (key.includes("border")) return "var(--hyperion-bs-inside-border)";
  if (key.includes("secondary") || key.includes("disable")) return "var(--hyperion-bs-text-secondary)";
  if (key.includes("background") || key.includes("layer")) return "var(--hyperion-bs-layer-background)";
  return "var(--hyperion-bs-text-primary)";
}

const cssVarLookup = (key: string, fallback?: string) => {
  const normalized = key.replaceAll("/", "-");
  return `var(--hyperion-bs-${normalized}, ${fallback ?? fallbackFor(key)})`;
};

export const cssVarV2 = Object.assign(cssVarLookup, cssVarTree);

const lightValues: Record<string, string> = {
  "edgeless/palette/black": "#1f211e",
  "edgeless/palette/white": "#ffffff",
};
const darkValues: Record<string, string> = {
  "edgeless/palette/black": "#1f211e",
  "edgeless/palette/white": "#ffffff",
};

export const lightThemeV2 = new Proxy(lightValues, { get: (target, key: string) => target[key] ?? "#6f63d9" });
export const darkThemeV2 = new Proxy(darkValues, { get: (target, key: string) => target[key] ?? "#8f83ee" });

export function themeToVar(key: string) {
  return `--hyperion-bs-${key.replaceAll("/", "-")}`;
}
