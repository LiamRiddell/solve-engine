import { useMemo } from "react"
import { Wrench, Target, ListTree as ListAlt, Milestone } from "lucide-react"
import { useDiagnosticReportStore, expression as selectExpression } from "@/stores/diagnosticReport"
import { usePipelineStore } from "@/stores/pipeline"
import { useUiStore } from "@/stores/ui"
import { ContextHeader } from "@/components/shared/ContextHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { TAB_BODY, TAB_ROOT } from "@/components/shared/tabChrome"

interface BpItem {
  tokenType: string
  bp: number
  kind: "prefix" | "infix"
  matched: boolean
}

/** Logical tiers of binding power for grouping. */
const BP_TIERS = [
  { label: "Atom", range: [0, 10] as const },
  { label: "Unary", range: [11, 40] as const },
  { label: "Factor", range: [41, 60] as const },
  { label: "Term", range: [61, 80] as const },
  { label: "Compare", range: [81, 100] as const },
  { label: "Logic", range: [101, 120] as const },
  { label: "Assign", range: [121, 200] as const },
]

function tokenMatches(p: { tokenType: string; category?: string }, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return p.tokenType.toLowerCase().includes(q) || (p.category?.toLowerCase().includes(q) ?? false)
}

/**
 * Shows all registered parselets with binding powers, highlights which
 * were matched in the last evaluation. Ported from playground's
 * ParseletRegistryTab.vue.
 */
