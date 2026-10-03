// Browser ports can be reused by a different worktree after a server stops.
// The server persists this namespace in its data directory until a reset.
function keyFor(key: string) {
  const storageKey =
    import.meta.env?.DEV && window.hyperionBrowserDevelopment?.storageKey;
  return storageKey ? `hyperion:browser:${storageKey}:${key}` : key;
}
export const uiStorage = {
  getItem(key: string) {
    return localStorage.getItem(keyFor(key));
  },
  setItem(key: string, value: string) {
    localStorage.setItem(keyFor(key), value);
  },
};
