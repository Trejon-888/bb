import { useLayoutEffect } from "react";
import "./nexus.css";

const ROOT_ATTRIBUTE = "data-ix-shell";
let holders = 0;

export function useNexusRootAttribute(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    holders += 1;
    root.setAttribute(ROOT_ATTRIBUTE, "nexus");
    return () => {
      holders -= 1;
      if (holders === 0) root.removeAttribute(ROOT_ATTRIBUTE);
    };
  }, []);
}
