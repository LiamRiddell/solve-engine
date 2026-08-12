# solve-engine

## 1.0.2

### Patch Changes

- b8c3a62: Markdown list markers are no longer evaluated as arithmetic.

  `- 100 + 20` in a document answered **-80**. The `-` is a bullet, but it is also a prefix operator, and nothing stripped the marker before evaluating, so the line was read as negative one hundred plus twenty. This is the worst shape a bug can take: a plausible number where a correct one was expected, with nothing on screen to say it went wrong.

  The three unordered markers disagreed with each other about the same document, which is what made it a defect rather than a design choice:

  ```
  - 100 + 20     was -80,   now 120
  * 100 + 20     was an error, now 120
  + 100 + 20     was 120, but by luck rather than by rule
  1. 100 + 20    was an error, now 120
  - [ ] 100 + 20 was "a matrix literal cannot be empty", now 120
  ```

  The lexer already classified these lines as `list` and had done all along; nothing consumed that classification to trim the marker before evaluating. The classification now carries a `contentOffset`, and both the token stream and the expression text are taken from it, so they cannot describe different lines. Task-item checkboxes are skipped too, since `[ ]` otherwise lexed as an empty matrix literal and reported a shape error to someone writing a to-do list.

  The discriminator is the space, which CommonMark requires after a list marker for exactly this reason. **`-100 + 20` has no space and is still -80.** Ordinary arithmetic is untouched, and `[1,2] + [3,4]` is still a matrix.

  This affects documents: a bulleted line that previously showed a negative number, or an error, now shows the result of the expression after the marker. That is the intended reading of a bulleted calculation, and it is the reason the bug was reported.

## 1.0.1

### Patch Changes

- 26964e3: `tryCompileExpression()` no longer throws, which was taking editors down on half-typed lines.

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

## 1.0.0

### Minor Changes

- 4ab427e: Durations written as several units, and written back out.

  `3 hours 5 minutes 10 seconds` did not parse. The parts sat next to each other as separate quantities and the parser reported an unexpected number, which is why the timespan, clock and several unit examples all failed in the same place. They now sum into one quantity that converts, adds and compares like any other:

  ```
  3 hours 5 minutes 10 seconds in seconds    11,110
  5 hours 30 minutes to seconds              19,800
  3h 5m 10s in seconds                       11,110
  1 kilometre 500 metres in metres           1,500
  ```

  The rule is deliberately narrow, because a run of number-unit pairs is also what ordinary arithmetic produces. Parts must share a measure, must strictly decrease, and must be unsigned, so `3 hours 5 metres`, `5 minutes 3 hours` and `3 hours - 30 minutes` are all left alone.

  `as timespan` and `as laptime` are the inverse, and neither existed despite being credited to the time package:

  ```
  5.5 minutes as timespan    5 minutes 30 seconds
  72 days as timespan        10 weeks 2 days
  5.5 minutes as laptime     00:05:30
  ```

  Laptime hours are not wrapped at 24, since a twenty-six hour measurement is real. A fractional remainder is kept rather than rounded away, and a non-duration says so rather than being treated as seconds.

- 4ab427e: Percentages are relative, and the investments syntax works.

  **`200 + 10%` is 220.** It used to be 200.10, because `%` compiled to a literal divide-by-100 and the result was an ordinary number. A percentage is a proportion _of_ something, so which reading applies now depends on what it sits next to: `$300 + 15%` is `$345.00` and keeps its currency, `10% + 20%` is `30%`, and `100% + 2` is `300%` rather than `3`. Multiplication is untouched, because there the percentage is already the factor it is: `50% × 30` is still 15, and a bare `15%` is still 0.15.

  This changes answers previously pinned by issues #79 and #81. Those regression tests are updated rather than removed, and both issues' actual complaints still hold.

  **Soulver's documented investment expressions parse.** Previously every one of them threw; only the mortgage grammar worked. Now:

  ```
  $1,000 after 3 years at 7%                                    $1,225.04
  $1,000 for 3 years at 7% compounding monthly                  $1,232.93
  $1,000 for 3 years at 7% compounding quarterly                $1,231.44
  interest on $1,000 after 3 years @ 7%                         $225.04
  present value of $1,000 after 20 years at 10%                 $148.64
  $500 invested $1,500 returned                                 2
  annual return on $1,000 invested $2,500 returned after 7 years   13.99%
  ```

  `compounding` accepts daily, weekly, fortnightly, monthly, quarterly, semi-annually and annually, and names the whole set when given something else. Return on investment is the gain against the cost, so tripling your money is a 2x return; the money multiple is `$1,500 / $500`. The annualised return is the compound rate that actually reproduces the figure, returned as a percentage.

  The older `compound interest on X over Y years at Z%` spelling still parses, and `after`, `for`, `over`, `at` and `@` are now interchangeable where they read naturally.

- 4ab427e: Solving for the missing part of a percentage, base conversions in words, and a multiplier fix.

  **`20/5 as multiplier` returned 5x. It returns 4x.** The converter added 1 unconditionally, which is right for a percentage (50% more is 1.5x) and wrong for a plain ratio. Telling those apart only became possible once `%` started producing a percentage-typed value.

  **The `is ... what` family.** `5% of what is 6` already worked; this is the order the documentation uses, where you state what you know first:

  ```
  20 is 10% of what        200
  180 is 10% off what      200
  220 is 10% on what       200
  20 is what % of 200      10%
  180 is what % off 200    10%
  180 is what % on 150     20%
  50 to 75 is what %       50%
  50 is 1/5 of what        250
  81 is 9 to what power    2
  ```

  **Base conversion in the other prepositions.** `256 as hex` always worked; `99 in binary`, `0x9F31 to decimal` and `0b1000101 to octal` did not, because `in` belongs to unit conversion and `to` to percentage change. They are rewritten to `as` before parsing, so each of those parselets keeps one job. `as base 2`, `as base 8` and `as base 16` also work, and an unsupported radix says which ones do.

