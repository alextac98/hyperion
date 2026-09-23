/** Electron adds its IPC channel to rejected errors; keep that out of UI copy. */
export function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error: /, "")
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
