export function HyperionMark({ small = false }: { small?: boolean }) {
  return <img className={`hyperion-mark${small ? " hyperion-mark-small" : ""}`} src={`${import.meta.env?.BASE_URL ?? "./"}brand/hyperion-icon-128.png`} width={32} height={32} alt="" aria-hidden="true" />;
}