- d2f9c9b: Highlighting can now see phrase-fused tokens, behind `normalizeForHighlighting`.

  `LanguageService` classifies at the lexer stage, which means a token type that only exists after normalization was never reachable from the highlighting path. That was documented and deliberate, but it had a consequence nobody had measured: all four token types mapped to the `datetime` category (`DATETIME_LITERAL`, `DURATION`, `VIDEO_TIMECODE`, `FRAME_COUNT`) are produced by normalizer rules, so no editor using this API has ever highlighted a date as a date. `12/09/2026` came back as number, operator, number, operator, number.

  ```ts
  const language = new LanguageService(engine, {
    normalizeForHighlighting: true,
  });
  language.getSemanticTokens("12/09/2026", 1);
  // one span, category "datetime", covering the whole date
  ```

  Off by default. It is a behaviour change for anything already painting these lines, spans merge and categories move, and it costs real work per keystroke, so a host should opt into it rather than inherit it from a version bump.

  What it costs, from `benchmarks/languageServiceBenchmarks.spec.ts`, median per call:

  | line                      | lexer only | normalized |
  | ------------------------- | ---------- | ---------- |
  | `1 + 2 * 3`               | 0.006 ms   | 0.009 ms   |
  | `$10 + 50% of 200 - 3 kg` | 0.009 ms   | 0.013 ms   |
  | fifty terms               | 0.209 ms   | 0.381 ms   |
  | prose                     | 0.031 ms   | 0.038 ms   |

  Roughly three microseconds on a typical line, and the result is cached per line, so an edit pays it once for the line that changed.

  The hard part was putting the tokens back. A fused token's `value` is its replacement rather than its source (`10 frames` becomes a `FRAME_COUNT` whose value is `10`), so `Token` gains an optional `sourceEnd` recording where the source text ended, stamped centrally by the normalizer for every one-replaces-many fusion rather than left to each rule to remember. Inserted tokens, such as the `*` implicit multiplication puts at the following token's offset, have no source text at all and are dropped rather than painted over the character that is really there.

- `2 ^ 3 ^ 2` is now 512, and the shifts and bitwise operators rank the way C and JavaScript rank them.

  Two precedence changes for 1.0, both moving the engine onto the convention mathematics and mainstream programming languages already share.

  **`^` groups to the right.** `2 ^ 3 ^ 2` is `2^(3^2)` = 512, where it used to be `(2^3)^2` = 64. A tower of powers is worked out from the top down in mathematics, in Python, in Ruby, in Wolfram and in JavaScript's `**`; grouping to the left is a pocket-calculator habit. The parser already had a special case for `^` and the special case did nothing: it parsed the right operand at the operator's own binding power, and the infix loop stops on `bp <= minBp`, so that behaved exactly like the left-associative branch it was meant to differ from. Both `BindingPower.ts` and `PrecedenceParser.ts` had described `^` as right-associative all along.

  `-2 ^ 2` is unchanged at 4: unary minus still binds tighter than the power it precedes.

  **The shifts and the bitwise trio take their C and JavaScript precedence.** They used to share a single level between `+` and `*`, which no language does, so arithmetic bound looser than a shift and `&` outranked `+`. The order is now, loosest to tightest: `|`, `xor`, `&`, the comparisons, the shifts, `+` and `-`, `*` and `/`.

  ```
  1 + 2 << 3     24   (was 17)
  8 >> 1 + 1     2    (was 5)
  4 & 3 + 1      4    (was 1)
  1 - 2 & 3      3    (was -1)
  4 | 6 & 3      6    (was 2)
  16 >> 3 & 1    0
  ```

  `>>>` was missing from the parser's fast-path table entirely, so it alone ran at the precedence its parselet declared: `16 >> 3 & 1` was 0 while `16 >>> 3 & 1` was 8, the same expression answering differently depending only on which spelling of right shift was typed. All three shifts now share one level, declared once and used by both parse tiers.

  Anything already parenthesised is unaffected.

- 4ab427e: Rounding, and magnitudes written as words.

  **Rounding is now something you can write in an expression.** The engine could already round, but only by configuring the formatter, which changes how every answer is displayed rather than rounding one value inside a calculation. The two are not the same: the formatter cannot express `21 rounded up to nearest 5`, and it cannot feed a rounded number into the next line.

  ```
  5.5 rounded                       6
  5.5 rounded down                  5
  37 to nearest 10                  40
  $490 rounded to nearest hundred   $500
  21 rounded up to nearest 5        25
  1/3 to 2 dp                       0.33
  pi to 5 digits                    3.14159
  ```

  `to the nearest` and `to 2 decimal places` read the same as their shorter forms. Rounding binds below arithmetic, so `1/3 to 2 dp` rounds a third rather than rounding the 3 and then dividing.

  `round(x)` is untouched: only the word `rounded` became a keyword, because claiming `round` would have broken every existing call. The cost is that `:rounded` is no longer usable as a variable name, the same accepted trade as `between` and `from`.

  **`3 million` works, not just `3M`.** The single-letter magnitudes only ever matched when written touching the number, which is right for letters and wrong for words, so the ordinary spelling failed with "Undefined variable: million". `thousand`, `million`, `billion`, `trillion`, their plurals, and `mn`/`bn`/`tn` are all accepted, with or without the space.

  `5 m` is still five metres, and `million` is still usable as a variable name.

