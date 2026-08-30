import { create } from "zustand"

// Bounds stageSnapshots (below) to avoid unbounded growth over a long
// session -- every distinct line number ever viewed in the pipeline
// dropdown, across every tab/document, added an entry here that nothing
// ever removed. FIFO eviction (oldest inserted key first) mirrors
// ExpressionEngine.ts's bytecodeCache bound -- this data is purely a
// "did this line's output change since I last looked at it" cache, so
// losing the oldest entry only means one extra pulse-animation flash the
// next time that line is revisited, never a correctness issue.
const MAX_STAGE_SNAPSHOTS = 200

interface PipelineState {
  /** Currently selected line in the pipeline dropdown (null = aggregate view). */
  selectedLine: number | null
  /**
   * Line numbers whose inline detail panel is open in the editor.
   *
   * Held here rather than inside the editor so that expanding a line and
   * selecting one are the same gesture: the diagnostic panes already scope to
   * `selectedLine`, so opening a panel points every one of them at that line
   * without the editor having to know they exist.
   */
  expandedLines: number[]
  /** Whether the dropdown was manually changed by the user. */
  dropdownManuallyChanged: boolean
  /** Stage output snapshots per line for change detection. */
  stageSnapshots: Map<number, string[]>
  /** Active flamegraph filter stage label. */
  flamegraphFilter: string | null

  selectLine: (lineNumber: number | null, manual?: boolean) => void
  /** Open or close one line's inline detail panel, selecting it when opened. */
  toggleLineExpanded: (lineNumber: number) => void
  resetDropdownOverride: () => void
  saveStageSnapshot: (lineKey: number, snapshot: string[]) => void
  getStageSnapshot: (lineKey: number) => string[] | undefined
  setFlamegraphFilter: (stageLabel: string | null) => void
  clearFlamegraphFilter: () => void
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  selectedLine: null,
  expandedLines: [],
  dropdownManuallyChanged: false,
  stageSnapshots: new Map(),
  flamegraphFilter: null,

  selectLine: (lineNumber, manual = false) =>
    set((s) => ({ selectedLine: lineNumber, dropdownManuallyChanged: manual ? true : s.dropdownManuallyChanged })),
  toggleLineExpanded: (lineNumber) =>
    set((s) => {
      const open = s.expandedLines.includes(lineNumber)
      return {
        expandedLines: open ? s.expandedLines.filter((n) => n !== lineNumber) : [...s.expandedLines, lineNumber],
        // Opening a panel is also a selection, which is what keeps the panes
        // beside the editor showing the line the reader just opened.
        selectedLine: open ? s.selectedLine : lineNumber,
        dropdownManuallyChanged: open ? s.dropdownManuallyChanged : true,
      }
    }),
  resetDropdownOverride: () => set({ dropdownManuallyChanged: false }),
  saveStageSnapshot: (lineKey, snapshot) => {
    const snapshots = get().stageSnapshots
    if (!snapshots.has(lineKey) && snapshots.size >= MAX_STAGE_SNAPSHOTS) {
      const oldest = snapshots.keys().next().value
      if (oldest !== undefined) snapshots.delete(oldest)
    }
    snapshots.set(lineKey, snapshot)
  },
  getStageSnapshot: (lineKey) => get().stageSnapshots.get(lineKey),
  setFlamegraphFilter: (stageLabel) => set({ flamegraphFilter: stageLabel }),
  clearFlamegraphFilter: () => set({ flamegraphFilter: null }),
}))
