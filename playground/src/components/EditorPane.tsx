import { useEffect, useRef } from "react"
import { Code2 } from "lucide-react"
import {
  EditorView,
  keymap,
  placeholder,
  Decoration,
  WidgetType,
  ViewPlugin,
  type ViewUpdate,
  type DecorationSet,
} from "@codemirror/view"
import { EditorState, StateField, RangeSetBuilder, RangeSet, StateEffect } from "@codemirror/state"
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete"
import { basicSetup } from "codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { oneDark } from "@codemirror/theme-one-dark"
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine"
import { LanguageService } from "@solve-js/language/LanguageService"
import { tokenClassName } from "@solve-js/language/tokenClassName"
import { completionItemToOption } from "@solve-js/language/adapters/codemirror"
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins"
import { OSRS_PACKAGE } from "@solve-js-examples/osrs/OsrsPackage"
import type { LineResult } from "@bridge/engine"
import { prepareEvaluationInput } from "@bridge/engineShared"
import * as engineService from "@/stores/engine"
import { useDiagnosticReportStore } from "@/stores/diagnosticReport"
import { useEditorStore } from "@/stores/editor"
import { usePipelineStore } from "@/stores/pipeline"
import { useTabsStore } from "@/stores/tabsStore"
import { useUiStore } from "@/stores/ui"
import { TabBar } from "@/components/TabBar"
import { ExamplesMenu } from "@/components/ExamplesMenu"
import { cn } from "@/lib/utils"
import { categoryMeta } from "@/lib/errorCategory"

/* ── Inline Result Widget ─────────────────────────────────────────────── */

/** Structured error detail carried by an error-type inline result — see `LineResult`'s own error fields. */
export interface ErrorDetail {
  code?: string
  category?: string
  message: string
  expected?: string
  found?: string
  suggestion?: string
  recoverable?: boolean
}


/**
 * Build a detail row (label + value) for the error popover, or nothing if
 * `value` is unset — most `EngineError`s today only populate `message`
 * (see AGENT.md: "expected/found/suggestion exist but almost nothing
 * populates them yet"), so this renders however much detail is actually
 * there rather than always reserving three rows.
 */
function popoverRow(label: string, value: string | undefined, accent = false): HTMLElement | null {
  if (!value) return null
  const row = document.createElement("div")
  row.className = "flex gap-1.5 text-[11px] leading-snug"
  const dt = document.createElement("span")
  dt.className = "shrink-0 font-medium text-muted-foreground/80 w-16"
  dt.textContent = label
  const dd = document.createElement("span")
  dd.className = accent ? "font-mono text-foreground" : "text-foreground/90"
  dd.textContent = value
  row.append(dt, dd)
  return row
}

/**
 * The hover popover's contents — category badge + code, message, then
 * whichever of expected/found/suggestion are actually populated.
 * Appended to `document.body` (not as a child of the badge) and positioned
 * via `getBoundingClientRect()` on show, so it's never clipped by the
 * editor scroller's `overflow: auto`.
 */
