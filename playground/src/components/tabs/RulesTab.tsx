import { useMemo, useState } from "react"
import { Shapes, Search, AlertTriangle, Layers } from "lucide-react"
import type { PipelineStageResult, NormalizerOutput } from "@solve-js/types/DiagnosticPipelineResult"
import { useDiagnosticReportStore, expression as selectExpression } from "@/stores/diagnosticReport"
import { usePipelineStore } from "@/stores/pipeline"
import { ContextHeader } from "@/components/shared/ContextHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { TAB_BODY, TAB_ROOT } from "@/components/shared/tabChrome"

const EMPTY: NormalizerOutput = {
  type: "normalizer",
  inputTokenCount: 0,
  outputTokenCount: 0,
  fusions: [],
  rulesApplied: [],
  tokens: [],
  phrases: {},
}

type RuleShape = NonNullable<NormalizerOutput["ruleShapes"]>[number]
type Slot = RuleShape["shape"][number]

/**
 * One slot of a rule's declared shape, drawn as the token position it matches.
 *
 * A slot constrains a type, a value, both or neither, and each reads
 * differently: the type is the grammar and the value is the vocabulary. Drawing
 * them in one chip with the value underneath keeps a two-slot shape readable at
 * a glance, which is the whole point of showing it.
 */
