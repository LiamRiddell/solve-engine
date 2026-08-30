import { LayoutDashboard } from "lucide-react"
import type { LineResult } from "@bridge/engine"
import { useDiagnosticReportStore, tokenCount, opcodeCount } from "@/stores/diagnosticReport"
import { usePipelineStore } from "@/stores/pipeline"
import { useUiStore } from "@/stores/ui"
import { fmt, STAGE_COLORS } from "@bridge/utils"
import { EmptyState } from "@/components/shared/EmptyState"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { TAB_BODY } from "@/components/shared/tabChrome"

const EMPTY_STATS = { lexerTime: 0, parserTime: 0, bytecodeTime: 0, executionTime: 0, totalTime: 0 }

/** Tier badge classes — tier-1 (fresh) and tier-2 (cached) share the same "success" styling. */
const TIER_CLASS: Record<string, string> = {
  "tier-1": "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success)]/30",
  "tier-2": "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success)]/30",
  "tier-3": "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning)]/30",
  "tier-skip": "bg-destructive/10 text-destructive border-destructive/30",
}

function getTier(result: LineResult): "tier-1" | "tier-2" | "tier-3" | "tier-skip" {
  if (result.error) return "tier-skip"
  if (result.wasCached) return "tier-2"
  if (result.type === "Pending") return "tier-3"
  return "tier-1"
}

function getTierLabel(result: LineResult): string {
  if (result.error) return "Error"
  if (result.wasCached) return "Cached"
  if (result.type === "Pending") return "Pending"
  return "Fresh"
}

/**
 * Full-document overview: aggregated performance cards followed by an
 * Output-tab-style per-line result list. Ported from playground's
 * SummaryTab.vue. Click a line to jump to it in the Pipeline tab.
 */
export function SummaryTab() {
  const result = useDiagnosticReportStore((s) => s.result)
  const stats = useDiagnosticReportStore((s) => s.stats) ?? EMPTY_STATS
  const lineResults = useDiagnosticReportStore((s) => s.lineResults)
  const tokens = useDiagnosticReportStore(tokenCount)
  const opcodes = useDiagnosticReportStore(opcodeCount)
  const selectLine = usePipelineStore((s) => s.selectLine)
  const setActiveTab = useUiStore((s) => s.setActiveTab)

  if (!result) {
    return (
      <div className={TAB_BODY}>
        <EmptyState icon={LayoutDashboard} text="No summary yet" hint="Evaluate an expression to see full-document stats." />
      </div>
    )
  }

  const timingCards = [
    { label: "Lexer", value: fmt(stats.lexerTime), color: STAGE_COLORS.Lexer },
    { label: "Parser", value: fmt(stats.parserTime), color: STAGE_COLORS.Parser },
    { label: "Compiler", value: fmt(stats.bytecodeTime), color: STAGE_COLORS.Compile },
    { label: "VM Execute", value: fmt(stats.executionTime), color: STAGE_COLORS.VM },
  ]

  const total = lineResults.length
  const hits = lineResults.filter((r) => r.wasCached).length
  const cacheHitRate = total === 0 ? "—" : `${Math.round((hits / total) * 100)}%`
  const errorCount = lineResults.filter((r) => r.error).length

  function jumpTo(lineNumber: number | undefined) {
    if (lineNumber == null) return
    selectLine(lineNumber, true)
    setActiveTab("flow")
  }

  return (
    <div className={cn(TAB_BODY, "@container")}>
      <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @3xl:grid-cols-5">
        <StatCard label="Total Time" value={fmt(stats.totalTime)} color="var(--chart-6)" />
        {timingCards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} color={card.color} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @3xl:grid-cols-5">
        <StatCard label="Lines" value={String(lineResults.length)} color={STAGE_COLORS.Lexer} />
        <StatCard label="Tokens" value={String(tokens)} color={STAGE_COLORS.Lexer} />
        <StatCard label="Opcodes" value={String(opcodes)} color={STAGE_COLORS.Compile} />
        <StatCard label="Cache Hit Rate" value={cacheHitRate} color="var(--chart-5)" />
        <StatCard label="Errors" value={String(errorCount)} color={errorCount > 0 ? "var(--destructive)" : "var(--faint)"} />
      </div>

      <div className="flex flex-col gap-1">
        {lineResults.map((lr) => (
          <div
            key={lr.lineNumber}
            title={`Jump to Line ${lr.lineNumber ?? 1} in the Pipeline tab`}
            onClick={() => jumpTo(lr.lineNumber)}
            className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
          >
            <span className="text-muted-foreground w-8 shrink-0 font-mono font-bold">L{lr.lineNumber ?? 1}</span>
            <span className="min-w-0 flex-1 truncate font-mono">{lr.expression}</span>
            <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", TIER_CLASS[getTier(lr)])}>
              {getTierLabel(lr)}
            </span>
            <span
              className={cn("max-w-55 shrink-0 truncate font-mono font-semibold", lr.error ? "text-destructive" : "text-primary")}
            >
              {lr.error || lr.result || (lr.type === "Pending" ? "pending…" : "")}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One headline figure.
 *
 * The label is allowed to wrap and the value is not: a stat card whose number
 * breaks across two lines ("248.1" above "ms") stops being scannable, which is
 * the only thing it is for. The label is given a fixed two-line box so that a
 * row of cards keeps its numbers on one baseline whether the label ran to one
 * line or two.
 */
function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card size="sm">
      <div className="flex items-start justify-between gap-2 px-4">
        <span className="text-muted-foreground line-clamp-2 min-h-[2.1em] text-[10px] leading-[1.05em] font-semibold tracking-[0.12em] uppercase">
          {label}
        </span>
        <span className="mt-0.5 size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      </div>
      <div
        className="mt-1 truncate px-4 font-mono text-lg font-bold tabular-nums"
        style={{ color }}
        title={value}
      >
        {value}
      </div>
    </Card>
  )
}