function buildErrorPopover(detail: ErrorDetail): HTMLDivElement {
  const meta = categoryMeta(detail.category)
  const popover = document.createElement("div")
  popover.className =
    "os-error-popover fixed z-50 w-80 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg " +
    "p-3 flex flex-col gap-2 pointer-events-auto opacity-0 -translate-y-1 transition-all duration-100"
  popover.style.visibility = "hidden"

  const header = document.createElement("div")
  header.className = "flex items-center gap-1.5"
  const badge = document.createElement("span")
  badge.className = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] uppercase tracking-wide ${meta.badgeClass}`
  const dot = document.createElement("span")
  dot.className = `size-1.5 rounded-full ${meta.dotClass}`
  badge.append(dot, document.createTextNode(meta.label))
  header.appendChild(badge)
  if (detail.code) {
    const code = document.createElement("span")
    code.className = "font-mono text-[10px] text-muted-foreground truncate"
    code.textContent = detail.code
    header.appendChild(code)
  }
  if (detail.recoverable === false) {
    const badBug = document.createElement("span")
    badBug.title = "Engine-internal — likely worth reporting, not a syntax fix"
    badBug.className = "ml-auto text-[10px] text-muted-foreground/70"
    badBug.textContent = "⚑ internal"
    header.appendChild(badBug)
  }
  popover.appendChild(header)

  const message = document.createElement("div")
  message.className = "text-xs font-medium leading-snug text-foreground"
  message.textContent = detail.message
  popover.appendChild(message)

  const rows = [
    popoverRow("Expected", detail.expected),
    popoverRow("Found", detail.found, true),
    popoverRow("Suggestion", detail.suggestion),
  ].filter((r): r is HTMLElement => r !== null)
  if (rows.length > 0) {
    const detailBlock = document.createElement("div")
    detailBlock.className = "flex flex-col gap-1 border-t border-border pt-2"
    detailBlock.append(...rows)
    popover.appendChild(detailBlock)
  }

  document.body.appendChild(popover)
  return popover
}

function positionPopover(popover: HTMLDivElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  const popRect = popover.getBoundingClientRect()
  let left = rect.left
  if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8
  left = Math.max(8, left)
  let top = rect.bottom + 6
  // Flip above the badge if there's not enough room below.
  if (top + popRect.height > window.innerHeight - 8) top = rect.top - popRect.height - 6
  popover.style.left = `${left}px`
  popover.style.top = `${top}px`
}

class ResultWidget extends WidgetType {
  private popover: HTMLDivElement | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    readonly text: string,
    readonly type: string,
    readonly pending = false,
    readonly errorDetail?: ErrorDetail,
    readonly colour?: string,
    readonly lineNumber?: number,
  ) {
    super()
  }

  /**
   * Make the result chip the handle for this line's detail panel.
   *
   * The chip is already the thing a reader looks at to see what the line did,
   * so it is the obvious place to ask for more, and it costs no extra chrome in
   * a document that is meant to read as a document. `ignoreEvent` has to admit
   * the click or CodeMirror treats it as an editor gesture and the handler
   * never runs.
   */
  protected attachToggle(el: HTMLElement) {
    if (this.lineNumber === undefined) return
    const line = this.lineNumber
    el.classList.add("os-result-expandable")
    el.addEventListener("mousedown", (e) => {
      e.preventDefault()
      e.stopPropagation()
      usePipelineStore.getState().toggleLineExpanded(line)
    })
  }
  eq(other: ResultWidget) {
    return (
      this.text === other.text &&
      this.type === other.type &&
      this.pending === other.pending &&
      this.errorDetail?.message === other.errorDetail?.message &&
      this.errorDetail?.code === other.errorDetail?.code &&
      this.colour === other.colour
    )
  }

  private scheduleHide() {
    this.hideTimer = setTimeout(() => this.hidePopover(), 150)
  }
  private cancelHide() {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }
  private showPopover(anchor: HTMLElement) {
    if (!this.errorDetail) return
    this.cancelHide()
    if (!this.popover) this.popover = buildErrorPopover(this.errorDetail)
    const popover = this.popover
    positionPopover(popover, anchor)
    popover.style.visibility = "visible"
    requestAnimationFrame(() => {
      popover.style.opacity = "1"
      popover.style.transform = "translateY(0)"
    })
    popover.onmouseenter = () => this.cancelHide()
    popover.onmouseleave = () => this.scheduleHide()
  }
  private hidePopover() {
    if (!this.popover) return
    this.popover.style.opacity = "0"
    this.popover.style.visibility = "hidden"
  }

  toDOM() {
    if (this.errorDetail) {
      const span = document.createElement("span")
      span.className = "os-result-inline os-result-error"
      span.textContent = `⚠ ${this.errorDetail.code ?? "Error"}`
      span.addEventListener("mouseenter", () => this.showPopover(span))
      span.addEventListener("mouseleave", () => this.scheduleHide())
      this.attachToggle(span)
      return span
    }

    const span = document.createElement("span")
    span.title = this.pending ? "Awaiting async resolution…" : this.type

    if (this.pending) {
      span.className = "os-result-inline os-result-pending"
      const spinner = document.createElement("span")
      spinner.className = "os-result-inline-spinner"
      spinner.textContent = "⟳"
      const label = document.createElement("span")
      label.className = "os-result-inline-pending-label"
      label.textContent = "..."
      span.appendChild(spinner)
      span.appendChild(label)
      return span
    }

    span.className = "os-result-inline"
    // A colour result gets a small swatch before the value, drawn from the
    // engine-supplied CSS string, so a hex/rgb/hsl answer is visible at a glance.
    if (this.colour) {
      const swatch = document.createElement("span")
      swatch.className = "os-result-swatch"
      swatch.style.cssText =
        "display:inline-block;width:0.75em;height:0.75em;border-radius:2px;margin-right:0.35em;vertical-align:baseline;border:1px solid rgba(128,128,128,0.45);"
      swatch.style.background = this.colour
      span.appendChild(swatch)
      span.appendChild(document.createTextNode(this.text))
      this.attachToggle(span)
      return span
    }
    span.textContent = this.text
    this.attachToggle(span)
    return span
  }

  ignoreEvent() {
    return false
  }

  destroy() {
    this.cancelHide()
    this.popover?.remove()
    this.popover = null
  }
}

/**
 * Format a stage duration.
 *
 * Timings arrive in nanoseconds and span four orders of magnitude between a
 * bare literal and a line that hits the network, so the unit is chosen per
 * value; one fixed scale renders the fast lines as zero.
 */
function formatNs(ns: number): string {
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(2)}ms`
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(1)}µs`
  return `${ns.toFixed(0)}ns`
}

/** One row of the inline detail panel: a dim label and a value beside it. */
function detailRow(label: string, value: string, mono = true): HTMLDivElement {
  const row = document.createElement("div")
  row.className = "os-detail-row"
  const key = document.createElement("span")
  key.className = "os-detail-key"
  key.textContent = label
  const val = document.createElement("span")
  val.className = mono ? "os-detail-val os-detail-mono" : "os-detail-val"
  val.textContent = value
  row.append(key, val)
  return row
}

/**
 * The panel that opens under a line, showing what the engine did with it.
 *
 * A block widget rather than a pane on the right, because the question it
 * answers is "what happened to THIS line", and the answer reads best where the
 * line is. The panes beside the editor still show the same line, since opening
 * a panel selects it.
 *
 * Deliberately a summary and not a fourth copy of the diagnostics: tokens, what
 * the parse matched, the answer and its type, and where the time went. Anything
 * deeper is a pane away, and this stays short enough to sit inside a document
 * without pushing the next line off the screen.
 */
class LineDetailWidget extends WidgetType {
  constructor(
    readonly lineNumber: number,
    readonly detail: {
      tokenCount: number
      result: string
      type: string
      parselet: string
      categories: Record<string, number>
      opcodes: number
      cached: boolean
      error?: string
      timing?: { lex: number; parse: number; compile: number; execute: number; total: number }
    },
  ) {
    super()
  }

  eq(other: LineDetailWidget) {
    return (
      this.lineNumber === other.lineNumber &&
      this.detail.result === other.detail.result &&
      this.detail.error === other.detail.error &&
      this.detail.tokenCount === other.detail.tokenCount &&
      this.detail.opcodes === other.detail.opcodes
    )
  }

  toDOM() {
    const d = this.detail
    const box = document.createElement("div")
    box.className = "os-line-detail"

    if (d.error) {
      box.append(detailRow("Error", d.error, false))
    } else {
      box.append(detailRow("Result", `${d.result}  (${d.type})`))
    }
    if (d.parselet) box.append(detailRow("Parsed by", d.parselet))
    const cats = Object.entries(d.categories)
    if (cats.length > 0) {
      box.append(detailRow("Matched", cats.map(([k, n]) => (n > 1 ? `${k} x${n}` : k)).join(", "), false))
    }
    box.append(
      detailRow(
        "Compiled",
        `${d.tokenCount} token${d.tokenCount === 1 ? "" : "s"} to ${d.opcodes} opcode${d.opcodes === 1 ? "" : "s"}${d.cached ? ", served from cache" : ""}`,
        false,
      ),
    )

    if (d.timing && d.timing.total > 0) {
      const bar = document.createElement("div")
      bar.className = "os-detail-bar"
      // Nanoseconds in, and the widths are shares of this line's own total, so
      // a fast line still fills the bar rather than rendering as a sliver.
      const parts: [string, number][] = [
        ["lex", d.timing.lex],
        ["parse", d.timing.parse],
        ["compile", d.timing.compile],
        ["execute", d.timing.execute],
      ]
      for (const [name, ns] of parts) {
        if (ns <= 0) continue
        const seg = document.createElement("span")
        seg.className = `os-detail-seg os-detail-seg-${name}`
        seg.style.width = `${(ns / d.timing.total) * 100}%`
        seg.title = `${name}: ${formatNs(ns)} (${((ns / d.timing!.total) * 100).toFixed(0)}%)`
        bar.append(seg)
      }
      const wrap = document.createElement("div")
      wrap.className = "os-detail-row"
      const key = document.createElement("span")
      key.className = "os-detail-key"
      key.textContent = "Time"
      // The bar carries proportions and nothing else, so on its own it cannot
      // say whether a line took a microsecond or a second. The total goes
      // beside it, and each segment names its own share on hover.
      const total = document.createElement("span")
      total.className = "os-detail-total os-detail-mono"
      total.textContent = formatNs(d.timing.total)
      total.title = parts.map(([n, ns]) => `${n} ${formatNs(ns)}`).join("  ")
      wrap.append(key, bar, total)
      box.append(wrap)
    }

    return box
  }

  ignoreEvent() {
    return false
  }
}

const detailEffect = StateEffect.define<{ pos: number; deco: Decoration }[]>()

/**
 * The open line-detail panels.
 *
 * Kept in its own field rather than added to {@link resultField}, because that
 * one rebuilds its whole set from each dispatch and the panels open and close
 * on a different signal (a click) from the one that rebuilds results (an
 * evaluation).
 */
const detailField = StateField.define<RangeSet<Decoration>>({
  create() {
    return Decoration.none
  },
  update(set, tr) {
    for (const e of tr.effects) {
      if (e.is(detailEffect)) {
        const builder = new RangeSetBuilder<Decoration>()
        for (const { pos, deco } of e.value) builder.add(pos, pos, deco)
        return builder.finish()
      }
    }
    return set.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

const resultEffect = StateEffect.define<{ from: number; to: number; deco: Decoration }[]>()
const resultField = StateField.define<RangeSet<Decoration>>({
  create() {
    return Decoration.none
  },
  update(set, tr) {
    for (const e of tr.effects) {
      if (e.is(resultEffect)) {
        const builder = new RangeSetBuilder<Decoration>()
        for (const { from, to, deco } of e.value) builder.add(from, to, deco)
        return builder.finish()
      }
    }
    return set.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

// `g`-flagged regexes are stateful (lastIndex) — every loop resets it before
// reuse, so sharing one instance across every tab's editor is safe.
const INLINE_SOLVE_RE = /s`[^`]*`/g

/**
 * Highlights inline solve regions (`` s`...` ``) within the editor. A
 * ViewPlugin so it can read `view.visibleRanges` — only lines actually on
 * screen are scanned on every rebuild.
 */
class InlineSolvePluginValue {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view)
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>()
    for (const { from, to } of view.visibleRanges) {
      let pos = from
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos)
        INLINE_SOLVE_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = INLINE_SOLVE_RE.exec(line.text)) !== null) {
          builder.add(line.from + m.index, line.from + m.index + m[0].length, Decoration.mark({ class: "cm-inline-solve" }))
        }
        pos = line.to + 1
      }
    }
    return builder.finish()
  }
}

