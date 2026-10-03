// Imports must finish before the editor is locked or its vault is switched.
const pending = new Set<Promise<unknown>>();
export async function trackMeetingTask<T>(
  action: () => Promise<T>,
): Promise<T> {
  const promise = Promise.resolve().then(action);
  pending.add(promise);
  try {
    return await promise;
  } finally {
    pending.delete(promise);
  }
}
export async function flushMeetingTasks() {
  while (pending.size) await Promise.allSettled([...pending]);
}
export function hasMeetingTasks() {
  return pending.size > 0;
}
