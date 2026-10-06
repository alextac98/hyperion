import { Code } from "@phosphor-icons/react";

export function DevelopmentBlueprint() {
  return (
    <div className="development-blueprint" aria-hidden="true">
      <span className="development-blueprint-window">
        <Code size={23} />
      </span>
      <span className="development-blueprint-dimension" />
      <span className="development-blueprint-square" />
    </div>
  );
}