const inlineSolveField = ViewPlugin.fromClass(InlineSolvePluginValue, {
  decorations: (v) => v.decorations,
})

/**
 * Per-tab state that CANNOT be shared across tabs — each open document gets
 * its own main-thread highlighting engine and language service, mirroring
 * how the real Obsidian plugin gives each editor pane its own
 * ExpressionEngine.
 */
interface TabEditor {
  view: EditorView
  highlightEngine: ExpressionEngine
  languageService: LanguageService
}

const EDITOR_THEME = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
})

/** Builds the syntax-highlighting ViewPlugin for ONE tab, closing over that tab's own languageService instance. */
function createHighlightPlugin(languageService: LanguageService) {
  class SolveHighlightPluginValue {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        const changedLines = new Set<number>()
        update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
          const startLine = update.state.doc.lineAt(fromB).number
          const endLine = update.state.doc.lineAt(toB).number
          for (let line = startLine; line <= endLine; line++) changedLines.add(line)
        })
        languageService.invalidateLines(changedLines)
        this.decorations = this.buildDecorations(update.view)
      } else if (update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view)
      }
    }

    private buildDecorations(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>()
      for (const { from, to } of view.visibleRanges) {
        let pos = from
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos)
          for (const token of languageService.getSemanticTokens(line.text, line.number)) {
            builder.add(line.from + token.from, line.from + token.to, Decoration.mark({ class: tokenClassName(token.category) }))
          }
          pos = line.to + 1
        }
      }
      return builder.finish()
    }
  }

  return ViewPlugin.fromClass(SolveHighlightPluginValue, {
    decorations: (v) => v.decorations,
  })
}

