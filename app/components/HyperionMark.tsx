export function HyperionMark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`hyperion-mark${small ? " hyperion-mark-small" : ""}`}
      aria-hidden="true"
    >
      <span />
    </span>
  );
}
