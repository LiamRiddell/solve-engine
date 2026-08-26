import { createElement } from "react";
import { createRoot } from "react-dom/client";
import SolveNotepad from "../components/SolveNotepad";

/**
 * Mounts one notepad into a host element.
 *
 * Kept in its own module so `solve-embeds.ts` can `import()` it, which is what
 * keeps React, Plate and the engine out of the initial bundle for every
 * reference page.
 */
export function mountNotepad(
  host: HTMLElement,
  source: string,
  options: { incremental?: boolean } = {},
): void {
  createRoot(host).render(
    createElement(SolveNotepad, {
      initial: source,
      label: "Editable example",
      incremental: options.incremental ?? false,
    }),
  );
}