- 73f6353: More word operators, a third conversion keyword, and the length and mass units the tables were missing.

  `with` adds and `without` subtracts, `mul` and `multiplied by` join `times` and `multiply by`, and `into` converts alongside `to` and `in`.

  Eighteen units are new: the surveying chain of lengths (mil, hand, rod, chain, furlong, cable, league) and two metric masses (carat, centner), each with its plural.

  Those needed an architectural change rather than a table entry, because the unit table is generated from an upstream package and cannot be hand-edited. Extended units could previously only define measures the base table had never heard of, and a mixed pair was refused outright as "disjoint by construction". They are not disjoint once an extended unit names a measure the base table also has: a furlong is a length, and both tables state their ratios against the same metre. Extended units now bridge into a shared measure, so `1 mile in furlongs` and `1 m in mil` work in both directions. A measure the base table genuinely has no concept of, such as pace, still cannot cross.

  The unit reference page also lists the extended units now. It was generated from the base table alone and so was short by about thirty spellings, on a page whose first line claims to list every one the engine accepts.

- 4ab427e: Operations spelled out in words.

  Every one of these already existed as a symbol or a function call. What was missing was the spelling anyone reaches for when writing a calculation rather than typing one:

  ```
  3 multiplied by 4        12
  1,000 divided by 200     5
  greater of 100 and 200   200
  lesser of 5 and 10       5
  gcd of 20 and 30         10
  lcm of 5 and 8           40
  square root of 81        9
  cube root of 27          3
  ```

  No new maths: `gcd of 20 and 30` calls the same builtin as `gcd(20, 30)`, and `square root of 81` the same one as `sqrt(81)`. The gap was grammar, not capability, and the function forms are untouched.

  All of them are fused two-word phrases rather than bare keywords, so `:greater` and `:lesser` remain usable as variable names. `larger of 1 + 1 and 3` also parses now, which the operand slot could not express while `and` was still the `+` token.

### Patch Changes

- 4ab427e: `average of 36, 42, 19 and 81` returned 59.33. It now returns 44.5.

  The word "and" is a synonym for `+` in this engine ("5 and 3" is 8), and that was implemented by mapping the word onto the PLUS token in the locale keyword table. Every phrase that uses "and" to separate a list therefore parsed its last two items as one sum: the line above read as three arguments, the last being 19 + 81, and divided 178 by 3. `median of 10, 20 and 30` answered 30 rather than 20 for the same reason.

  `total of 3, 4, 7 and 9` was the example the original tests used, and it hid the bug perfectly, because summing four numbers and summing three numbers where two have been pre-added give the same total.

  The word now has its own token type. It still compiles to an addition, so "5 and 3" is unchanged and "true and false" still reads as boolean conjunction, but it binds one step looser than `+`, so a phrase parselet can parse an argument and stop at it.

  That also removes a workaround. Parselets taking "X and Y" operands had to parse X at multiplication precedence to stop "and" swallowing "and Y", which stopped a genuine `+` too, so `midpoint between 100 + 50 and 300` could not be written. It parses now.

- 92a994e: Fixed the three open CodeQL alerts.

  Both worker `postMessage` handlers (`packages/engine/src/workers/engine.worker.ts` and `packages/playground-bridge/src/engine.worker.ts`) now check the incoming message's origin against the worker's own before trusting `event.data`. A dedicated worker can only ever be constructed same-origin, so this never legitimately rejects a real message, but the handlers previously trusted `event.data` unconditionally. The check is skipped, not enforced, when either side is unset, which covers the test harnesses that drive these handlers directly with a plain object and no `location` global, without opening anything a real message could exploit: a browser-populated `event.origin` cannot be spoofed by the sender.

  `scripts/check-comment-style.mjs`'s control-character rule matched the right three ranges (`\x00-\x08`, `\x0B-\x1F`, `\x7F-\x9F`, deliberately excluding tab and newline) but wrote them as literal raw bytes instead of escape sequences, which is invisible in most editors and exactly the class of problem the rule's own doc comment warns about. Rewritten as `\x00-\x08\x0B-\x1F\x7F-\x9F`, with identical matching behaviour confirmed against both the intended control characters and ordinary printable text.

- 6be77e0: The CPI table's two projected years are now derived from published data.

  The table carried a warning that 2025 and 2026 were projections from model knowledge rather than published figures, and nothing checked how far off they were. Measured against the IMF monthly CPI series for the USA, chaining annual mean year-over-year rates forward from the published 2024 figure:

  ```
  year   table    from IMF   difference
  2021   271.0    270.9      -0.02%
  2022   292.7    292.6      -0.02%
  2023   304.7    304.7      +0.02%
  2024   313.7    313.7      +0.01%
  2025   320.6    322.2      +0.49%   <- projection
  2026   327.4    332.7      +1.63%   <- projection
  ```

  The published years were already right to two hundredths of a percent. Only the two projections drifted, and they are now the IMF-derived figures. Cumulative inflation from 2024 to 2026 was understated as 4.37% where the series shows 6.05%.

  `CpiTableAccuracy.spec.ts` pins this against fixed numbers rather than a live fetch, because a test that calls a network service fails when the service is down, and the job here is to catch the table being edited wrongly.

