import { useState, useSyncExternalStore } from "react";
import { meetingRecorder } from "../lib/meeting-recording";
export function MeetingRecordingStatus() {
  const recording = useSyncExternalStore(
    meetingRecorder.subscribe,
    meetingRecorder.getSnapshot,
  );
  const [error, setError] = useState("");
  if (!recording) return null;
  const seconds = Math.floor(recording.seconds);
  return (
    <aside
      className="meeting-recording-status"
      aria-label="Active meeting recording"
    >
      <span role="status">
        <strong>{recording.title || "Meeting"}</strong> ·{" "}
        {recording.phase === "recording"
          ? `Recording ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
          : recording.phase === "requesting"
            ? "Requesting microphone…"
            : recording.phase === "saving"
              ? "Saving audio…"
              : "Audio needs attention"}
      </span>
      {recording.phase === "recording" && (
        <button
          onClick={() => {
            setError("");
            void meetingRecorder
              .stop()
              .catch((error) => setError(String(error)));
          }}
        >
          Stop recording
        </button>
      )}
      {recording.phase === "error" && (
        <button
          onClick={() => {
            setError("");
            void meetingRecorder
              .retry()
              .catch((error) => setError(String(error)));
          }}
        >
          Retry save
        </button>
      )}
      {(recording.error || error) && (
        <span role="alert">{recording.error || error}</span>
      )}
    </aside>
  );
}
