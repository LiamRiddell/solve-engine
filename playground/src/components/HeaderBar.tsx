import { Activity } from "lucide-react"
import { useDiagnosticReportStore } from "@/stores/diagnosticReport"
import { fmt } from "@bridge/utils"
import { BrandWordmark } from "@/components/shared/BrandWordmark"
import { cn } from "@/lib/utils"

/**
 * Where the wordmark points: the documentation site, which sits one level
 * above the playground's own base path.
 *
 * Derived rather than hardcoded because the base is only known at build time.
 * The deploy workflow passes `/<repo>/playground/`, so stripping the trailing
 * segment gives `/<repo>/`. Under `vite dev` the base is `/` and there is no
 * documentation site on this origin, so it resolves to the playground root and
 * the link is a no-op rather than a broken URL.
 */
const DOCS_HOME = import.meta.env.BASE_URL.replace(/playground\/?$/, "") || "/"

/** Top app header — brand mark, live pipeline timing readout. */
export function HeaderBar() {
  const status = useDiagnosticReportStore((s) => s.status)
  const result = useDiagnosticReportStore((s) => s.result)
  const stats = useDiagnosticReportStore((s) => s.stats)

  return (
    <header className="bg-background flex h-13 shrink-0 items-center gap-4 border-b px-4 select-none">
      <div className="flex flex-none items-center gap-2.5">
        <a
          href={DOCS_HOME}
          title="Back to the Solve documentation"
          className="focus-visible:ring-ring/50 rounded-sm transition-opacity hover:opacity-70 focus-visible:ring-[3px] focus-visible:outline-none"
        >
          <BrandWordmark className="text-foreground text-xl" />
        </a>
        <span className="text-muted-foreground border-border rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
          Playground
        </span>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div
          className={cn(
            "border-border bg-card text-muted-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-medium tabular-nums opacity-70",
            status === "busy" && "border-primary/30 text-primary opacity-100",
          )}
        >
          <Activity className={cn("size-3", status === "busy" && "animate-pulse")} />
          {result ? fmt(stats?.totalTime ?? 0) : "0 µs"}
        </div>
      </div>

      {/* Balances the fixed-width left group so the timing pill stays visually centered. */}
      <div className="flex-none basis-[13rem]" aria-hidden="true" />
    </header>
  )
}
