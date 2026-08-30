import {
  Terminal,
  LayoutDashboard,
  RefreshCw,
  Waypoints,
  Database,
  Wrench,
  Braces,
  Zap,
  Share2,
  Settings,
  Gauge,
  Radio,
  AlertTriangle,
  Shapes,
  Timer,
} from "lucide-react"
import { useDiagnosticReportStore } from "@/stores/diagnosticReport"
import { useUiStore, type ActiveTab } from "@/stores/ui"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { OutputTab } from "@/components/tabs/OutputTab"
import { SummaryTab } from "@/components/tabs/SummaryTab"
import { ErrorsTab } from "@/components/tabs/ErrorsTab"
import { PipelineTab } from "@/components/tabs/PipelineTab"
import { BytecodeTab } from "@/components/tabs/BytecodeTab"
import { VmTraceTab } from "@/components/tabs/VmTraceTab"
import { PerfTab } from "@/components/tabs/PerfTab"
import { WorkersTab } from "@/components/tabs/WorkersTab"
import { CacheTab } from "@/components/tabs/CacheTab"
import { StreamTab } from "@/components/tabs/StreamTab"
import { DagTab } from "@/components/tabs/DagTab"
import { ParseletRegistryTab } from "@/components/tabs/ParseletRegistryTab"
import { NormalizerTab } from "@/components/tabs/NormalizerTab"
import { RulesTab } from "@/components/tabs/RulesTab"
import { LineSpeedsTab } from "@/components/tabs/LineSpeedsTab"
import { cn } from "@/lib/utils"

/**
 * The panes, grouped by where their subject sits in the pipeline.
 *
 * Fifteen panes in one flat strip was the previous arrangement, and at any
 * ordinary window width the last third of them scrolled out of sight with
 * nothing to say they existed: a tool for showing people what the engine does
 * was hiding half of what it can show. Grouping them fixes the reachability and
 * earns its keep twice, because the groups run in pipeline order, so the strip
 * reads as the journey a line of text takes.
 */
const TAB_GROUPS: {
  label: string
  tabs: { id: ActiveTab; label: string; icon: typeof Terminal; blurb: string }[]
}[] = [
  {
    label: "Result",
    tabs: [
      { id: "tokens", label: "Output", icon: Terminal, blurb: "What each line evaluated to" },
      { id: "summary", label: "Summary", icon: LayoutDashboard, blurb: "Totals for the whole document" },
      { id: "errors", label: "Errors", icon: AlertTriangle, blurb: "Lines that did not evaluate" },
    ],
  },
  {
    label: "Pipeline",
    tabs: [
      { id: "flow", label: "Pipeline", icon: Waypoints, blurb: "Every stage, start to finish" },
      { id: "normalizer", label: "Normalizer", icon: RefreshCw, blurb: "Tokens rewritten before parsing" },
      { id: "rules", label: "Rules", icon: Shapes, blurb: "Which rules can fire, and where" },
      { id: "parselets", label: "Parselets", icon: Wrench, blurb: "The parser's grammar table" },
      { id: "bytecode", label: "Bytecode", icon: Braces, blurb: "The compiled program" },
      { id: "vmtrace", label: "VM Trace", icon: Zap, blurb: "The stack, instruction by instruction" },
    ],
  },
  {
    label: "Speed",
    tabs: [
      { id: "lines", label: "Line speeds", icon: Timer, blurb: "Which line is slow, and in which stage" },
      { id: "perf", label: "Perf", icon: Gauge, blurb: "Where the document's time went" },
      { id: "cache", label: "Cache", icon: Database, blurb: "What was reused rather than recompiled" },
    ],
  },
  {
    label: "System",
    tabs: [
      { id: "dag", label: "DAG", icon: Share2, blurb: "How lines depend on each other" },
      { id: "workers", label: "Workers", icon: Settings, blurb: "Background evaluation" },
      { id: "stream", label: "Stream", icon: Radio, blurb: "Results as they arrive" },
    ],
  },
]

const TABS = TAB_GROUPS.flatMap((g) => g.tabs)

/**
 * Hosts the diagnostic and introspection tabs behind a shadcn Tabs nav.
 * Ported from playground's DiagnosticsPane.vue.
 */