- Cross-line references now work on the right-hand side of a bare assignment.

  `total = prev` reported "Cross-line references require a real document" even when it was inside one. The same happened for `x = line2`, `x = prev + 1`, and any range or `above` aggregation written as an assignment's value. A bare expression line (`prev + 1`) was unaffected, so the gap was specific to a reference sitting on an assignment's right-hand side.

  A bare assignment evaluates its right-hand side through the symbolic-tolerant path, the one `=>` and equation solving also use, and that path executed its bytecode with no per-line execution context. `prev`, `line<N>` and the aggregations read the document through that context, so without it they could not tell they were inside a document at all and returned `LINE_REF_NO_DOCUMENT`. The path now receives the line number and builds the same context an ordinary line does:

  ```
  eggs = 100
  fries = 2.02
  total = prev     2.02
  ```

  Bare expression lines were already correct and are unchanged. Outside a document, `evaluateExpression("total = prev")` still returns a clear error rather than guessing a value.

- e3013dc: Two of the three runtime dependencies are gone. Installing this package now brings `@tanstack/query-core` and nothing else.

  `tslib` was declared and never used. The build is esbuild, which inlines its own helpers rather than calling tslib's, and at this target it emits none at all: the published `1.0.0-beta.1` contains zero references to it across 96 files. `importHelpers` is off now too, so nothing can ask for it again by accident.

  `semver` is bundled instead of installed. Three functions are used from it, in one file, and none reach the public type surface, so it is an implementation detail rather than part of the contract. Tree-shaking carries only what those three functions touch, and because a consumer's bundler was already pulling semver in through the external import, this does not add anything new to their output. It comes out slightly smaller: 92,677 bytes gzipped to 92,493.

  What does grow is the package on disk, from 2.0 MB to 2.1 MB, because semver's reachable code now lives in `dist` rather than in the consumer's `node_modules`.

  `@tanstack/query-core` stays external on purpose. Its types appear in sixteen shipped declaration files, so inlining the code would leave those pointing at a package the consumer no longer has. It is also the one a consumer might reasonably want to patch or audit, and a bundled dependency can only be updated by a release here.

- Findings from the new fuzzer, all of them the engine reporting its own bug for input a caller or a user supplied, or spending far more time on that input than answering it deserved.

  **Rejecting a long line no longer takes seconds.** A 723-character line took 18 seconds to be refused, and then answered `UNEXPECTED_TRAILING_TOKEN`. A host evaluating as the user types froze for that long. The cost was the labelled-line fallback: when a line does not parse whole, it retries the fragment after each colon, rightmost first, and every retry re-ran the whole fallback on its own suffix. Those inner suffixes are the ones the outer loop already visits, so the work doubled per colon and a line with k colons compiled 2^k times. The retry now gets a plain parse, which loses no coverage: 524,288 parse attempts and 18 seconds became 22 attempts and 3 milliseconds, and a synthetic worst case is now linear in the number of colons.

  **A date literal no longer breaks the resolver preflight.** `OpCode.DATE_LITERAL` was missing from the operand-width table, so every scanner that walks bytecode without executing it read the literal's constant-pool index as if it were an opcode and misread the rest of the stream. Preflight runs outside the VM's own try/catch, so the resulting `TypeError` escaped `evaluateExpression()` to the host on input as ordinary as `1-1-2020`.

  **Malformed bytecode is now a validation error rather than an internal one.** `executeBytecode` is a public export, so a bytecode program is caller input in the same sense an expression string is, and it was not being treated that way: a truncated stream, an out-of-range constant-pool index, a unit or converter name that is not a string, or a `map`/`reduce` body kind with no matching arm each reached a raw JavaScript exception, which arrived as `UNEXPECTED_ERROR`. Eleven bytes of nonsense told the caller the engine had a bug. Operands are now checked where they are read and answered with `MALFORMED_BYTECODE_*`, naming the opcode and the operand. `executeBytecode(undefined)` returns an error rather than throwing.

  **Mixing a bigint with something that is not a whole number now says so.** `1n + 0.5`, `1n & 1.5`, `5n/pi` and `e/8n` threw `BigInt()`'s own `RangeError`, relabelled `UNEXPECTED_ERROR`; they now raise `BIGINT_INEXACT_OPERAND` naming the operand. `10n / 0n` raises `BIGINT_DIVISION_BY_ZERO`, which stays deliberately different from `1 / 0` being Infinity: a bigint division is exact integer division (`7n / 2n` is 3n), and integer division by zero has no answer in C, Java, Python or JavaScript's own BigInt either.

  **`gcd` and `lcm` no longer freeze on a value that is not a number.** `gcd(4, arccos(2))` never returned. The Euclidean algorithm ends because the remainder shrinks to zero, and a NaN remainder never does, so nine characters wedged the host permanently inside a single opcode that neither the instruction ceiling nor the allocation budget can see into. Both functions now refuse a non-finite operand, and the two hand-copied loops are one shared one.

  **`1.000n` is refused instead of crashing.** A whole-number literal has no fractional part, so a `.` or `,` inside one is thousands grouping, and nothing stripped it before `BigInt()` saw it. `1,000n` is now 1000n in a locale that groups with commas, `1.234.567n` is 1234567n in any locale, and a single dot group a locale reads as a decimal point is an `INVALID_NUMBER_LITERAL` rather than a guess between 1 and 1000.

