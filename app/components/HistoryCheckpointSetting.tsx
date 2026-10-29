import { useState } from "react";
import { SettingToggle } from "./SettingToggle";

const DEFAULT_CHECKPOINT_MINUTES = 60;
const validCheckpoint = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= 1440;

export function HistoryCheckpointSetting({
  minutes,
  onChange,
}: {
  minutes: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const [draft, setDraft] = useState(String(minutes ?? DEFAULT_CHECKPOINT_MINUTES));
  const commit = () => {
    const value = Number(draft);
    if (validCheckpoint(value)) {
      if (value !== minutes) onChange(value);
    }
    else setDraft(String(minutes ?? DEFAULT_CHECKPOINT_MINUTES));
  };
  return (
    <>
      <SettingToggle
        title="Save versions during long writing sessions"
        description="Versions are saved after two minutes without edits and when you leave a page. While you keep writing, also save one on a regular interval."
        checked={minutes !== null}
        onChange={(checked) =>
          onChange(
            !checked
              ? null
              : validCheckpoint(Number(draft))
                ? Number(draft)
                : DEFAULT_CHECKPOINT_MINUTES,
          )
        }
      />
      {minutes !== null && (
        <label className="setting-range">
          <span>
            <strong>Minutes between versions</strong>
            <small>Choose from 1 to 1440 minutes. The default is 60.</small>
          </span>
          <input
            type="number"
            min="1"
            max="1440"
            step="1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
          />
          <output>min</output>
        </label>
      )}
    </>
  );
}