/** Creates the CodeMirror EditorView for one tab, including its own highlighting engine/language service. */
function createTabEditor(tabId: string, container: HTMLElement, initialDoc: string): TabEditor {
  // OSRS is an example package, not a built-in — registered explicitly
  // alongside BUILTIN_PACKAGES so "osrs"/game-item tokens still highlight
  // correctly. Keep this in sync with engine.ts's PLAYGROUND_PACKAGES.
  const highlightEngine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, OSRS_PACKAGE] })
  // highlightEngine never evaluates anything, so its own DAG is always
  // empty — read variable names from the real evaluation engine's
  // already-computed DAG snapshot instead (the ACTIVE tab's snapshot).
  const languageService = new LanguageService(highlightEngine, {
    variableNameSource: () => {
      const snap = useDiagnosticReportStore.getState().dagSnapshot
      if (!snap) return []
      return [...Object.keys(snap.consumers), ...Object.values(snap.writes).flat()]
    },
  })

  function solveCompletionSource(context: CompletionContext): CompletionResult | null {
    const word = context.matchBefore(/[\w]+/)
    if (!word || (word.from === word.to && !context.explicit)) return null

    const line = context.state.doc.lineAt(context.pos)
    const items = languageService.getCompletions(line.text, context.pos - line.from)
    if (items.length === 0) return null

    return { from: word.from, options: items.map(completionItemToOption) }
  }

  const view = new EditorView({
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
        markdown(),
        oneDark,
        createHighlightPlugin(languageService),
        inlineSolveField,
        resultField,
        detailField,
        autocompletion({ override: [solveCompletionSource] }),
        placeholder("Enter an expression…  e.g. 10 + 5 * 2"),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            // The document text must reach the engine unmodified (never
            // .trim()'d) so every line's reported lineNumber stays aligned
            // with its actual position in the document.
            const expr = prepareEvaluationInput(update.state.doc.toString())
            useTabsStore.getState().updateTabText(tabId, expr)
            engineService.evaluate(expr, tabId)
          }
          if (update.selectionSet && tabId === useTabsStore.getState().activeTabId) {
            const pos = update.state.selection.main.head
            const line = update.state.doc.lineAt(pos)
            useEditorStore.getState().updateCursorLine(line.number)
          }
        }),
        keymap.of([
          {
            key: "Ctrl-Enter",
            run: () => {
              run(tabId)
              return true
            },
          },
        ]),
        EDITOR_THEME,
      ],
    }),
    parent: container,
  })

  return { view, highlightEngine, languageService }
}