- 4ab427e: `$100 in UAH` returned an unconverted hundred dollars.

  Not an error and not a conversion: the original amount, as though the rate were 1. The cause was a hand-written allowlist of forty-six currency codes in `CurrencyExchange.isCurrency()`, so a code missing from it silently did nothing. Roughly 130 active ISO 4217 codes were affected, including UAH, RON, BGN, ISK, TWD, GEL, AZN, UZS, KZT and RSD.

  Recognition now comes from the ISO 4217 active set rather than from whichever codes happened to get added, and a test asserts every one of them is recognised. Recognising a code is not the same as having a rate for it; that stays a separate question answered by the exchange provider, and conflating the two is what produced the silent failure.

  Deliberately still not currencies: `XXX` (the code meaning "no currency"), `XTS` (reserved for testing), the precious metals `XAU`/`XAG`/`XPT`/`XPD`, `XDR`, and withdrawn codes like `DEM`. Cryptocurrencies are recognised as before, separately, since they are not ISO 4217.

  **The silent failure itself is not fixed.** `$100 in ZZZ` still returns an unconverted hundred dollars rather than saying it cannot convert. Widening the table removed the common case, not the failure mode. That is asserted as a known gap and tracked in `docs-internal/PARITY_BACKLOG.md`.

- 727b242: Republish with the code included.

  `1.0.0-beta.0` reached npm containing three files: `LICENSE`, `package.json` and `README.md`. Those are the ones npm adds whatever `files` says, so the published package had no code in it and `import { ExpressionEngine } from "solve-engine"` failed on install. `files` lists `dist`, the build had not run on the machine that published, and npm packed the absence without comment.

  Nothing in the pipeline could have caught it. `publint`, `arethetypeswrong` and the smoke test all read `packages/engine/dist` from the working tree, where a previous job had just built it, rather than reading the tarball. They proved the build worked and said nothing about what got packed.

  Two checks now sit in the way. `prepublishOnly` builds and then refuses to publish unless every `files` entry exists and is non-empty and `main`, `module` and `types` all resolve. And a consumer test packs the package, installs the tarball into a scratch project, and exercises the public API by bare specifier through ESM and CJS, so what is verified is what npm would actually serve.

  No API changed. This release exists because the last one shipped empty.

- 7748381: `"sideEffects": false` is now proven rather than assumed.

  That field is a promise to bundlers that nothing in this package does work worth keeping at import time, and it is one this package had never checked. Nothing in the pipeline could check it: the test suite runs against `src`, and the smoke test, the publishable assertion and the consumer test all reach the built package through Node's ESM loader, which evaluates every module it is told to load regardless of what any manifest claims. All of them pass whether the promise holds or not. The only person who would find out otherwise is a consumer bundling with Rollup, webpack or Vite, and what they would get is an engine whose token type ids were never registered.

  The promise was not idle. tsup's code splitting emits twenty six bare chunk imports at the top of `dist/index.js`, and `"sideEffects": false` tells a bundler it may delete every one of them; esbuild already says so during `npm run size`, once per import, as `[ignored-bare-import]`. Behind those imports is real load-time work: `registerAllTokenTypes()`, the parser's binding power table and its cached token ids, and several process-wide registries.

  It holds, for a reason narrower than it first appears. Rollup's `moduleSideEffects: false` only means it will not include a module merely because something imports it; effectful top-level statements in a module that is included for its bindings survive. So the only thing genuinely at risk is a chunk reachable through bare imports alone, and every chunk here that does load-time work, twenty two of forty nine, is also imported for its bindings somewhere. The one chunk reachable only by bare import contains two source map comments and nothing else.

  That is a property of how tsup currently splits the code, not a design guarantee, so it is now checked on every run of `npm run verify`, which includes the run that gates publishing. `npm run smoke:bundled` bundles a real consumer with Rollup, applying this package's own `sideEffects` field the way Vite applies it, and fails if the bundled run disagrees with the same script run directly under Node. It then audits every chunk in `dist` for load-time work reachable only through bare imports, because the first check passing depends on a chunk graph that a re-split could change without the consumer fixture noticing.

  No API changed, and no behaviour changed for anyone importing this package today. What changed is that the guarantee is now falsifiable.

## 1.0.0-beta.7

### Patch Changes

- 2a9afc7: The published README and npm package description now match the repository's, and the origin-check and control-character-regex CodeQL fixes actually reach npm.

  `latest` has been stuck on `1.0.0-beta.2` since it was accidentally published there instead of `beta`, so npm's package page (and `npm install solve-engine` with no tag) has been showing that old version's README the whole time, regardless of what landed on `main` since. This patch is what finally moves `latest` forward under the simplified always-publish-to-latest release policy.

## 1.0.0-beta.6

### Patch Changes

- 92a994e: Fixed the three open CodeQL alerts.

  Both worker `postMessage` handlers (`packages/engine/src/workers/engine.worker.ts` and `packages/playground-bridge/src/engine.worker.ts`) now check the incoming message's origin against the worker's own before trusting `event.data`. A dedicated worker can only ever be constructed same-origin, so this never legitimately rejects a real message, but the handlers previously trusted `event.data` unconditionally. The check is skipped, not enforced, when either side is unset, which covers the test harnesses that drive these handlers directly with a plain object and no `location` global, without opening anything a real message could exploit: a browser-populated `event.origin` cannot be spoofed by the sender.

  `scripts/check-comment-style.mjs`'s control-character rule matched the right three ranges (`\x00-\x08`, `\x0B-\x1F`, `\x7F-\x9F`, deliberately excluding tab and newline) but wrote them as literal raw bytes instead of escape sequences, which is invisible in most editors and exactly the class of problem the rule's own doc comment warns about. Rewritten as `\x00-\x08\x0B-\x1F\x7F-\x9F`, with identical matching behaviour confirmed against both the intended control characters and ordinary printable text.

## 1.0.0-beta.5

### Patch Changes

