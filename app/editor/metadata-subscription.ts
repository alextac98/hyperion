// Publish the final projection when navigating away, even inside the debounce window.
export function observeMetadata<T>(
  subscribe: (changed: () => void) => () => void,
  read: () => T,
  publish: (metadata: T) => void,
  delay = 220,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    publish(read());
  };
  const unsubscribe = subscribe(() => {
    if (delay === 0) {
      publish(read());
      return;
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  });
  return () => {
    unsubscribe();
    flush();
  };
}
