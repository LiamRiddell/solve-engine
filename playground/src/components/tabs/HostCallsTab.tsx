import { useState } from "react"
import { Crosshair } from "lucide-react"
import { useTabsStore } from "@/stores/tabsStore"
import { useEditorStore } from "@/stores/editor"
import { useUiStore } from "@/stores/ui"
import { Card } from "@/components/ui/card"
import { TAB_BODY } from "@/components/shared/tabChrome"
import { cn } from "@/lib/utils"
import {
  definitionAt,
  explainDocumentLine,
  isFailure,
  parseOverrides,
  referencesAt,
  renameAt,
  traceDocumentLine,
  whatIfLines,
  type ExplainedLine,
  type HostCallFailure,
  type TracedLine,
  type WhatIfLines,
} from "@bridge/hostCalls"
import type { VariableReference } from "@solve-js/language/DocumentReferences"

/** The active tab's document text. */
function useActiveText(): string {
  return useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.text ?? "")
}

/** A failure as a panel shows it: the engine's message, and its code beside it. */
function Failure({ failure }: { failure: HostCallFailure }) {
  return (
    <p className="text-destructive text-xs">
      {failure.error} <span className="text-muted-foreground font-mono">({failure.code})</span>
    </p>
  )
}

const INPUT = "border-border bg-background w-full rounded border px-2 py-1 font-mono text-xs"
const BUTTON = "border-border hover:bg-muted rounded border px-2 py-1 text-xs"

/**
 * The host calls the document features rely on, run against the active tab:
 * explain and trace a line, re-run the note with inputs changed (what-if), and
 * the reference calls (definition, references, rename). Each runs on its own
 * engine with live data off and changes nothing in the note, except a rename,
 * which writes its edits into the editor.
 */