- 6be77e0: The CPI table's two projected years are now derived from published data.

  The table carried a warning that 2025 and 2026 were projections from model knowledge rather than published figures, and nothing checked how far off they were. Measured against the IMF monthly CPI series for the USA, chaining annual mean year-over-year rates forward from the published 2024 figure:

  ```
  year   table    from IMF   difference
  2021   271.0    270.9      -0.02%
  2022   292.7    292.6      -0.02%
  2023   304.7    304.7      +0.02%
  2024   313.7    313.7      +0.01%
  2025   320.6    322.2      +0.49%   <- projection
  2026   327.4    332.7      +1.63%   <- projection
  ```

  The published years were already right to two hundredths of a percent. Only the two projections drifted, and they are now the IMF-derived figures. Cumulative inflation from 2024 to 2026 was understated as 4.37% where the series shows 6.05%.

  `CpiTableAccuracy.spec.ts` pins this against fixed numbers rather than a live fetch, because a test that calls a network service fails when the service is down, and the job here is to catch the table being edited wrongly.

## 1.0.0-beta.4

### Minor Changes

- 4ab427e: Durations written as several units, and written back out.

  `3 hours 5 minutes 10 seconds` did not parse. The parts sat next to each other as separate quantities and the parser reported an unexpected number, which is why the timespan, clock and several unit examples all failed in the same place. They now sum into one quantity that converts, adds and compares like any other:

  ```
  3 hours 5 minutes 10 seconds in seconds    11,110
  5 hours 30 minutes to seconds              19,800
  3h 5m 10s in seconds                       11,110
  1 kilometre 500 metres in metres           1,500
  ```

  The rule is deliberately narrow, because a run of number-unit pairs is also what ordinary arithmetic produces. Parts must share a measure, must strictly decrease, and must be unsigned, so `3 hours 5 metres`, `5 minutes 3 hours` and `3 hours - 30 minutes` are all left alone.

  `as timespan` and `as laptime` are the inverse, and neither existed despite being credited to the time package:

  ```
  5.5 minutes as timespan    5 minutes 30 seconds
  72 days as timespan        10 weeks 2 days
  5.5 minutes as laptime     00:05:30
  ```

  Laptime hours are not wrapped at 24, since a twenty-six hour measurement is real. A fractional remainder is kept rather than rounded away, and a non-duration says so rather than being treated as seconds.

- 4ab427e: Percentages are relative, and the investments syntax works.

  **`200 + 10%` is 220.** It used to be 200.10, because `%` compiled to a literal divide-by-100 and the result was an ordinary number. A percentage is a proportion _of_ something, so which reading applies now depends on what it sits next to: `$300 + 15%` is `$345.00` and keeps its currency, `10% + 20%` is `30%`, and `100% + 2` is `300%` rather than `3`. Multiplication is untouched, because there the percentage is already the factor it is: `50% × 30` is still 15, and a bare `15%` is still 0.15.

  This changes answers previously pinned by issues #79 and #81. Those regression tests are updated rather than removed, and both issues' actual complaints still hold.

  **Soulver's documented investment expressions parse.** Previously every one of them threw; only the mortgage grammar worked. Now:

  ```
  $1,000 after 3 years at 7%                                    $1,225.04
  $1,000 for 3 years at 7% compounding monthly                  $1,232.93
  $1,000 for 3 years at 7% compounding quarterly                $1,231.44
  interest on $1,000 after 3 years @ 7%                         $225.04
  present value of $1,000 after 20 years at 10%                 $148.64
  $500 invested $1,500 returned                                 2
  annual return on $1,000 invested $2,500 returned after 7 years   13.99%
  ```

  `compounding` accepts daily, weekly, fortnightly, monthly, quarterly, semi-annually and annually, and names the whole set when given something else. Return on investment is the gain against the cost, so tripling your money is a 2x return; the money multiple is `$1,500 / $500`. The annualised return is the compound rate that actually reproduces the figure, returned as a percentage.

  The older `compound interest on X over Y years at Z%` spelling still parses, and `after`, `for`, `over`, `at` and `@` are now interchangeable where they read naturally.

- 4ab427e: Solving for the missing part of a percentage, base conversions in words, and a multiplier fix.

  **`20/5 as multiplier` returned 5x. It returns 4x.** The converter added 1 unconditionally, which is right for a percentage (50% more is 1.5x) and wrong for a plain ratio. Telling those apart only became possible once `%` started producing a percentage-typed value.

  **The `is ... what` family.** `5% of what is 6` already worked; this is the order the documentation uses, where you state what you know first:

  ```
  20 is 10% of what        200
  180 is 10% off what      200
  220 is 10% on what       200
  20 is what % of 200      10%
  180 is what % off 200    10%
  180 is what % on 150     20%
  50 to 75 is what %       50%
  50 is 1/5 of what        250
  81 is 9 to what power    2
  ```

  **Base conversion in the other prepositions.** `256 as hex` always worked; `99 in binary`, `0x9F31 to decimal` and `0b1000101 to octal` did not, because `in` belongs to unit conversion and `to` to percentage change. They are rewritten to `as` before parsing, so each of those parselets keeps one job. `as base 2`, `as base 8` and `as base 16` also work, and an unsupported radix says which ones do.

- 4ab427e: Rounding, and magnitudes written as words.

  **Rounding is now something you can write in an expression.** The engine could already round, but only by configuring the formatter, which changes how every answer is displayed rather than rounding one value inside a calculation. The two are not the same: the formatter cannot express `21 rounded up to nearest 5`, and it cannot feed a rounded number into the next line.

  ```
  5.5 rounded                       6
  5.5 rounded down                  5
  37 to nearest 10                  40
  $490 rounded to nearest hundred   $500
  21 rounded up to nearest 5        25
  1/3 to 2 dp                       0.33
  pi to 5 digits                    3.14159
  ```

  `to the nearest` and `to 2 decimal places` read the same as their shorter forms. Rounding binds below arithmetic, so `1/3 to 2 dp` rounds a third rather than rounding the 3 and then dividing.

  `round(x)` is untouched: only the word `rounded` became a keyword, because claiming `round` would have broken every existing call. The cost is that `:rounded` is no longer usable as a variable name, the same accepted trade as `between` and `from`.

  **`3 million` works, not just `3M`.** The single-letter magnitudes only ever matched when written touching the number, which is right for letters and wrong for words, so the ordinary spelling failed with "Undefined variable: million". `thousand`, `million`, `billion`, `trillion`, their plurals, and `mn`/`bn`/`tn` are all accepted, with or without the space.

  `5 m` is still five metres, and `million` is still usable as a variable name.

