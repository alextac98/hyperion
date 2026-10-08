import { WarningCircle, X } from "@phosphor-icons/react";
import { errorMessage } from "../lib/error-message";

export function DataErrorNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="data-error-banner" role="alert">
      <WarningCircle className="data-error-icon" size={20} aria-hidden="true" />
      <p>{errorMessage(message)}</p>
      <button
        className="data-error-dismiss"
        aria-label="Dismiss error"
        title="Dismiss error"
        onClick={onDismiss}
      >
        <X size={16} />
      </button>
    </div>
  );
}
