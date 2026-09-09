import { createPortal } from "react-dom";
import { useEffect, useId, useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  DownloadSimple,
  XCircle,
} from "@phosphor-icons/react";
import type { UpdateState } from "../../electron/updates";

export function UpdateControls({
  compact = false,
  onOpenDetails,
}: {
  compact?: boolean;
  onOpenDetails?: () => void;
}) {
  const desktop = window.hyperionDesktop;
  const tooltipId = useId();
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const showTooltip = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    setTooltipPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
      bottom: window.innerHeight - rect.top + 8,
    });
  };
  const [state, setState] = useState<UpdateState | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let received = false;
    const unsubscribe = desktop.onUpdateState((next) => {
      received = true;
      if (next.status !== "error") {
        setErrorDismissed(false);
        setError(null);
      }
      setState(next);
    });
    void desktop.updateState().then(
      (next) => {
        if (active && !received) setState(next);
      },
      () => {
        if (active)
          setError("Could not load update status. Reopen Settings to retry.");
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktop]);
  if (!desktop) return null;
  const run = (action: () => Promise<unknown>) => {
    setError(null);
    void action().catch(() =>
      setError("Could not complete the action. Please try again."),
    );
  };
  const status = state?.status;
  const busy =
    status === "checking" ||
    status === "downloading" ||
    status === "installing";
  const label =
    status === "checking"
      ? "Checking for updates…"
      : status === "available"
        ? `Hyperion ${state?.version} is available`
        : status === "downloading"
          ? `Downloading… ${state?.percent ?? 0}%`
          : status === "ready"
            ? `Hyperion ${state?.version} is ready`
            : status === "installing"
              ? "Saving and restarting…"
              : status === "error"
                ? "Update needs attention"
                : status === "disabled"
                  ? "In-app updates unavailable"
                  : state?.checkedAt
                    ? "You’re up to date"
                    : "Check for a newer version";
  const retry = () =>
    run(
      state?.retry === "download"
        ? desktop.downloadUpdate
        : state?.retry === "install"
          ? desktop.installUpdate
          : desktop.checkForUpdates,
    );
  if (compact) {
    if (
      !state ||
      !state.version ||
      (errorDismissed && (error || state.status === "error")) ||
      ["idle", "checking", "disabled"].includes(state.status)
    )
      return null;
    const actionLabel = error
      ? error + " Open update settings."
      : status === "available"
        ? `Download Hyperion ${state.version}`
        : status === "ready"
          ? `Restart to update to Hyperion ${state.version}`
          : status === "error"
            ? state.retry === "download"
              ? "An error occurred while downloading the update. Click to view details."
              : "An error occurred while updating Hyperion. Click to view details."
            : status === "idle"
              ? `${label}. Check for updates`
              : label;
    const tooltip = `${state.preview ? "Update preview · " : ""}${actionLabel}`;
    return (
      <>
        <button
          className={`update-icon-button${busy ? " is-busy" : ""}${status === "available" && !error ? " has-update" : ""}`}
          aria-describedby={tooltipPosition ? tooltipId : undefined}
          onMouseEnter={(event) => showTooltip(event.currentTarget)}
          onMouseLeave={() => setTooltipPosition(null)}
          onFocus={(event) => showTooltip(event.currentTarget)}
          onBlur={() => setTooltipPosition(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setTooltipPosition(null);
          }}
          aria-label={tooltip}
          onClick={() => {
            setTooltipPosition(null);
            if (error || status === "error") {
              setErrorDismissed(true);
              onOpenDetails?.();
            } else if (busy) onOpenDetails?.();
            else if (status === "available") run(desktop.downloadUpdate);
            else if (status === "ready") run(desktop.installUpdate);
            else run(desktop.checkForUpdates);
          }}
        >
          {status === "downloading" && (
            <svg
              className="update-progress-ring"
              viewBox="0 0 32 32"
              aria-hidden="true"
            >
              <circle
                className="update-progress-track"
                cx="16"
                cy="16"
                r="14"
              />
              <circle
                className="update-progress-value"
                cx="16"
                cy="16"
                r="14"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={
                  100 - Math.max(0, Math.min(100, state.percent ?? 0))
                }
              />
            </svg>
          )}
          {error || status === "error" ? (
            <span className="update-ready-icon" aria-hidden="true">
              <DownloadSimple size={17} />
              <XCircle className="update-error-badge" size={11} weight="fill" />
            </span>
          ) : status === "ready" || status === "installing" ? (
            <span className="update-ready-icon" aria-hidden="true">
              <ArrowClockwise size={17} />
              <CheckCircle
                className="update-ready-check"
                size={10}
                weight="fill"
              />
            </span>
          ) : (
            <DownloadSimple size={17} aria-hidden="true" />
          )}
        </button>
        {tooltipPosition &&
          createPortal(
            <div
              id={tooltipId}
              role="tooltip"
              className="update-tooltip"
              style={tooltipPosition}
            >
              {tooltip}
            </div>,
            document.body,
          )}
      </>
    );
  }
  return (
    <section className="update-controls" aria-label="Hyperion updates">
      {state?.preview && (
        <p>Update preview · Simulated download and installation</p>
      )}
      {!compact && (
        <>
          <h2>Updates</h2>
          <p>Hyperion {state?.currentVersion ?? ""}</p>
        </>
      )}
      <div role="status">
        <DownloadSimple size={16} aria-hidden="true" /> <span>{label}</span>
      </div>
      {status === "downloading" && (
        <progress
          aria-label="Update download"
          max={100}
          value={state?.percent ?? 0}
        />
      )}
      {(error || state?.message) && (
        <p role={error || status === "error" ? "alert" : undefined}>
          {error || state?.message}
        </p>
      )}
      <div className="update-actions">
        {status === "available" && (
          <button onClick={() => run(desktop.downloadUpdate)}>
            Download update
          </button>
        )}
        {status === "ready" && (
          <button onClick={() => run(desktop.installUpdate)}>
            Restart to update
          </button>
        )}
        {status === "error" && <button onClick={retry}>Retry</button>}
        {!compact &&
          status !== "disabled" &&
          !["available", "ready", "error"].includes(status ?? "") && (
            <button
              disabled={busy || !state}
              onClick={() => run(desktop.checkForUpdates)}
            >
              Check for updates
            </button>
          )}
        {(status === "error" || status === "disabled") && (
          <button onClick={() => run(desktop.downloadUpdateManually)}>
            Download manually
          </button>
        )}
      </div>
      {!compact && (
        <p>
          Updates are checked at startup and every four hours. Downloads start
          when you choose. Installation happens only when you select Restart to
          update.
        </p>
      )}
    </section>
  );
}
