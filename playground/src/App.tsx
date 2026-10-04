import { useEffect } from "react"
import { EditorPane } from "@/components/EditorPane"
import { HeaderBar } from "@/components/HeaderBar"
import { StatusBar } from "@/components/StatusBar"
import { DiagnosticsPane } from "@/components/DiagnosticsPane"
import { usePipelineStore } from "@/stores/pipeline"
import { useTabsStore } from "@/stores/tabsStore"
import { useUiStore } from "@/stores/ui"
import { SHARE_PREFIX, readShareFragment } from "@bridge/share"

/**
 * Open the document a shared link carries, once, at start-up. Live data is
 * switched off before the tab opens, so the first evaluation of a shared note
 * fetches nothing; the reader turns it on from the header. A link that cannot
 * be read leaves the playground as it was and says why.
 */
function openSharedDocument(): void {
  const hash = window.location.hash
  if (!hash.startsWith(SHARE_PREFIX)) return
  void readShareFragment(hash).then((shared) => {
    const ui = useUiStore.getState()
    if (!shared.ok) {
      ui.setNotice(shared.message)
      return
    }
    ui.setLiveData(false)
    useTabsStore.getState().openDocumentSet([{ title: "Shared document", content: shared.text }])
    ui.setNotice("Opened from a link, with live data off. Turn it on from the header to fetch.")
  })
}
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"

/**
 * Header/status chrome, the editor/diagnostics split, and the
 * Escape-clears-flamegraph-filter shortcut. The split is built on
 * react-resizable-panels (via the shadcn-style ResizablePanelGroup/Panel/
 * Handle wrappers in components/ui/resizable.tsx) rather than a hand-rolled
 * mousedown/mousemove drag handler — same drag-to-resize behavior, but also
 * gets keyboard-accessible resizing (focus the handle, arrow keys) for
 * free. Panel `id`s are set explicitly (not left to the library's
 * auto-generated ones) since they're a stable anchor if layout persistence
 * (`useDefaultLayout`) is ever added later.
 */
function App() {
  useEffect(openSharedDocument, [])

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape" && usePipelineStore.getState().flamegraphFilter !== null) {
        e.preventDefault()
        usePipelineStore.getState().clearFlamegraphFilter()
      }
    }
    document.addEventListener("keydown", onKeydown)
    return () => document.removeEventListener("keydown", onKeydown)
  }, [])

  return (
    <div className="flex h-screen flex-col">
      <HeaderBar />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 overflow-hidden">
        <ResizablePanel id="editor" defaultSize="50" minSize="30" className="flex min-h-0 flex-col">
          <EditorPane />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="diagnostics" defaultSize="50" minSize="20" className="flex min-h-0 flex-col">
          <DiagnosticsPane />
        </ResizablePanel>
      </ResizablePanelGroup>
      <StatusBar />
    </div>
  )
}

export default App
