import { useEffect, useState } from "react";
import type { VaultPreferences } from "../lib/local-database";
import {
  meetingMicrophone,
  meetingMicrophones,
  setMeetingMicrophone,
} from "../lib/meeting-preferences";
export function MeetingSettings({
  preferences,
  onPreferences,
}: {
  preferences: VaultPreferences;
  onPreferences: (patch: Partial<VaultPreferences>) => Promise<void>;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphone, setMicrophone] = useState(meetingMicrophone);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void meetingMicrophones()
        .then((devices) => {
          if (!cancelled) setDevices(devices);
        })
        .catch(() => {});
    };
    refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
    };
  }, []);
  return (
    <>
      <div className="settings-heading">
        <h2>Blocks</h2>
        <p>Configure the blocks you use in this vault.</p>
      </div>
      <h3>Meeting</h3>
      <label className="setting-field">
        <span>Default meeting tab</span>
        <select
          value={preferences.meetingDefaultTab}
          onChange={(event) =>
            void onPreferences({
              meetingDefaultTab: event.target
                .value as VaultPreferences["meetingDefaultTab"],
            })
          }
        >
          <option value="notes">Notes</option>
          <option value="transcript">Transcript &amp; recording</option>
          <option value="summary">Summary</option>
        </select>
      </label>
      <label className="setting-field">
        <span>Microphone on this device</span>
        <select
          value={microphone}
          onChange={(event) => {
            const id = event.target.value;
            setMeetingMicrophone(id);
            setMicrophone(id);
          }}
        >
          <option value="">System default</option>
          {microphone &&
            !devices.some((device) => device.deviceId === microphone) && (
              <option value={microphone}>Saved microphone (unavailable)</option>
            )}
          {devices
            .filter(
              (device) => device.deviceId && device.deviceId !== "default",
            )
            .map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
        </select>
      </label>
      <button
        disabled={loading}
        onClick={() => {
          setLoading(true);
          setError("");
          void meetingMicrophones(true)
            .then(setDevices)
            .catch((error) => setError(String(error)))
            .finally(() => setLoading(false));
        }}
      >
        {loading
          ? "Checking microphones…"
          : "Allow access & refresh microphones"}
      </button>
      {error && (
        <p role="alert" className="data-error">
          {error}
        </p>
      )}
      <div className="settings-note">
        <span>
          <strong>Recording and transcription</strong>
          <small>
            Record your microphone or import an audio file. Paste or import
            transcripts. Automatic transcription and AI summaries will be added
            later.
          </small>
        </span>
      </div>
    </>
  );
}