function run(tabId?: string): void {
  const id = tabId ?? useTabsStore.getState().activeTabId
  const editor = tabEditorsSingleton.get(id)
  if (!editor) return
  engineService.evaluate(prepareEvaluationInput(editor.view.state.doc.toString()), id)
}

/**
 * Draw a detail panel under every line the reader has opened.
 *
 * Runs on two signals, which is why it is separate from the inline results: an
 * evaluation (the content changed) and a toggle (which lines are open changed).
 * Both end in the same place, so a panel opened before a re-run redraws with
 * the new answer rather than going stale or vanishing.
 */
function renderLineDetails(tabId: string): void {
  const editor = tabEditorsSingleton.get(tabId)
  if (!editor) return
  const view = editor.view
  if (!view.dom || !view.dom.parentNode) return

  const { expandedLines } = usePipelineStore.getState()
  const report = useDiagnosticReportStore.getState()
  const effects: { pos: number; deco: Decoration }[] = []

  for (const lineNumber of [...expandedLines].sort((a, b) => a - b)) {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) continue
    const lr = report.lineResults.find((r) => (r.lineNumber ?? 1) === lineNumber)
    if (!lr) continue
    const line = view.state.doc.line(lineNumber)
    const stages = report.stagesByLine?.[lineNumber]
    const lexer = stages?.find((st) => st.stage === "lexer")
    // Only the count. The chips used to be drawn here and repeated the line
    // sitting directly above them, which is the one thing a panel under a line
    // never needs to say.
    const tokenCount = ((lexer?.output as { tokens?: unknown[] } | undefined)?.tokens ?? []).length
    const ls = report.lineStats?.find((x) => x.lineNumber === lineNumber)?.stats

    effects.push({
      pos: line.to,
      deco: Decoration.widget({
        widget: new LineDetailWidget(lineNumber, {
          tokenCount,
          result: lr.result,
          type: lr.type,
          parselet: lr.parselet,
          categories: lr.parseletCategories ?? {},
          opcodes: lr.opcodeCount,
          cached: lr.wasCached,
          error: lr.error,
          timing: ls
            ? {
                lex: ls.lexerTime,
                parse: ls.parserTime,
                compile: ls.bytecodeTime,
                execute: ls.executionTime,
                total: ls.totalTime,
              }
            : undefined,
        }),
        block: true,
        side: 1,
      }),
    })
  }

  try {
    view.dispatch({ effects: detailEffect.of(effects) })
  } catch {
    // Same failure mode the inline results guard against: RangeSetBuilder
    // rejects out-of-order positions. Sorted above, so this is belt and braces.
  }
}