export function DiagnosticsPane() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const diagnosticsCollapsed = useUiStore((s) => s.diagnosticsCollapsed)
  // Each tab remounts on every new evaluation (mirrors the Vue original's
  // `:key="dr.runId"` on the dynamically-rendered tab component), so a
  // tab's local UI state (expanded sections, collapsed groups, etc.)
  // doesn't carry over stale assumptions about the previous result's shape.
  const runId = useDiagnosticReportStore((s) => s.runId)
  const errorCount = useDiagnosticReportStore((s) => s.lineResults.filter((lr) => lr.error).length)

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col", diagnosticsCollapsed && "w-0 min-w-0 overflow-hidden")}>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList
          variant="line"
          className="bg-card/40 flex w-full flex-nowrap items-center justify-start gap-x-0.5 overflow-x-auto border-b px-2 py-1 !h-auto group-data-horizontal/tabs:h-auto"
        >
          {TAB_GROUPS.map((group, groupIndex) => (
            <div key={group.label} className="flex shrink-0 items-center gap-0.5">
              {/* Groups are spaced, not ruled. The separators drew four vertical
                  lines through a strip that is already only one row tall, which
                  read as clutter rather than as structure. */}
              {groupIndex > 0 && <span className="w-3" aria-hidden="true" />}
              {group.tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  aria-label={tab.label}
                  // Native title rather than a Tooltip: wrapping the trigger in
                  // TooltipTrigger asChild took it out of Radix Tabs' own
                  // collection, and every tab lost its active state.
                  title={`${tab.label} — ${tab.blurb}`}
                  className="h-7 flex-none gap-1.5 px-2 text-xs"
                >
                  <tab.icon className="size-4" />
                  {/* Only the active pane spells its name out. Fifteen labels at
                      once needed three rows and read as a wall; one label still
                      answers "where am I", and the title answers "what is that
                      one" without costing a row. */}
                  {activeTab === tab.id && <span>{tab.label}</span>}
                  {tab.id === "errors" && errorCount > 0 && (
                    <Badge variant="destructive" className="ml-0.5 h-4 min-w-4 justify-center px-1 text-[10px] leading-none">
                      {errorCount}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </div>
          ))}
        </TabsList>
        <TabsContent value="tokens" className="mt-0 flex min-h-0 flex-col">
          <OutputTab key={runId} />
        </TabsContent>
        <TabsContent value="summary" className="mt-0 flex min-h-0 flex-col">
          <SummaryTab key={runId} />
        </TabsContent>
        <TabsContent value="errors" className="mt-0 flex min-h-0 flex-col">
          <ErrorsTab key={runId} />
        </TabsContent>
        <TabsContent value="normalizer" className="mt-0 flex min-h-0 flex-col">
          <NormalizerTab key={runId} />
        </TabsContent>
        <TabsContent value="rules" className="mt-0 flex min-h-0 flex-col">
          <RulesTab key={runId} />
        </TabsContent>
        <TabsContent value="lines" className="mt-0 flex min-h-0 flex-col">
          <LineSpeedsTab key={runId} />
        </TabsContent>
        <TabsContent value="flow" className="mt-0 flex min-h-0 flex-col">
          <PipelineTab key={runId} />
        </TabsContent>
        <TabsContent value="cache" className="mt-0 flex min-h-0 flex-col">
          <CacheTab key={runId} />
        </TabsContent>
        <TabsContent value="parselets" className="mt-0 flex min-h-0 flex-col">
          <ParseletRegistryTab key={runId} />
        </TabsContent>
        <TabsContent value="bytecode" className="mt-0 flex min-h-0 flex-col">
          <BytecodeTab key={runId} />
        </TabsContent>
        <TabsContent value="vmtrace" className="mt-0 flex min-h-0 flex-col">
          <VmTraceTab key={runId} />
        </TabsContent>
        <TabsContent value="dag" className="mt-0 flex min-h-0 flex-col">
          <DagTab key={runId} />
        </TabsContent>
        <TabsContent value="workers" className="mt-0 flex min-h-0 flex-col">
          <WorkersTab key={runId} />
        </TabsContent>
        <TabsContent value="perf" className="mt-0 flex min-h-0 flex-col">
          <PerfTab key={runId} />
        </TabsContent>
        <TabsContent value="stream" className="mt-0 flex min-h-0 flex-col">
          <StreamTab key={runId} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
