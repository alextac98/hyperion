import { useEffect, useRef, type ReactNode } from "react";

// Native modal dialogs keep background controls inert and contain keyboard focus.
export function Dialog({
  label,
  className = "",
  busy = false,
  onClose,
  children,
}: {
  label: string;
  className?: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    const closeBackdrop = (event: MouseEvent) => {
      if (event.target === dialog && !busyRef.current) closeRef.current();
    };
    dialog.addEventListener("mousedown", closeBackdrop);
    return () => {
      dialog.removeEventListener("mousedown", closeBackdrop);
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog-layer ${className}`}
      aria-label={label}
      onKeyDownCapture={(event) => {
        if (busy) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onClickCapture={(event) => {
        if (busy) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
      {busy && (
        <div className="data-operation-overlay" role="status">
          Finishing data operation…
        </div>
      )}
    </dialog>
  );
}
