import { useMemo, useState } from "react"
import { Timer, ArrowDownWideNarrow, ListOrdered } from "lucide-react"
import { useDiagnosticReportStore, expression as selectExpression } from "@/stores/diagnosticReport"
import { ContextHeader } from "@/components/shared/ContextHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { TAB_BODY, TAB_ROOT } from "@/components/shared/tabChrome"

/** The four stages a line's time is split across, in pipeline order. */
const STAGES = [
  { key: "lexerTime", label: "Lex", cls: "bg-sky-500/70" },
  { key: "parserTime", label: "Parse", cls: "bg-violet-500/70" },
  { key: "bytecodeTime", label: "Compile", cls: "bg-amber-500/70" },
  { key: "executionTime", label: "Execute", cls: "bg-emerald-500/70" },
] as const

/**
 * Format a stage timing.
 *
 * These arrive in NANOSECONDS, from the diagnostic events' `elapsedNs`. The
 * unit is chosen per value rather than fixed: a line can be tens of nanoseconds
 * or several milliseconds, and one scale for both makes the fast ones read as
 * zero and the slow ones as noise.
 */
function dur(ns: number): string {
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(2)}ms`
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(1)}µs`
  return `${ns.toFixed(0)}ns`
}

/**
 * Per-line timings, split by stage.
 *
 * The Perf tab answers "where did the whole document go"; this answers "which
 * line is slow, and in which stage". They are different questions: a document
 * can be fast overall and still have one line that stalls an editor on every
 * keystroke, and the aggregate hides exactly that.
 *
 * Sorting by duration is the default because the interesting line is almost
 * never the first one, and document order is a click away for reading a
 * document as written.
 */
export function LineSpeedsTab() {
  const lineStats = useDiagnosticReportStore((s) => s.lineStats)
  const expression = useDiagnosticReportStore(selectExpression)
  const [byDuration, setByDuration] = useState(true)

  const rows = useMemo(() => {
    const list = (lineStats ?? []).map((ls) => ({
      lineNumber: ls.lineNumber,
      total: ls.stats.totalTime,
      stats: ls.stats,
    }))
    return byDuration ? [...list].sort((a, b) => b.total - a.total) : list
  }, [lineStats, byDuration])

  const slowest = rows.reduce((m, r) => Math.max(m, r.total), 0)
  const totalAll = rows.reduce((a, r) => a + r.total, 0)
  const median = useMemo(() => {
    if (rows.length === 0) return 0
    const sorted = [...rows].map((r) => r.total).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }, [rows])

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Timer}
        text="No per-line timings"
        hint="Evaluate a document with more than one line to see where each line's time goes."
      />
    )
  }

  return (
    <div className={TAB_ROOT}>
      <ContextHeader label="Line speeds" lineBadge="All Lines" expression={expression} />
      <div className={cn(TAB_BODY, "@container")}>
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          <Card className="gap-1 p-3">
            <span className="text-muted-foreground text-[10px] uppercase">Lines</span>
            <span className="font-mono text-lg">{rows.length}</span>
          </Card>
          <Card className="gap-1 p-3">
            <span className="text-muted-foreground text-[10px] uppercase">Total</span>
            <span className="font-mono text-lg">{dur(totalAll)}</span>
          </Card>
          <Card className="gap-1 p-3">
            <span className="text-muted-foreground text-[10px] uppercase">Median line</span>
            <span className="font-mono text-lg">{dur(median)}</span>
          </Card>
          <Card className="gap-1 p-3">
            <span className="text-muted-foreground text-[10px] uppercase">Slowest line</span>
            <span className="font-mono text-lg text-amber-500">{dur(slowest)}</span>
          </Card>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setByDuration((v) => !v)}
            className="h-7 gap-1.5 text-[11px]"
          >
            {byDuration ? <ArrowDownWideNarrow className="size-3.5" /> : <ListOrdered className="size-3.5" />}
            {byDuration ? "Slowest first" : "Document order"}
          </Button>
          <div className="text-muted-foreground ml-auto flex items-center gap-3 text-[10px]">
            {STAGES.map((s) => (
              <span key={s.key} className="flex items-center gap-1">
                <span className={cn("size-2 rounded-sm", s.cls)} />
                {s.label}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          {rows.map((row) => (
            <div key={row.lineNumber} className="flex items-center gap-2">
              <span className="text-muted-foreground w-10 shrink-0 text-right font-mono text-[11px]">
                {row.lineNumber}
              </span>
              <div className="bg-muted/40 flex h-4 flex-1 overflow-hidden rounded-sm">
                {STAGES.map((s) => {
                  const v = row.stats[s.key]
                  const pct = slowest > 0 ? (v / slowest) * 100 : 0
                  if (pct <= 0) return null
                  return (
                    <div
                      key={s.key}
                      className={s.cls}
                      style={{ width: `${pct}%` }}
                      title={`Line ${row.lineNumber} — ${s.label}: ${dur(v)}`}
                    />
                  )
                })}
              </div>
              <span
                className={cn(
                  "w-16 shrink-0 text-right font-mono text-[11px]",
                  row.total >= slowest * 0.9 && rows.length > 1 && "text-amber-500",
                )}
              >
                {dur(row.total)}
              </span>
            </div>
          ))}
        </div>

        <p className="text-muted-foreground text-[11px]">
          Each bar is one line, scaled against the slowest, and split by the stage the time was spent in. A line that is
          mostly lex is long text; one that is mostly execute is doing real arithmetic.
        </p>
      </div>
    </div>
  )
}
