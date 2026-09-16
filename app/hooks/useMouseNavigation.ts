import { useEffect, useRef } from "react";
import {
  NavigationHistory,
  type NavigationDirection,
  type NavigationLocation,
} from "../application/navigation-history";

type Options = {
  vaultId: string;
  loading: boolean;
  location: NavigationLocation;
  isBlocked: () => boolean;
  isAvailable: (location: NavigationLocation) => boolean;
  onNavigate: (location: NavigationLocation) => void;
};

export function useMouseNavigation(options: Options) {
  const history = useRef(new NavigationHistory());
  const scope = useRef<string | null>(null);

  useEffect(() => {
    if (options.loading || scope.current !== options.vaultId) {
      history.current = new NavigationHistory();
      scope.current = options.vaultId;
    }
    if (!options.loading) history.current.visit(options.location);

    const navigate = (direction: NavigationDirection) => {
      if (
        options.loading ||
        options.isBlocked() ||
        document.querySelector("dialog[open]")
      )
        return;
      const next = history.current.move(direction, options.isAvailable);
      if (next) options.onNavigate(next);
    };
    const mouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      // Cancel Chromium's document navigation even at a history boundary.
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "auxclick")
        navigate(event.button === 3 ? "back" : "forward");
    };
    window.addEventListener("mousedown", mouse, true);
    window.addEventListener("mouseup", mouse, true);
    window.addEventListener("auxclick", mouse, true);
    const unsubscribe = window.hyperionDesktop?.onNavigate(navigate);
    return () => {
      window.removeEventListener("mousedown", mouse, true);
      window.removeEventListener("mouseup", mouse, true);
      window.removeEventListener("auxclick", mouse, true);
      unsubscribe?.();
    };
  }, [options]);
}
