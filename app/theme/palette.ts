import tokenStyles from "./tokens.css?raw";

// Some editor consumers (including canvas renderers) need literal colors, not
// CSS var() references. Read both palettes from the same stylesheet as the UI.
function declarations(block: string) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value.trim()]));
}

const light = declarations(tokenStyles.match(/:root\s*\{([^}]+)\}/)?.[1] ?? "");
const dark = { ...light, ...declarations(tokenStyles.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1] ?? "") };

export function themeToken(name: string, theme: "light" | "dark" = "light"): string {
  const tokens = theme === "dark" ? dark : light;
  let value = tokens[name];
  const visited = new Set<string>();
  while (value?.startsWith("var(")) {
    if (visited.has(value)) throw new Error(`Circular brand token: ${name}`);
    visited.add(value);
    value = tokens[value.slice(4, -1)];
  }
  if (!value) throw new Error(`Unknown brand token: ${name}`);
  return value;
}
