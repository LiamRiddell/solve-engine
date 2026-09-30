import { Activity, Link2, Wifi, WifiOff } from "lucide-react"
import { useDiagnosticReportStore } from "@/stores/diagnosticReport"
import { useTabsStore } from "@/stores/tabsStore"
import { useUiStore } from "@/stores/ui"
import * as engineService from "@/stores/engine"
import { fmt } from "@bridge/utils"
import { makeShareFragment } from "@bridge/share"
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

/**
 * Copy a link that opens the active tab's document. The document travels in
 * the URL fragment, which a browser never sends to a server, so sharing a note
 * uploads it nowhere; the link opens with live data off (see App.tsx).
 */
async function shareActiveDocument(): Promise<void> {
  const { tabs, activeTabId } = useTabsStore.getState()
  const text = tabs.find((t) => t.id === activeTabId)?.text ?? ""
  const setNotice = useUiStore.getState().setNotice
  try {
    const fragment = await makeShareFragment(text)
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${fragment}`
    window.history.replaceState(null, "", fragment)
    try {
      await navigator.clipboard.writeText(url)
      setNotice("Link copied. It opens this document with live data off.")
    } catch {
      setNotice("The link is in the address bar; copy it from there.")
    }
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error))
  }
}

/** Turn live lookups on or off, and evaluate the active tab again under the new setting. */
function setLiveData(on: boolean): void {
  useUiStore.getState().setLiveData(on)
  useUiStore.getState().setNotice(null)
  const { tabs, activeTabId } = useTabsStore.getState()
  const text = tabs.find((t) => t.id === activeTabId)?.text
  if (text !== undefined) engineService.evaluate(text, activeTabId)
}

/** Top app header: brand mark, live pipeline timing readout, live data and sharing. */
export function HeaderBar() {
  const status = useDiagnosticReportStore((s) => s.status)
  const result = useDiagnosticReportStore((s) => s.result)
  const stats = useDiagnosticReportStore((s) => s.stats)
  const liveData = useUiStore((s) => s.liveData)
  const notice = useUiStore((s) => s.notice)

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
        <span className="text-muted-foreground border-border rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
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

      <div className="flex flex-none basis-[13rem] items-center justify-end gap-2">
        {notice && (
          <span role="status" className="text-muted-foreground max-w-[18rem] truncate text-[11px]" title={notice}>
            {notice}
          </span>
        )}
        <button
          type="button"
          onClick={() => setLiveData(!liveData)}
          aria-pressed={liveData}
          title={liveData ? "Live data is on: currency and weather lines fetch. Click to turn it off." : "Live data is off: currency and weather lines do not fetch. Click to turn it on."}
          className={cn(
            "border-border flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
            liveData ? "text-muted-foreground" : "border-amber-500/40 text-amber-500",
          )}
        >
          {liveData ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
          {liveData ? "Live data" : "Live data off"}
        </button>
        <button
          type="button"
          onClick={() => void shareActiveDocument()}
          title="Copy a link that carries this document in the URL, so nothing is sent to a server"
          className="border-border text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
        >
          <Link2 className="size-3" />
          Share
        </button>
      </div>
    </header>
  )
}
