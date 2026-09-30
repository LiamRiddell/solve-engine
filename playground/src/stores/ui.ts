import { create } from "zustand"

export type ActiveTab =
  | "tokens"
  | "summary"
  | "errors"
  | "flow"
  | "bytecode"
  | "vmtrace"
  | "perf"
  | "workers"
  | "cache"
  | "stream"
  | "dag"
  | "parselets"
  | "normalizer"
  | "rules"
  | "lines"
  | "host"

interface UiState {
  activeTab: ActiveTab
  editorCollapsed: boolean
  diagnosticsCollapsed: boolean
  /** Pre-filled filter query for the ParseletRegistryTab (set by clicking a parselet chip in the parser stage). */
  parseletFilterQuery: string
  /**
   * Whether live lookups (currency, weather) may reach the network. A document
   * opened from a shared link starts with it off, so a link cannot make a
   * reader's browser send a request they did not ask for.
   */
  liveData: boolean
  /** Keep `line N` references on their lines when lines are inserted or deleted. */
  keepLineReferences: boolean
  /** A one-line message for the header: a shared link that could not be opened, a link copied. */
  notice: string | null

  setActiveTab: (tab: ActiveTab) => void
  /** Navigate to the Parselets tab and pre-fill the filter for a specific token type. */
  focusParselet: (tokenType: string) => void
  setParseletFilterQuery: (query: string) => void
  toggleEditor: () => void
  toggleDiagnostics: () => void
  setLiveData: (on: boolean) => void
  setKeepLineReferences: (on: boolean) => void
  setNotice: (notice: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "tokens",
  editorCollapsed: false,
  diagnosticsCollapsed: false,
  parseletFilterQuery: "",
  liveData: true,
  keepLineReferences: true,
  notice: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  focusParselet: (tokenType) => set({ parseletFilterQuery: tokenType, activeTab: "parselets" }),
  setParseletFilterQuery: (query) => set({ parseletFilterQuery: query }),
  toggleEditor: () => set((s) => ({ editorCollapsed: !s.editorCollapsed })),
  toggleDiagnostics: () => set((s) => ({ diagnosticsCollapsed: !s.diagnosticsCollapsed })),
  setLiveData: (on) => set({ liveData: on }),
  setKeepLineReferences: (on) => set({ keepLineReferences: on }),
  setNotice: (notice) => set({ notice }),
}))
