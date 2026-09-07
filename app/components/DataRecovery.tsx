import { useEffect, useState } from "react";
import { requireDesktop } from "../platform/runtime";
import { dataOperation } from "../lib/data-operations";
export function DataRecovery({ onHistory }: { onHistory: () => void }) {
  const [backups, setBackups] = useState<Array<{ name: string; path: string }>>([]);
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const refresh = () => requireDesktop().listBackups().then(setBackups);
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, []);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); setMessage(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <div className="data-recovery"><h3>Backups and history</h3><p>Automatic backups run at startup and daily while Hyperion is open. The latest 10 are retained. Manual backups are kept.</p><div className="recovery-actions"><button disabled={busy} onClick={() => void run(async () => { const backup = await dataOperation(() => requireDesktop().createBackup()); setMessage(`Backup verified: ${backup.path}`); await refresh(); })}>Back up now</button><button disabled={busy} onClick={() => void run(() => requireDesktop().showBackupFolder())}>Open backup folder</button><button disabled={busy} onClick={() => void run(async () => { const result = await dataOperation(() => requireDesktop().restoreBackup()); if (result) setMessage(`Backup restored to ${result.directory}. Use the storage folder chooser to open it. Your current database remains active.`); })}>Restore database backup…</button><button onClick={onHistory}>Browse page history</button></div><p>{backups.length} database backups available. Copy backups to another device or drive to protect against disk loss.</p>{message && <p role="status">{message}</p>}{error && <p className="data-error" role="alert">{error}</p>}</div>;
}