export function HostCallsTab() {
  const text = useActiveText()
  const cursorLine = useEditorStore((s) => s.cursorLine) ?? 1
  const cursorCharacter = useEditorStore((s) => s.cursorCharacter)
  const keepLineReferences = useUiStore((s) => s.keepLineReferences)
  const setKeepLineReferences = useUiStore((s) => s.setKeepLineReferences)

  const [explained, setExplained] = useState<ExplainedLine | HostCallFailure | null>(null)
  const [traced, setTraced] = useState<TracedLine | HostCallFailure | null>(null)
  const [overrides, setOverrides] = useState("")
  const [scenario, setScenario] = useState<WhatIfLines | HostCallFailure | null>(null)
  const [references, setReferences] = useState<VariableReference[] | HostCallFailure | null>(null)
  const [newName, setNewName] = useState("")
  const [renamed, setRenamed] = useState<string | HostCallFailure | null>(null)

  const position = { line: cursorLine, character: cursorCharacter }

  function runWhatIf(): void {
    const parsed = parseOverrides(overrides)
    setScenario(isFailure(parsed) ? parsed : whatIfLines(text, parsed))
  }

  function goToDefinition(): void {
    const found = definitionAt(text, position)
    if (isFailure(found)) {
      setReferences(found)
      return
    }
    if (found === null) {
      setReferences({ error: "The cursor is not on a variable a line above defines.", code: "NO_DEFINITION" })
      return
    }
    useEditorStore.getState().editorRef?.moveCursor(found.line, found.from)
  }

  function rename(): void {
    const result = renameAt(text, position, newName.trim())
    if (isFailure(result)) {
      setRenamed(result)
      return
    }
    useEditorStore.getState().editorRef?.replaceDocument(result.text)
    setRenamed(`Renamed in ${result.edits} place${result.edits === 1 ? "" : "s"}.`)
  }

  return (
    <div className={cn(TAB_BODY, "flex flex-col gap-3")}>
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Crosshair className="size-3" /> The cursor is on line {cursorLine}, character {cursorCharacter}.
      </p>

      <Card className="flex flex-col gap-2 p-3">
        <h3 className="text-sm font-semibold">Explain and trace</h3>
        <p className="text-muted-foreground text-xs">
          Explain shows how the line under the cursor reached its answer, step by step. Trace shows which other lines it read.
        </p>
        <div className="flex gap-2">
          <button type="button" className={BUTTON} onClick={() => setExplained(explainDocumentLine(text, cursorLine))}>
            Explain line {cursorLine}
          </button>
          <button type="button" className={BUTTON} onClick={() => setTraced(traceDocumentLine(text, cursorLine))}>
            Trace line {cursorLine}
          </button>
        </div>
        {explained && (isFailure(explained) ? <Failure failure={explained} /> : (
          <ol className="font-mono text-xs">
            {explained.steps.length === 0 && <li className="text-muted-foreground">Nothing to break down: {explained.result}</li>}
            {explained.steps.map((step, i) => (
              <li key={i}>{step.description} <span className="text-muted-foreground">{step.shown}</span></li>
            ))}
          </ol>
        ))}
        {traced && (isFailure(traced) ? <Failure failure={traced} /> : <pre className="font-mono text-xs whitespace-pre-wrap">{traced.summary}</pre>)}
      </Card>

      <Card className="flex flex-col gap-2 p-3">
        <h3 className="text-sm font-semibold">What if</h3>
        <p className="text-muted-foreground text-xs">
          Re-run the note with some inputs changed, without editing it: name each input and its new value, such as deposit = 200000, rate = 5%.
        </p>
        <div className="flex gap-2">
          <input className={INPUT} value={overrides} onChange={(e) => setOverrides(e.target.value)} placeholder="deposit = 200000" aria-label="Inputs to change" />
          <button type="button" className={BUTTON} onClick={runWhatIf}>Run</button>
        </div>
        {scenario && (isFailure(scenario) ? <Failure failure={scenario} /> : (
          <table className="font-mono text-xs">
            <tbody>
              {scenario.lines.filter((l) => l.changed).map((l) => (
                <tr key={l.lineNumber}>
                  <td className="text-muted-foreground pr-2">{l.lineNumber}</td>
                  <td className="pr-2">{l.before}</td>
                  <td>{l.shown}</td>
                </tr>
              ))}
              {scenario.lines.every((l) => !l.changed) && (
                <tr><td className="text-muted-foreground">No line changes.</td></tr>
              )}
            </tbody>
          </table>
        ))}
      </Card>

      <Card className="flex flex-col gap-2 p-3">
        <h3 className="text-sm font-semibold">References</h3>
        <p className="text-muted-foreground text-xs">
          Follow the variable under the cursor: where it is defined, every line that names it, or give it a new name in all of them at once.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} onClick={goToDefinition}>Go to definition</button>
          <button type="button" className={BUTTON} onClick={() => setReferences(referencesAt(text, position))}>Find references</button>
        </div>
        {references && (isFailure(references) ? <Failure failure={references} /> : (
          <ul className="font-mono text-xs">
            {references.length === 0 && <li className="text-muted-foreground">The cursor is not on a variable.</li>}
            {references.map((r, i) => (
              <li key={i}>
                <button type="button" className="hover:underline" onClick={() => useEditorStore.getState().editorRef?.moveCursor(r.line, r.from)}>
                  line {r.line}: {r.name} ({r.kind})
                </button>
              </li>
            ))}
          </ul>
        ))}
        <div className="flex gap-2">
          <input className={INPUT} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="new name" aria-label="New name" />
          <button type="button" className={BUTTON} onClick={rename}>Rename</button>
        </div>
        {renamed && (typeof renamed === "string" ? <p className="text-xs">{renamed}</p> : <Failure failure={renamed} />)}
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={keepLineReferences} onChange={(e) => setKeepLineReferences(e.target.checked)} />
          Keep line N references on their lines when lines are inserted or deleted
        </label>
      </Card>
    </div>
  )
}