- 73f6353: More word operators, a third conversion keyword, and the length and mass units the tables were missing.

  `with` adds and `without` subtracts, `mul` and `multiplied by` join `times` and `multiply by`, and `into` converts alongside `to` and `in`.

  Eighteen units are new: the surveying chain of lengths (mil, hand, rod, chain, furlong, cable, league) and two metric masses (carat, centner), each with its plural.

  Those needed an architectural change rather than a table entry, because the unit table is generated from an upstream package and cannot be hand-edited. Extended units could previously only define measures the base table had never heard of, and a mixed pair was refused outright as "disjoint by construction". They are not disjoint once an extended unit names a measure the base table also has: a furlong is a length, and both tables state their ratios against the same metre. Extended units now bridge into a shared measure, so `1 mile in furlongs` and `1 m in mil` work in both directions. A measure the base table genuinely has no concept of, such as pace, still cannot cross.

  The unit reference page also lists the extended units now. It was generated from the base table alone and so was short by about thirty spellings, on a page whose first line claims to list every one the engine accepts.

- 4ab427e: Operations spelled out in words.

  Every one of these already existed as a symbol or a function call. What was missing was the spelling anyone reaches for when writing a calculation rather than typing one:

  ```
  3 multiplied by 4        12
  1,000 divided by 200     5
  greater of 100 and 200   200
  lesser of 5 and 10       5
  gcd of 20 and 30         10
  lcm of 5 and 8           40
  square root of 81        9
  cube root of 27          3
  ```

  No new maths: `gcd of 20 and 30` calls the same builtin as `gcd(20, 30)`, and `square root of 81` the same one as `sqrt(81)`. The gap was grammar, not capability, and the function forms are untouched.

  All of them are fused two-word phrases rather than bare keywords, so `:greater` and `:lesser` remain usable as variable names. `larger of 1 + 1 and 3` also parses now, which the operand slot could not express while `and` was still the `+` token.

### Patch Changes

- 4ab427e: `average of 36, 42, 19 and 81` returned 59.33. It now returns 44.5.

  The word "and" is a synonym for `+` in this engine ("5 and 3" is 8), and that was implemented by mapping the word onto the PLUS token in the locale keyword table. Every phrase that uses "and" to separate a list therefore parsed its last two items as one sum: the line above read as three arguments, the last being 19 + 81, and divided 178 by 3. `median of 10, 20 and 30` answered 30 rather than 20 for the same reason.

  `total of 3, 4, 7 and 9` was the example the original tests used, and it hid the bug perfectly, because summing four numbers and summing three numbers where two have been pre-added give the same total.

  The word now has its own token type. It still compiles to an addition, so "5 and 3" is unchanged and "true and false" still reads as boolean conjunction, but it binds one step looser than `+`, so a phrase parselet can parse an argument and stop at it.

  That also removes a workaround. Parselets taking "X and Y" operands had to parse X at multiplication precedence to stop "and" swallowing "and Y", which stopped a genuine `+` too, so `midpoint between 100 + 50 and 300` could not be written. It parses now.

- 4ab427e: `$100 in UAH` returned an unconverted hundred dollars.

  Not an error and not a conversion: the original amount, as though the rate were 1. The cause was a hand-written allowlist of forty-six currency codes in `CurrencyExchange.isCurrency()`, so a code missing from it silently did nothing. Roughly 130 active ISO 4217 codes were affected, including UAH, RON, BGN, ISK, TWD, GEL, AZN, UZS, KZT and RSD.

  Recognition now comes from the ISO 4217 active set rather than from whichever codes happened to get added, and a test asserts every one of them is recognised. Recognising a code is not the same as having a rate for it; that stays a separate question answered by the exchange provider, and conflating the two is what produced the silent failure.

  Deliberately still not currencies: `XXX` (the code meaning "no currency"), `XTS` (reserved for testing), the precious metals `XAU`/`XAG`/`XPT`/`XPD`, `XDR`, and withdrawn codes like `DEM`. Cryptocurrencies are recognised as before, separately, since they are not ISO 4217.

  **The silent failure itself is not fixed.** `$100 in ZZZ` still returns an unconverted hundred dollars rather than saying it cannot convert. Widening the table removed the common case, not the failure mode. That is asserted as a known gap and tracked in `docs-internal/PARITY_BACKLOG.md`.

## 1.0.0-beta.3

### Minor Changes

