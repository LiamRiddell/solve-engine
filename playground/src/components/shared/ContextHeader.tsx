import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"

/**
 * Sticky "what am I looking at" header shown at the top of a diagnostic
 * tab: an eyebrow label, the active line badge (`L{n}` or "All Lines"),
 * and the expression text being diagnosed.
 *
 * Ported from playground's ContextHeader.vue — used by Pipeline, Normalizer,
 * ParseletRegistry, Bytecode, and VmTrace tabs.
 */
export function ContextHeader({
  label,
  lineBadge,
  expression,
  extra,
  summary: summaryProp,
}: {
  /** Eyebrow label, e.g. "Normalizing", "Pipeline", "Parselets". */
  label: string
  /** Compact line indicator, e.g. "L3" or "All Lines". */
  lineBadge: string
  /** The active expression text being diagnosed. */
  expression: string
  extra?: ReactNode
  /**
   * What the pane is showing when it is not showing one line, e.g.
   * "25 lines, 113 tokens". Falls back to a plain line count.
   */
  summary?: string
}) {
  // A badge of the form "L3" is the only case where one expression identifies
  // what is on screen; "All Lines" and "Last line" do not.
  const isSingleLine = /^L\d+$/.test(lineBadge)
  const lineCount = expression.split(String.fromCharCode(10)).filter((l) => l.trim() !== "").length
  const summary = summaryProp ?? `${lineCount} line${lineCount === 1 ? "" : "s"}`

  return (
    <div className="bg-card sticky top-0 z-10 flex items-center gap-3 border-b px-4 py-2">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
          {label}
        </span>
        <Badge variant="secondary">{lineBadge}</Badge>
      </div>
      {/* Only when it identifies something. A pane showing the whole document
          was putting every line of it here, joined end to end and truncated,
          which told the reader nothing they could not see in the editor beside
          it and cost the width that a real caption would need. */}
      {isSingleLine ? (
        <span className="min-w-0 flex-1 truncate font-mono text-sm" title={expression}>
          {expression || "(empty expression)"}
        </span>
      ) : (
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{summary}</span>
      )}
      {extra && <div className="shrink-0">{extra}</div>}
    </div>
  )
}