function renderInlineResults(tabId: string, lineResults: LineResult[]): void {
  const editor = tabEditorsSingleton.get(tabId)
  if (!editor) return
  const view = editor.view
  // Guard against destroyed editor (HMR unmount / tab close leaves stale reference)
  if (!view.dom || !view.dom.parentNode) return
  const effects: { from: number; to: number; deco: Decoration }[] = []
  for (const lr of lineResults) {
    const isPending = lr.type === "Pending"
    // A Pending result formats to "" (see formatLineResultValue in
    // engineShared.ts — the queryKey must never be shown as if it were the
    // answer), so it needs its own branch instead of the `!lr.result` skip
    // other empty/non-evaluable lines take.
    if (!lr.error && !lr.result && !isPending) continue
    if ((lr.lineNumber ?? 1) > view.state.doc.lines) continue
    const line = view.state.doc.line(lr.lineNumber ?? 1)
    const text = isPending ? "…" : lr.result
    // An error line previously rendered NO inline indicator at all (the
    // caller used to `continue` past it entirely) — the only way to see
    // what went wrong was the Output tab. Now shows a badge + hover
    // popover with the full EngineError detail, right where you're
    // already looking.
    const errorDetail: ErrorDetail | undefined = lr.error
      ? {
          code: lr.errorCode,
          category: lr.errorCategory,
          message: lr.error,
          expected: lr.errorExpected,
          found: lr.errorFound,
          suggestion: lr.errorSuggestion,
          recoverable: lr.errorRecoverable,
        }
      : undefined
    effects.push({
      from: line.to,
      to: line.to,
      deco: Decoration.widget({ widget: new ResultWidget(text, lr.type, isPending, errorDetail, lr.colour, lr.lineNumber ?? 1), side: 1 }),
    })
  }
  // Always dispatch, even with an empty effects array: resultField's update()
  // rebuilds the ENTIRE decoration set from this list every time, so skipping
  // the dispatch when every line errored left whatever was previously
  // rendered stuck on screen after the line was edited into something that
  // no longer parses.
  try {
    view.dispatch({ effects: resultEffect.of(effects) })
  } catch (e) {
    // RangeSetBuilder.add() throws if `effects` isn't in ascending position
    // order — shouldn't happen (lineResults comes back in document order),
    // but surfacing this clearly beats a silently-stale result display.
    console.error("Failed to render inline results:", e)
  }
}