- d2f9c9b: Highlighting can now see phrase-fused tokens, behind `normalizeForHighlighting`.

  `LanguageService` classifies at the lexer stage, which means a token type that only exists after normalization was never reachable from the highlighting path. That was documented and deliberate, but it had a consequence nobody had measured: all four token types mapped to the `datetime` category (`DATETIME_LITERAL`, `DURATION`, `VIDEO_TIMECODE`, `FRAME_COUNT`) are produced by normalizer rules, so no editor using this API has ever highlighted a date as a date. `12/09/2026` came back as number, operator, number, operator, number.

  ```ts
  const language = new LanguageService(engine, {
    normalizeForHighlighting: true,
  });
  language.getSemanticTokens("12/09/2026", 1);
  // one span, category "datetime", covering the whole date
  ```

  Off by default. It is a behaviour change for anything already painting these lines, spans merge and categories move, and it costs real work per keystroke, so a host should opt into it rather than inherit it from a version bump.

  What it costs, from `benchmarks/languageServiceBenchmarks.spec.ts`, median per call:

  | line                      | lexer only | normalized |
  | ------------------------- | ---------- | ---------- |
  | `1 + 2 * 3`               | 0.006 ms   | 0.009 ms   |
  | `$10 + 50% of 200 - 3 kg` | 0.009 ms   | 0.013 ms   |
  | fifty terms               | 0.209 ms   | 0.381 ms   |
  | prose                     | 0.031 ms   | 0.038 ms   |

  Roughly three microseconds on a typical line, and the result is cached per line, so an edit pays it once for the line that changed.

  The hard part was putting the tokens back. A fused token's `value` is its replacement rather than its source (`10 frames` becomes a `FRAME_COUNT` whose value is `10`), so `Token` gains an optional `sourceEnd` recording where the source text ended, stamped centrally by the normalizer for every one-replaces-many fusion rather than left to each rule to remember. Inserted tokens, such as the `*` implicit multiplication puts at the following token's offset, have no source text at all and are dropped rather than painted over the character that is really there.

### Patch Changes

- 7748381: `"sideEffects": false` is now proven rather than assumed.

  That field is a promise to bundlers that nothing in this package does work worth keeping at import time, and it is one this package had never checked. Nothing in the pipeline could check it: the test suite runs against `src`, and the smoke test, the publishable assertion and the consumer test all reach the built package through Node's ESM loader, which evaluates every module it is told to load regardless of what any manifest claims. All of them pass whether the promise holds or not. The only person who would find out otherwise is a consumer bundling with Rollup, webpack or Vite, and what they would get is an engine whose token type ids were never registered.

  The promise was not idle. tsup's code splitting emits twenty six bare chunk imports at the top of `dist/index.js`, and `"sideEffects": false` tells a bundler it may delete every one of them; esbuild already says so during `npm run size`, once per import, as `[ignored-bare-import]`. Behind those imports is real load-time work: `registerAllTokenTypes()`, the parser's binding power table and its cached token ids, and several process-wide registries.

  It holds, for a reason narrower than it first appears. Rollup's `moduleSideEffects: false` only means it will not include a module merely because something imports it; effectful top-level statements in a module that is included for its bindings survive. So the only thing genuinely at risk is a chunk reachable through bare imports alone, and every chunk here that does load-time work, twenty two of forty nine, is also imported for its bindings somewhere. The one chunk reachable only by bare import contains two source map comments and nothing else.

  That is a property of how tsup currently splits the code, not a design guarantee, so it is now checked on every run of `npm run verify`, which includes the run that gates publishing. `npm run smoke:bundled` bundles a real consumer with Rollup, applying this package's own `sideEffects` field the way Vite applies it, and fails if the bundled run disagrees with the same script run directly under Node. It then audits every chunk in `dist` for load-time work reachable only through bare imports, because the first check passing depends on a chunk graph that a re-split could change without the consumer fixture noticing.

  No API changed, and no behaviour changed for anyone importing this package today. What changed is that the guarantee is now falsifiable.

## 1.0.0-beta.2

### Patch Changes

- e3013dc: Two of the three runtime dependencies are gone. Installing this package now brings `@tanstack/query-core` and nothing else.

  `tslib` was declared and never used. The build is esbuild, which inlines its own helpers rather than calling tslib's, and at this target it emits none at all: the published `1.0.0-beta.1` contains zero references to it across 96 files. `importHelpers` is off now too, so nothing can ask for it again by accident.

  `semver` is bundled instead of installed. Three functions are used from it, in one file, and none reach the public type surface, so it is an implementation detail rather than part of the contract. Tree-shaking carries only what those three functions touch, and because a consumer's bundler was already pulling semver in through the external import, this does not add anything new to their output. It comes out slightly smaller: 92,677 bytes gzipped to 92,493.

  What does grow is the package on disk, from 2.0 MB to 2.1 MB, because semver's reachable code now lives in `dist` rather than in the consumer's `node_modules`.

  `@tanstack/query-core` stays external on purpose. Its types appear in sixteen shipped declaration files, so inlining the code would leave those pointing at a package the consumer no longer has. It is also the one a consumer might reasonably want to patch or audit, and a bundled dependency can only be updated by a release here.

## 1.0.0-beta.1

### Patch Changes

- 727b242: Republish with the code included.

  `1.0.0-beta.0` reached npm containing three files: `LICENSE`, `package.json` and `README.md`. Those are the ones npm adds whatever `files` says, so the published package had no code in it and `import { ExpressionEngine } from "solve-engine"` failed on install. `files` lists `dist`, the build had not run on the machine that published, and npm packed the absence without comment.

  Nothing in the pipeline could have caught it. `publint`, `arethetypeswrong` and the smoke test all read `packages/engine/dist` from the working tree, where a previous job had just built it, rather than reading the tarball. They proved the build worked and said nothing about what got packed.

  Two checks now sit in the way. `prepublishOnly` builds and then refuses to publish unless every `files` entry exists and is non-empty and `main`, `module` and `types` all resolve. And a consumer test packs the package, installs the tarball into a scratch project, and exercises the public API by bare specifier through ESM and CJS, so what is verified is what npm would actually serve.

  No API changed. This release exists because the last one shipped empty.
