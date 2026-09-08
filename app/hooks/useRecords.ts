import { useCallback, useRef, useState, type SetStateAction } from "react";

// Event handlers read the latest records, including several edits in one batch.
// Commands run outside React's replayable state updater functions.
export function useRecords<T>(initial: T[]) {
  const [records, setState] = useState(initial);
  const current = useRef(records);
  const read = useCallback(() => current.current, []);
  const replace = useCallback((value: SetStateAction<T[]>) => {
    const next = typeof value === "function" ? value(current.current) : value;
    current.current = next;
    setState(next);
  }, []);
  return [records, replace, read] as const;
}
