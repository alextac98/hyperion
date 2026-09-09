export function HyperionMark({ small = false }: { small?: boolean }) {
  const icon = import.meta.env?.DEV ? "hyperion-icon-development-128.png" : "hyperion-icon-128.png";
  return <img className={`hyperion-mark${small ? " hyperion-mark-small" : ""}`} src={`${import.meta.env?.BASE_URL ?? "./"}brand/${icon}`} width={32} height={32} alt="" aria-hidden="true" />;
}
