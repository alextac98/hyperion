import { Database, FileText, PencilSimple, Stack } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Composer } from "../application/navigation";
import { Dialog } from "./Dialog";

export function ComposerDialog({
  composer,
  parentTitle,
  onClose,
  onValue,
  onSubmit,
}: {
  composer: NonNullable<Composer>;
  parentTitle?: string;
  onClose: () => void;
  onValue: (value: string) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    if (composer.type === "rename") inputRef.current?.select();
  }, [composer.type]);
  return (
    <Dialog
      label={
        composer.type === "rename" ? "Rename page" : "Create " + composer.type
      }
      onClose={() => onClose()}
    >
      <form
        className="composer-dialog"
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting) return;
          setSubmitting(true);
          setError(null);
          try {
            await onSubmit(event);
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "This action could not be completed. Try again.",
            );
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="dialog-icon">
          {composer.type === "vault" ? (
            <Database size={22} />
          ) : composer.type === "rename" ? (
            <PencilSimple size={22} />
          ) : composer.type === "template" ? (
            <Stack size={22} />
          ) : (
            <FileText size={22} />
          )}
        </div>
        <h2>
          {composer.type === "rename"
            ? "Rename page"
            : composer.type === "template"
              ? composer.noteId
                ? "Save as template"
                : "New template"
              : `New ${composer.type === "vault" ? "vault" : "page"}`}
        </h2>
        <p>
          {composer.type === "vault"
            ? "A separate local knowledge space with its own notes and settings."
            : composer.type === "rename"
              ? "Give this page a clear name. Existing page links will continue to work."
              : composer.type === "template"
                ? composer.noteId
                  ? "Save this page’s content, icon, and tags for future pages and journal entries."
                  : "Create a blank reusable page, then shape its title, icon, and content in the template editor."
                : composer.parentId
                  ? `Create a page inside “${parentTitle ?? "this page"}”.`
                  : "Create a top-level page. It can hold content and child pages."}
        </p>
        <input
          ref={inputRef}
          aria-label={
            composer.type === "vault"
              ? "Vault name"
              : composer.type === "template"
                ? "Template name"
                : "Page title"
          }
          value={composer.value}
          onChange={(event) => onValue(event.target.value)}
          placeholder={
            composer.type === "vault"
              ? "Vault name"
              : composer.type === "template"
                ? "Template name"
                : "Page title"
          }
        />
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={() => onClose()}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={submitting || !composer.value.trim()}
          >
            {composer.type === "rename"
              ? "Rename"
              : composer.type === "template"
                ? composer.noteId
                  ? "Save template"
                  : "Create template"
                : "Create"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
