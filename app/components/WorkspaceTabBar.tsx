import { useEffect, useRef, type ReactNode } from "react";
import { Plus, X } from "@phosphor-icons/react";
import type {
  WorkspaceTabs,
  TabAction,
  WorkspaceTab,
} from "../application/workspace-tabs";

export function WorkspaceTabBar({
  state,
  dispatch,
  label,
  icon,
  disabled,
}: {
  state: WorkspaceTabs;
  dispatch: (action: TabAction) => void;
  label: (tab: WorkspaceTab) => string;
  icon: (tab: WorkspaceTab) => ReactNode;
  disabled: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef<string | null>(null);
  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.active]);
  return (
    <div className="workspace-tabs">
      <div
        className="workspace-tab-list"
        role="tablist"
        aria-label="Workspace tabs"
        ref={root}
      >
        {state.tabs.map((tab, index) => (
          <div
            className={`workspace-tab${state.active === tab.id ? " active" : ""}`}
            key={tab.id}
            draggable={!disabled}
            onDragStart={(event) => {
              dragging.current = tab.id;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", tab.id);
            }}
            onDragEnd={() => {
              dragging.current = null;
            }}
            onDragOver={(event) => {
              if (dragging.current && !disabled) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging.current && !disabled)
                dispatch({
                  type: "reorder",
                  id: dragging.current,
                  before: tab.id,
                });
              dragging.current = null;
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                if (!disabled) dispatch({ type: "close", id: tab.id });
              }
            }}
          >
            <button
              role="tab"
              onMouseDown={(event) => {
                if (event.button === 0) event.preventDefault();
              }}
              id={`tab-${tab.id}`}
              aria-controls={`panel-${tab.id}`}
              aria-selected={state.active === tab.id}
              tabIndex={state.active === tab.id ? 0 : -1}
              disabled={disabled}
              title={label(tab)}
              onClick={() => dispatch({ type: "focus", id: tab.id })}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % state.tabs.length;
                else if (event.key === "ArrowLeft")
                  next = (index - 1 + state.tabs.length) % state.tabs.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = state.tabs.length - 1;
                else if (event.key === "Delete") {
                  event.preventDefault();
                  dispatch({ type: "close", id: tab.id });
                  return;
                } else return;
                event.preventDefault();
                if (event.altKey)
                  dispatch({
                    type: "reorder",
                    id: tab.id,
                    before: state.tabs[next].id,
                  });
                else {
                  dispatch({ type: "focus", id: state.tabs[next].id });
                  (
                    root.current?.querySelectorAll('[role="tab"]')[
                      next
                    ] as HTMLElement
                  )?.focus();
                }
              }}
            >
              {icon(tab)}
              <span>{label(tab)}</span>
            </button>
            <button
              className="tab-close"
              disabled={disabled}
              aria-label={`Close ${label(tab)} tab`}
              title="Close tab"
              onClick={() => dispatch({ type: "close", id: tab.id })}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="tab-home"
        disabled={disabled}
        aria-label="Open Home tab"
        title="Open Home tab"
        onClick={() => dispatch({ type: "open", location: { view: "home" } })}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
