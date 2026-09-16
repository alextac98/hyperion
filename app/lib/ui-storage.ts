// Browser ports can be reused by a different branch after a server stops.
// Keep UI preferences separate even when two branches share that browser origin.
function keyFor(key: string) {
  const branch =
    import.meta.env?.DEV && window.hyperionBrowserDevelopment?.branch;
  return branch ? `hyperion:browser:${JSON.stringify(branch)}:${key}` : key;
}
export const uiStorage = {
  getItem(key: string) {
    return localStorage.getItem(keyFor(key));
  },
  setItem(key: string, value: string) {
    localStorage.setItem(keyFor(key), value);
  },
};
