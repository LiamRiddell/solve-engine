---
"solve-engine": patch
---

`tryCompileExpression()` no longer throws, which was taking editors down on half-typed lines.

The method answers "does this compile" with a boolean, and `LanguageService` calls it for every visible line on every keystroke to decide what to highlight. A throw from it does not land in a caller that is looking for one. In the Obsidian plugin it reached CodeMirror's transaction dispatch and broke the editor mid-edit, reported as `EngineError: Unexpected end of input` after clearing a document.

The trigger was not exotic. `total =` is what every assignment looks like for the moment between typing the `=` and typing the value, so the crash was reachable by typing an assignment at ordinary speed:

```
total =        threw, now false
hello =        threw, now false
"              threw, now false
der(           threw, now false
```

Two separate paths reached it. The symbolic grammar parses its own operand sub-ranges and ran ahead of the try/catch guarding the main parse, so an empty right-hand side threw the parser's error straight out of `prepareExpression()`. That is now caught into the same `'parse'` result every other failure in that method already returned, which also makes `compileExpression()` consistent. Separately the lexer throws on an unterminated string, before the parser is reached at all, so `tryCompileExpression()` now enforces its own contract rather than trusting every stage below it to agree.

`evaluateExpression()` is unchanged and still throws. It is documented `@throws {EngineError}`, and only the boolean probe was wrong.

The fuzzer could not have found this. Its oracle counts a thrown `EngineError` as a pass, which is correct for the `@throws` API it drives, and `tryCompileExpression()` is the one entry point with a stricter contract. The expression oracle now asserts that contract on every case, so the whole existing corpus exercises it. Adding the invariant immediately shrank two further reproducers out of unrelated inputs, both fixed here and committed to the corpus.