function SlotChip({ slot, index, indexed }: { slot: Slot; index: number; indexed: boolean }) {
  const types = slot.types ?? []
  const values = slot.values ?? []
  const wildcard = types.length === 0 && values.length === 0

  return (
    <div
      className={cn(
        "flex min-w-[92px] flex-col gap-0.5 rounded-md border px-2 py-1",
        indexed ? "border-primary/40 bg-primary/5" : "border-border bg-muted/40 border-dashed",
      )}
      title={indexed ? `Slot ${index}, used by the index` : `Slot ${index}, declared but past the indexed depth`}
    >
      <span className="text-muted-foreground/70 font-mono text-[9px] uppercase">slot {index}</span>
      {wildcard ? (
        <span className="text-muted-foreground font-mono text-[11px]">any</span>
      ) : (
        <>
          {types.length > 0 && (
            <span className="font-mono text-[11px] leading-tight break-all">{types.join(" | ")}</span>
          )}
          {values.length > 0 && (
            <span className="text-muted-foreground font-mono text-[10px] leading-tight break-all">
              {values.length <= 4 ? values.join(", ") : `${values.slice(0, 4).join(", ")} +${values.length - 4}`}
            </span>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The normalizer's rules and the shape each one declared.
 *
 * The normalizer tries a rule only where its declared shape could match, so a
 * rule with a shape costs the documents that use it and a rule without one
 * costs every document. Nothing outside the engine could see which was which,
 * which is exactly the kind of cost that goes unnoticed until it is everywhere,
 * so this draws it: the shapes, the rules that declined to declare one and
 * their stated reason, and how many rules each position of the current line
 * actually admitted.
 */
export function RulesTab() {
  const stages = useDiagnosticReportStore((s) => s.stages)
  const stagesByLine = useDiagnosticReportStore((s) => s.stagesByLine)
  const lineResults = useDiagnosticReportStore((s) => s.lineResults)
  const expression = useDiagnosticReportStore(selectExpression)
  const selectedLine = usePipelineStore((s) => s.selectedLine)
  const [query, setQuery] = useState("")

  // Scoped to the selected line when there is one. The candidate counts are
  // per position of ONE line's token stream, so showing them under the whole
  // document's expression invited the reading that they covered all of it.
  const data = useMemo<NormalizerOutput>(() => {
    const forLine = selectedLine !== null ? stagesByLine[selectedLine] : undefined
    const source = forLine ?? stages
    const stage = source.find((s: PipelineStageResult) => s.stage === "normalizer")
    const out = stage?.output
    return out && out.type === "normalizer" ? out : EMPTY
  }, [stages, stagesByLine, selectedLine])

  const lineExpression =
    selectedLine !== null
      ? (lineResults.find((r) => r.lineNumber === selectedLine)?.expression ?? expression)
      : expression

  const rules = data.ruleShapes ?? []
  const counts = data.candidatesPerPosition ?? []

  const fired = useMemo(() => new Set(data.rulesApplied.map((r) => r.rule)), [data.rulesApplied])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rules
    return rules.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.shape.some(
          (s) =>
            (s.types ?? []).some((t) => t.toLowerCase().includes(q)) ||
            (s.values ?? []).some((v) => v.toLowerCase().includes(q)),
        ),
    )
  }, [rules, query])

  const shaped = rules.filter((r) => r.shape.length > 0).length
  const unshaped = rules.length - shaped

  // What the index actually saved on this line: every position would otherwise
  // try every rule, so the unindexed cost is positions x rules.
  const tried = counts.reduce((a, b) => a + b, 0)
  const unindexed = counts.length * rules.length
  const skipped = counts.filter((c) => c === 0).length

  if (rules.length === 0) {
    return (
      <EmptyState
        icon={Shapes}
        text="No rule shapes"
        hint="Evaluate an expression to see the normalizer's rules and the shapes they declare."
      />
    )
  }

  return (
    <div className={TAB_ROOT}>
      <ContextHeader
          label="Rule shapes"
          lineBadge={selectedLine !== null ? `L${selectedLine}` : "Last line"}
          expression={lineExpression}
        />
      <div className={cn(TAB_BODY, "@container")}>
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          <Card className="gap-1 p-3">
            <span className="text-muted-foreground text-[10px] uppercase">Rules</span>
            <span className="font-mono text-lg">{rules.length}</span>
          </Card>
          <Card className="gap-1 p-3">
            <span className="text-muted-foreground text-[10px] uppercase">With a shape</span>
            <span className="text-primary font-mono text-lg">{shaped}</span>
          </Card>
          <Card className="gap-1 p-3">
            <span className="text-muted-foreground text-[10px] uppercase">Tried at every token</span>
            <span className={cn("font-mono text-lg", unshaped > 0 && "text-amber-500")}>{unshaped}</span>
          </Card>
          <Card className="gap-1 p-3">
            <span className="text-muted-foreground text-[10px] uppercase">Positions skipped</span>
            <span className="font-mono text-lg">
              {skipped}
              <span className="text-muted-foreground text-xs">/{counts.length}</span>
            </span>
          </Card>
        </div>

        {counts.length > 0 && (
          <Card className="gap-2 p-3">
            <div className="flex items-center gap-1.5">
              <Layers className="size-3.5" />
              <span className="text-xs font-medium">
                Rules tried on {selectedLine !== null ? `line ${selectedLine}` : "this line"}
              </span>
              <span className="text-muted-foreground ml-auto font-mono text-[11px]">
                {tried} of {unindexed} without shapes
                {unindexed > 0 && ` — ${(unindexed / Math.max(1, tried)).toFixed(1)}x fewer`}
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-0.5">
              {counts.map((c, i) => (
                <div
                  key={i}
                  title={`Token ${i}: ${c} rule${c === 1 ? "" : "s"} tried`}
                  className={cn(
                    "w-3 rounded-sm",
                    c === 0 ? "bg-muted h-1" : c <= 3 ? "bg-primary/50" : "bg-amber-500/70",
                  )}
                  style={c === 0 ? undefined : { height: `${Math.min(28, 4 + c * 3)}px` }}
                />
              ))}
            </div>
            <p className="text-muted-foreground text-[11px]">
              One bar per token. A flat bar is a position where no rule could fire, rejected without calling one.
            </p>
          </Card>
        )}

        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by rule name, token type or trigger word"
            className="h-8 pl-7 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          {filtered.map((rule) => {
            const didFire = fired.has(rule.name)
            return (
              <Card
                key={rule.name}
                className={cn("gap-2 p-3", didFire && "border-primary/50")}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium">{rule.name}</span>
                  <span className="text-muted-foreground font-mono text-[10px]">p{rule.priority}</span>
                  {didFire && (
                    <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 text-[10px]">fired here</span>
                  )}
                  {rule.shape.length === 0 && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-500">
                      <AlertTriangle className="size-3" />
                      tried at every token
                    </span>
                  )}
                </div>

                {rule.shape.length > 0 ? (
                  <div className="flex flex-wrap items-stretch gap-1.5">
                    {rule.shape.map((slot, i) => (
                      <SlotChip key={i} slot={slot} index={i} indexed={i < rule.indexedSlots} />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-[11px] italic">
                    {rule.unshapedReason ?? "No shape declared and no reason given."}
                  </p>
                )}
              </Card>
            )
          })}
          {filtered.length === 0 && (
            <div className="text-muted-foreground p-6 text-center text-sm">No rule matches that filter.</div>
          )}
        </div>
      </div>
    </div>
  )
}
