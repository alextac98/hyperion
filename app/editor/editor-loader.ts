function loadOnce<T>(load: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

// Document initialization must not wait for the much larger view dependency graph.
export function createEditorLoader<Runtime, View>(
  importRuntime: () => Promise<Runtime>,
  importView: () => Promise<View>,
) {
  const runtime = loadOnce(importRuntime);
  const view = loadOnce(importView);
  return {
    runtime,
    view,
    preload: () => Promise.all([runtime(), view()]).then(() => undefined),
    async open<Store>(initialize: (runtime: Runtime) => Promise<Store>) {
      const [document, renderer] = await Promise.all([
        runtime().then(async (loaded) => ({
          runtime: loaded,
          store: await initialize(loaded),
        })),
        view(),
      ]);
      return { ...document, view: renderer };
    },
  };
}
