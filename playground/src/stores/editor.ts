import { create } from "zustand"

interface EditorRefHandle {
  insertExample(expr: string): void
  /** Replace the active tab's document, as a rename's edited text does. */
  replaceDocument(text: string): void
  /** Put the cursor at a one-based line and a zero-based character, as go to definition does. */
  moveCursor(line: number, character: number): void
}

interface EditorState {
  /** Initially null — first cursor update from CodeMirror sets the real value. */
  cursorLine: number | null
  /** The cursor's zero-based character on its line, for the reference calls. */
  cursorCharacter: number
  /** Imperative handle exposed by the EditorPane component (via useImperativeHandle). */
  editorRef: EditorRefHandle | null

  setEditorRef: (ref: EditorRefHandle | null) => void
  updateCursorLine: (line: number, character?: number) => void
  insertExample: (expression: string) => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  cursorLine: null,
  cursorCharacter: 0,
  editorRef: null,

  setEditorRef: (ref) => set({ editorRef: ref }),
  updateCursorLine: (line, character) => set({ cursorLine: line, cursorCharacter: character ?? 0 }),
  insertExample: (expression) => get().editorRef?.insertExample(expression),
}))