function insertExample(expression: string): void {
  const editor = tabEditorsSingleton.get(useTabsStore.getState().activeTabId)
  if (!editor) return
  editor.view.dispatch({ changes: { from: 0, to: editor.view.state.doc.length, insert: expression } })
}

// Module-level map — CodeMirror EditorViews are imperative, DOM-attached
// objects that outlive React's render cycle; they're keyed by tabId and
// managed via effects below, not React state. Mirrors the Vue version's
// plain (non-reactive) `tabEditors`/`containerEls` maps.
const tabEditorsSingleton = new Map<string, TabEditor>()

export function EditorPane() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const editorCollapsed = useUiStore((s) => s.editorCollapsed)
  const result = useDiagnosticReportStore((s) => s.result)
  const cursorLine = useEditorStore((s) => s.cursorLine)
  const selectLine = usePipelineStore((s) => s.selectLine)

  // Self-healing attach: React (esp. StrictMode's dev-only double-invoke of
  // effects/refs) can call this ref callback more than once for the same
  // tab without a matching null-detach in between. Keying re-creation on
  // whether the tracked editor's DOM is STILL the one actually attached to
  // `el` (rather than just "does a map entry exist") means a repeat call
  // is a no-op, and a genuinely stale/orphaned entry gets torn down before
  // a fresh one is built — so exactly one live editor per tab survives
  // regardless of how many times this fires.
  const containerRefsCallback = (tabId: string) => (el: HTMLDivElement | null) => {
    if (!el) return
    const existing = tabEditorsSingleton.get(tabId)
    if (existing && existing.view.dom.parentElement === el) return
    if (existing) existing.view.destroy()
    el.replaceChildren()
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
    const editor = createTabEditor(tabId, el, tab?.text ?? "")
    tabEditorsSingleton.set(tabId, editor)
    engineService.evaluate(tab?.text ?? "", tabId)
  }

  // Register this pane's imperative API for other components (ExamplesMenu) to call.
  useEffect(() => {
    useEditorStore.getState().setEditorRef({ insertExample })
    return () => useEditorStore.getState().setEditorRef(null)
  }, [])

  // Tear down editors for tabs that no longer exist (closed tabs).
  useEffect(() => {
    const currentIds = new Set(tabs.map((t) => t.id))
    for (const [tabId, editor] of tabEditorsSingleton) {
      if (!currentIds.has(tabId)) {
        editor.view.destroy()
        tabEditorsSingleton.delete(tabId)
      }
    }
  }, [tabs])

  useEffect(() => {
    return () => {
      for (const editor of tabEditorsSingleton.values()) editor.view.destroy()
      tabEditorsSingleton.clear()
    }
  }, [])

  // Update cursor line in pipeline when store changes.
  useEffect(() => {
    selectLine(cursorLine, false)
  }, [cursorLine, selectLine])

  // Render inline result decorators — `result` only ever reflects the
  // ACTIVE tab, so render into that tab's editor specifically.
  useEffect(() => {
    if (result) {
      const tabId = useTabsStore.getState().activeTabId
      requestAnimationFrame(() => {
        renderInlineResults(tabId, result.lineResults)
        renderLineDetails(tabId)
      })
    }
  }, [result])

  // Redraw when the reader opens or closes a panel. Separate from the effect
  // above because the two run on different signals: that one fires when the
  // answer changed, this one when which lines are open changed.
  const expandedLines = usePipelineStore((s) => s.expandedLines)
  useEffect(() => {
    const tabId = useTabsStore.getState().activeTabId
    renderLineDetails(tabId)
  }, [expandedLines])

  return (
    <main className={cn("flex min-h-0 flex-1 flex-col", editorCollapsed && "w-0 min-w-0 overflow-hidden")}>
      <div className="bg-card/40 flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-muted-foreground flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
          <Code2 className="size-3.5" /> Editor
        </span>
        <ExamplesMenu />
      </div>
      <TabBar />
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={containerRefsCallback(tab.id)}
            className={cn("absolute inset-0", tab.id !== activeTabId && "hidden")}
          />
        ))}
      </div>
    </main>
  )
}
