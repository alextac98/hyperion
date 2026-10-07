import { ArrowSquareOut, ChatCircle } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";

const description =
  "Opens a public GitHub issue; a GitHub account is required. App version, OS, and architecture are included.";

export function FeedbackButton({
  role,
  onOpened,
}: {
  role?: "menuitem";
  onOpened?: () => void;
}) {
  const desktop = window.hyperionDesktop;
  const descriptionId = useId();
  const pending = useRef(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  if (!desktop) return null;

  const open = async () => {
    if (pending.current) return;
    pending.current = true;
    setOpening(true);
    setError("");
    try {
      await desktop.openFeedback();
      onOpened?.();
    } catch {
      setError("Could not open GitHub. Please try again.");
    } finally {
      pending.current = false;
      setOpening(false);
    }
  };

  return (
    <div className="feedback-action">
      <button
        type="button"
        className="feedback-button"
        role={role}
        title={description}
        aria-describedby={descriptionId}
        disabled={opening}
        onClick={() => void open()}
      >
        <ChatCircle size={17} aria-hidden="true" />
        <span>{opening ? "Opening GitHub…" : "Give feedback…"}</span>
        <ArrowSquareOut size={14} aria-hidden="true" />
      </button>
      <span id={descriptionId} hidden>
        {description}
      </span>
      {error && (
        <p className="feedback-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