export function ParseletRegistryTab() {
  const result = useDiagnosticReportStore((s) => s.result)
  const lineResults = useDiagnosticReportStore((s) => s.lineResults)
  const expression = useDiagnosticReportStore(selectExpression)
  const parseletRegistry = useDiagnosticReportStore((s) => s.parseletRegistry)
  const matchedParselets = useDiagnosticReportStore((s) => s.parselets) ?? []
  const selectedLine = usePipelineStore((s) => s.selectedLine)
  const filterQuery = useUiStore((s) => s.parseletFilterQuery)
  const setFilterQuery = useUiStore((s) => s.setParseletFilterQuery)

  const prefixParselets = parseletRegistry?.prefix ?? []
  const infixParselets = parseletRegistry?.infix ?? []
  const registeredCount = prefixParselets.length + infixParselets.length

  const matchedTokenTypes = useMemo(() => new Set(matchedParselets.map((p) => p.tokenType)), [matchedParselets])
  // ParseletInfo (the shape of dr.parselets) has no `prefix` field — derive
  // it from which registry list actually contains the matched token type
  // instead (the Vue original read a nonexistent `mp.prefix`, which was
  // always undefined and silently mis-labeled every matched chip "infix").
  const prefixTokenTypes = useMemo(() => new Set(prefixParselets.map((p) => p.tokenType)), [prefixParselets])

  const matchedRegistryCount = useMemo(() => {
    let count = 0
    for (const p of prefixParselets) if (matchedTokenTypes.has(p.tokenType)) count++
    for (const p of infixParselets) if (matchedTokenTypes.has(p.tokenType)) count++
    return count
  }, [prefixParselets, infixParselets, matchedTokenTypes])

  const matchedFraction = registeredCount > 0 ? `${matchedRegistryCount} / ${registeredCount} registry entries matched` : ""

  const q = filterQuery.trim().toLowerCase()
  const filteredPrefix = useMemo(() => (q ? prefixParselets.filter((p) => tokenMatches(p, q)) : prefixParselets), [prefixParselets, q])
  const filteredInfix = useMemo(() => (q ? infixParselets.filter((p) => tokenMatches(p, q)) : infixParselets), [infixParselets, q])

  const bpTierGroups = useMemo(() => {
    const raw: BpItem[] = []
    for (const p of prefixParselets) raw.push({ tokenType: p.tokenType, bp: p.bindingPower, kind: "prefix", matched: matchedTokenTypes.has(p.tokenType) })
    for (const p of infixParselets) raw.push({ tokenType: p.tokenType, bp: p.leftBindingPower, kind: "infix", matched: matchedTokenTypes.has(p.tokenType) })

    return BP_TIERS.map((tier) => ({
      label: tier.label,
      range: tier.range,
      items: raw.filter((d) => d.bp >= tier.range[0] && d.bp <= tier.range[1]).sort((a, b) => a.bp - b.bp || a.tokenType.localeCompare(b.tokenType)),
    })).filter((group) => group.items.length > 0)
  }, [prefixParselets, infixParselets, matchedTokenTypes])

  if (!result) {
    return (
      <div className={TAB_BODY}>
        <EmptyState icon={Wrench} text="No parselet data available" hint="Evaluate an expression to see the parselet registry and matched parselets" />
      </div>
    )
  }

  const activeLineBadge = selectedLine !== null ? `L${selectedLine}` : "All"
  const activeExpression =
    selectedLine !== null
      ? (lineResults.find((r) => r.lineNumber === selectedLine)?.expression ?? "")
      : (lineResults[0]?.expression ?? expression ?? "")

  return (
    <div className={TAB_ROOT}>
      <ContextHeader
        label="Parselets"
        lineBadge={activeLineBadge}
        expression={activeExpression}
        extra={
          <div className="flex items-center gap-2">
            <Input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter by token type…"
              spellCheck={false}
              className="h-7 max-w-45 text-xs"
            />
            <Badge variant="secondary">{registeredCount} registered</Badge>
          </div>
        }
      />

      <div className={TAB_BODY}>
        {/* Matched Parselets */}
        <div className="rounded-md border">
          <div className="bg-muted/50 flex items-center gap-2 border-b px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Target className="size-3.5" /> Matched Parselets
            </span>
            <span className="text-muted-foreground ml-auto text-xs">{matchedParselets.length}</span>
          </div>
          <div className="p-3">
            {matchedParselets.length === 0 ? (
              <div className="text-muted-foreground text-sm">No parselets were matched during evaluation</div>
            ) : (
              <>
                <div className="text-muted-foreground mb-1.5 font-mono text-[10px]">{matchedFraction}</div>
                <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {matchedParselets.map((mp) => (
                    <span
                      key={mp.tokenType + "-" + mp.tokenValue}
                      title={`${mp.parseletType} parselet\nToken: ${mp.tokenType}\nValue: ${mp.tokenValue}\nOffset: ${mp.tokenOffset}`}
                      className={cn(
                        "flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px]",
                        prefixTokenTypes.has(mp.tokenType)
                          ? "border-[var(--chart-1)]/30 bg-[var(--chart-1)]/10 text-[var(--chart-1)]"
                          : "border-[var(--chart-3)]/30 bg-[var(--chart-3)]/10 text-[var(--chart-3)]",
                      )}
                    >
                      <span className="text-[9px] font-bold tracking-wide uppercase opacity-80">{mp.parseletType}</span>
                      <span className="opacity-40">→</span>
                      <span className="font-bold">{mp.tokenType}</span>
                      {mp.tokenValue && <span className="max-w-30 truncate opacity-70">"{mp.tokenValue}"</span>}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Registry Table */}
        <div className="rounded-md border">
          <div className="bg-muted/50 flex items-center gap-2 border-b px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <ListAlt className="size-3.5" /> Parselet Registry
            </span>
            <span className="text-muted-foreground ml-auto text-xs">
              {filteredPrefix.length + filteredInfix.length} / {registeredCount}
            </span>
          </div>
          {filteredPrefix.length + filteredInfix.length > 0 ? (
            <div className="max-h-80 overflow-y-auto">
              <Table className="font-mono text-xs">
                <TableHeader className="bg-muted/30 sticky top-0">
                  <TableRow className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
                    <TableHead>Kind</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead className="text-right">Left BP</TableHead>
                    <TableHead className="text-right">Right BP</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPrefix.map((p) => (
                    <TableRow key={"pre-" + p.tokenType} className={cn(matchedTokenTypes.has(p.tokenType) && "bg-[var(--warning-bg)]")}>
                      <TableCell>
                        <span className="rounded bg-[var(--chart-1)]/10 px-1.5 py-0.5 text-[9px] font-bold text-[var(--chart-1)] uppercase dark:text-[var(--chart-1)]">
                          prefix
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 font-semibold",
                            matchedTokenTypes.has(p.tokenType) ? "border-[var(--warning)]/30 bg-[var(--warning-bg)] text-[var(--warning-text)]" : "text-muted-foreground",
                          )}
                        >
                          {p.tokenType}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{p.bindingPower}</TableCell>
                      <TableCell className="text-muted-foreground text-right">—</TableCell>
                      <TableCell>{p.category || "—"}</TableCell>
                      <TableCell>
                        {matchedTokenTypes.has(p.tokenType) ? (
                          <span className="rounded bg-[var(--success-bg)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--success-text)] uppercase dark:text-[var(--success-text)]">matched</span>
                        ) : (
                          <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[9px] font-bold uppercase">unused</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredInfix.map((p) => (
                    <TableRow key={"in-" + p.tokenType} className={cn(matchedTokenTypes.has(p.tokenType) && "bg-[var(--warning-bg)]")}>
                      <TableCell>
                        <span className="rounded bg-[var(--chart-3)]/10 px-1.5 py-0.5 text-[9px] font-bold text-[var(--chart-3)] uppercase dark:text-[var(--chart-3)]">infix</span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 font-semibold",
                            matchedTokenTypes.has(p.tokenType) ? "border-[var(--warning)]/30 bg-[var(--warning-bg)] text-[var(--warning-text)]" : "text-muted-foreground",
                          )}
                        >
                          {p.tokenType}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{p.leftBindingPower}</TableCell>
                      <TableCell className="text-right font-semibold">{p.rightBindingPower}</TableCell>
                      <TableCell>{p.category || "—"}</TableCell>
                      <TableCell>
                        {matchedTokenTypes.has(p.tokenType) ? (
                          <span className="rounded bg-[var(--success-bg)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--success-text)] uppercase dark:text-[var(--success-text)]">matched</span>
                        ) : (
                          <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[9px] font-bold uppercase">unused</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-muted-foreground p-3 text-sm">No parselets{filterQuery ? " matching filter" : ""}</div>
          )}
        </div>

        {/* Binding Power Tiers */}
        {bpTierGroups.length > 0 && (
          <div className="rounded-md border">
            <div className="bg-muted/50 flex items-center gap-2 border-b px-3 py-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Milestone className="size-3.5" /> Binding Power Tiers
              </span>
              <span className="text-muted-foreground ml-auto text-xs">where parselets fall</span>
            </div>
            <div className="space-y-2.5 p-3">
              <div className="text-muted-foreground text-xs">
                Binding power controls parsing precedence: <strong className="text-foreground">higher binds tighter and evaluates first</strong> — e.g.{" "}
                <code className="bg-muted rounded px-1">*</code> (binding power ~50) binds tighter than <code className="bg-muted rounded px-1">+</code> (~40), so{" "}
                <code className="bg-muted rounded px-1">2 + 3 * 4</code> parses as <code className="bg-muted rounded px-1">2 + (3 * 4)</code>.
              </div>
              {bpTierGroups.map((group) => (
                <div key={group.label}>
                  <div className="mb-1 flex items-baseline gap-1.5">
                    <span className="text-[10px] font-semibold tracking-[0.12em] uppercase">{group.label}</span>
                    <span className="text-muted-foreground font-mono text-[9px]">
                      BP {group.range[0]}–{group.range[1]}
                    </span>
                    <span className="text-muted-foreground ml-auto font-mono text-[9px]">{group.items.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.items.map((item) => (
                      <span
                        key={item.kind + ":" + item.tokenType}
                        title={`${item.kind} ${item.tokenType}: BP ${item.bp}${item.matched ? " ✓ matched" : ""}`}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px]",
                          item.kind === "prefix"
                            ? "border-[var(--chart-1)]/30 bg-[var(--chart-1)]/10 text-[var(--chart-1)]"
                            : "border-[var(--chart-3)]/30 bg-[var(--chart-3)]/10 text-[var(--chart-3)]",
                          item.matched && "border-[var(--warning)]/40 bg-[var(--warning-bg)] text-[var(--warning-text)]",
                        )}
                      >
                        <span className="font-bold">{item.tokenType}</span>
                        <span className="opacity-60">{item.bp}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
