---
"solve-engine": minor
---

The second wave of work on the parser pipeline: the normaliser stops running to its pass budget, the lexer's vocabulary edges are hardened, an operator can declare its associativity, and the benchmark suites measure what they name. Figures are medians from the engine's own benchmark suites on one machine.

A line holding the word `assuming` ran the normaliser 100 times on every evaluation. The phrase trie matches on a token's written value, and a fused single-word phrase keeps that value, so every pass proposed the same fusion again and the pass budget was the only exit; the result was whatever the last pass left. A token that already carries a phrase's type is now the fusion, not a word to fuse, and the line settles in two passes. This was found the moment the pass budget became an error: a rule chain that is still changing the stream after `maxPasses` passes now throws `NORMALIZER_PASS_LIMIT_EXCEEDED`, the way the token-count limit already did, rather than handing the parser a stream that is quietly whatever pass 100 produced.

| expression | before | now |
| --- | --- | --- |
| `value of $500 in 2031 assuming 3% inflation` | 100 normaliser passes | 2 |

Every registered normaliser rule now declares the shape it starts on: the recurring schedule, the bill split (now two rules, one per shape, because a rule's shape is read from where it starts) and the nth weekday were the last three without one. The clock-time rule asks its "inside a matrix range" question, which scans back to the start of the line, only once a clock shape fits, rather than at every number from 0 to 23. The rule index and the phrase trie lower-case a word only when it carries a capital.

The lexer's non-ASCII symbols (the multiplication and division signs, plus-minus, not-equal, the currency glyphs, the minus sign and the en dash) are one table serving the fast path, the main loop and the identifier scanner, which used to know nothing of them.

| expression | before | now |
| --- | --- | --- |
| `x×2` (with `:x = 3`) | Undefined variable: x×2 | `6` |

A raw-line pattern a package wrote with the `g` or `y` flag carried its `lastIndex` between lines, so every second line failed to match; the lexer keeps a flag-safe copy and unregisters by owner. An operator the fast path could never read (not two characters, or a first character the scanner does not class as an operator) registered without complaint and never fired; it is refused with `PLUGIN_OPERATOR_UNSUPPORTED` at the moment the author can act on it.

An infix parselet can declare `rightAssociative`, and `parseRightOperand(this, parser, builder)` turns the declaration into the binding power, one below the operator's own for a right-associative operator. Associativity used to live in how each parselet happened to call `parseExpression`, so the registry could only report every operator as left-associative, `^` included. `getAllInfix()` now reports `associativity`, with the right power one below the left for `^`, and the package-author page names the fast-path token set a package cannot override.

An engine that is never cleared retains a nineteenth of what it did. The async preflight now runs only for a program a registered resolver could intercept, declared through an optional `watchedOpcodes` on `IAsyncResolver`, so an ordinary line no longer allocates two cancellation controllers and adds two keystroke listeners. Those listeners were what held a finished engine's state reachable.

| | before | now |
| --- | --- | --- |
| retained per uncleared engine | 285 KB | 15 KB |
| a cached expression, evaluated again | 1.73 us | 1.14 us |
| a 10,000-line document, re-parsed warm | 32.5 ms | 28.3 ms |

The compiled caches evict the least recently used entry rather than the oldest, keeping the program, its front half and the remembered parse failure in step. Recency is recorded only once a cache is full, which is the only time it decides anything: marking every hit below the cap cost more than the accuracy was worth, and a variable chain measured 1.17 ms against 2.10 ms with it, in the same continuous-integration run as its own merge base. The dependency sorts and the async batcher are linear rather than quadratic: with five thousand consumers of one live value, ordering the affected lines falls from 2.34 ms to 1.31 ms and adding five thousand queries from 54.6 ms to 0.45 ms.

In the virtual machine, a currency is recognised from a small remembered table rather than two string allocations per instruction, and the conversion arms ask the question only after the measure table declines: converting a unit falls from 1.56 ms to 0.79 ms per two thousand executions. Two plain numbers are answered before the arithmetic and comparison ladders. A failed evaluation restores the shared stack to the depth it started at, a plot reports a fault in its body instead of drawing a flat line at zero, and an unknown opcode is refused at the instruction that carries it rather than running past it.

## What this costs, and where

Registering a package now builds more: every normaliser rule declares the shape it starts on, and the rule index and the phrase trie are built from that. Evaluation reads those structures; construction pays for them. Measured in continuous integration, each branch against its own merge base in the same run:

| case | merge base | now | |
| --- | --- | --- | --- |
| `PROD_single_eval_warm`, a reused engine | 0.004 ms | 0.002 ms | faster |
| `PROD_10k_warm`, a reused engine | 0.010 ms | 0.009 ms | faster |
| `PROD_50_line_doc`, a new engine each time | 3.087 ms | 3.608 ms | slower |
| `DIAG_50_line_doc`, a new engine each time | 2.150 ms | 3.333 ms | slower |

Every case that reuses an engine is the same or faster; every case that builds one per iteration is slower, because that is what those cases mostly measure. A host that creates one engine and evaluates many lines, which is the ordinary shape, comes out ahead. A host that creates an engine per document pays roughly two tenths of a millisecond more for it, and `create_engine` now measures that on its own so the number is visible rather than buried inside a parse.

The benchmark suites measure what they name. The parser suite took a mean of `performance.now()` deltas around a loop that rebuilt a ten-package registry per iteration, so its figure was registry construction; it now holds one parser and records a mitata median (0.8 µs to 1.6 µs per parse). The micro suite's `process.hrtime` pair per iteration is replaced by the same measurement, the suite-geomean bands sit at 1.1 and 1.3 now that every suite records a median, and the pipeline suite times engine construction on its own (`create_engine`, 442 µs for every built-in package on this machine).
