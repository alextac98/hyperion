import { errorMessage } from "../lib/error-message";
import { FolderOpen, Plus, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { VaultRecord } from "../lib/local-database";
import { HyperionMark } from "./HyperionMark";

export function VaultSetup({
  firstRun,
  error: initialError = "",
  vaults = [],
  onClose,
  onCreate,
  onOpen,
  onChooseDirectory,
  onSuggestDirectory,
  onSelect,
}: {
  firstRun: boolean;
  error?: string;
  vaults?: VaultRecord[];
  onClose?: () => void;
  onCreate: (
    name: string,
    options: { starterNotes: boolean; directory?: string },
  ) => Promise<void>;
  onOpen?: () => Promise<void>;
  onChooseDirectory?: () => Promise<string | null>;
  onSuggestDirectory: (name: string) => Promise<string>;
  onSelect: (vaultId: string) => Promise<void>;
}) {
  const [name, setName] = useState("Hyperion");
  const [starterNotes, setStarterNotes] = useState(firstRun);
  const [directory, setDirectory] = useState<string>();
  const [suggestion, setSuggestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(errorMessage(initialError));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    let cancelled = false;
    void onSuggestDirectory(name.trim() || "Hyperion")
      .then((path) => {
        if (!cancelled) setSuggestion(path);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [name, onSuggestDirectory]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="vault-setup"
      aria-labelledby="vault-setup-title"
      aria-busy={busy}
    >
      {onClose && (
        <button
          className="icon-button vault-setup-close"
          aria-label="Close vault setup"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      )}
      <HyperionMark />
      <h1 id="vault-setup-title">
        {firstRun ? "Welcome to Hyperion" : "Create a vault"}
      </h1>
      <p className="vault-setup-intro">
        A home for your thoughts. A vault keeps your pages, files, and history
        together in a folder.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => onCreate(name.trim(), { starterNotes, directory }));
        }}
      >
        <fieldset disabled={busy}>
          <label htmlFor="vault-name">
            What would you like to call your vault?
          </label>
          <input
            id="vault-name"
            ref={input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
            autoComplete="off"
          />
          <label htmlFor="vault-location">Save location</label>
          <div className="vault-location-control">
            <output id="vault-location" title={directory ?? suggestion}>
              {directory ?? (suggestion || "Finding a home for your vault…")}
            </output>
            {onChooseDirectory && (
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    const path = await onChooseDirectory();
                    if (path) setDirectory(path);
                  })
                }
              >
                Browse…
              </button>
            )}
          </div>
          <small>
            {onChooseDirectory
              ? "Choose an empty folder. You can move your vault later in Settings."
              : "Saved on the development server. Folder browsing is available in the desktop app."}
          </small>
          <label className="vault-starter-option" htmlFor="vault-starter-notes">
            <input
              id="vault-starter-notes"
              type="checkbox"
              checked={starterNotes}
              onChange={(event) => setStarterNotes(event.target.checked)}
            />
            <span>
              Add starter notes
              <small>Three friendly pages to explore and make your own.</small>
            </span>
          </label>
          <button
            className="primary-button vault-create-button"
            disabled={!name.trim()}
            type="submit"
          >
            <Plus size={18} />
            {busy ? "Please wait…" : "Create vault"}
          </button>
        </fieldset>
      </form>
      {onOpen && (
        <div className="vault-open-option">
          <span>Already have a vault?</span>
          <button disabled={busy} onClick={() => void run(onOpen)}>
            <FolderOpen size={18} />
            Open existing vault…
          </button>
        </div>
      )}
      {vaults.length > 0 && (
        <div className="vault-recent">
          <h2>Your vaults</h2>
          {vaults.map((vault) => (
            <button
              key={vault.id}
              disabled={busy}
              onClick={() => void run(() => onSelect(vault.id))}
            >
              <FolderOpen size={17} />
              {vault.name}
            </button>
          ))}
        </div>
      )}
      {busy && (
        <p role="status" className="vault-setup-status">
          Finishing your vault operation. This may take a moment.
        </p>
      )}
      {error && (
        <p className="vault-setup-error" role="alert">
          {error}
        </p>
      )}
      <p className="vault-setup-footnote">
        {onOpen
          ? "Local to this device. No account needed."
          : "Stored on your development server."}
      </p>
    </section>
  );
}
