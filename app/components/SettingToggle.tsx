import { useId } from "react";

export function SettingToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputId = useId();
  return (
    <label className="setting-toggle" htmlFor={inputId}>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        id={inputId}
        aria-label={title}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i />
    </label>
  );
}
