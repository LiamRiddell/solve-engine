/**
 * Per-`ErrorCategory` display metadata, shared between the inline editor's
 * error hover popover (`EditorPane.tsx`, vanilla DOM) and the Errors tab
 * (`ErrorsTab.tsx`, JSX) — one source of truth so a given category always
 * reads the same color everywhere in the UI.
 *
 * Mirrors AGENT.md's category semantics: PARSING/VALIDATION read as "fix
 * your input", EXECUTION as a runtime failure, EXTERNAL as "not your
 * fault, a network call failed", INTERNAL/CONFIG as "this is likely an
 * engine bug" — distinct enough at a glance that the badge color alone
 * tells you which bucket you're in before reading a word.
 */
export interface ErrorCategoryMeta {
  label: string
  /** Tailwind classes for a pill badge (background tint + text color). */
  badgeClass: string
  /** Tailwind class for a small solid accent dot. */
  dotClass: string
}

export const CATEGORY_META: Record<string, ErrorCategoryMeta> = {
  PARSING: { label: "Parsing", badgeClass: "bg-[var(--warning-bg)] text-[var(--warning-text)]", dotClass: "bg-[var(--warning)]" },
  VALIDATION: { label: "Validation", badgeClass: "bg-[var(--warning-bg)] text-[var(--warning-text)]", dotClass: "bg-[var(--warning)]" },
  EXECUTION: { label: "Execution", badgeClass: "bg-[var(--destructive)]/15 text-[var(--destructive)]", dotClass: "bg-[var(--destructive)]" },
  EXTERNAL: { label: "External", badgeClass: "bg-[var(--info-bg)] text-[var(--info-text)]", dotClass: "bg-[var(--info)]" },
  INTERNAL: { label: "Internal", badgeClass: "bg-[var(--chart-1)]/15 text-[var(--chart-1)]", dotClass: "bg-[var(--chart-1)]" },
  CONFIG: { label: "Config", badgeClass: "bg-[var(--chart-1)]/15 text-[var(--chart-1)]", dotClass: "bg-[var(--chart-1)]" },
}

export const DEFAULT_CATEGORY_META: ErrorCategoryMeta = CATEGORY_META.EXECUTION

export function categoryMeta(category: string | undefined): ErrorCategoryMeta {
  return (category && CATEGORY_META[category]) || DEFAULT_CATEGORY_META
}
