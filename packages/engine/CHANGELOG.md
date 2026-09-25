# solve-engine

## 2.41.0

### Minor Changes

- 0b876a4: `ans` is the line above, and a bare `sum` or `total` says to write `total above`
  
  Numi, Numbr, NumPad and SpeedCrunch users write `ans` for the previous answer and a bare `sum` or `total` under a column. The engine spells those `prev` and `total above`, and answered both habits with an undefined variable that gave no hint (#668).
  
  | note | before | now |
  | --- | --- | --- |
  | `10`, `ans * 2` | Undefined variable: ans | 20 |
  | `ans = 5`, `ans * 2` | 10 | 10 |
  | `10`, `20`, `sum` | Undefined variable: sum | Undefined variable: sum. To add up the lines above, write "total above". |
  | `ans * 2` through `evaluateExpression` | throws Undefined variable: ans | the error value `prev` gives outside a document |
  
  `ans` means the line above only when nothing in the note is named `ans`: a note that defines it gets its variable, as before. Where `prev` has nothing to read (the first line, after a blank line or a heading, after a line that failed) `ans` gives the same answer `prev` does, and it takes the same dependency on the line above, so an edit to that line reaches it in a live editor. Both document passes agree.
  
  What this does not do: a bare `sum` or `total` does not become a total. A note full of prose must never start producing numbers from a word, so reading the bare word as the column is its own, larger feature. `Ans` and `ANS` are ordinary names, as other variables are.
  
  The line-references page lists `ans` and says what a bare `sum` does.
  
  ## Verification
  
  `Issue668_ansAndBareTotals.spec.ts` has 16 tests: `ans` reading the line above, a variable named `ans` winning, an edit above reaching it in a live editor, and the single-expression refusal; adversarial cases where `prev` has nothing to read, an `ans` defined below its first use, and `Ans` and `ANS` as ordinary names; and a bare `sum` or `total` in four spellings, a defined one, and a near miss that keeps its own suggestion. `CrossPathDocumentFeatures.spec.ts` runs `ans`, a defined `ans` and the places `prev` has nothing to read through `parseDocument` and `evaluateDocument` and asserts they agree; the single-expression refusal is pinned in the issue spec.
  
  The engine suite is 14,209 tests in 588 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,331 bytes on Node 24, 14,109 under the ceiling) and the bundled-consumer contract.
- def27fc: Eight faults a host meets at the engine's edges: a defined function takes over its name, a promise from a plugin never settles, a restored snapshot calls the wrong function, and five smaller ones
  
  These are the survey's host-facing faults (#658 to #665): each is something an embedding application, a package author or a worker host runs into, rather than a reader typing a line.
  
  **`defineFunction` no longer claims its name everywhere (#659).** The name was registered as a lexer keyword, which is unconditional, so with `price` defined every other use of the word stopped parsing. It is now a call word, the built-in `sha256(` shape: the call only where `(` follows, never after `:`, matched without regard to case.
  
  | with `price` defined | before | now |
  | --- | --- | --- |
  | `price(100)` | = 120 | = 120 |
  | `:price = 5` | Expected identifier or unit after colon, got DEFINE_FN_PRICE | = 5 |
  | `price * 2` (after `:price = 5`) | Expected token type "LPAREN" but got "STAR" | = 10 |
  | `price: 3` | Expected token type "LPAREN" but got "COLON" | = 3 |
  
  The call highlights as a function and appears in completion with its signature (`price(x: number): number`). A name the engine already reads as something else, a unit (`kg`), a keyword (`in`) or a built-in function (`sqrt`), could never become the call, so registering it is refused with `PLUGIN_CALL_FUSION_UNREACHABLE`; that refusal applies to any package's `callFusions`, and `createEngine` logs it and carries on without the package. Two packages declaring the same call word for different tokens now raise a `callFusionName` compatibility warning; the later one is in force, as before. Building the adversarial cases found a second fault underneath: plugin-function names are engine-wide, so a defined function called `sum`, `average` or `count` took over the tags package's function of that name, and `total of #a` failed, while defined and after it was removed. A defined function's internal name is now prefixed, and unregistering any package hands a shared plugin-function name back to the previous claimant instead of deleting it for both.
  
  **A plugin function's promise settles (#660).** A handler may return a promise, and the engine awaited it only to learn that it had settled; the re-run called the handler again, got a new promise, and the line stayed pending for good. The settled value is now kept under the call's key, the function and each argument's type, value and unit.
  
  | `slowdouble(21)`, a handler resolving after 20 ms | before | now |
  | --- | --- | --- |
  | through the documented `lines-updated` loop | still pending after 16 evaluations, 31 handler calls | = 42 on the second evaluation, two handler calls in all |
  
  Once the promise has settled, the re-run asks the handler once more, because handlers read the contract two ways. One stores what it fetched and answers the re-run itself, as the historical exchange rate does; that answer is used, as before. One with no store of its own returns another promise, and is answered with what the first one settled to and not called again for that argument list. A re-evaluation while the promise is in flight, or a second line with the same arguments, shares the one call. A rejection settles to `PLUGIN_CALL_FAILED` with its message, and a promise resolving to something that is not a value to `PLUGIN_RESULT_NOT_A_VALUE`. A settled answer is kept for the engine's life (a thousand calls at most) and dropped when its package is unregistered: a raw handler has no refresh and no retry, which is what `createQueryResolver` is for. A synchronous handler builds no key and pays nothing.
  
  **A restored snapshot relinks its plugin calls by name (#658).** A plugin function's index is handed out process-wide in registration order, and a snapshot carried bytecode with those indices baked in, so the same packages in another order, or another engine registered first, ran another function. Snapshots are now format version 2: each call a compiled program makes is recorded by package and function name, and `fromJSON` points it at that function on the restored engine.
  
  | restored in another process | before | now |
  | --- | --- | --- |
  | `zbeta(21)`, packages passed as `zbeta, zalpha` | = 1,021 (`zalpha`'s answer) | = 42 |
  | the `zalpha` package left out | `zalpha(21)` = 42 | refused: `SNAPSHOT_PACKAGE_MISSING` |
  
  A version 1 snapshot still restores: it names no calls, so its cached lines that call a plugin function are left out and recompile when next evaluated. A call compiled with a one-byte index that the restoring engine holds past 255 is left out the same way, since it cannot be widened in place.
  
  **The internal worker offload no longer re-runs lines without their variables (#661).** When live data landed and more than fifty lines depended on it, the batcher sent their bytecode to the internal execution pool, whose workers hold none of the document's variables or packages. With a worker factory registered, every `price * qty` came back as "Undefined variable: price". A re-run of any size now stays on the main thread, and answers as it does with no factory (`$33.00` for the survey's document). Compilation still moves to the worker; performance.mdx says so and no longer claims execution does.
  
  **The worker DTO carries an error's code (#662).** `5 kg in m` crossed the worker boundary as its message alone. `SerializedWorkerValue` has an optional `errorCode` (`INCOMPATIBLE_UNITS`), set only on an error, so a host branches on the code rather than the words. `EventTargetLike` accepts a DOM `Worker`, a `DedicatedWorkerGlobalScope` and a `MessagePort` under `strict`, where the guide's `eventTargetTransport(worker)` used to fail to compile, and it and `MessagePortLike` are exported.
  
  **A replayed parse error has its own span (#663).** The engine remembers a text that failed to parse, and replayed the error first thrown, span included. `3 + * 4` evaluated on its own after a document had held it on line 4 reported line 4, offset 22; it now reports line 1, column 5, as a fresh engine does, and each replay is its own error object.
  
  **`editLine` compares the text, not only its hash (#664).** djb2 gives `ab` and `bA` one hash, so editing `total = ab * 2` to `total = bA * 2` returned false and kept `= 6`; it now returns true and gives `= 200`. A worker's compile result is checked against the line's text as well, and `isBytecodeValid` takes the text as an optional third argument.
  
  **The snapshot guide says what `toJSON` leaves out (#665).** It said a variable holding a symbolic value makes `toJSON()` throw. It never did: a symbolic value, a colour, a bill split, a chart or an IP subnet has no snapshot form yet, and the variable or cached line holding one is left out, undefined on the restored engine until the document is re-evaluated. The docs and doc comments now say so, and a spec pins it.
  
  What these do not cover: package-contributed state in a snapshot, serialising symbolic values, cancellation or refresh for a raw plugin handler, and the compile offload's own worker path. The per-engine plugin-function index allocator is part of the 3.0 work; relinking by name is what makes its order irrelevant to a snapshot.
  
  ## Verification
  
  A spec for each issue pins its before/now lines and adversarial cases: a snapshot restored in a separate Node process with the packages reversed, with one missing and after another engine registered first; a hand-edited snapshot; a promise that never settles, one that rejects and one that resolves to something that is not a value; djb2 collision pairs through editLine and the worker boundary; a DOM Worker, a worker scope and a MessagePort type-checked under strict with the DOM and WebWorker libs; and a defined function named after a unit, a keyword, a built-in and another package's call word. The full suite is 14,001 tests in 579 suites, all passing (four skipped), and `npm run verify:ci` passes, including `lint:dispatch-size` (47,481 bytes on Node 24, 13,959 under the ceiling), the three-zone `test:temporal` run and the bundled-consumer contract.
- 0b876a4: `ln(x)` is the natural logarithm, and the docs say which base `log` uses
  
  `ln` was an undefined function, and nothing on the reader pages said that `log` is the natural logarithm, so `log(100)` giving 4.61 read as a wrong answer to anyone expecting a calculator's base-10 key (#667).
  
  | line | before | now |
  | --- | --- | --- |
  | `ln(e)` | Undefined function: ln | 1 |
  | `ln(100)` | Undefined function: ln | 4.61, the same as `log(100)` |
  | `ln(0)` | Undefined function: ln | refused: ln(0) has no real value: ln is only defined for positive numbers. |
  | `ln = 4`, then `ln * 2` | 8 | 8 |
  
  `ln` becomes the call only where a bracket follows it, the way `sha256(` does, so a note that already uses `ln` as a variable keeps working. It has its own builtin index over the same implementation as `log`, so a refusal, an arity error and an explanation all name `ln` as the line wrote it, and the algebra reads it as the logarithm it knows.
  
  `log x base n` is exact at a power now. It divided two natural logarithms, so `log 1000 base 10` came out as 2.9999999999999996 and showed as 3.00; base 10 and base 2 now use their own logarithms, and a result a hair from a whole number that really is the power (`log 81 base 3`) is that whole number.
  
  | line | before | now |
  | --- | --- | --- |
  | `log 1000 base 10` | 3.00 | 3 |
  | `log 81 base 3` | 4.00 | 4 |
  
  What stays: `log` is still base e, since making it base 10 would change every note that uses it. A two-argument `log(x, base)` is not added, because tools disagree on the argument order; `log 8 base 2` already names a base in words, and `log10` and `log2` name the common two. `ln 10` without a bracket is not read.
  
  The number-functions page has a section on logarithms that says all of this.
  
  ## Verification
  
  `Issue667_lnAndLogBase.spec.ts` has 25 tests: `ln` beside `log`, `log10` and `log2` and inside `map`, its explanation and its completion; `log x base n` at powers of 10, 2 and 3 and at a non-power (`log 2 base 10`), its refusals, its explanation and its symbolic change of base; and adversarial cases: `ln` of zero, of a negative number and of a mass, and with no argument or two, each refused under the name it was written with; `ln` as a variable name wherever no bracket follows, on both document passes; and the algebra reading `ln` as the logarithm.
  
  The engine suite is 14,209 tests in 588 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,331 bytes on Node 24, 14,109 under the ceiling) and the bundled-consumer contract.
- 0b876a4: `≤`, `≥`, `√`, `∞` and `π` are read, as `×`, `÷`, `±` and `≠` already were
  
  People paste and type the mathematical symbols: `≥` from a phone keyboard, `π` and `√` from a formula. The engine read the multiplication, division, plus-minus and not-equal signs, but each of these failed in its own way (#669).
  
  | line | before | now |
  | --- | --- | --- |
  | `3 ≥ 2` | Unexpected token after expression: "2" | true |
  | `3 ≤ 2` | Unexpected token after expression: "2" | false |
  | `√16 + 9` | Undefined variable: √16 | 13 |
  | `√(9 + 16)` | Undefined variable: √ | 5 |
  | `π * 2` | Undefined variable: π | 6.28 |
  | `1/∞` | Undefined variable: ∞ | 0 |
  
  `≤` and `≥` are the `<=` and `>=` operators, and highlight as comparisons. `√` is a square root that binds as tightly as a minus sign, so `√16 + 9` is 13 and `2√3` is two times the root of three; it calls the builtin `sqrt` does, so a quantity and a negative number answer as `sqrt(...)` does. `∞` is infinity, and meets the refusals the functions already give it (`sin(∞)` has no real value).
  
  `π` is pi only while nothing in the note is named `π`: `π = 3` then `π * 2` is still 6, on both document passes, as it was.
  
  What is not added: the word `infinity`, which is ordinary English in a line of prose.
  
  The operators page lists the new symbols beside the ones already read.
  
  ## Verification
  
  `Issue669_mathSymbols.spec.ts` has 26 tests: `≤` and `≥` between numbers and between names with no spaces; `√` over a number, a bracket, a quantity, itself and a negative number, and on its own; `∞` and `π`, with the refusals the functions already give infinity and a variable named `π` kept on both passes; and adversarial cases: the word `infinity` as a name, a comparison with nothing on its right, and highlighting that matches the ASCII spellings.
  
  The engine suite is 14,209 tests in 588 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,331 bytes on Node 24, 14,109 under the ceiling) and the bundled-consumer contract.
- 0b876a4: `*=` and `/=` beside `+=` and `-=`, for a balance that grows by a rate
  
  The running-total forms stopped at `+=` and `-=`, so a balance grown by a rate, or a quantity halved in place, could not be written the same way (#670).
  
  | note | before | now |
  | --- | --- | --- |
  | `bal = $100`, `bal *= 1.05` | No prefix parselet found for token: EQUALS | $105.00 |
  | `a = 8`, `a /= 2` | No prefix parselet found for token: EQUALS | 4 |
  | `len = 10 m`, `len /= 4` | No prefix parselet found for token: EQUALS | 2.50 m |
  | `y *= 2`, with nothing named `y` | No prefix parselet found for token: EQUALS | Undefined variable: y |
  
  They are read exactly as `+=` and `-=` are: the right-hand side keeps its own brackets (`q *= 2 + 1` multiplies by 3), the arithmetic is the ordinary multiplication and division, so money stays exact to the penny and a unit stays its unit, and the line answers with the new value. Tracing, renaming and highlighting treat the new lines as they treat a running total, and highlighting one runs nothing.
  
  What differs from `+=`: a first `*=` or `/=` on a name that has not been set is refused as an undefined variable, since starting from zero would make every product zero. `%=` and `^=` are not added.
  
  The variables page shows a balance grown by a rate.
  
  ## Verification
  
  `Issue670_starAndSlashEquals.spec.ts` has 19 tests: the lexer reading both operators while a comment and a plain division stay untouched; running products and quotients over numbers, money (exact to the penny) and quantities, a trace and a rename; and adversarial cases: a first use on an unknown name, division by zero, a missing right-hand side, a number on the left, a length on the right, and highlighting a running product, which runs nothing.
  
  The engine suite is 14,209 tests in 588 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,331 bytes on Node 24, 14,109 under the ceiling) and the bundled-consumer contract.
- 28702fa: Time abbreviations after a number: `$15/hr`, `30 mins` and `10 secs` are units, and so is anything with a micro sign, such as `5 µs`
  
  An hourly rate is usually written `$15/hr` and a meeting `30 mins`. The engine refused both as undefined variables, although it already read the same spellings inside a compact duration: `1hr30min` gave 90 minutes (#666). The unit tables did not spell them, and they are the vocabulary the lexer, the rate and duration rules and the conversions all read. They now carry seven abbreviations, each another name for a unit they already had: `hr` and `hrs` for the hour, `mins` for the minute, `sec` and `secs` for the second, `wks` for the week and `yrs` for the year.
  
  | line | before | now |
  | --- | --- | --- |
  | `$15/hr` | error: Undefined variable: hr | 15.00 USD/hr |
  | `30 mins` | error: Undefined variable: mins. Did you mean min? | 30.00 mins |
  | `10 secs` | error: Undefined variable: secs | 10.00 secs |
  | `3 yrs in months` | error: Undefined variable: yrs | 36.50 months |
  | `2 hours in mins` | refused: "mins" is not a unit. Did you mean min? | 120.00 mins |
  | `90 minutes in hr` | refused: "hr" is not a unit. | 1.50 hr |
  | `$15/hr * 37.5 hrs` | error: Undefined variable: hr | $562.50 |
  | `1hr 30min` | error: Unexpected token after expression: "30" | 90.00 min |
  | `1hr30min` | 90 minutes | 90 minutes |
  
  The abbreviations are added by the table generator from a short, justified list, at the ratio of the unit each one names, so `hr` agrees with `h` to the bit. It checks that `convert`, the package the table is mirrored from, still lacks each one, so an upstream release that adds a spelling fails the generator rather than leaving two definitions. They are lower case only, as every unit spelling is, so `HR` and `Hrs` stay names.
  
  **The micro sign is admitted.** The tables spell every micro unit with both characters a keyboard gives for the prefix, the micro sign (U+00B5) and the Greek small letter mu (U+03BC), but the lexer admitted only ASCII spellings, so `5 µs`, `5 µm` and `250 µg` were all undefined variables while `5 microseconds` worked. A leading micro sign on a spelling the table has is now read as the unit.
  
  | line | before | now |
  | --- | --- | --- |
  | `5 µs in ns` | error: Undefined variable: µs | 5,000.00 ns |
  | `5 μs in ns` | error: Undefined variable: μs | 5,000.00 ns |
  | `3 µm in nm` | error: Undefined variable: µm | 3,000.00 nm |
  | `250 µg in mg` | error: Undefined variable: µg | 0.25 mg |
  | `5 µs + 1 ms` | error: Undefined variable: µs | 1,005.00 µs |
  
  A micro unit as a conversion target already worked (`1 mL in µL` gave 1,000.00 µL), because the word after `in` is read as a unit name directly. `us` is not read as microseconds, because it is also an ordinary word, and a micro sign on anything the table does not spell (`5 µx`) is still an undefined variable.
  
  **A variable with one of these names.** A unit spelling has always been read as a unit when it stands straight after a value, and as your variable where a name stands on its own. The new spellings follow that rule, so two documents that used one as a variable after a value now read the unit, as `h` already did:
  
  | document | before | now |
  | --- | --- | --- |
  | `hr = 2` then `$15/hr` | $7.50 | 15.00 USD/hr |
  | `mins = 4` then `30 mins` | 120 | 30.00 mins |
  | `hr = 2` then `hr * 3` | 6 | 6 |
  | `h = 2` then `$15/h` | 15.00 USD/h | 15.00 USD/h |
  
  Both passes agree on every line above. After a slash with a plain value before it, a defined variable is divided by, for every unit spelling and these seven with them (#642, in its own entry): with `hr = 2`, `30 / hr` is 15.
  
  **A misspelt target is offered units of the same measure.** With `mins` in the table, `5 km in mies` would have offered `miles or mins`, since both are one letter away. Converting from a unit, the refusal now names only the near spellings that measure the same thing, when there are any: `5 km in mies` still offers `miles`, and `5 kg in mies`, with no mass that close, offers both.
  
  The boundary: `m` is still metres outside a compact duration, and `mo` and `d` are unchanged. `60 mph for 2 hours` and `5 ms to ?` fail the same way with the new spellings as with the old, which is a separate question. The time page gains a short-spellings section and the converting-units page a section on the micro sign, both with proven examples, and the unit reference lists the new spellings and the micro ones it could not list before.
  
  ## Verification
  
  `Issue666_timeAbbreviations.spec.ts` has 134 tests: each abbreviation after a number, after a slash and as a conversion target, agreeing with the unit it names to the bit; the compact forms; the micro sign in both characters, as a prefix only; a rate's count keeping a symbol singular; what did not change (`30 min`, `2 wk`, `90m`, capitals, `sec(1)`); a variable of the same name at the start of a line, after a value and as a global, through both document passes; prose; the suggestion filter, with direct tests of `unknownUnitError`; and an adversarial sweep of nine forms over each spelling, answered honestly. `ConvertParity.spec.ts` checks each added spelling against the upstream unit it names in every sweep, and pins the seven as the only additions; `UnitVocabulary.spec.ts` pins the micro sign. The unit reference is regenerated and `lint:units` passes.
  
  The engine suite is 15,164 tests in 602 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including `lint:units`, the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,528 bytes on Node 24, 13,912 under the ceiling) and the bundled-consumer contract.

### Patch Changes

- d4b35f1: A clock sum after a minus is read left to right
  
  The rule that adds bare clock times (`8:15 + 7:45`) fused any run of them joined by `+`, without looking at what came before it. After a minus that took the wrong times: in `17:30 - 9:00 + 0:45` it fused `9:00 + 0:45` into 585 minutes, and the line read as `17:30 - 585 minutes`, a time of day (#628). A run is now fused only where a sum can start (the start of an expression, or after a bracket, an `=`, a comma or another `+`), and a run added to a clock subtraction is a length of time added to that shift, which stays a span.
  
  | line | before | now |
  | --- | --- | --- |
  | `17:30 - 9:00 + 0:45` | 7:45 AM today | 9:15 |
  | `18:00 - 12:55 + 1:00 + 0:30` | 3:35 AM today | 6:35 |
  | `(9:30 - 8:30) + 1:00` | 2:00 AM today | 2:00 |
  
  The sums the rule was written for are unchanged (`8:15 + 7:45 + 8:30` is 1,470 minutes), and so is a bracket that asks for the other reading: `17:30 - (9:00 + 0:45)` is still a time of day, 9:45 before half past five. After a `*` or `/` the run is left to precedence, so `2 * 1:00 + 0:30` multiplies a time of day, which is refused by name.
  
  The timesheets page shows a shift with overtime added.
  
  ## Verification
  
  A new spec pins each shape through both document passes, including a column of them under `total above`, the boundary cases, and every operator in front of a run; the time suites pass unchanged. It shipped with the percentages fixes, under the same full-suite run: 13,905 tests in 571 suites.
- d1ffc5e: Dates and times: Oct and Dec are months, a dotted time keeps its minutes, a moment is refused in arithmetic, a pace may carry its minute unit, and a date moves only by a length of time
  
  Nine date and time faults from the 2026-09-25 survey. Most gave a number that looked like an answer and was not one: a date's epoch milliseconds, or a date left where it was.
  
  **Oct and Dec are months (#623).** `oct` and `dec` also name the octal and decimal conversions, so they lexed as those, and the month-name rule never saw them. The rule now takes them too, except straight after `as`, `in` or `to`, where they are still the conversion.
  
  | line | before | now |
  | --- | --- | --- |
  | `1 Oct 2026` | error: Unexpected token after expression: "Oct" | Thursday, October 1, 2026 |
  | `25 Dec 2026` | error: Unexpected token after expression: "Dec" | Friday, December 25, 2026 |
  | `255 as dec` | 255 | 255 |
  
  **A dotted time keeps its minutes (#624).** `3.30pm` read its hour from the number the lexer made of `3.30`, which is 3.3, so it was 3:00 PM. The hour and minutes are now read from the text. Only two digits after the point are minutes: `3.5pm` could mean half past or five past, so it is not read as a time at all.
  
  | line | before | now |
  | --- | --- | --- |
  | `3.30pm` | 3:00 PM today | 3:30 PM today |
  | `10.45am` | 10:00 AM today | 10:45 AM today |
  
  **A date or time is refused in arithmetic (#625).** Only `+` and `-` guarded a date, so everything else read it as its epoch milliseconds. Multiplying, dividing, a remainder, a power, a negation, the numeric functions, `% of`, `as %`, and a unit written after a clock time are each refused by name now, with a pointer to the ways a length of time is written. Figures from 25 September 2026 at about 15:00 in London, since each carried the day's date:
  
  | line | before | now |
  | --- | --- | --- |
  | `1:30 * 3` | 5,370,888,600,000 | A date or time cannot be multiplied: it is a moment, not an amount. A length of time is written 1h30m, 90 minutes or 1:30:00. |
  | `round(1:30)` | 1,790,296,200,000 | round takes a number, not a date or time: ... |
  | `1:30 hours in minutes` | 107,417,772,000,000 minutes | A date or time cannot take a unit, hours: ... |
  | `1 Jan 2026 as %` | 176722560000000.00% | A date or time cannot be written as a percentage: ... |
  
  Comparisons, `min` and `max`, `as number`, `to timestamp` and spans are unchanged, since they ask about order or for the number: `9:00 > 8:00` is true, `1 Jan 2026 as number` is 1,767,225,600,000 and `(9:30 - 8:30) * 3` is 3:00. A host with `date.onAmbiguous: "arithmetic"` no longer gets the fourteen-digit answer for `29 February 2026`, which was 29 times the instant of 1 February; it gets the multiplication refusal.
  
  **A pace may carry its minute unit, or `per` (#626).** The pace rule wanted the slash straight after the seconds.
  
  | line | before | now |
  | --- | --- | --- |
  | `5:30 min/km` | 29838510000:00:00 /km | 5:30 /km |
  | `5:30 min per km` | 29838510000:00:00 /km | 5:30 /km |
  | `10 km at 5:30 min/km` | 17,903,106,000,000.00 min | 3,300 seconds |
  
  Only a minute unit is read this way; `5:30 h/km` is refused as a clock time with a unit.
  
  **A date moves only by a length of time (#627).** A unit that is not a time was read as nothing and a bare number as milliseconds, so the date came back unchanged or a few milliseconds on.
  
  | line | before | now |
  | --- | --- | --- |
  | `1 Jan 2026 + 5 kg` | Thursday, January 1, 2026 | A date or time moves by a length of time, such as 5 days, 2 weeks or 3 hours, not by a mass. |
  | `1 Jan 2026 + 5` | Thursday, January 1, 2026, 12:00:00 AM | A date or time moves by a length of time, and a plain number does not say whether it means days, hours or minutes. Write the unit, as in + 5 days. |
  
  A bare number is refused rather than read as days, since nothing on the line says which unit it means. `+ 5 days`, `+ 5 workdays`, `+ 1 month`, `+ 1h30m` and a span from subtracting two times all move a date as before. `2026-04-03 in GMT+9`, read as `(2026-04-03 in GMT) + 9`, is now this refusal rather than nine milliseconds; the time-zones page says so.
  
  **A span stays a span with a length of time added (#629).** Only two spans added together, or a span scaled by a number, kept the clock display.
  
  | line | before | now |
  | --- | --- | --- |
  | `(9:30 - 8:30) + 30 minutes` | 5,400,000.00 ms | 1:30 |
  | `30 minutes + (9:30 - 8:30)` | 90 minutes | 1:30 |
  
  A typed quantity in milliseconds keeps its milliseconds: `(9:30 - 8:30) + 40ms` is 3,600,040.00 ms, since a clock shows whole seconds.
  
  **`workdays between` counts the calendar (#630).** It fell to the generic `<unit> between`, whose workday is a fixed seven fifths of a day.
  
  | line | before | now |
  | --- | --- | --- |
  | `workdays between 01/01/2024 and 31/01/2024` | 21.43 workdays | 23 |
  | `how many working days between 01/01/2024 and 31/01/2024` | error: Unexpected token after expression: "many" | 23 |
  | `workdays until 25 December 2026` | 64.58 workdays (on 25 September 2026) | refused, pointing at `workdays between today and <date>` |
  
  **`to` between two dates is the span (#631).** `a to b` compiled `b / a - 1` whatever the operands were. A new opcode decides when the line runs, since either side can be a variable.
  
  | line | before | now |
  | --- | --- | --- |
  | `1 Jan 2026 to 1 Mar 2026` | 0.29% | 59 days |
  | `2 April 2026 to 6 September 2026` | 0.76% | 157 days |
  | `1 Mar 2026 to 1 Jan 2026` | -0.29% | -59 days |
  | `1 Jan 2026 to 5` | -100.00% | refused |
  
  Two numbers give the percentage change exactly as before (`10 to 20` is 100.00%), through the same opcodes.
  
  **`as iso8601` reads a timestamp in seconds (#632).** It read every number as milliseconds.
  
  | line | before | now |
  | --- | --- | --- |
  | `1710000000 as iso8601` | 1970-01-20T20:00:00+01:00 | 2024-03-09T16:00:00+00:00 |
  | `5 kg as iso8601` | 1970-01-01T01:00:00+01:00 | refused by name |
  
  It now reads its argument as `to date` does: a date as it is, a number through the same seconds-or-milliseconds threshold, text through the ISO 8601 parser. A timestamp past the dates a JavaScript date can hold, about 273,000 years either side of 1970, is refused by both (`DATE_OUT_OF_RANGE`), where `(2^53) as iso8601` wrote `NaN-NaN-NaNTNaN:NaN:NaN-NaN:NaN` and `(2^53) to date` showed `Invalid Date, Invalid Date`; the adversarial sweep's numeric edges found it.
  
  What these deliberately leave for later: a clock sum after a minus (`17:30 - 9:00 + 0:45`, #628) needs a bare `0:45` told apart from `0:45am` when the line runs, and is its own change; so are signed UTC offsets after a time and a date with a time of day. `today` as the current instant and date minus date as elapsed time stay as they are, held for 3.0.
  
  The time, timesheets, health, time-zones, date-arithmetic, working-days and date-literals pages describe each change, with proven examples.
  
  ## Verification
  
  New tests pin each issue under `__tests__/bugs` (#623 to #627 and #629 to #632), each with an adversarial section: every arithmetic form and numeric function against a clock time, an am/pm time, a date literal, an ISO date-time, `today` and `now`, on either side and held in a variable; the boundaries that must not move (comparisons, `min` and `max`, `as number`, spans); a pace with every minute spelling, `per`, and the shapes that are not a pace; a date plus each kind of non-duration; a span plus each time unit, typed milliseconds and a variable; the edges of a working-day window and a host holiday calendar; `to` between dates, variables and a date against a number; and timestamps at the seconds threshold and past the calendar. Unit tests cover the new helpers (`datetimeArithmeticRefused`, `datetimeTakesNoUnit`, `datetimeConversionRefused`, `datetimeArgumentRefused`, `asIso8601`) and the new `PERCENT_CHANGE` opcode on hand-built bytecode. The adversarial sweep gains a dates group of eight forms over its numeric edges, which found the out-of-range timestamp. Nine existing tests that pinned the old readings (a bare number as milliseconds, a non-duration ignored, the fourteen-digit `onAmbiguous` answer, a nine-millisecond UTC offset) now pin the refusals. The VM dispatch loop is 47,326 bytes, 476 over main and well under the 61,440 ceiling.
  
  The full suite is 13,763 tests in 563 suites, all passing (four skipped), and `npm run verify:ci` passes, including `smoke:globals`, the three-zone `test:temporal` run and the bundled-consumer contract.
- 3e0edc9: A one-character first line is its own line, a what-if reads `:name` as the input, and the ESM build loads where Node's globals do not exist
  
  Three faults found by the survey before 2.40.0 and listed as known issues in its release notes.
  
  **A one-character first line is its own line (#609).** The lexer's one-character fast path built its token from the whole input, and a document scan narrows only the line's end, so a first line of one character took the whole document as its text. The two document passes disagreed, and the bad program was reused for a later line on the same engine.
  
  | document | before (parseDocument) | now (both passes) |
  | --- | --- | --- |
  | `e`, then `5` | error: Undefined variable: e, followed by the rest of the document | 2.72, then 5 |
  | `e`, then `total above` | error: Line 1 has an error | 2.72, then 2.72 |
  | `x`, then `5` | error: Undefined variable: x, followed by the rest of the document | error: Undefined variable: x, then 5 |
  
  **A what-if, a sweep and a goal seek read `:name` as the input (#608).** A reader who defined `:price = 100` writes `line 2 with :price = 300`. The colon kept the what-if from being recognised, `with` stayed the English word for `+`, and the line added the assignment and overwrote the variable.
  
  | line, after `:price = 100` and `:total = :price * 1.2` | before | now |
  | --- | --- | --- |
  | `line 2 with :price = 300` | 420, and `:price` became 300 | 360, and `:price` stays 100 |
  | `line 2 for :price from 100 to 300 step 100` | error: Expected token type "AT" but got "FROM" | [120, 240, 360] |
  
  **The ESM build loads where Node's globals do not exist (#610).** Value.ts read `process.env.NODE_ENV` at module scope, unguarded, so every entry point threw "process is not defined" on import in a browser tab or a module Web Worker loaded without a bundler. The read is now guarded, as the engine's other reads of `process` are. This was true of 2.39.0 too; a bundler that defines `process.env.NODE_ENV` was never affected.
  
  A new check, `npm run smoke:globals`, imports every ESM entry point of the build twice, once as Node has it and once with `process`, `Buffer` and `global` removed, and fails if an entry loads only with them. It runs in `verify` and `verify:ci`, and was shown to fail on the unguarded read.
  
  The what-if page carries a proven example of the colon form.
  
  ## Verification
  
  New tests pin each shape of one-character first line through both passes, that a later line on the same engine is not poisoned, and that the answer does not depend on what the engine did before; the colon form of a what-if, a joined input, a sweep and a goal seek, each agreeing with its bare spelling through both passes; and that `with` still means `+` where no name and `=` follow. The full suite is 11,948 tests in 548 suites, all passing (four skipped), and `npm run verify:ci` passes, including `smoke:globals`, the three-zone `test:temporal` run and the bundled-consumer contract.
- 5c2a031: The goal-seek refusal says which pass gave it
  
  `parseDocument` refused goal seek with the single-expression entry point's sentence, "The single-expression entry point has no document to solve against", which is wrong for a caller that passed a whole document (#617). The batch pass has a document; what it cannot do is re-run a line. The refusal now says so, and names the passes that can. The code, `GOAL_SEEK_NO_DOCUMENT`, is unchanged.
  
  | entry point | before | now |
  | --- | --- | --- |
  | `parseDocument` | Goal seek only works inside a document, since it re-runs another line. The single-expression entry point has no document to solve against. | Goal seek re-runs another line, which the batch pass (parseDocument) cannot do: it evaluates each line once. evaluateDocument and a live editor can solve it. |
  | `evaluateLine` | the same sentence | unchanged |
  | `evaluateDocument` | solves it | solves it |
  
  The goal-seek page now names the entry points that solve goal seek and the two that refuse it.
  
  ## Verification
  
  A new spec pins each entry point's answer, and the goal-seek and cross-path suites pass unchanged, since they assert the code and that the batch refusal mentions a document. The full suite is 13,793 tests in 565 suites, all passing (four skipped), and `npm run verify:ci` passes, now including `lint:ci-parity` and `lint:dispatch-size` (47,474 bytes on Node 24, 13,966 under the ceiling), the three-zone `test:temporal` run and the bundled-consumer contract.
- 5cda73b: An infinite angle and a remainder with no value are refused by name, and the normal distribution's far tails answer 0 and 1
  
  **An infinite angle, a remainder by zero and a remainder of an infinity are refused (#600).** Each has no value, and JavaScript's maths answered NaN for all of them, which `number-functions.md` calls "not an answer". They are now refused by name, as the functions outside their domain have been since #510.
  
  | expression | before | now |
  | --- | --- | --- |
  | `sin(1/0)` | NaN | error: sin(Infinity) has no real value: sin is only defined for finite angles. |
  | `5 mod 0` | NaN | error: 5 mod 0 has no value: nothing is left over from a division by zero, because it never ends. |
  | `(1/0) mod 3` | NaN | error: Infinity mod 3 has no value: an infinite number has no remainder. |
  | `5 mod (1/0)` | 5 | 5 |
  | `sin(1e300)` | a number | a number |
  
  **The normal distribution's far tails answer 0 and 1 (#601).** The exponential the tails are built from split its argument with `Math.trunc(x * 4096)`, which overflows near the top of the double range, so `normalcdf(1e308)` came out NaN. Past 40 standard deviations the exponential has underflowed to zero anyway, so it now answers 0 there without the arithmetic.
  
  | expression | before | now |
  | --- | --- | --- |
  | `normalcdf(1e308)` | NaN | 1 |
  | `normalcdf(-1e308)` | NaN | 0 |
  | `normalpdf(1e308)` | NaN | 0 |
  | `normalcdf(-10)` | 7.62e-24 | 7.62e-24 |
  
  The boundary: `0/0` stays NaN and `1/0` stays infinity, the floating-point standard's defined answers, and a form fed `0/0` passes its NaN on (`sin(0/0)` is NaN) rather than blaming the function. A whole-number remainder by zero (`10n mod 0n`) keeps its own named error.
  
  Both were found by the new adversarial sweep. The number-functions and operators pages carry proven examples.
  
  ## Verification
  
  New tests pin each refusal and its message, finite angles up to the largest double, every sign of a finite remainder, exact and unit remainders, an infinity reached through a variable and a line reference, and the normal distribution finite at every power of ten up to the largest double. The existing modulo tests that pinned NaN now pin the refusal. `npm run verify:ci` passes.
- 5c2a031: `field(...)` refuses JSON nested more than 512 levels deep, the same on every runtime
  
  `field(...)` left the depth of a JSON text to the runtime's own `JSON.parse` and `JSON.stringify`, so the answer depended on the Node version. A text nested a hundred thousand levels deep was refused as `TEXT_NOT_JSON` on Node 22 and 24, and the new Node 26 job found it was not refused that way there (#621).
  
  | line | before | now |
  | --- | --- | --- |
  | `field(("[" repeated 100000 times) + ("]" repeated 100000 times), "[0]")` | refused on Node 22 and 24, not on Node 26 | refused on every runtime: field(...) reads JSON nested at most 512 levels deep, and this text nests deeper |
  | `field(("[" repeated 512 times) + "1" + ("]" repeated 512 times), "[0]")` | answered | answered |
  
  The engine now counts the nesting itself before parsing. Five hundred and twelve levels is far past any API's answer and inside what every runtime reads and writes. Brackets inside a JSON string are text and do not count. The code is `TEXT_NOT_JSON`, as before.
  
  ## Verification
  
  The text suite pins the limit on either side of 512 and a string full of brackets, and the Node 26 job in CI runs it there.
- 775decc: Both document passes count lines as an editor does, and a CRLF line's text leaves out the `\r`
  
  `parseDocument` dropped the empty line after a trailing line break, and returned no lines for an empty note. `evaluateDocument`, which reads the note through the same line model an editor host uses, kept them, so the two passes disagreed on how many lines a note had, and a host indexing results by the editor's line number read a different list from each (#613). `evaluateDocument` also kept the `\r` of a CRLF line ending in the line's `text`, and counted it in the line's end offset.
  
  | note | before: `parseDocument` | before: `evaluateDocument` | now: both |
  | --- | --- | --- | --- |
  | `""` | no lines | one empty line | one empty line |
  | `"1\n2\ntotal above\n"` | 3 lines | 4 lines, the last empty | 4 lines, the last empty |
  | `"1\r\n2\r\n"` | 2 lines, text `1` and `2` | 3 lines, text `1\r`, `2\r` and empty | 3 lines, text `1`, `2` and empty, at the same offsets |
  
  The lines above the new last line read as they did. A line that names the new last line now finds an empty line there, as `evaluateDocument` already did: `line 4 with x = 1` at the end of a three-line note that ends in a line break said "There is no line 4 to re-run: the document has 3 lines." through `parseDocument`, and now says line 4 is not a calculation through both passes. `evaluateLines` returns one `ParsedLine` per line given even when the last is empty (`["1", ""]` gave one, and `[""]` none), and still none for no lines.
  
  A lone `\r`, the line ending of classic Mac OS, still ends a line in `parseDocument` only; `evaluateDocument`'s line model splits on `\n`. No host this engine targets writes one, and changing the model's split would move the character offsets a host passes to it for an edit.
  
  The TypeScript guide says how lines are counted.
  
  ## Verification
  
  New tests pin the count for an empty note, notes of only line breaks of both kinds, a trailing line break after answers, errors, a heading and `total above`, and CRLF notes, each through both passes with their text and offsets; `evaluateLines` of no lines, one empty line and a trailing empty line; a what-if naming the new last line; and inline solves on CRLF lines. The cross-path suite gains CRLF notes with a trailing line break for a line reference, a category tag, a section and a what-if. The adversarial sweep's four pinned #613 documents now pass and run in the ordinary set. Four existing tests that pinned the old count (the lexer's empty document and trailing line break, and the engine's empty document) now pin the editor's count. The full suite is 13,360 tests in 554 suites, all passing (four skipped), and `npm run verify:ci` passes, including `smoke:globals`, the three-zone `test:temporal` run and the bundled-consumer contract.
- 2c2a052: A form that reads a line below it gives the same answer on both document passes
  
  A section total, a count or a line range can read lines below the line that asks. Each asks of every line whether it has a figure. The batch pass knew the answer for every line from its scan; the incremental pass knew it for a line only once it had evaluated that line, so a comment or a table row below the reader read as a figure still to come (#803).
  
  | note | `parseDocument` | `evaluateDocument`, before | `evaluateDocument`, now |
  | --- | --- | --- | --- |
  | `count of section "Home"`, `# Home`, `// note 5` | 0 | Line 3 has not been evaluated yet | 0 |
  | `total of section "Trip"`, `## Trip`, `// note 4` | The section "Trip" has no figures to add up. | Line 3 has not been evaluated yet | The section "Trip" has no figures to add up. |
  | `sum(line 5 : line 4)` over a blank line and a table separator | Lines 5 to 4 hold no figures to add up | Line 5 has not been evaluated yet | Lines 5 to 4 hold no figures to add up |
  
  A line the incremental pass has not reached is now read from its text, the way the batch pass reads it: a blank line, a heading, a comment, a quote, a fence or a table row has no figure. A live editor whose viewport stops above the comment gives the same answer. A figure below the reader is still a forward reference on both passes.
  
  The cross-path fuzz generator found these on its first run.
  
  ## Verification
  
  `Issue803_linesBelowTheReader.spec.ts` has 15 tests: unit tests for `hasNoFigure` over each line kind, a table row, a row holding an inline solve and past either end; a section below holding only a comment; a section below holding a comment and a figure, where the figure is still a forward reference; a range reaching down over a table; and a live editor that has not scrolled to the comment yet, which gives the batch answer. `CrossPathDocumentFeatures.spec.ts` gains the section count and the line range over lines below the reader, asserting both passes agree value for value.
  
  The engine suite is 14,062 tests in 582 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch rebased onto main after #808, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,481 bytes on Node 24, 13,959 under the ceiling) and the bundled-consumer contract.
- 610a61d: Locales: a German engine refuses a dot decimal rather than reading it a hundred times too large, a regional tag reads as its language, native digits run past the decimal mark, and Indian grouping is read beside the rupee
  
  Four locale faults from the 2026-09-25 survey, and a fifth found while fixing them. Most gave a number that looked like an answer and was not one.
  
  **A German engine refuses a dot decimal (#654).** German groups thousands with a point, and the parser removed every point from a literal whatever followed it, so `2.5` was 25 and `$9.99` was $999.00. A German thousands group is always three digits, so a point followed by one, two, or four or more digits is an English decimal typed into a German engine. The engine cannot use it either way without guessing, so it is now refused with `INVALID_NUMBER_LITERAL`, naming the locale, at both parse sites. Under `createEngine({ locale: "de" })`, with results written in the default settings:
  
  | line | before | now |
  | --- | --- | --- |
  | `2.5` | 25 | refused: "2.5" is not a number in the de locale: "." groups thousands there, so it is followed by exactly three digits, as in 2.500 (two thousand five hundred). |
  | `$9.99` | $999.00 | refused |
  | `1.5 km` | 15.00 km | refused |
  | `0.5` | 5 | refused |
  | `12.5%` | 125.00% | refused |
  | `9.99 EUR` | €999.00 | refused |
  | `2.500` | 2,500 | 2,500 |
  | `1.234.567` | 1,234,567 | 1,234,567 |
  | `17.11.2025` | Monday, November 17, 2025 | Monday, November 17, 2025 |
  
  What stays: `2.500` is two thousand five hundred and `1.234.567` over a million, since a three-digit group is how German writes them, and a dotted date is a date. English and French engines read `2.5` as before. Reading `2,5` as two and a half is the decimal comma, which this does not add: `2,5` is refused in every engine, as it was, and a German engine writes a fraction as a division (`5/2`) until it is read. Pasted text keeps its own reading, so `numbers in "preis 9.99"` is still 9 and 99 under `de`.
  
  **A regional tag reads as its language (#655).** `getLocale` looked a code up as an exact key of a plain object. `de-DE`, which is what a browser reports, missed `de` and read as English, and a code naming an inherited property (`toString`, `constructor`, `__proto__`, `hasOwnProperty`) returned what the object inherits, which crashed engine construction. A tag now falls back by its language subtag before falling back to English, in any case and with `-` or `_` between the subtags, and a code is looked up as an own key or not at all.
  
  | `locale` | line | before | now |
  | --- | --- | --- | --- |
  | `de-DE` | `€1.250` | €1.25 | €1,250.00 |
  | `de-DE` | `1.000 + 1` | 2 | 1,001 |
  | `de-DE` | `1.5 + 1` | 2.50 | refused, as under `de` |
  | `toString` | `createEngine({ locale })` | TypeError: Cannot convert undefined or null to object | an English engine |
  
  `formatValue` wrote a regional tag's digits through `Intl` but took its weekday and month names from the language pack's code, which is `en` for any tag without a pack of its own. The names now come from the full tag wherever `Intl` has data for it. With `decimalSeparatorLocale` set:
  
  | tag | `2025-11-17` before | now |
  | --- | --- | --- |
  | `de-DE` | Monday, November 17, 2025 | Montag, 17. November 2025 |
  | `fr-FR` | Monday, November 17, 2025 | lundi 17 novembre 2025 |
  | `en-GB` | Monday, November 17, 2025 | Monday, 17 November 2025 |
  
  A tag `Intl` has no data for (`xx`) keeps its language pack's names, English for a code with none, as before, so a date does not follow the machine the engine runs on. The subtag chooses the language pack and nothing else about reading, with Indian grouping (below) the one exception, and no language is added.
  
  **A second decimal mark is refused where the comma marks the decimal.** Found while fixing #655: a German or French engine turned the first comma of `1,234,567` into its decimal point, and `parseFloat` stopped at the second, so it answered 1.234. That reading had reached only `de` and `fr` engines; with regional tags falling back to their language it would have reached every `de-DE` and `fr-FR` host, which read the line as English until now, so it is refused in the same change, by the same code.
  
  | `locale` | line | before | now |
  | --- | --- | --- | --- |
  | `de` | `1,234,567` | 1.23 | refused: "1,234,567" is not a number in the de locale: "," marks the decimal there, so it appears once, with only digits after it. |
  | `fr` | `1,234.56` | 1.23 | refused |
  | `de-DE` | `1,234,567` | 1,234,567, read as English | refused |
  
  What stays: `1,000` is one in German and French, as it was, and `1.234,567` is one thousand two hundred and thirty-four and a bit in German.
  
  **The two readings that slipped past (#805, #806).** An English engine read the mirror of #654, a German number typed into it, by dropping its comma, and a German engine let two shapes through: a first group longer than three digits, and a frame rate, whose parselet read its number the English way.
  
  | `locale` | line | before | now |
  | --- | --- | --- | --- |
  | `en` | `1.234,567` | 1.23 | refused: "1.234,567" is not a number in the en locale: "." marks the decimal there, and the digits after it are not grouped. |
  | `de` | `12345.678` | 12,345,678 | refused: "12345.678" is not a number in the de locale: "." groups thousands there, in threes, as in 12.345.678. |
  | `de` | `2.5 fps` | 2.50 frames/s | refused, as `2.5` is |
  | `de` | `2.500 fps` | 2.50 frames/s | 2,500.00 frames/s |
  
  A list or a call written without spaces is unchanged (`[1.5,234]` is `[1.50, 234]` in English), since a comma there is a separator.
  
  **Native digits run past the decimal mark (#656).** `localiseFixedDecimal`, which writes every quantity, every amount of money and an exact number to a fixed place count, localised the whole part through `Intl` and appended the fraction as the ASCII it arrived in. The fraction's digits now follow the tag's numbering system, leading zeros kept, and so does the whole part when grouping is off, which had the same gap. With `decimalSeparatorLocale` set:
  
  | tag | line | before | now |
  | --- | --- | --- | --- |
  | `ar-EG` | `3.5 days` | ٣٫50 days | ٣٫٥٠ days |
  | `ar-EG` | `£1234.5` | £١٬٢٣٤٫50 | £١٬٢٣٤٫٥٠ |
  | `ar-EG` | `3.14159 to 2 dp` | ٣٫14 | ٣٫١٤ |
  | `bn` | `3.5 days` | ৩.50 days | ৩.৫০ days |
  | `mr` | `£1234.5` | £१,२३४.50 | £१,२३४.५० |
  | `fa` | `3.5 days` | ۳٫50 days | ۳٫۵۰ days |
  | `ar-EG`, grouping off | `£1234.5` | £1234٫50 | £١٢٣٤٫٥٠ |
  
  The digits follow whatever numbering system `Intl` picks for the tag, so `ar-EG-u-nu-latn` still gives `3.50 days`. This is display only: typed native digits (`٣٫٥`) are not read.
  
  **Indian grouping is read beside the rupee (#657).** In India a hundred thousand is one lakh, written `1,00,000`. The lexer and text extraction read a thousands group only as exactly three digits, so `₹1,00,000` was refused at its first comma and `amounts in "₹1,00,000"` answered `[1]`. The grouping (a first group of one or two digits, then groups of two, then a final three) is now read after `₹` or before `INR` in any engine whose pack groups thousands with a comma, and everywhere in an engine whose tag names India as its region (`en-IN`, `hi-IN`).
  
  | line | before | now |
  | --- | --- | --- |
  | `amounts in "₹1,00,000"` | [1] | [100,000] |
  | `numbers in "₹1,00,000"` | [1, 0] | [100,000] |
  | `amounts in "rent ₹12,34,567.89"` | [12] | [1,234,567.89] |
  | `₹1,00,000` | refused: Unexpected token after expression: "," | ₹100,000.00 |
  | `1,00,000 INR` | refused: Unexpected token after expression: "," | ₹100,000.00 |
  | `12,34,567` under `en-IN` | refused: Unexpected token after expression: "," | 1,234,567 |
  
  What stays: a bare `12,34,567` in an English engine with no rupee marker is refused, since outside the convention a group of two digits is not a group and a refusal is safer than a guess. A comma inside a call or a bracket separates arguments and elements, so `[1,00,000]` is three numbers under `en-IN` too. A German or French engine does not read the grouping, since its comma is the decimal mark, and a mixed `1,00,000,000` is refused everywhere.
  
  A new Locales page in the developer guide says what each language pack accepts typed, how a tag is resolved, where Indian grouping is read, and how the formatting tag writes digits and dates. The currency and pasted-text pages show Indian grouping, the pasted-text page says where a typed line and pasted text read differently, and the embedding and formatting guides point to the new page.
  
  **Five pages said more about locales than the engine does (#675).** The embedding guide says `locale` decides the keywords and how numbers are read, and that the order of an ambiguous date is `config.date.inputOrder`: `03/04/2026` is 3 April in a German engine as in an English one. The introduction no longer promises a currency display setting, or settings that default from the engine, since `formatValue` never sees one. The pasted-text page says a typed line in a German engine does not yet accept a decimal comma, where pasted text does. The export tables describe `solve-engine/constants` as configuration defaults and the engine version, which is all it exports.
  
  `UnifiedParsingOptions.localeCode` is deprecated, and goes in 3.0. `parseDocument` never read it: the engine reads keywords and numbers in the `locale` it was created with, so `parseDocument("1.000 + 1", { inputType: "markdown", localeCode: "de" })` on an English engine answers 2. The worker option of the same name is a different one, and is read.
  
  ## Verification
  
  A spec per issue under `__tests__/bugs`, with unit tests for the new helpers and, for #654 to #657, an adversarial section: 65 tests for #654 (`isDotDecimal`, `unreadableInLocale`, `localeLiteralRefusal`, both parse tiers refusing together, whole documents, a literal of a hundred thousand digits, a tag of any length); 103 for #655 (`getLocale`, `groupsInLakhs`, `hasSecondDecimalMark`, every prototype word, `__PROTO__`, a non-string and a very long tag as a locale, and dates written through the full tag); 26 for #656 (`localiseFixedDecimal` across numbering systems, a tag `Intl` refuses, a prototype-named tag, a ten-thousand-digit fraction); 73 for #657 (`lakhGroupEnd`, `rupeeMarked`, English and `en-IN` engines, text extraction, whole documents, a long run of pairs); 22 for #805 and #806 (`unreadableInLocale`, `readLocaleNumber`, and the frame-rate form under both locales); and 9 for #675, one per corrected page claim, so a page that drifts from the engine again has a failing test beside it. `AdversarialFeatureSweep.spec.ts` gains Indian grouping in its money group.
  
  The engine suite is 15,502 tests in 608 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch rebased onto main after #813, including the docs proofs, `lint:sidebar` for the new Locales page, the three-zone `test:temporal` run, `lint:dispatch-size` (47,528 bytes on Node 24, 13,912 under the ceiling) and the bundled-consumer contract.
- d4b35f1: Percentages: one scale with permille and ppm, `as % of` asks for the rate, `on` and `off` take the percentage before them, a change needs a base with a size, and a percentage is formatted like any other figure
  
  Five percentage faults from the 2026-09-25 survey. Each gave a confident answer to a sum people type often.
  
  **Percent is on the parts-per scale (#633).** A percent is one part in a hundred, a permille one in a thousand and a part per million one in a million, but percent sat outside that scale. `in %` left the `%` for the postfix operator, which divided by a hundred again; `as %` read a quantity's magnitude and dropped its unit; and `of` multiplied a parts-per quantity by its magnitude.
  
  | line | before | now |
  | --- | --- | --- |
  | `20/80 in %` | 0.25% | 25.00% |
  | `0.25 to %` | error: No prefix parselet found for token: PERCENT | 25.00% |
  | `100 ppm as %` | 10000.00% | 0.01% |
  | `0.5% in ppm` | 0.01 ppm | 5,000.00 ppm |
  | `2 permille of $5000` | $10,000.00 | $10.00 |
  | `5 km as %` | 500.00% | refused: a length is not a proportion |
  
  Only `of` reads a parts-per quantity as a rate; `*` keeps its unit, so `2 permille * 5000` is still 10,000 permille, the same amount as 10.
  
  **`as % of` asks for the rate (#634).** `40 as % of 50` converted 40 to 4000% and took that of 50. `as %`, `as percent` and `as a %` with a base now ask what `is what %` asks, through the same code.
  
  | line | before | now |
  | --- | --- | --- |
  | `40 as % of 50` | 2,000 | 80.00% |
  | `$60 as % on $50` | $3,050.00 | 20.00% |
  | `$40 as a % of $50` | error: Unknown converter "as a" | 80.00% |
  
  **`on` and `off` take the percentage just before them (#635).** They bound below arithmetic on their left, so the rate was whatever had been built there, and a chain grouped to the left. The rate is now the percentage before the word, the base is everything after it, and a chain groups to the right. `explainLine` follows the same grouping.
  
  | line | before | now |
  | --- | --- | --- |
  | `5 + 20% off 100` | -500 | 85 |
  | `10% off 20% off $100` | $82.00 | $72.00 |
  | `10% on 10% on 100` | 111.00 | 121 |
  
  The base still reaches to the end: `10% off 100 + 100` is 180.
  
  **A percentage change needs a base with a size and a sign (#636).** A change from zero divided by zero, and a change from a negative base picked a sign for a question with two conventional answers.
  
  | line | before | now |
  | --- | --- | --- |
  | `0 to 10` | Infinity% | refused (`PERCENT_CHANGE_FROM_ZERO`) |
  | `0 to 0` | NaN% | refused (`PERCENT_CHANGE_FROM_ZERO`) |
  | `-100 to -50` | -50.00% | refused, naming both readings (`PERCENT_CHANGE_NEGATIVE_BASE`) |
  | `40 is what % of 0` | Infinity% | refused (`PERCENTAGE_NOT_FINITE`) |
  
  `10 to 0` is still -100.00%, a fall to nothing from a positive base, and `1/0` is still ∞: only a percentage of a value that is not finite is refused.
  
  **A percentage is formatted like any other figure (#637).** The formatter used `toFixed` alone.
  
  | line | before | now |
  | --- | --- | --- |
  | `0.001%` | 0.00% | 0.001% |
  | `-0.001%` | 0.00% | -0.001% |
  | `1234567%` | 1234567.00% | 1,234,567.00% |
  | `1/8 as %`, formatted for de-DE | 12.50% | 12,50% |
  
  A zero is still written without a sign (#585).
  
  The percentages page is rebuilt around these forms, and also documents the ones it did not show (#683): discounts and markups, what percentage one number is of another, the original before a markup, and percent beside permille and ppm. The decimals page shows a percentage under the too-small rule.
  
  ## Verification
  
  A spec for each issue pins its before/now lines and adversarial cases: a parts-per quantity in every conversion form, a percentage of a quantity, chains of `on` and `off`, a change from zero, a negative and a non-finite base, and percentages at the edges of the formatter (a tiny value, a huge one, a negative zero, a de-DE decimal mark). The full suite is 13,905 tests in 571 suites, all passing (four skipped), and `npm run verify:ci` passes, including `lint:dispatch-size`, the three-zone `test:temporal` run and the bundled-consumer contract.
- 261bcb8: Goal seek refuses a target that re-runs the note, re-runs no longer fill the value pool, a trace shows a large value short, and a sweep says when its steps together reach the budget
  
  Four faults found by the survey before 2.40.0 and listed as known issues in its release notes. Each let a short note spend far more time or memory than its answer needed, and each is now bounded or refused by name.
  
  **Goal seek refuses a target that holds a what-if or a sweep (#604).** A what-if already refuses to re-run a line holding another what-if, so one question cannot set off another. Goal seek was the exception: it re-runs its target up to a hundred times, and a sweep on the target re-ran the whole note on every one of those runs. It now answers with a named refusal on its first probe. It refuses whether or not the algebra could have inverted the line, so the answer does not depend on the line's shape.
  
  | note, through `evaluateDocument` | before | now |
  | --- | --- | --- |
  | a 1,000-step sweep of line 73, then `solve line 74 for k = 3000.5` | 12,166 ms, 371 MB still held afterwards, then "did not converge" | the whole note in 350 ms, and "Goal seek cannot target a line that holds a what-if or a sweep, since every one of its probes would re-run the document again. Target a line without one." |
  | six such goal-seek lines | 75,921 ms, 2,232 MB held | each refused by name |
  
  A target that only reads a what-if line's answer, rather than holding the what-if, still solves. The batch pass refused goal seek before and still does.
  
  **Re-runs no longer fill the value pool (#605).** The engine keeps a small pool of reusable values for the lines on screen, so scrolling allocates nothing. A what-if or sweep's re-runs, goal seek's probes and reads of a table column all ran while the pool was on, and every value they made stayed in it for as long as the note was open. Re-runs and probes now make ordinary values, and the pool stops growing at 16,384, about twenty times what the heaviest example in these docs uses.
  
  | note, through `evaluateDocument` | values held before | now |
  | --- | --- | --- |
  | 100 lines, then one 1,000-step sweep | 200,205 | 1,205 |
  | the same 100 lines, then five such sweeps | 1,000,229 | 5,229 |
  | a 1,000-row table, then 1,000 reads of its column | 1,003,001 | 16,384 |
  
  **A trace shows a large value short (#606).** `inputs of line N` formatted every traced value in full before it checked the trace's length, and a 100,000-element list is 787,929 characters that took about 2.3 s to format, once for each line of the trace holding it. A list of more than ten values now shows its first ten and a count, a matrix of more than a hundred cells shows its shape, and a text of more than eighty characters shows its first eighty and a count. The cut comes before the formatting, so the work is bounded as well as the text.
  
  | note | before | now |
  | --- | --- | --- |
  | five lines each holding `map(x*1, 1:100000)`, then `inputs of line 5` | 12,079 ms, then refused as too long | 112 ms: `z [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, and 99,990 more] (line 5) <- ...` |
  | `v = map(x*1, 1:100000)`, then `inputs of line 1` | 3,201 ms and 787,929 characters | `v [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, and 99,990 more] (line 1) reads no other line` |
  
  `engine.traceLine()` returns values rather than text and is unchanged.
  
  **A sweep says when its steps together reach the budget (#607).** A line may create at most 2,000,000 list items and matrix cells, and make a limited number of user-defined-function calls. A sweep's steps share those budgets, as they must, or a thousand steps could use a thousand times what a line may. The refusal blamed the step the running total happened to reach, which answered on its own, and said "has no answer" twice. It now says what happened.
  
  | after `:k = 1` and `sum(x, map(x*1, 1:99999)) * k` | before | now |
  | --- | --- | --- |
  | `line 2 for k from 1 to 20 step 1` | With k at 7, line 2 has no answer: Line 2 has no answer with these inputs: Evaluating this expression would materialise 99,999 collection elements, past the limit of 2,000,000 elements for one evaluation | This sweep stopped with k at 7: this sweep's re-runs of line 2 share this line's limit of 2,000,000 materialised elements, and together they reached it. Use a larger step or a shorter range. |
  | `line 2 with k = 7` | 34,999,650,000 | 34,999,650,000 |
  
  A sweep whose steps leave no room for its list of answers says that too, where it used to report the list's few cells as if they alone were past the limit. A step that is over a budget by itself is still reported as that step's failure, now with "has no answer" said once. The budgets are unchanged, and a single what-if, which runs once, keeps its message.
  
  The goal-seek, what-if and tracing-inputs pages describe each change, with proven examples of the goal-seek refusal and the short form of a trace.
  
  ## Verification
  
  New tests pin the goal-seek refusal through all three entry points in the cross-path suite, with adversarial cases for a sweep inside a function call, a what-if in brackets, two and six goal-seek lines on one target under a time bound, and the boundary where a target reads a sweep line's answer; the pool's ceiling, its reset and the helper that turns it off, and its size after each of the survey's notes, a what-if with several inputs and a goal seek; the short form of a trace for lists, columns, matrices and text, at the edge of each limit and across characters outside the Basic Multilingual Plane; and the sweep's wording with the budget crossed on a middle step, at the final list and by function calls, against a step that is over the budget by itself. The full suite is 11,994 tests in 552 suites, all passing (four skipped), and `npm run verify:ci` passes, including `smoke:globals`, the three-zone `test:temporal` run and the bundled-consumer contract.
- 0b876a4: Twice-yearly compounding is read, and `compounded monthly` means `compounding monthly`
  
  `compounding semi-annually` was refused, and the refusal named `semi-annually` among the intervals it accepts: the hyphen split the word before the interval was looked up, so the lookup saw `semi` (#801). `compounded monthly`, the commoner English, was left as a token the line could not place.
  
  | line | before | now |
  | --- | --- | --- |
  | `interest on 1000 over 3 years at 5% compounding semi-annually` | refused: compounding semi: expected one of annually, yearly, semi-annually, ... | 159.69 |
  | `... compounding semiannually` | refused | 159.69 |
  | `... compounding half-yearly` | refused | 159.69 |
  | `... compounded monthly` | Unexpected token after expression: "compounded" | 161.47, the same as `compounding monthly` |
  
  `compounded` is read only in that position, after a rate, so it stays free as a variable name. Every interval the refusal lists is one the engine reads, and a spec checks it.
  
  What stays refused: `biannually`, which some readers take to mean every two years, and `twice yearly`, a two-word form the tail does not read.
  
  The interest page lists the intervals read and shows semi-annual compounding and `compounded`, proven.
  
  ## Verification
  
  `Issue801_semiAnnualCompounding.spec.ts` has 11 tests: the four spellings, the result sitting between annual and quarterly, the growth form, `compounded` after a rate and as an ordinary name elsewhere; and adversarial cases: a half-written interval, a hyphenated word that is not one, and a check that every interval the refusal lists is one the engine reads.
  
  The engine suite is 14,209 tests in 588 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,331 bytes on Node 24, 14,109 under the ceiling) and the bundled-consumer contract.
- 2c2a052: A table column's summaries read its money cells, as `total above` reads the same figures on lines
  
  `total of column "cost" above` and the other column summaries read plain numbers only. A money cell was dropped without a word, a column of money was refused outright, a comma in the wrong place was read as thousands grouping, and a percentage vanished (#651). The lookup beside them already read those cells; the summaries now read them the same way.
  
  | table | form | before | now |
  | --- | --- | --- | --- |
  | `$500`, `$200` | `total of column "cost" above` | error: no plain-number cells to aggregate | $700.00 |
  | `500`, `$200`, `1,200` | `total of column "cost" above` | 1,700 | $1,900.00 |
  | `500`, `$200`, `1,200` | `count of column "cost" above` | 2 | 3 |
  | `12,57`, `1` | `total of column "cost" above` | 1,258 | 1 |
  | `20%`, `1` | `total of column "cost" above` | 1 | refused: the cell on line 3 is a percentage |
  
  A money column totals in the currency written first, and a plain number joins it as an amount in that currency, which is what `total above` gives for `500`, `$200` and `1,200` typed as lines. Two currencies are refused by name, as `total above` refuses `$500` over `£200`. The minimum, maximum, median, spread, mode and standard deviation are in the currency too; the variance of a money column is refused, since it would be in square dollars. `12,57` is not grouped in threes, so it is text and skipped, as a lookup already treated it. A percentage is counted by `count` and refused by the summaries that add or compare, rather than dropped.
  
  What this does not cover: a cell with a unit (`5 km`) is still not read, and the refusal for a column of them now says so. A column of plain numbers, decimals included, totals exactly as before.
  
  The table-columns page shows a money column and says which cells are read.
  
  ## Verification
  
  `Issue651_tableColumnsReadMoney.spec.ts` pins every summary over a money column in 16 tests, with adversarial cases: a 20,000-row money column, a symbol with no amount, misgrouped money (`$1,2`), a negative amount, an ISO code beside a symbol, the variance refused by name, a percentage cell under `count` and `max`, a column of units and a column of text. `CrossPathDocumentFeatures.spec.ts` runs a money column, two currencies, a percentage and misplaced grouping through `parseDocument` and `evaluateDocument` and asserts they agree; the single-expression refusal of each column form was already pinned in the same file. Two existing tests that pinned the old reading now pin the new one: a money cell beside a plain number in `ColumnAggregate.spec.ts` totals $1,250.00 rather than 1,200, and the column aggregates beside a lookup in `TableLookups.spec.ts` give $1,250.00 and $625.00.
  
  The engine suite is 14,062 tests in 582 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch rebased onto main after #808, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,481 bytes on Node 24, 13,959 under the ceiling) and the bundled-consumer contract.
- b980ee8: Every row of a markdown table is markup on both document paths, not only its separator row
  
  The line classifier sees one line at a time, and a line starting with a pipe is a table row only because of the separator row in its block, so the classifier recognised the `|---|` row alone. Every other row went to the expression path and reported an error, on both `parseDocument` and `evaluateDocument`, and a line under a table was blamed on its last row (#616). The docs, and four comments in the engine, already said the rows were skipped.
  
  | note | before | now |
  | --- | --- | --- |
  | a four-line table, then `total of column "cost" above` | each header and data row: No prefix parselet found for token: BIT_OR ("\|"), three entries in `errors` | no result and no error on any row; the total is 700 as before |
  | `10`, a three-line table, then `total above` | Line 4 has an error | No lines above to aggregate: the table ends the block, as a heading does |
  
  The rule, the same on both paths: a pipe row is table markup when its block of pipe rows holds a separator row with a header above it. The batch pass decides it after the scan, walking each block once. The incremental pass decides it when a row is classified, walking the block once and keeping the answer until the document changes, and an edit that can change the answer (a separator added or removed, a pipe row becoming or ceasing to be one, a line inserted or deleted beside one) sends the block back to be classified, so typing a table in a live editor reads the header as markup once the separator is under it. A cell edit inside a table leaves the other rows as they were.
  
  What stays: a pipe row with no separator in its block is an expression, since `|` is bitwise or (`5 | 3` is 7), and a raw row alone through `evaluateLine` is still a parse error, as the cross-path suite pins. A row holding an inline solve is read like prose holding one, so the solve is still worked out.
  
  The table-columns page says what makes the rows a table.
  
  ## Verification
  
  A new spec unit-tests every table-block helper and the scan's classification, runs the survey's notes through both passes, and covers inline solves in cells, indented tables, two tables, a CRLF table at the end of a note, pipe rows with no separator, prototype-named cells a 2,000-row table under a time bound, and a count of the line reads a live pass over a 20,000-row table makes, which a row-by-row walk to the separator would have made quadratic (it took the existing 130,000-row column spec to seven minutes before the walk was made once per block). The cross-path suite gains six cases, among them live edits that add and remove a separator and a deletion that joins two pipe blocks, and the adversarial sweep gains three table documents. The full suite is 13,788 tests in 564 suites, all passing (four skipped), and `npm run verify:ci` passes, including `smoke:globals`, the three-zone `test:temporal` run and the bundled-consumer contract.
- 2c2a052: `total above` passes over a comment in its column instead of stopping at it
  
  `total above` and `average above` add up the figures directly above them, and a blank line or a heading ends the column. They also stopped at every other line the classifier skips, so a comment in the middle of a column cut the total short (#652). A line range already passed over such a line.
  
  | note | before | now |
  | --- | --- | --- |
  | `rent: $500`, `// remember to check`, `food: $200`, `total above` | $200.00 | $700.00 |
  | the same with `average above` | $200.00 | $350.00 |
  | `rent: $500`, `> quoted note`, `food: $200`, `total above` | $200.00 | $700.00 |
  
  A comment, a blockquote and a wiki link have no figure and are passed over. A blank line, a heading, a horizontal rule, a code or math fence and a markdown table still end the block, and a pipe row that is not part of a table is an expression that counts (`10`, `5 | 3`, `20` totals 37). `inputs of line N` names the same lines the total read, and both document passes agree.
  
  What stays: the section, tag and line-range forms read lines exactly as before, and a prose line that fails as an expression still fails the total that reads it.
  
  The line-references page shows a comment inside a column.
  
  ## Verification
  
  `Issue652_totalAbovePassesOverComments.spec.ts` has 21 tests: unit tests for `endsFigureBlock` over a blank line, headings, a rule, each fence, a comment, a quote, a wiki link and a figure, past either end of the document, and a pipe row inside and outside a table; and adversarial cases: a comment that holds a figure, a column of nothing but comments, a comment between a heading and the figures, a line starting with a tag, 10,000 comment lines inside a column, and a failed prose line, which still fails the total. `CrossPathDocumentFeatures.spec.ts` runs a column with a comment in it, and `inputs of line N` over it, through both document passes and asserts they agree, with a comment and a blank line typed into a live column; the single-expression refusal was already pinned in the same file.
  
  The engine suite is 14,062 tests in 582 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch rebased onto main after #808, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,481 bytes on Node 24, 13,959 under the ceiling) and the bundled-consumer contract.
- 28702fa: A variable named like a unit is divided by after a slash: with `t = 5`, `100 / t` is 20
  
  `t`, `d`, `s`, `h` and `m` are among the commonest variable names, and each is also a unit symbol. After a slash with no number after it, the engine read one as a rate's unit however the document defined it, so `100 / t` with `t = 5` was a hundred per tonne while `100 * t` and `100 / (t)` read the variable (#642). The rule that fuses `/ t` into a rate reads the text alone and cannot know which names are defined, so the choice is now made when the line runs: a variable of that name defined above the line is divided by, and otherwise the rate is built as before.
  
  | document | before | now |
  | --- | --- | --- |
  | `t = 5` then `100 / t` | 100.00 /t | 20 |
  | `distance = 120`, `t = 2`, then `speed = distance / t` | 120.00 /t | 60 |
  | `s = 2` then `100 / s` | 100.00 /s | 50 |
  | `h = 4` then `100 / h` | 100.00 /h | 25 |
  | `kg = 2` then `10 / kg` | 10.00 /kg | 5 |
  | `f(t) = 100 / t` then `f(4)` | 100.00 /t | 25 |
  | `100 / t` with no `t` defined | 100.00 /t | 100.00 /t |
  
  The division is the ordinary one: `100 / t` gives what `100 / (t)` gives for any value of `t`, a quantity, money or a list included. Both document passes agree, and because the answer now depends on another line, the dependency graph records the name as a read: typing `t = 5` above the line, changing it or deleting it changes the line's answer in a live editor, as it does for any other variable. Renaming `t` carries `100 / t` with it where `t` is defined above it; a `100 / t` above the definition is still the unit, so a rename leaves it alone.
  
  The boundary: a unit written before the slash keeps the rate whatever the name holds, as variables.md documents that a unit after a value is a unit. With `h = 4`, `$15 / h` is still 15.00 USD/h, `60 km / h` 60.00 km/h and `100 per h` a rate, since the word `per` says rate in so many words. A variable defined below the line is not read, as with any variable, and `100 / t` on its own, with no document to define `t`, is the rate. The capitals `N`, `W`, `J`, `K` and `F` were already left to the variable reading and are unchanged.
  
  The variables page shows both readings with proven examples.
  
  ## Verification
  
  `Issue642_unitNamedVariableAfterSlash.spec.ts` has 104 tests: a defined name after a slash for each common unit spelling and the capitals, a function parameter, a global and a quantity in the variable; `100 / t` against `100 / (t)` for fourteen kinds of value, a quantity, money, a list, text and a boolean among them; the forms that keep the rate; the dependency graph's read of the name; `RATE_OR_DIVIDE` in the VM, with a malformed stream and an unregistered rate builtin refused; and an adversarial sweep over eleven names, `constructor` and `__proto__` included. `CrossPathDocumentFeatures.spec.ts` gains 10 tests: both passes agree, a live edit that adds, changes, renames away or deletes the definition changes the line, a rename through the language service carries the denominator where the name is defined above it and leaves it where it is not, and the single-expression path reads the rate. `OperandWidth.spec.ts` compiles `100 / t` into its corpus.
  
  The engine suite is 15,164 tests in 602 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including `lint:units`, the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,528 bytes on Node 24, 13,912 under the ceiling) and the bundled-consumer contract.
- 28702fa: Units and money: a shape's area is squared, a tolerance, a list and a constant are refused where their unit was lost, statistics and health read units, temperatures add as steps, `in` reaches a converter, a decimal is its own fraction, fiat and crypto rates coexist, and inflation is US dollars only
  
  Twelve faults from the 2026-09-25 survey of units, quantities and money. Each gave a confident answer in a unit that was wrong, or dropped a unit without saying so.
  
  **A shape's dimensions carry their units (#638).** The geometry parselet read only the number of `radius 5 m`, so the stranded `m` labelled the whole answer, and in front of a comma it stopped the line parsing. Each dimension is now read with its unit, the dimensions are put into one length unit (the first one written), and the answer takes the power its measure has: a length for a perimeter, the square for an area, the cube for a volume.
  
  | line | before | now |
  | --- | --- | --- |
  | `area of circle radius 5 m` | 78.54 m | 78.54 m² |
  | `area of circle radius 5 m in cm²` | refused: a length cannot be converted to an area | 785,398.16 cm² |
  | `area of circle radius 5 m in cm` | 7,853.98 cm | refused: an area cannot be converted to a length |
  | `volume of sphere radius 2 m` | 33.51 m | 33.51 m³ |
  | `area of rectangle width 3 m, height 4 m` | error: Unexpected token after expression: "," | 12.00 m² |
  | `area of circle radius 5 kg` | 78.54 kg | refused: a radius is a length, not a mass |
  
  A dimension with no unit beside one with a unit is read in that unit, as `total of 1 km, 500` reads it, so `width 3 m, height 4` is 12.00 m². A length with no square or cube spelling of its own answers in square or cubic metres, as `(5 furlong)^2` does, rather than being refused: `area of square side 2 furlong` is 161,874.26 m². Bare dimensions answer plain numbers as before.
  
  **A value with a tolerance cannot be converted or meet a quantity (#639).** A tolerance is read without the unit of the value it is on, as the uncertainty page documents, so `5 m +/- 1 cm` is the plain `5 ± 0.01`. A later `in mm` labelled that bare 5 as millimetres, and a quantity in `+`, `-`, `*` or `/` gave the answer its unit and dropped the spread. Both are refused by name (`UNCERTAINTY_WITHOUT_UNIT`), and so is a unit written straight after such a value.
  
  | line | before | now |
  | --- | --- | --- |
  | `(5 m +/- 1 cm) in mm` | 5.00 mm | refused, pointing at `(5 m in mm) +/- 10` |
  | `(20 C +/- 1 F) in F` | 20.00 F | refused |
  | `(5 +/- 0.1) in km` | 5.00 km | refused |
  | `(5 +/- 0.1) km` | 5.00 km | refused |
  | `(5 m +/- 1 cm) + 2 m` | 7.00 m | refused |
  | `(5 +/- 0.1) * 2 m` | 10.00 m | refused |
  
  The engine cannot tell a centre whose unit was dropped from one that never had one, so a unitless measurement is refused the same way. Scalar arithmetic is unchanged (`(5 m +/- 1 cm) * 2` is 10 ± 0.02), and so is the conversion of the tolerance into the centre's unit. Carrying the unit through, so that `(5 m +/- 1 cm) in mm` is 5,000 ± 10 mm, changes what the page documents and is left to its own change.
  
  **A list given a unit is refused, not read as zero (#640).** A unit written straight after a list, and a quantity combined with one, read the list as the 0 `toNumber()` reports for it. The first is refused with the sentence `in` has given since #547 (`CONVERT_NON_NUMERIC`), the second with `QUANTITY_NON_NUMERIC`.
  
  | line | before | now |
  | --- | --- | --- |
  | `[1, 2, 3] km` | 0.00 km | refused |
  | `$[4, 5]` | $0.00 | refused |
  | `[1, 2] * 1 km` | 0.00 km | refused |
  | `[1, 2] + 1 km` | 1.00 km | refused |
  | `1 km - [1, 2]` | 1.00 km | refused |
  | `[1, 2] * 2` | [2, 4] | [2, 4] |
  
  A range and a colour beside a quantity are refused the same way. Text and a date keep their own refusals. Lists that carry a unit, so that `[1, 2] * 1 km` becomes a list of lengths, are a designed feature this leaves open.
  
  **A list literal in two units is refused (#641).** A cell stores a quantity's amount and drops its unit, so two units could not both be read right. A literal whose cells are in two different units is refused by name (`MATRIX_CELL_UNITS_DIFFER`), naming both.
  
  | line | before | now |
  | --- | --- | --- |
  | `[1 km, 500 m]` | [1, 500] | refused, pointing at `in km` |
  | `[1 kg, 3 m]` | [1, 3] | refused: mass and length are not one measure |
  | `[$1, 2 kg]` | [1, 2] | refused |
  | `[1 km, 2 km]` | [1, 2] | [1, 2] |
  | `[1 km, 500]` | [1, 500] | [1, 500] |
  
  A list in one unit keeps its bare magnitudes, since nothing in it is misread; two spellings of one unit (`km` and `kilometres`) are one unit. A bare number beside a quantity is read in its unit, the rule the aggregates follow.
  
  **Standard deviation, variance and mode read units (#643).** Each read its arguments' bare magnitudes. They now read them in the first one's unit, as `spread` does, and answer in it.
  
  | line | before | now |
  | --- | --- | --- |
  | `standard deviation of 1 kg, 1000 g` | 499.50 | 0.00 kg |
  | `standard deviation of $10, $20, $30` | 8.16 | $8.16 |
  | `mode of 1 kg, 1000 g, 2 kg` | 1 | 1.00 kg |
  | `standard deviation of 1 kg, 2 m` | 0.50 | refused: mass and length cannot be used in a standard deviation |
  | `variance of 2 m, 4 m` | 1 | 1.00 m² |
  | `variance of 1 kg, 1000 g` | 249,500.25 | refused (`UNIT_POWER_UNSUPPORTED`) |
  | `standard deviation of 1/0, 1000` | NaN | refused (`STATISTIC_NOT_FINITE`) |
  
  A variance is in the square of the data's unit, which the engine spells only for a length. For any other quantity, money and temperatures included, the choice made is to refuse by name, as the power operator refuses `(2 kg)^2`, and to point at the standard deviation, which is the same spread in a unit the engine can write. A list with an infinity in it, which gave NaN, is refused as well. Plain numbers are otherwise unchanged. A table column of quantities is still refused by the column form, which reads plain-number cells only.
  
  **`bmi`, `pace` and `speed` convert the units they are given (#644).** Each read a quantity's magnitude in the unit it assumes, so 175 cm was 175 metres and one hour was one minute. A quantity is converted into the function's unit now, and one that measures something else is refused with `HEALTH_BAD_INPUT`.
  
  | line | before | now |
  | --- | --- | --- |
  | `bmi(70 kg, 175 cm)` | 0.00229 | 22.86 |
  | `bmi(154 lb, 69 in)` | 0.03 | 22.74 |
  | `speed(10 km, 1 h)` | 600.00 km/h | 10.00 km/h |
  | `speed(10 mi, 1 h)` | 600.00 km/h | 16.09 km/h |
  | `pace(10 mi, 80 min)` | 8:00 /km | 4:58 /km |
  | `bmi(70 kg, -175 cm)` | 0.00229 | refused: the height cannot be negative |
  
  A bare number keeps the documented unit, so `speed(10, 1)` is still 600.00 km/h. A negative figure is refused with or without a unit. `pace` still answers per kilometre when the distance is in miles.
  
  **Temperatures across scales (#645).** A conversion between offset scales that lands within the comparison tolerance of zero is zero, so the value and not only its display is the shared point. And `+` reads a right-hand temperature on another scale as a step, converted the way a tolerance's width is.
  
  | line | before | now |
  | --- | --- | --- |
  | `32 °F in °C` | 5.68e-14 °C | 0.00 °C |
  | `20 °C + 10 °F` | 7.78 °C | 25.56 °C |
  | `20 °C + 10 K` | -243.15 °C | 30.00 °C |
  | `68 °F + 10 °C` | 118.00 °F | 86.00 °F |
  | `10 °F + 20 °C` | 78.00 °F | 46.00 °F |
  
  Same-scale sums are unchanged, and a genuine small reading is left alone (`32.0018 °F in °C` is 0.001 °C). Subtraction, and converting a difference afterwards, keep their documented reading and are held for 3.0: `20 °C - 10 °F` is still 32.22 °C.
  
  **A bare number takes only a unit or a converter after `in` (#646).** A package's converters (`roman`, `words`, `ordinal`) lex as ordinary words, so `in` never reached them, and a plain number was given any word after `in` as its unit. `in` now reaches every converter a package registered, as `as` does, and a word that is neither a unit nor a converter is refused with the `UNKNOWN_UNIT` sentence a quantity already had.
  
  | line | before | now |
  | --- | --- | --- |
  | `2024 in roman` | 2,024.00 roman | MMXXIV |
  | `42 in words` | 42.00 words | forty-two |
  | `5 in widgets` | 5.00 widgets | refused: "widgets" is not a unit. |
  | `5 in Tokyo` | 5.00 Tokyo | refused |
  | `5 in km` | 5.00 km | 5.00 km |
  
  `to` is deliberately not rewritten the same way. A word after `to` is a percentage change to a variable (`start to n`), and a package converter is often named like one (the derived units register `n`, `v` and `w`), so `2024 to roman` still reads a variable called `roman`. The converters stay process-wide, as `as` reads them. The developer guide for `asConverters` describes the `in` spelling and its limits.
  
  **A typed decimal is the fraction it spells (#647).** `as fraction` guessed at the double nearest the decimal with a continued fraction, which for six-digit decimals landed on near misses. It now renders the value's exact decimal. The choice made is the rule fractions.md states, a decimal reads as the fraction it is, always, so a decimal that only approximates a simple fraction is not rounded onto it.
  
  | line | before | now |
  | --- | --- | --- |
  | `0.333333 as fraction` | 333332/999997 | 333333/1000000 |
  | `3.14159 as fraction` | 76149/24239 | 314159/100000 |
  | `0.0001234 as fraction` | 3/24311 | 617/5000000 |
  | `0.3333333 as fraction` | 1/3 | 3333333/10000000 |
  | `0.2857142857 as fraction` | 2/7 | 2857142857/10000000000 |
  | `0.125 as fraction` | 1/8 | 1/8 |
  
  A value with no exact form keeps the continued-fraction guess: `sqrt(2) as fraction` is still 47321/33461.
  
  **`boltzmann` carries J/K, and the unitless constants refuse a quantity (#648).** The physical constants without an engine unit were plain numbers, which take the unit of the quantity they meet.
  
  | line | before | now |
  | --- | --- | --- |
  | `boltzmann` | 1.38e-23 | 1.38e-23 J/K |
  | `boltzmann * 300 K` | 4.14e-21 K | 4.14e-21 J |
  | `planck * 5e14 Hz` | 3.31e-19 Hz | refused (`CONSTANT_UNIT_UNSUPPORTED`) |
  | `gas constant * 300 K` | 2,494.34 K | refused |
  | `avogadro * 2` | 1,204,428,152,000,000,000,000,000 | 1,204,428,152,000,000,000,000,000 |
  
  `planck`, `elementary charge`, `gas constant` and `avogadro` need a dimension the engine does not have yet (charge, the mole, a product of units). They stay plain numbers marked with their unit, and a quantity meeting one in arithmetic or a conversion is refused. A value already computed from one (`planck * 2`) is an ordinary number, so the refusal covers the constant as written or held in a variable. A snapshot keeps the mark (an optional `uu` field on a serialised number, so no format version bump), so a variable holding `planck` is refused the same way after `fromJSON`. They gain their units with the everyday-units feature.
  
  **Fiat and crypto rates no longer overwrite each other (#649).** Both fetch paths stored their result under the base currency and replaced whatever table was there, so of `$100 in EUR` and `$100 in BTC` in one note, whichever landed second cost the other its rate, and a host's primed table was lost to the first live fetch for its base. Each source now keeps its own table. With `fetch` stubbed (Frankfurter USD to EUR at 0.9, CoinGecko bitcoin at $50,000):
  
  | note | before | now |
  | --- | --- | --- |
  | `$100 in EUR`, then `$100 in BTC` | CURRENCY_RATE_UNAVAILABLE, 0.002 BTC | €90.00, 0.002 BTC |
  | `$100 in BTC`, then `$100 in EUR` | 0.002 BTC, CURRENCY_RATE_UNAVAILABLE | 0.002 BTC, €90.00 |
  | host primed USD to EUR at 0.9, Frankfurter stub at 0.8 | €80.00, CURRENCY_RATE_UNAVAILABLE | €90.00, 0.002 BTC |
  
  A pair two fresh tables both hold is served by the rule the single table per base gave: the base stored first, and within a base the table stored most recently, so no rate that used to be served moves. Freshness windows, the providers and the triangulation rules are unchanged; whether a live fetch should ever override a host's own rate is left as it was.
  
  **Inflation adjusts US dollars only (#650).** The bundled table is the US consumer price index (CPI-U), and every form applied it to whatever it was given, keeping the unit.
  
  | line | before | now |
  | --- | --- | --- |
  | `what is £100 from 1990` | £254.55 | refused (`INFLATION_EXPECTED_USD`), naming the US index |
  | `what is 100 kg from 1990` | 254.55 kg | refused |
  | `what is 100 from 1990` | 254.55 | refused |
  | `inflationAdjust(£100, 1990, 2020)` | £198.01 | refused |
  | `inflationAdjust($100, 1990, 2020)` | $198.01 | $198.01 |
  
  The `from <year>` forms run to the current year (2026 on this run). The choice for a bare number follows payroll, which refuses a bare salary: it would assume dollars without saying so, and is refused pointing at `$100`. Indices for other countries are not bundled; the stated-rate `value of ... assuming N% inflation` form does not use the index and still takes any currency.
  
  The geometry, uncertainty, vectors and matrices, statistics, health, converting units, unit arithmetic, numerals, time zones, fractions, other representations, constants, currency and interest and inflation pages describe each change with proven examples, and the `asConverters` guide and the live-data guide cover `in` and the side-by-side rate tables.
  
  ## Verification
  
  New tests pin each issue under `__tests__/bugs` (#638 to #641 and #643 to #650), each with an adversarial section: a mass, a duration, money, a list and an area as a shape's side, metres beside centimetres, a unit on one dimension only, zero and negative dimensions, and a quantity from a variable and from a line reference; every operator with a tolerance, a list or a constant on either side of a quantity, a percentage tolerance, a temperature centre and money; two spellings of one unit, two currencies, a temperature pair, a matrix with `;` rows and a sweep over lengths; temperatures across every pair of scales in both directions and a genuine small reading the snap must leave alone; a converter a host registered, words naming inherited properties and a very long rate after `in`; decimals past a double's digits and past the exact-decimal limit; both orders of arrival of a fiat and a crypto rate, two crypto pairs from one base, a primed table beside a live fetch, a stale table, a failed fetch and provenance per line; and every inflation form with pounds, euros, a converted amount, a mass and a bare number. Each checks both document passes agree. Unit tests cover the new and changed helpers (`readDimensions`, `measureInUnit`, `asPowerOfLength`, `noSingleAmount`, `quantityOperandRefused`, `unitAfterValue`, `plainValueInUnit`, `namesAUnit`, `unknownUnitError`, `toleranceHasNoUnit`, `toleranceMeetsQuantity`, `uncertainOp`, `sameUnit`, `cellUnitsDiffer`, `spreadStatistic`, `modeOf`, `readHealthInput`, `temperatureStep`, `hasOffset` and the offset snap in `convertUnit`, `fractionOfExactDecimal`, `unspelledUnitRefused`, `inflationAmountRefused`, the converter preposition rule, and the exchange's tables through its public methods). The adversarial sweep gains a units-and-money group of fifteen forms over its numeric edges, which found the NaN standard deviation of a list with an infinity in it. Five existing tests that pinned the old readings now pin the new ones: `5 in Tokyo`, which was labelled as a unit and is refused, and four inflation tests written with a bare amount, now written in dollars, with the bare amount's refusal pinned beside them. The time-zones page's `5 in Tokyo` example shows the refusal.
  
  The engine suite is 15,164 tests in 602 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including `lint:units`, the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,528 bytes on Node 24, 13,912 under the ceiling) and the bundled-consumer contract.

## 2.40.0

### Minor Changes

- 5540410: Cash-flow appraisal: `npv of`, `irr of` and `payback of` judge a series of cash flows
  
  The finance package worked on one sum at a time (`present value of`, `roi`, the annual return), so the question asked of an investment, an outlay followed by a return each period, had no form: `npv of -1000, 300, 400, 500 at 10%` failed at the first comma and `npv(...)` was an undefined function. Three forms now answer it: the net present value at a discount rate, the internal rate of return (the rate at which that value is zero), and the payback period (how long the running total takes to climb back to zero).
  
  | expression | before | now |
  | --- | --- | --- |
  | `npv of -1000, 300, 400, 500 at 10%` | error: unexpected token `,` | -21.04 |
  | `npv of -$1,000, $300, $400, $500 at 10%` | error: unexpected token `,` | -$21.04 |
  | `npv of -100, 110 at 10%` | error: unexpected token `,` | 0 |
  | `irr of -1000, 300, 400, 500` | error: unexpected token `,` | 8.90% |
  | `irr of -100, 230, -132` | error: unexpected token `,` | error: 2 internal rates of return, 10.00% and 20.00% |
  | `payback of -1000, 300, 400, 500` | error: unexpected token `,` | 2.60 |
  | `payback of -1000, 300, 400` | error: unexpected token `,` | error: still 300 short after the last one |
  
  The convention, stated on the new page: the first flow is today and is not discounted, and each later flow is one period further away, the reading a finance textbook uses. A spreadsheet's `NPV()` discounts the first value as well and answers -19.12 for the first row (-21.04 divided by 1.1); its usual idiom, the outlay added outside the function, is exactly the figure here. For that reason there is deliberately no `npv(...)` call spelling, since a call written like the spreadsheet's that answered differently would be a trap. `net present value of` and `payback period of` are the long spellings; the flows can also be one bracketed list or a variable holding one.
  
  Money keeps its currency, and the discounting runs in exact decimals, so a series that breaks even exactly answers 0 rather than a floating-point remainder. The IRR does not guess: a series whose sign changes more than once can have several rates, and a spreadsheet's `IRR()` returns whichever its starting guess reaches. Here the rates are isolated exactly on the flows' own coefficients (Descartes' rule of signs, halving until each rate stands alone), so a single rate is answered only when there is exactly one, and otherwise every rate is named, or the series is refused as having none. The payback is fractional, taking the flow in the crossing period to arrive evenly through it, and a later outlay that pulls the total below zero again pays back the last time it recovers.
  
  The boundary: flows are evenly spaced, one per period, so a dated series (a spreadsheet's `XNPV` and `XIRR`) is not a form, since it needs a day-count convention of its own. A series in two currencies is refused rather than converted, because a future flow at today's exchange rate would be a guess presented as a figure. There is no discounted payback and no modified IRR. The rate must be above -100%, and a bare-number rate is a proportion, as in the other finance forms. The triggers are the fused phrases, so `npv`, `irr` and `payback` alone stay ordinary names, and `IRR` stays the Iranian rial's currency code. Every refusal (a flow that is not an amount, fewer than two flows, a list mixed with loose flows, a rate at or below -100%, several rates or none, never paying back) is a structured error naming the problem, never a thrown exception or a wrong number; an `npv of` with no `at` clause is a parse error that names the missing rate, as the other finance phrases treat a missing clause. The forms are plugin functions on the finance package; no builtin index is added.
  
  ## Verification
  
  A new spec, `__tests__/packages/finance/CashFlow.spec.ts`, pins every form against references computed outside the engine: exact rational arithmetic in Python for the NPV and payback figures, sympy's exact real-root isolation for every IRR, and Microsoft's own worked NPV and IRR examples (1,922.06, -3,749.47, 8.66%, -2.12%, -44.35%), with each refusal and its code. The new NPV, IRR & payback page carries proven `solve` and `solve-doc` examples, and the cheatsheet gains two lines. npm run verify:ci passes: 10,709 tests across 517 suites.
- 5540410: Places written by latitude and longitude, with the great-circle distance and the initial bearing between them
  
  A place on the globe can now be written by its latitude and longitude, and the engine answers how far apart two places are and which way to set off from one to reach the other. Angles can be written the way a map writes them, in degrees, minutes and seconds (`51°30'27"`) or with a compass letter (`51.5074°N`), and `as dms` writes an angle back that way. It is a new package, `GEO_PACKAGE` (`solve-geo`), on by default and removable.
  
  | expression | before | now |
  | --- | --- | --- |
  | `distance from London to Tokyo` | error: unexpected token "from" | 9,558.57 km |
  | `bearing from London to Tokyo` | error: unexpected token "from" | 31.73 degrees |
  | `51°30'27"` | error: unterminated string literal | 51.51 degrees |
  | `51.5°N` | error: undefined variable `°N` | 51.50 degrees |
  | `51.5074° as dms` | error: unknown converter "as dms" | 51°30'26.64" |
  
  The first two rows are read in a document where `London = 51.5074°N 0.1278°W` and `Tokyo = 35.6762°N 139.6503°E` are defined on earlier lines. A place is written as a signed pair in brackets, latitude first, or as two compass-lettered angles in either order, or held in a variable; inside `distance` and `bearing` a bare pair such as `51.5074, -0.1278`, which is what a map copies, needs no brackets.
  
  ```text
  distance from (51.5074, -0.1278) to (48.8566, 2.3522)             343.56 km
  distance between 51.5074, -0.1278 and 48.8566, 2.3522             343.56 km
  distance from 51.5074°N 0.1278°W to 35.6762°N 139.6503°E in nmi   5,161.22 nmi
  bearing from (51.5074, -0.1278) to (48.8566, 2.3522)              148.12 degrees
  distance from (0, 179.5) to (0, -179.5)                           111.20 km
  bearing from (90, 0) to (51.5074, -0.1278)                        180.00 degrees
  (51.5074, -0.1278) as dms                                         51°30'26.64"N 0°07'40.08"W
  ```
  
  The distance is the great-circle distance, the shortest path over the surface, worked with the haversine formula on a sphere of the Earth's mean radius, 6,371.0088 km, and returned in kilometres so it converts like any length. The sphere is a deliberate choice over Vincenty's method on the WGS-84 ellipsoid: it gives one answer for every pair of places, including exact antipodes, where Vincenty's iteration fails to converge, and its error (within about 0.5% of the ellipsoidal distance) is smaller than the uncertainty in which point stands for a city. A pair either side of the 180° meridian is measured the short way across it. The bearing is the initial heading in degrees clockwise from true north; from a pole it is due south or due north, whatever longitude the pole was written with.
  
  The angle literal needed a lexer change. A `"` used to open a string, so `51°30'27"` failed as an unterminated string, and a letter after `°` joined it into an identifier. The lexer now reads a number followed directly by `°` and then minutes, or a compass letter, as one `GEO_ANGLE` token, which the geo package turns into an angle in degrees or, paired with a second lettered angle, a place. A bare `90°`, a temperature such as `20°C`, and every string literal lex as before. Without the geo package registered, the literal is a parse error, as the same text was.
  
  Refusals are values on the line that name the part at fault, never a throw or a number: a latitude past a pole, a longitude past 180°, 60 or more minutes or seconds, two latitudes offered as a place, `as dms` of something that is not an angle, and a bearing between the same point or two exact antipodes, which has no single direction.
  
  The boundary: there is no built-in list of cities and nothing reaches the network, so a place is the coordinates the reader gives it, typed or held in a variable. A city covers many square kilometres, and which point stands for it moves the answer by more than the method does, so that choice stays visible on the line. The distance is as the crow flies, not by road or flight route, and ignores height. A destination point (where a heading and a distance lead) and a midpoint are not included. The new "Coordinates, distance and bearing" page explains latitude, longitude, great circles and bearings before the syntax, with every example proven.
  
  ## Verification
  
  New suites pin the distances and bearings for London, Paris, Tokyo, New York and Sydney against figures computed independently in Python with the atan2 form of the central angle, the analytic cases (antipodes and pole to pole at pi times the radius, a quarter circumference, one degree across the 180° meridian), the pole and antipode bearings, degrees-minutes-seconds rounding and carry, every refusal and its code, variables unaffected by the new phrases, the package's removal, and the lexer's boundary around strings, temperatures and the bare degree sign. `npm run verify:ci` passes: 10,709 tests across 517 suites.
- 281c2ab: An unknown name says which real names it is close to
  
  A mistyped variable, function or unit used to be reported bare, `Undefined variable: kilomters`, and a conversion to a word that is not a unit was reported as two units that measure different things. The error now names the nearest real names, so a typo is one glance from fixed. Nothing is ever corrected on the reader's behalf: the line stays an error, in keeping with the rule that a spelling that is not a unit is never resolved to the nearest thing that looks similar.
  
  | expression | before | now |
  | --- | --- | --- |
  | `20 kilomters in miles` | Undefined variable: kilomters | Undefined variable: kilomters. Did you mean kilometers? |
  | `sqr(16)` | Undefined function: sqr | Undefined function: sqr. Did you mean sqrt? |
  | `budgte * 2` (with `budget` defined) | Undefined variable: budgte | Undefined variable: budgte. Did you mean budget? |
  | `sine(1)` | Undefined function: sine | Undefined function: sine. Did you mean sin, sind or sinh? |
  | `5 km in mies` | Cannot convert km to mies: they do not measure the same thing | "mies" is not a unit. Did you mean miles? |
  
  The candidates come from the engine's own vocabulary: the builtin functions, the note's own functions and variables, and every unit spelling, so a package's units are suggested without the package doing anything. Closeness is the edit distance with adjacent transpositions, compared without case, allowing one edit up to five letters, two up to nine and three beyond. Names equally close are all listed, up to three.
  
  For a host, the candidates travel on the thrown `EngineError` as `suggestion` (a comma-separated list) and `context.didYouMean` (an array), ready for a one-click fix; a document line carries the sentence in its error text. A target that is not a unit comes back as an `UNKNOWN_UNIT` error value.
  
  The boundary: a short word gets no suggestion, since the unit table holds thousands of short spellings and nearly every short word is an edit or two from one of them. The floor is three letters for a function name, so `sqr` still finds `sqrt`, and four for a variable, whose candidates include every unit. Four or more equally close names get none, since listing them all would not help. The suggestion does not yet carry a source span; a host locates the named word in the line. In a document with more than 500 variables, which a written note does not reach, an unknown name is compared with the units alone: comparing it with every variable made a long generated document take time growing with the square of its length. The unit table is searched through an index built once, and an unknown word's search is remembered, so a line that stays wrong costs nothing extra on the next pass.
  
  ## Verification
  
  A new suite pins the distance, the ties and the thresholds, the sentence, each of the error forms above including a user-defined function and a variable from earlier in the note, and the mismatch that is still a mismatch. The unit arithmetic and variables pages gain proven examples, and the TypeScript guide shows the fields a host reads. `npm run verify:ci` passes: 9,807 tests across 496 suites, with the bundled-consumer contract.
- 5540410: A `check` line asserts something a note must keep true, and fails loudly when an edit breaks it
  
  A note can now state what must hold: a budget that covers the spending, two totals that agree, a formula close to a known value. `check` and a comparison shows a tick while it holds and becomes an error naming both sides the moment an edit breaks it. `≈` (or `~=`) and `within` allow a margin, as a percentage of the right-hand side or an amount in the same unit. A host gets a pass and fail count on the parse result.
  
  | expression | before | now |
  | --- | --- | --- |
  | `check 1 + 1 == 2` | error: Unexpected token after expression | ✓ |
  | `check :spent <= :budget` (spent $2,010, budget $1,950) | error: Unexpected token after expression | error: check failed: $2,010.00 is more than $1,950.00 |
  | `check 22/7 ≈ pi within 0.1%` | error: Unexpected token | ✓ (differs by 0.04%) |
  | `check 22/7 ≈ pi within 0.01%` | error: Unexpected token | error: check failed: 3.14286 differs from 3.14159 by 0.04%, more than 0.01% |
  | `check 5 m ≈ 5.01 m within 1 cm` | error: Unexpected token | ✓ (differs by 0.01 m) |
  
  The two sides are compiled separately, so a failure can name them, and compared in a shared unit the way the engine's own comparisons reconcile units, so `check 1 km == 1000 m` passes. Equality allows a conversion's rounding, so `check 0.1 + 0.2 == 0.3` passes; `≈` without `within` allows rounding noise. An approximate failure shows its two sides to six significant figures, since the usual two places would round the difference away. A `total above` beneath a check steps over it, passed or failed, so an assertion does not break the column it guards. `parseDocument` and `evaluateDocument` report `checks: { passed, failed }`, present only when the document has any, and the worker's result DTO carries it too.
  
  The boundary: `check` is a check only at the start of a line that compares two things, so a variable called `check` (a restaurant bill) keeps working, and `within` and `≈` become single tokens. Two things with no common measure, a length and a mass, are refused as incomparable (`CHECK_INCOMPARABLE`) rather than reported as a failed check, and text compares with `==` and `!=` only. A check does not stop the lines around it evaluating; it is a signal, not a guard.
  
  ## Verification
  
  A new suite pins passing checks, every failure message, approximate checks by percentage and by amount, the refusals, `check` as a variable, a total beneath a check, and the host count from `parseDocument` and `evaluateDocument` alike. The conditionals page gains a Checks section with proven examples, and the TypeScript guide shows the count. `npm run verify:ci` passes: 10,709 tests across 517 suites.
- 83c13d4: Exact decimals for plain numbers
  
  A number written with a decimal point now keeps the exact decimal it was written as through arithmetic, the way money always has, so a comparison agrees with the answer on screen. Before, a plain decimal was a binary floating-point number (the IEEE 754 double), which cannot hold a tenth exactly: `0.1 + 0.2` was 0.30000000000000004, shown as 0.30, and then compared unequal to 0.3 on the next line.
  
  | expression | before | now |
  | --- | --- | --- |
  | `0.1 + 0.2 == 0.3` | false | true |
  | `1.1 * 1.1 == 1.21` | false | true |
  | `0.1 + 0.2 - 0.3` | 5.55e-17 | 0 |
  | `0.3 / 0.1` | 3.00 | 3 |
  | `floor((0.7 + 0.1) * 10)` | 7 | 8 |
  | `100 + 10%` | 110.00 | 110 |
  | `(0.5 + 0.505) to 2 dp` | 1.00 | 1.01 |
  | `(0.1 + 0.2) to 17 dp` | 0.30000000000000004 | 0.30000000000000000 |
  | `0.1 + 0.2` | 0.30 | 0.30 |
  | `12.3 kWh * $0.15/kWh` | $1.84 | $1.85 |
  | `12.3 kg at $0.15/kg` | $1.84 | $1.85 |
  | `$0.15 per kg * 12.3 kg` | $1.84 | $1.85 |
  | `$0.15 * 12.3 kWh` | $1.84 | $1.85 |
  | `$1.005/kg` | 1.00 USD/kg | 1.01 USD/kg |
  
  Adding, taking away, multiplying, a remainder, a whole power and a percentage are exact. A division is exact where its decimal ends (`1 / 0.8` is 1.25) and is kept as the exact fraction where it does not, the way `1/3` already was, so `0.1 / 3 * 3 == 0.1` is true and a fraction meets a decimal as fractions (`1/3 + 0.1` is exactly 13/30). The comparisons and a conditional's test read the exact values, and so does rounding: `to N dp`, `round`, `floor` and `ceil` round the decimal itself, so a value exactly half way rounds away from zero, as money's half-cent does. The totals and averages of a list, of the lines above, of a range, of a category tag and of a table column are exact too. A figure that records where it came from, such as a converted amount read as a number, is exact on the same terms as one typed in, and it keeps its record, as an exact total of such figures keeps all of theirs: nine euros read as a number, times 0.15, is exactly 1.35 and still names the rate it was converted at.
  
  A price per unit is money, and it keeps the decimal it was typed as, so the bill it gives is the plain product in every spelling. At 15 cents a kilowatt-hour, 12.3 kilowatt-hours cost exactly $1.845. `$0.15 * 12.3` always showed $1.85, but a price per unit was worked in floating point, where the product lands a hair under the half cent, so `12.3 kWh * $0.15/kWh`, `12.3 kg at $0.15/kg`, `$0.15 per kg * 12.3 kg` and `$0.15 * 12.3 kWh` showed $1.84. Each now comes to the plain product's $1.85. A price per unit on its own line rounds a half cent the way money does (`$1.005/kg` is 1.01 USD/kg, as `$1.005` is $1.01), and a price below a cent still shows its significant digits (`$0.001/kWh` is 0.001 USD/kWh), since a tenth of a cent a unit is a real price. The quantity is not money, so it is still held in floating point, and its decimal is read back from that number: a quantity typed as a decimal, or converted onto a short one (`12300 Wh` is 12.3 kWh), counts exactly, while a quantity that is floating point's rounding of a fraction, such as a third of a kilowatt-hour, is worked out in floating point as it was, so `(1/3) kWh * $30/kWh == $10` stays true. A price worked out by dividing (`$1.20 / 0.4 kg`) and a price per unit times another rate (`$0.15/kWh * 12.3 kWh/day`, whose answer is a rate, not an amount of money) are floating point too.
  
  What is shown for an ordinary answer does not change. The lines that change are the ones where floating point had left a visible trace: a result that is a whole number no longer shows `.00`, a true half now rounds away from zero (`1.9 + 15%` is exactly 2.185, so 2.19 where it was 2.18), `as scientific` loses the trailing digits of the approximation, and a decimal quotient `as fraction` is the exact fraction rather than a close one (`1234.0765 / 1234.01` is 2468153/2468020, not 37115/37113).
  
  The boundary, and why. An irrational answer (a square root, a logarithm, a trigonometric function, `pi`) has no exact decimal or fraction to keep, so it stays in floating point. Scientific notation is still read as floating point: it is how a magnitude is written, and it is what keeps a typed `1e16` from being given digits it never had, so `1e-1 + 2e-1 == 3e-1` is still false. An exact answer carries at most 34 digits, and 34 places, the precision of IEEE 754's decimal128 format; a longer one, such as `1.05 ^ 30` at 61 digits, is the floating-point answer it always was. A unit other than money, a measurement with an uncertainty, a statistic such as a median and a matrix entry stay in floating point, and so do the areas, reciprocals and rates other than prices that units now form when they multiply and divide. A negative zero keeps the sign floating point gives it, so `1 / (0.0 * -1)` is still -Infinity. The plain whole-number arithmetic is unchanged: two whole numbers never take the decimal path, and each exact path is a call behind a property test rather than code in the VM's dispatch loop, which keeps that loop under the size V8 will optimise.
  
  Fixes #579.
  
  ## Verification
  
  A new suite pins every operation above against its exact value and its nearest double, the rounding family, the percentage paths, the totals through both document passes, the fraction bridge, negative zero, a figure carrying its sources and the exact totals of such figures, every spelling of a price per unit against the plain product it abbreviates, and each boundary, including the 34-digit limit, a huge power refused before it is built, the unit products that stay in floating point, and a count or a price per unit that has no short decimal. The cross-path suite gains the decimal column, range, tag and table totals through `parseDocument` and `evaluateDocument`. The hardening suites that pinned the floating-point answers now pin the exact ones, with each reversal recorded, and still pin floating point through scientific notation.
  
  An A/B against a build of the previous main ran 34,709 cases: every documented example, line by line and as whole documents through both document passes, every string the test suite evaluates, 6,000 generated decimal lines, 3,000 generated prices per unit in every spelling, and 360 generated documents with totals, tags and table columns. 1,598 answers differ, all of them the intended changes above: 1,313 carry the nearest double to the exact answer with the display unchanged, 142 comparisons are decided on the exact values, 54 bills through a price per unit or a quantity at a price round their half cent as the plain product does, 2 prices per unit on their own round a half cent as money does, 1 bill of a tenth of a cent is $0.00 as `$0.001` is, 29 whole results drop `.00`, 25 roundings take the exact half or the exact digits (`to N dp`, a percentage, a total), 10 `as scientific` and 2 `as fraction` readings lose the approximation, 5 remainders and 2 sums are exactly zero, 5 `floor`, `ceil` and `trunc` read the typed digits, 4 whole powers and 1 product past the safe range show their exact digits, and 3 conditionals take the other branch. Every documented example that differs is on a page this change updates. No answer changed type, and none became or stopped being an error.
  
  The VM's dispatch loop, compiled the way Jest compiles it, is 46,898 bytes of bytecode against the previous 46,598, with 14,542 to spare below the 61,440 V8 will optimise. The benchmark comparison against the previous main, five alternating runs of the vm, pipeline and document-parse suites with Maglev and five with `--no-maglev` (what the benchmark job's Node 22 sees of an oversized loop), passes the regression gate on every pair: the suite geometric means of the per-case medians are 0.990, 0.995 and 1.004 with Maglev, and 0.982, 1.001 and 0.977 without it. The decimals page is rewritten, the fractions and exact coefficients pages updated, and the money precision page gains prices per unit, with proven examples. `npm run verify:ci` passes: 11,728 tests across 536 suites, with the bundled-consumer contract.
- 939aaa8: Conversions, function calls and finance phrases explain their steps, and a note can trace which lines fed a result
  
  `explainLine` derived arithmetic, percentages and date readings from a fixed table of operators, and returned no steps at all for the three things a reader most often wants to check: a conversion, a function call and a finance phrase. Each of those is a call into a package, and only the package knows what happened between the numbers that went in and the one that came out. Packages now describe their own steps through a new `explain` field on `IEnginePackage`, and the unit, function and finance packages do.
  
  | line | before | now |
  | --- | --- | --- |
  | `5 km in miles` | no steps | `1 km is 0.621371 miles`, `5 times 0.621371` = 3.11 miles |
  | `sqrt(16) + 2` | no steps | `the square root of 16` = 4, `4 plus 2` = 6 |
  | `present value of $1,000 after 5 years at 5%` | no steps | `5% a year for 5 years: (1 plus 5%) to the power of 5 is 1.27628`, `$1,000.00 divided by 1.27628` = $783.53 |
  | `-(2 + 3)` | `2 plus 3` = 5, a last step that disagreed with the answer | `2 plus 3` = 5, `the negative of 5` = -5 |
  
  Every number a step shows is the engine's own. A conversion factor is what the engine's conversion gives for one unit, and the finance steps compute through a new shared module, `vm/FinanceFormulas.ts`, that the finance builtins now use too, so the growth factor a step shows is the one the answer was divided by. The hook is handed each call the line made, with the arguments and result the engine used, and returns the steps between them; its last step must carry the call's own result, or the answer is discarded. A plugin function or an `as` converter is offered only to the package that registered it, and a builtin or a conversion to every package, the most recently registered first. The VM reports calls only on the run `explainLine` makes, through `LineExecutionContext.observeCall`, so ordinary evaluation never calls a hook.
  
  The second half is where a number came from across lines. `engine.traceLine(n)` returns line n's answer and the lines it read, each followed upwards in the same shape, reading a variable to its nearest definition above, a position (`line 2`, `prev`, `total above`, a range) and a category tag. A reader asks the same question in the note:
  
  | document | line 5 |
  | --- | --- |
  | `:rate = 4%`, `:deposit = 100000`, blank, `:payment = monthly repayment on deposit over 25 years at rate`, `inputs of line 4` | payment 527.84 (line 4) <- deposit 100,000 (line 2), rate 4.00% (line 1) |
  
  The trace is built from each line's text and answer rather than from the dependency graph, which records positional reads only on the incremental path, so `parseDocument` and `evaluateDocument` give the same trace value for value. Two lines that read each other come back marked as a cycle rather than looping, and a line reading one below it is marked as a forward reference; `inputs of line N` turns both into named errors, `TRACE_CYCLE` and `TRACE_FORWARD_REFERENCE`, and refuses through the single-expression entry point, which has no document. The trace stops ten levels down and after two hundred lines, marking where it stopped.
  
  The boundary: a hook describes calls, never the arithmetic between them, and a derivation is never partial, so a line with an undescribed call, or whose calls leave an operation out (`round(5 km in miles + 1 mile, 1)`), gets no steps rather than some. Steps are English prose in the engine's default number style. Date arithmetic, matrices and symbolic algebra still report their answer without a breakdown. A table column is read from the table's text, so it lists no inputs in a trace. `inputs of line N` shares the `lineRef` plugin slot rather than registering a function of its own, since it reads the same target line through the same line context.
  
  ## Verification
  
  Two new suites pin the three probes, every finance form, the hook contract (owner-only plugin calls, the discarded answer, a throwing hook, the latest registration first, a converter, a `defineFunction` package), the no-partial rule, that no hook runs during ordinary evaluation, and the trace's reads, cycles, forward references, bounds and refusals through a parsed result and an attached document model. The cross-path suite gains `inputs of line N` through all three entry points. A new syntax page, a host guide and a package-author guide are added, with the explaining guide and the authoring routing table updated. `npm run verify` passes: 11,248 tests across 532 suites, with the bundled-consumer contract.
- 5540410: Special angles give exact answers, and a function outside its domain says so
  
  The angles people type, 0, 30, 45, 60 and 90 degrees and their multiples, and the same angles written with π, now give exact sines, cosines and tangents. A computer holds none of those angles exactly, so the sine of its nearest approximation to 180° was 0.000000000000000122 and the tangent of 45° was 0.9999999999999999. And the logarithms and inverse functions, asked for a value outside their domain, answered with an infinity or `NaN`; they now refuse by name with `FUNCTION_DOMAIN`, saying what the function accepts.
  
  | expression | before | now |
  | --- | --- | --- |
  | `sin(180 degrees)` | 1.22e-16 | 0 |
  | `cos(90 degrees)` | 6.12e-17 | 0 |
  | `tan(45 degrees)` | 1.00 (0.9999999999999999) | 1 |
  | `tan(180 degrees)` | -1.22e-16 | 0 |
  | `log(0)` | -∞ | error: log is only defined for positive numbers |
  | `log(-1)` | NaN | error: log is only defined for positive numbers |
  | `asin(2)` | NaN | error: asin is only defined for numbers from -1 to 1 |
  | `atanh(1)` | ∞ | error: atanh is only defined for numbers strictly between -1 and 1 |
  
  An angle counts as special when it is within the conversion's own rounding of a multiple of 30° or 45°, with the tolerance scaled to the angle, the rule `tan`'s asymptote check from #532 already uses. The degree-argument forms `sind`, `cosd` and `tand` follow the same rules, and `tand(90)` now refuses the asymptote as `tan(90 degrees)` does. The refusals cover `log`, `log10`, `log2`, `log1p`, `asin`, `acos`, `asind`, `acosd`, `acosh` and `atanh`.
  
  The boundary: exactness covers the multiples of 30° and 45°; an irrational exact value such as the sine of 45° is the nearest double, and any other angle is computed as before. A square root of a negative number is not refused, since it has an exact complex answer (`sqrt(-1)` is `i`). Division by zero keeps the floating-point standard's infinity, `1/0` is ∞, a decision recorded in the arithmetic hardening suite: it is the standard's defined answer for an operator, where the functions above had no answer at all. A `NaN` argument is not refused, since whatever produced it has its own story.
  
  ## Verification
  
  A new suite pins each exact angle in degrees, radians, gradians and the degree functions, the positive zero, the irrational special values, unchanged ordinary angles, `tand`'s asymptote, every domain refusal and its message, the edges of each domain, and the complex square root and IEEE division that stay as they were. The number functions page gains exact angles and a section on domains, with proven examples. `npm run verify:ci` passes: 10,709 tests across 517 suites.
- 939aaa8: Live values say where they came from, and a line ending in `frozen` keeps its answer with the date it was fixed
  
  A converted amount, a price or a temperature is true at one moment according to one provider, and a result said neither: the exchange rate cache kept its fetch time to itself, and nothing reached the value. Every live figure now carries a provenance record on `Value.sources` (the provider, whether it was fetched live, supplied by the host or looked up for a past day, when, and what was asked for), and the record travels through arithmetic, conversions, rounding, aggregates, line references and variables, so a host can show "reference rate, 23 Sep 16:02" beside a line and mark every line computed from it as rate-dependent. Ending a line with `frozen` keeps its first settled answer, with the moment it was frozen, so a shared or archived note reads the same next month.
  
  | line | before | now |
  | --- | --- | --- |
  | `(10 USD in GBP) * 3` | £22.23 | £22.23, carrying the rate's provider, pair and time |
  | `10 USD in GBP frozen` | error: Unexpected token after expression: "frozen" | £7.41, and still £7.41 after the rate moves, with the date it was frozen |
  | `:rate = 1 USD in GBP frozen`, then `rate * 100` | error, then an undefined variable | £0.74, then £74.10 carrying the frozen rate's record |
  | `10 USD in GBP frozen on 2024-01-15`, nothing stored | error: Unexpected token after expression: "frozen" | error: This line was frozen on 2024-01-15, but no value frozen that day is stored in this engine. A frozen value is never fetched again: restore the snapshot or frozen values it was saved with, or remove "on 2024-01-15" to freeze it anew. |
  
  The record is set where a live figure enters: the exchange tables name `Frankfurter` or `CoinGecko`, or the host's own name for rates it primes (`primeRates` takes `provider` and `publishedAt`); `createQueryResolver` stamps what it fetches with a new `provider` option; weather names `Open-Meteo`; stocks, crypto, knowledge and historical currency take a `provider` (`historicalProviderName` for currency). A historical figure is recorded as one, with the day it describes. The record crosses the worker DTO and a snapshot unchanged, and `explainLine` ends a derivation with a step per source, which gives a conversion a step for the first time. Arithmetic merges records rather than inventing them, so a value built only from what the reader typed carries none, and the plain-number fast path declines a sourced operand exactly as it declines a fraction or a tolerance, so ordinary arithmetic takes no new path.
  
  A frozen line is answered from a store the engine keeps, keyed by the line's text, on every path that runs a line: the first pass, a re-run from cached bytecode, the re-run when a value lands, and goal seek's probes, which read a stored answer and record nothing. A stored answer is returned without running the line, so no rate is read and no request is made, and the line stops being one of its source's readers, so a background refresh that nothing else reads stops. `toJSON()` carries the answers and the frozen lines (the one live line a snapshot keeps, because the reader asked for it), and `fromJSON()` restores them, so a restored document answers with the network switched off. `getFrozenValues()` lists them, `unfreeze()` forgets one or all, and `clear()` forgets them with the document. A line that names its day, `frozen on 2026-09-23`, is refused with `FROZEN_VALUE_MISSING` in an engine that holds no value frozen that day, rather than frozen afresh at today's figure; writing today's date freezes it now.
  
  The boundary: freezing keeps a whole line's answer, so the word goes at the end, and a function definition, a global cell or a definition part-way through a line is refused by name (`FROZEN_UNSUPPORTED`), as is `frozen on` followed by anything but a date (`FROZEN_DATE_EXPECTED`). A frozen answer does not refresh, and editing the line's text freezes it afresh. A line computed from a frozen answer is not itself marked frozen, since it is a new value; it carries the frozen rate's record, with its freeze date. A comparison's true or false, a bracketed list and text made from a live value carry no record. The engine records where a figure came from and when; it does not judge whether that is recent enough. A variable called `frozen` at the end of a line now needs its operator written out: `2 * frozen` multiplies, `2 frozen` freezes `2`.
  
  The documentation spec now runs its engines with the network switched off, since a line that reaches the network carries no expected value and should not make a request during the build.
  
  ## Verification
  
  New suites pin the merge rules, every place a record is set (primed and fetched rates, `createQueryResolver`, historical closes and conversions), carrying through each operation and aggregate, agreement between `parseDocument` and `evaluateDocument`, the worker DTO, and the explanation steps; and for `frozen`, keeping an answer across a rate change, frozen definitions, freezing only a settled answer, a background refresh stopping once its line freezes, the dated form and its refusals, a Tier 2 re-run, a goal-seek probe, explaining without freezing, snapshots restored with no network and no fetch, malformed snapshots, and the host's store API. A new Frozen answers page is proven by the documentation spec, and the currency, stocks, crypto, weather, knowledge, async and live data, embedding, explaining lines and async data source pages are updated. `npm run verify:ci` passes: 11,248 tests across 532 suites, with the bundled-consumer contract.
- 5540410: One time in several zones, the hours several places share, and a named day for both
  
  Every timezone form took one time and one target zone, so a team spread across three cities asked three questions, and a line naming more than one target did not parse. Nor could a line say which day it meant: `3pm London in New York` read today, and the gap between two places changes on the days their clocks change, so the answer moved with the calendar and no example of it could be pinned down.
  
  A clock-time conversion now takes a list of targets, separated by commas or `and`, and answers each one labelled with the name the reader wrote. `on <date>`, after the first place or at the end of the line, fixes the day. A new form, `overlap of <hours> in <places>`, finds the stretch of the day that falls inside the same hours in every place named, gives its length first, and reads it on each place's own clock.
  
  | expression | before | now |
  | --- | --- | --- |
  | `3pm London in Tokyo, New York and Sydney` | parse error: unexpected `,` | Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day), on 23 September 2026 |
  | `3pm London on 23 September 2026 in Tokyo, New York and Sydney` | parse error | Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day) |
  | `3pm London on 20 March 2026 in New York` | parse error | 11:00 AM |
  | `overlap of 9am to 5pm in London and New York on 23 September 2026` | parse error | 3 hours: London 2:00 PM to 5:00 PM, New York 9:00 AM to 12:00 PM |
  | `overlap of 9am to 5pm in London and New York on 20 March 2026` | parse error | 4 hours: London 1:00 PM to 5:00 PM, New York 9:00 AM to 1:00 PM |
  | `overlap of 8am to 6pm in Tokyo and San Francisco on 23 September 2026` | parse error | 2 hours: Tokyo 8:00 AM to 10:00 AM, San Francisco 4:00 PM to 6:00 PM (-1 day) |
  | `overlap of 9am to 5pm in London and Tokyo on 23 September 2026` | parse error | No overlap between London and Tokyo |
  | `1:30am London on 29 March 2026 in Tokyo` | parse error | 1:30 AM did not happen in London on March 29, 2026: the clocks went forward past it |
  
  The overlap is anchored on the first place's day. Each further place cuts it down to the part inside that place's own hours on any of its days, because a place across the date line keeps its matching hours on its yesterday or its tomorrow, and every end is read on its own day's clock, so daylight saving is applied place by place and date by date. Hours that end before they start run past midnight, as a night shift does, and hours longer than twelve can meet another place's twice in a day, in which case both stretches are given with their total. Inside `overlap of`, `9am-5pm` reads as `9am to 5pm`, since what follows the phrase is known to be a stretch of the day.
  
  A wall-clock time that the clocks skip or repeat on a daylight-saving day names no single moment, so a conversion refuses it by name (`TIME_ZONE_SKIPPED_TIME`, `TIME_ZONE_REPEATED_TIME`) rather than quietly moving it an hour. This applies to the existing undated form too, on the two days a year it matters: on 29 March 2026, `1:30am London in Tokyo` answered 10:30 AM, the answer for 2:30am, and now says 1:30 did not happen. On every other day that form, and the bytecode it compiles to, are unchanged. An overlap with one place (`OVERLAP_NEEDS_TWO_ZONES`), hours with no length (`OVERLAP_HOURS_EMPTY`), and an `on` clause that is not a date (`TIME_ZONE_EXPECTED_DATE`) are refused as Error values, and an unknown place after `and` is named as not a time zone rather than reported as an undefined variable.
  
  The time zone material moves from the time page to its own page, time zones, which explains what a zone and daylight saving are before the syntax and proves every dated example.
  
  The boundary, deliberately:
  
  - One set of hours applies to every place in an overlap. Places that keep different hours are not compared in one line.
  - Weekends and public holidays are not considered: the hours apply to every day, so a Monday morning in Tokyo that is a Sunday afternoon in San Francisco is reported like any other.
  - The answers are text, written to be read, as the existing timezone forms' are, not values to do arithmetic with.
  - Outside `overlap of`, a hyphen between two times is still read as subtraction, so `9am-5pm London in New York` is unchanged and wrong in the way the issue records. Reading a bare hyphen as a range everywhere is a separate decision.
  - `time difference between` and `time in` still answer for the present moment; they take no `on` clause.
  
  ## Verification
  
  A new suite pins every answer above, each spelling of the hours and of the list, the day shifts in both directions, daylight saving in both hemispheres, a transition inside the hours, the skipped and repeated readings, each refusal and parse error, and the undated forms against a pinned clock. It runs under both calendar backends and in the three zones `npm run test:temporal` uses. The time zones page is proven by the documentation examples suite. `npm run verify:ci` passes: 10,709 tests across 517 suites.
- 5540410: Primes, prime factorisation, modular arithmetic, `n choose k` and `5!`
  
  The whole-number side of maths gains its missing pieces: primality, the next prime, prime factorisation, modular power and inverse, and the mathematical spellings of the factorial and of choosing. Every answer is exact at any size, building on the exact integers of #526.
  
  | expression | before | now |
  | --- | --- | --- |
  | `isprime(97)` | error: Undefined function: isprime | true |
  | `nextprime(2^53)` | error: Undefined function: nextprime | 9,007,199,254,740,997 |
  | `factor(360)` | 360 | 2^3 * 3^2 * 5 |
  | `modpow(7, 77, 13)` | error: Undefined function: modpow | 11 |
  | `modinv(3, 11)` | error: Undefined function: modinv | 4 |
  | `5!` | error: Unexpected trailing token | 120 |
  | `10 choose 3` | error: Unexpected trailing token | 120 |
  | `nCr(10, 3)` | error: Undefined function: nCr | 120 |
  
  Primality is Miller-Rabin with the first thirteen primes as witnesses, a proof for every number below 3.3 × 10^24 and not fooled by Carmichael numbers such as 561. `factor` of a whole number writes its prime factorisation in a form that reads back as the number, trial division then Pollard's rho, and `factor` of an expression with an unknown still factors the polynomial. `modpow` never builds the power, so `modpow(2, 100, 1000000007)` answers at once. `!` is a postfix factorial binding as tightly as `%`, so `2^3!` is 2 to the power 6 and `-3!` is -6, and `choose` binds like `*`; `nCr`, `ncr` and `binomial` are names for `combination`, and `powmod` for `modpow`. A new page, "Primes, factors and counting", explains each, and documents the factorial, permutation and combination functions, which had no page.
  
  The boundary: `factor` refuses a whole number above 2^64, since factoring is the one step whose cost grows faster than a number's length; above 3.3 × 10^24 `isprime` reports a strong probable prime rather than a proved one. `choose` becomes a keyword, so it cannot name a variable. The word `prime` still means an exponent (`x prime`), so `97 is prime` and a `prime(n)` for the nth prime are not forms here. A fraction, a zero to factor, a negative exponent for `modpow` and a number with no inverse are each refused by name.
  
  `AlgebraSurface.spec.ts` pinned `factor(12)` as 12, the number handed back unchanged; it now asserts the factorisation.
  
  ## Verification
  
  A new suite pins primality (including Carmichael numbers), the next prime, modular power and inverse, factorisations up to 2^64 - 1, every engine form, the read-back, the polynomial `factor` that is unchanged, the factorial and choose precedence, `!=`, and every refusal by code. `npm run verify:ci` passes: 10,709 tests across 517 suites.
- 5540410: `solve` finds numeric roots, `integral` takes bounds, and `limit` is new
  
  An equation that mixes the unknown with a function of itself, such as `cos(x) = x` or `2^x = 10`, has no formula for its answer, and `solve` refused every one of them as "not a polynomial equation". It now searches the real line for where the two sides cross, closes in on each crossing by bisection, and substitutes each candidate back into both sides before reporting it. `integral` with two bounds after the variable is the definite integral, the area under the curve between them, and `limit(f, x, a)` is the value `f` settles towards as `x` approaches `a`.
  
  | expression | before | now |
  | --- | --- | --- |
  | `solve(cos(x) = x, x)` | error: not a polynomial equation | 0.74 |
  | `solve(2^x = 10, x)` | error: not a polynomial equation | 3.32 |
  | `solve(e^x = 10, x)` | error: not a polynomial equation | 2.30 |
  | `solve(log(x) = 2, x)` | error: not a polynomial equation | 7.39 |
  | `solve(exp(x) = x + 2, x)` | error: not a polynomial equation | [-1.84, 1.15] |
  | `solve(sin(x) = 0.5, x, 0, 3)` | parse error | [0.52, 2.62] |
  | `integral(x^2, x, 0, 3)` | parse error: expected `)` | 9 |
  | `integral(x^2, x, 0, 1)` | parse error: expected `)` | 1/3 |
  | `integral(exp(x^2), x, 0, 1)` | parse error: expected `)` | 1.46 |
  | `integral(1/x, x, 0, 1)` | parse error: expected `)` | error: improper integral |
  | `limit(sin(x)/x, x, 0)` | error: undefined variable x | 1 |
  | `limit((x^2-1)/(x-1), x, 1)` | error: undefined variable x | 2 |
  | `limit(abs(x)/x, x, 0)` | error: undefined variable x | error: the sides disagree, -1 and 1 |
  
  A numeric root is approximate, as the roots of a quintic already were, and the solving page now has a section saying which answers are found by search. The search runs from -1,000,000 to 1,000,000 unless two numbers after the unknown name a range; a range also filters the exact roots of a polynomial, so `solve(x^2 = 4, x, 0, 10)` is 2. More than ten roots in the range is declined (`SYMBOLIC_SOLVE_TOO_MANY_ROOTS`) rather than listed, since a list cut off at the edge of the search would read as complete, and finding none is `SYMBOLIC_SOLVE_NO_ROOT_FOUND`, never "no solution", which is a stronger claim than a search can make. A pole (`1/x = 0`) and a side that underflows to zero (`e^x = 0`) are not reported as roots.
  
  A definite integral is exact through the antiderivative where `integral` finds one, and a fraction stays a fraction. The antiderivative is trusted on its own only for an integrand continuous everywhere by its shape; for anything else a numeric estimate is made too and must agree, which is what stops `integral(1/x^2, x, -1, 1)` answering -2 across the pole at zero. Where there is no antiderivative, adaptive Gauss-Kronrod quadrature gives the answer once its error estimate is within one part in ten billion. A limit of a rational function is exact; any other is extrapolated numerically from both sides, with each value's own rounding error tracked so that cancellation near the point cannot pass for a trend.
  
  Each way these can fail is its own named error: `SYMBOLIC_INTEGRAL_IMPROPER` for an integrand with no finite value in the range or an infinite bound, `SYMBOLIC_INTEGRAL_UNSETTLED` for an estimate that does not settle, and `SYMBOLIC_LIMIT_SIDES_DISAGREE`, `SYMBOLIC_LIMIT_DIVERGES`, `SYMBOLIC_LIMIT_UNSETTLED` and `SYMBOLIC_LIMIT_UNDEFINED` for a limit that does not exist. A bound, range or point that is not a plain finite number is `SYMBOLIC_BOUND_INVALID`.
  
  The boundary, and why:
  
  - A root where the two sides touch without crossing (`cos(x) = 1` at 0) is found only if the search lands on it exactly, and two roots closer together than its sample spacing can be missed. The error for finding nothing says so.
  - The solver does not isolate the unknown from inside a function, so `2^x = 10` is answered with the decimal rather than `log(10)/log(2)`.
  - An improper integral is refused even when it converges (`1/sqrt(x)` from 0 to 1 is 2), and a bound of infinity is refused, because both need a limit at the edge of the range and a wrong one looks exactly like a right one.
  - A limit at infinity is not evaluated, and there is no one-sided form; the disagreeing-sides error names what each side approaches.
  - An equation, integrand or limit with a second unknown in it is refused, as the exact forms refuse it.
  - A numeric answer is an ordinary number, not marked approximate in the value itself; the documentation says which forms produce one.
  
  `limit` is a plugin function of the symbolic package rather than a new builtin index, and, like the other algebra words, is a function only when directly followed by `(`, so `limit = 40` is still a variable.
  
  ## Verification
  
  New suites cover the root search (poles, jumps, underflow and domain gaps never reported as roots), the quadrature against integrals with known values, the error-bounded evaluation, limits and definite integrals below the engine, and every form above through the engine, each checked against values computed independently with JavaScript's own functions. The symbolic property suite now substitutes every numeric root back into its equation. The solving-equations, calculus and cheatsheet pages gain the new forms as proven examples. `npm run verify` passes: 10,709 tests across 517 suites, with the bundled-consumer contract.
- 5540410: Numbers, amounts of money, pattern matches and JSON fields are read out of pasted text
  
  A receipt, a log line or an API response pasted into a note was text the engine could measure but not read: the numbers in it had to be typed out again to be totalled, and `jwt(...)` and `query(...)` returned JSON with no way to take one value out of it. The text package now reads four things out of such text: its numbers, its amounts of money, the part a pattern matches, and a field of JSON.
  
  | expression | before | now |
  | --- | --- | --- |
  | `numbers in "Coffee 3.20, lunch 12.50, taxi 18"` | parse error: unexpected text after the expression | [3.20, 12.50, 18] |
  | `total of numbers in "Coffee 3.20, lunch 12.50, taxi 18"` | parse error: unexpected text after the expression | 33.70 |
  | `total of amounts in "2 coffees £3.20, 1 cake £2.50"` | parse error: unexpected text after the expression | £5.70 |
  | `match("Order #4471 shipped", "#(\d+)")` | error: undefined function `match` | 4471 |
  | `matchcount("GET 200, GET 404, POST 200", "\b200\b")` | error: undefined function `matchcount` | 2 |
  | `matches("2026-09-23", "^\d{4}-\d{2}-\d{2}$")` | error: undefined function `matches` | true |
  | `field(query("name=John+Doe&page=2"), "name")` | error: undefined function `field` | John Doe |
  
  `numbers in X` lists every number written in a piece of text, and `amounts in X` only the ones with a currency sign or code beside them. Written straight after an aggregate (`total of`, `sum of`, `average of`, `median of`, `count of`, `spread of`, `mode of`, the standard deviations and variances), either phrase hands the aggregate the numbers themselves, so the answer is the shipped aggregate's: a total of amounts keeps its currency, and a mix of currencies with no rate is refused as incompatible units, as `total of €3, $4` is. The text is read in the engine's configured number format rather than guessed from the text, so a German engine reads `1.234,56` as one number and an English engine as two, and a French engine accepts the no-break spaces a copied French number carries. A minus sign counts only in front of a number, so `10-20` is two numbers.
  
  `match(text, pattern)` returns the text of the first group that took part in the first match (or the whole match), `matches` whether the pattern occurs, and `matchcount` how often. The patterns never reach JavaScript's `RegExp`. They run on the package's own matcher, which tries every way of matching at once and reads each character once, so `(a+)+$` against forty letters and a full stop answers at once where a backtracking engine would take hours. It follows JavaScript's syntax and its choices between alternatives, including resetting a loop's groups on each pass and refusing an optional pass that matched nothing, and a seeded differential run against `RegExp` holds it to that, groups and match counts included. `(?i)` at the start ignores case by JavaScript's rule.
  
  `field(json, "path")` reads one value out of JSON by a path such as `order.items[0].price`: a number as a number, a string as text, a boolean as a boolean, and a list or object as its JSON. JSON typed into a line, where each quotation mark is written `\"`, is read as the JSON it spells.
  
  Every form answers or refuses with a named Error value, never a throw and never a guessed number: `TEXT_NO_NUMBERS`, `TEXT_NO_AMOUNTS`, `TEXT_NO_MATCH`, `TEXT_PATTERN_INVALID`, `TEXT_PATTERN_UNSUPPORTED`, `TEXT_FIELD_NOT_FOUND` (which lists the fields that are there), `TEXT_FIELD_NULL`, `TEXT_NOT_JSON` and the rest, each a stable code a host can read without parsing the sentence. The work is bounded: a text gives up to 10,000 numbers, a pattern may be 500 characters with 32 groups and repeat counts up to 1,000, and the pattern forms on one line share 5,000,000 steps. The step count is kept per evaluation rather than per call, so fifty calls on one line cannot take fifty allowances; `vm/AllocationBudget.ts` gains `currentEvaluation()` for that, and `docs-internal/RESOURCE_GUARDS.md` lists the new limits. No VM builtin was added: the forms are the text package's phrases, a normaliser rule and plugin functions.
  
  The boundary, and why:
  
  - **No backreferences, lookahead or lookbehind.** They are refused by name, since no matcher can promise to answer a backreference in time proportional to the text, and the guarantee is the point. The only flag is `(?i)`, at the start.
  - **A list holds plain numbers.** `amounts in X` on its own shows the amounts without their currency; the aggregates, which read the amounts directly, keep it. A list among other values (`total of 1, numbers in X`) is still one value, and the aggregate refuses it as before.
  - **Only the common currency codes are read**: the ones the engine shows with a sign of its own. `TOP 10` is not ten Tongan pa'anga. `$` is the US dollar, as everywhere in the engine.
  - **Only the number is read.** `15%` is 15, `1.5e3` is 1.5 and 3, and a date is the numbers it is written with.
  - **A character in a pattern is a code point**, so a skin-toned emoji is two characters to `.`, where the text operations count it as one.
  - **A JSON key containing a dot or a bracket cannot be reached by a path**, and a whole number past 2^53 is refused rather than rounded.
  - Pasted text is only searched. Nothing in it is evaluated.
  
  A new syntax page, pasted text, explains each form for a reader meeting it for the first time, with proven examples; the text operations page points to it where it used to call regular expressions a later addition, and the text encoding page shows `field` reading what `jwt` and `query` return.
  
  ## Verification
  
  Two new suites. One pins the matcher: its syntax, its refusals, its limits, the exponential patterns answering in one pass, and 8,000 generated patterns (half with loops that may match nothing) agreeing with `RegExp` on the first match, its groups and the match count. Outside the suite, seeded runs of 400,000 more generated patterns on the finished matcher agreed, half of them with loops that may match nothing, and `(?i)` agreed with `RegExp` on every character of the Basic Multilingual Plane against its case partners, alone and in a class. The other drives every form through the engine: the number formats of the three locales, currency placement, each aggregate against its written-out list, the refusals, big pastes refused quickly, the per-line step budget, and the batch and incremental document passes agreeing. The pasted text page's examples are proven by the documentation suite. `npm run verify:ci` passes: 10,709 tests across 517 suites.
- 5540410: Probability distributions: the inverse normal, binomial, Poisson and Student's t, with the error and gamma functions behind them
  
  The statistics package had the normal distribution's cumulative probability and density and nothing else, so a note could not give a critical value, a confidence interval's margin or the chance of exactly 3 heads in 10 tosses without opening a spreadsheet. It now has the inverse normal, the binomial, Poisson and Student's t distributions, and the special functions they are built on, under the names a graphing calculator uses.
  
  | expression | before | now |
  | --- | --- | --- |
  | `normalinv(0.975)` | error: undefined function | 1.96 |
  | `normalinv(0.9, 100, 15)` | error: undefined function | 119.22 |
  | `binompdf(10, 0.5, 3)` | error: undefined function | 0.12 |
  | `binomcdf(10, 0.5, 3)` | error: undefined function | 0.17 |
  | `poissoncdf(2, 3)` | error: undefined function | 0.86 |
  | `tinv(0.975, 9)` | error: undefined function | 2.26 |
  | `2 * (1 - tcdf(2.5, 12))` | error: undefined function | 0.03 |
  | `erf(0.5)` | error: undefined function | 0.52 |
  | `gamma(0.5)` | error: undefined function | 1.77 |
  | `normalcdf(-8)` | 6.11e-16 | 6.22e-16 |
  | `normalcdf(-10)` | 0 | 7.62e-24 |
  
  Each distribution answers the three questions a note asks of one: `pdf` is the chance of one exact outcome (or, for a measurement, the height of the curve), `cdf` the chance of an outcome at or below a value, and `inv` the value a given share of outcomes falls below. The functions are `normalinv` (and `invnorm`), `binompdf` and `binomcdf`, `poissonpdf` and `poissoncdf`, `tpdf`, `tcdf` and `tinv` (and `invt`), and `erf`, `erfc`, `gamma` and `lgamma`. A probability can be written as a decimal or a percentage, and every result is an ordinary number, so a margin computed from `normalinv` or `tinv` can be written after a value with `±` and carried as its tolerance.
  
  The last two rows are the existing `normalcdf`. It was built on a textbook approximation of the error function with an absolute error of 1.5e-7, which is fine near the middle of the curve and wrong in the tail: 1.8% out at z = -8, and 0 at z = -10. The error function is now a series near zero and a continued fraction in the tail, so a far-tail probability keeps its significant digits, and every function here is accurate to at least ten significant figures. Up to 50 trials a binomial is summed term by term, so a fair coin's answers are exact: `binomcdf(10, 0.5, 3)` is 176/1024 to the last digit.
  
  Every argument is checked against its distribution's rules, and one outside them is refused by name rather than passed to a formula that would produce a number anyway: a probability outside 0 to 1 (`STAT_PROBABILITY_RANGE`), a fractional or negative count (`STAT_NOT_WHOLE`, `STAT_COUNT_RANGE`), more successes than trials, a standard deviation, average or degrees of freedom that is not positive, gamma at zero or a negative whole number (`STAT_GAMMA_POLE`), and an answer past the largest number a double holds (`STAT_OVERFLOW`). More successes than trials is refused rather than answered 0 because it is far more often a spreadsheet's argument order (`BINOM.DIST` puts the successes first) than a real question.
  
  The boundary: the argument order is a graphing calculator's, value first for a measurement (`tcdf(t, df)`) and count last for a count (`binompdf(n, p, k)`, `poissonpdf(mean, k)`). A spreadsheet's `POISSON.DIST` takes the count first, and since both orders are valid calls that one mix-up cannot be caught. `tinv` is left-tailed like `T.INV`, not two-tailed like an older spreadsheet's `TINV`. The calculator's range forms, `normalcdf(lower, upper, mean, sd)` and `tcdf(lower, upper, df)`, are refused by argument count; the difference of two calls gives the same share. Very large counts cost precision: past about a hundred billion trials the binomial's cumulative answers keep fewer than ten digits (about seven at a thousand trillion), and past an average of about twenty billion a Poisson cumulative answer can be refused (`STAT_NO_CONVERGENCE`) rather than approximated. Each new name followed by `(` is a call, so `gamma(x) = ...` cannot define a function of that name; `gamma` without brackets is still free as a variable. Other distributions (chi-square, F, exponential, uniform) are not part of this change.
  
  The normal distribution moves from the statistics page to a new probability distributions page with the rest, which explains each distribution before its syntax.
  
  ## Verification
  
  A new spec pins every function against reference values computed independently with mpmath at 40 digits, including far tails, huge counts, degrees of freedom from 0.3 to 10^17, and the gamma function's reflection and overflow; it checks that each quantile inverts its CDF, that each cumulative probability is the sum of its masses, that the t distribution meets the Cauchy at one degree of freedom and the normal at many, and that every refusal returns its code as a value rather than throwing. The new page's examples are proven by the documentation suite. `npm run verify:ci` passes: 10,709 tests across 517 suites.
- 46c0e89: A number divided by a quantity is its reciprocal
  
  A plain number divided by a quantity kept the quantity's unit, so `1 / (2 m)` was reported as half a metre when it is half of one per metre, and `10 / (5 s)` as two seconds when it is two a second. The answer is now the reciprocal: a per-unit rate, written the way the engine already writes a count per something (`/m`, `/s`), which cancels against the quantity again.
  
  | expression | before | now |
  | --- | --- | --- |
  | `1 / (2 m)` | 0.50 m | 0.50 /m |
  | `10 / (5 s)` | 2.00 s | 2.00 /s |
  | `1 / (2 m) * 4 m` | 2.00 m2 | 2 |
  | `1 / (60 km/h)` | 0.02 km/h | 1:00 /km |
  | `1 / (50 Hz)` | 0.02 Hz | 0.02 s |
  | `1 / (2/week)` | 0.50 /week | 0.50 week |
  | `1 / (20 C)` | 0.05 C | error: no unit |
  | `1 / 2 hour` | 0.50 hour | 0.50 hour |
  | `3 / 4 cup` | 0.75 cup | 0.75 cup |
  
  A rate turns over, so the reciprocal of a speed is a time per distance (`1 / (60 km/h)` is a minute a kilometre, `h/km`), a count per something turns into that something, and a frequency turns into its period in seconds. A temperature is measured from a zero point of its own and has no reciprocal, so it is refused by name as `UNIT_RECIPROCAL_UNSUPPORTED`, as is a label that is not a unit.
  
  A fraction written in front of a unit is still that much of the unit. The unit binds to the number beside it before any operator does, which is why `1 / 2 hour` was one over two hours all along and only looked right; the uom package now brackets such a fraction before the unit binds, where the source still shows it was written as one amount. It applies to a fraction that starts an amount: a quantity or a symbol before the slash (`100 km / 2 h`, `$10 / 2 h`) is a division, as is a number straight after another division or a power (`6 / 3 / 2 h`), and a bracket (`1 / (2 hour)`) asks for the reciprocal.
  
  The boundary: a reciprocal is a per-unit rate, not a named unit. Ten per second is `10.00 /s` rather than ten hertz, and the two do not convert into each other. A percentage or a big integer divided by a quantity keeps its existing reading.
  
  Fixes #570.
  
  ## Verification
  
  The unit algebra suite gains the reciprocals above, the cancellation back to a number, a variable holding a quantity, the refused temperature, and the fractions that stay amounts. The multiplying and dividing units page gains a proven section on reciprocals and loses the boundary note that described the old reading. `npm run verify:ci` passes: 11,654 tests across 535 suites, with the bundled-consumer contract.
- 939aaa8: Hosts can find, rename and follow a note's variables, and keep line references on their lines when lines move
  
  The language service classified one line at a time and knew nothing about a note as a whole, so an editor had no way to list where a variable is used, jump to its definition, show its value, or rename it: a find and replace edits prose that shares the word. And `line 3` is an absolute number, so a line typed at the top of a note left every reference below it reading the wrong line. `LanguageService` now answers both from the engine's own reading of the note.
  
  | call | example | result |
  | --- | --- | --- |
  | `findReferences` | `tax` in `:tax = 20%` / `100 + 100 * tax` / `tax is due in April` | lines 1 and 2; the prose on line 3 is not a reference |
  | `getDefinition` | the `tax` on line 2 | line 1, characters 1 to 4 |
  | `getHover` | the same, with the document's results | `:tax = 20%`, value 20.00% |
  | `rename` | `tax` to `vat` | edits lines 1 and 2 only; line 2 still gives 120 |
  | `rename` | `tax` to `pi` | refused: `RENAME_KEYWORD` |
  | `shiftLineReferences` | a line inserted above `10` / `20` / `line 1 + line 2` | the edit `line 2 + line 3`; the answer stays 30 |
  | `shiftLineReferences` | line 2 deleted under `line 2 * 2` | the edit `line deleted * 2`, an error that says the line was deleted |
  
  A word is a variable only where the engine reads it as one: a line is code when it parses, and a name on it is a reference when the dependency graph reads or writes it there. The calls ask exactly that, through a new side-effect-free `ExpressionEngine.readExpressionTokens` (the real lexer, normaliser and parser, with a `label:` set aside as prose) and the graph's own `extractReadsAndWrites`, which can now report positions. Every call takes the whole document and returns positions or text edits for the host to apply; `applyTextEdits` applies them to a string. Nothing is evaluated, and nothing in the engine changes: a running total or a unit definition is recognised by its shape and never run. A unit the note defines is a unit below its definition, as it is when the note runs, so the `sprints` in `3 sprints` is never taken for a variable, even on an engine kept only for highlighting that has never evaluated the note.
  
  A rename is refused with a named reason rather than done partly: the position is not on a variable, the variable is a `global` other documents read, the new name is not an identifier, is a keyword or a unit, is already used in the note, or would change how an edited line reads (renaming a function `f` to `sum` makes `f(3)` a different call). A line-reference shift renumbers every absolute `line N`, including a range's ends and goal seek's target, and moves a range's ends independently, as a spreadsheet does. A reference into a deleted line has no right number to become, so it is rewritten as `line deleted`, a new form that answers with the named `LINE_REFERENCE_DELETED` error in every entry point rather than silently reading whichever line moved into the gap. It compiles to the existing line-reference call, so no plugin function index moves.
  
  The boundary: a global is found but not renamed, since one note cannot rename it in the others. `prev`, `total above` and `average above` read whatever is above them and are never rewritten, and the inserted lines themselves are left as written. A split or merge in the middle of a line has no single answer for which half is the same line, so the host describes its change as whole lines inserted or deleted. A line is read the way the batch pass reads it; the one place that differs from evaluation is a label followed by a definition (`rent: :rent = 1200`), which the equation grammar currently claims before the parser does. The hover's value is the one the host's own results hold.
  
  ## Verification
  
  A new suite pins references, definitions and hover across labels, comments, inline solves, list items, globals, function parameters, goal seek and unit definitions; every rename refusal; renames whose answers match before and after through both document passes; insertions and deletions including ranges, glued references and refused changes; and that reading a note leaves a running total and the unit table untouched. A second suite holds `readExpressionTokens` to `tryCompileExpression` over every line the documentation shows, plus prose, half-typed lines and each statement shape, so the side-effect-free reading cannot drift from the engine's own. The cross-path suite gains the line shift through `parseDocument` and `evaluateDocument` and `line deleted` through all three entry points. The line-references page and a new reference-aware editing guide carry proven examples. `npm run verify:ci` passes: 11,248 tests across 532 suites, with the bundled-consumer contract.
- 5540410: A section is totalled by its heading, and a tagged note is broken down by every tag at once
  
  A note's figures can now be added up by the heading they sit under. `total above` stops at the first blank line or heading, so it only works written directly under its own block, and `sum(line 2 : line 4)` names line numbers that go stale as soon as a line is inserted above them. `total of section "Travel"` names the block by its heading instead, and reads whatever is under it from anywhere below, a summary at the bottom of the note included. Category tags answered one tag at a time, and each tag's share of the whole had to be worked out by hand; `total by tag` gives every tag's total and share on one line.
  
  | expression | before | now |
  | --- | --- | --- |
  | `total of section "Travel"` | error: unexpected token "Travel" | $720.00 |
  | `total by tag` | error: unexpected token "by" | food $65.00 (68%) · transport $30.00 (32%) |
  
  The first row is a note with `Flights: $450`, `Hotel: $220` and `Taxi: $50` under `# Travel`; the second has `$40 #food`, `$25 #food` and `$30 #transport`. `sum of section`, `average of section` and `count of section` read the same block, and `sum by tag` is a synonym:
  
  ```
  average of section "Travel"    $240.00
  count of section "Travel"      3
  total of section "travel"      $720.00
  ```
  
  A section is the lines under a heading, down to the next heading at the same level or above, so `# Travel` takes in the `## Flights` and `## Hotels` inside it, and `total of section "Flights"` reads only its own part. The name is matched without regard to case or extra spaces. Blank lines, the smaller headings and comment lines are passed over. A line that is itself a summary of other lines (`total above` and its siblings, a `sum(line a : line b)` span, a tag total, another section total, `total by tag`) is left out, because the figures it sums are already counted: a section that ends in its own subtotal is not counted twice. A line that reads one other line, such as `prev`, is a figure and is counted. Money and units carry through in the first unit written, as they do for `total above`.
  
  Every refusal is a named error rather than a number. A name no heading carries is `SECTION_NOT_FOUND`, and the message lists the headings the note has; a name two headings carry is `SECTION_AMBIGUOUS`, naming both lines; a section with no figures is `SECTION_EMPTY` for a total or an average, and zero for `count`. A line that is not a number is refused with `AGGREGATE_NON_NUMERIC`, naming the line and its section, and a mix of measures is refused by dimension, the rules `total above` and the inline aggregates already follow.
  
  In the breakdown, each tag's amount is the one `total of #tag` gives, and the tags appear in the order they are first written. The whole is every tagged line counted once, so when each line carries one tag the shares describe how the whole divides; a line carrying two tags counts toward both, and overlapping shares can add up to more than 100%. Each share is rounded to a whole percentage on its own, and a share too small to round to 1% reads `<1%`. A note with no tags (`TAG_EMPTY`), a tagged line that is not a number (`TAG_NON_NUMERIC`), tags in different measures (`INCOMPATIBLE_UNITS`) and tagged lines that add up to zero (`TAG_BREAKDOWN_NO_WHOLE`) are each refused.
  
  The refusal `total of "Travel"` gives, a quoted name read as text, now names the section form as well as the tag form: `To gather the lines under a heading, write total of section "Travel"; to gather tagged lines, use "total of #tag".`
  
  Both forms read the whole document. Through the single-expression entry point each returns a structured error that says a document is needed (`SECTION_NO_DOCUMENT`, `TAG_NO_DOCUMENT`), never a number. The word `section` is only special with a quoted name after it, and `total by tag` needs all three words, so a variable named `section`, `tag` or `total` keeps working.
  
  The boundary, and each part is deliberate:
  
  - **A total goes below the block it reads.** It reads lines that have already been worked out, the way `total above` and the tag totals do, so one written above its section reports the first line not yet evaluated. It can sit at the foot of its own section, and leaves itself out.
  - **One heading per name.** Two headings with the same name are refused rather than added together, and a heading path such as `"April / Travel"` is not read. Tagging the lines is the form for gathering a heading repeated under every month.
  - **Only `total`, `sum`, `average` and `count`** over a section; its median, smallest and largest are not offered.
  - **A summary line is recognised from its text**, the way the tag scanner tells a tag query from a tag member. A label is set aside first, so `Total above budget: $50` is still the figure `$50`.
  - **The breakdown is text, not a structured value.** Several labelled figures fit none of the engine's existing value types, and a labelled result shape is left for the scenario comparison that would share it. It cannot be carried into arithmetic (`total of #tag` is the form for that), and a host's own number formatting does not reach the amounts inside it.
  - **A section total walks the note's headings once per evaluation**, so its cost grows with the length of the note rather than the size of the section.
  
  The syntax reference gains a Sections page under "Working across lines", and the category tags page a section on the breakdown, both as proven examples. The line references, statistics, trigger words and cheatsheet pages point to the new forms, and a stale boundary on the category tags page, which said a note could hold only one aggregate per tag, is removed.
  
  ## Verification
  
  New suites pin the section reader's rules (headings, name matching, summary lines); every section form and refusal through both document passes; a live editor's answer after an insert, an in-place edit, a delete, a heading renamed away and back, and a heading inserted into a block, each against a fresh pass over the edited text; the dependency edges a section total takes, and that a summary it leaves out cannot close a cycle; and the breakdown's shape, ordering, overlap, rounding and refusals. `CrossPathDocumentFeatures.spec.ts` adds both forms through all three entry points: the document result, the agreement of the two document passes, and the single-line refusal. The differential document fuzzer's vocabulary gains named headings at two levels, section totals and the breakdown, and 1,600 editing sessions across four seeds agreed with a fresh pass throughout. `npm run verify:ci` passes: 10,709 tests across 517 suites, with the bundled-consumer contract.
- 281c2ab: Random draws can be seeded, so a note's rolls, picks and identifiers are the same on every run
  
  Randomness came straight from `Math.random`, so a roll, a `pick`, a `shuffle`, a `coin`, a `uuid` or a `random hex` changed every time the line ran, and a note or a worked example that recorded one could not be checked or shared. A seed now makes every draw repeatable: the same seed gives the same draws on every run and every machine. A document seeds itself with a `random seed <value>` line, and a host with `createEngine({ random: { seed } })`, `engine.setRandomSeed()` or the worker client's `init({ random })`.
  
  | document | before | now |
  | --- | --- | --- |
  | `random seed 42`, `roll(1, 6)` | error: Expected token type "LPAREN", then a fresh roll | random draws seeded with 42, then 1 on every run |
  | `random seed 42`, `pick("north", "south", "east", "west")` | a different option each run | east on every run |
  | `random seed 42`, `uuid` | a different identifier each run | 218d5e25-71f0-4f2f-920c-f6f25498daa0 on every run |
  | `roll(1, 6)` with no seed | a fresh roll each run | a fresh roll each run |
  
  Each line draws from its own stream, worked out from the seed and the line's compiled program, with a package function named rather than numbered so the draws do not depend on which packages a process happened to register first. A draw changes only when its own line is edited or the seed changes: adding or editing other lines leaves it where it was, and two lines written the same way still draw separately. The `random seed` line seeds the whole document wherever it sits, and takes precedence over the host's seed. When the seed in force changes, the lines that drew under the old one are dropped from the cache and draw again, in a batch pass and in the incremental evaluator alike. Unseeded, draws come from `Math.random` exactly as before.
  
  Draws reach the engine through the line's execution context, the way the clock already does through the calendar backend, so a builtin or a package that draws randomness reads `context.random()` rather than `Math.random`. The dice and randomness pages, which could show no fixed answer until now, gain proven examples and leave the documentation spec's unprovable list.
  
  The boundary: a seeded draw is repeatable, not unpredictable. The generator (mulberry32) is built to look random to a reader, not to resist prediction, so a seeded `uuid` or `random hex` is not suitable as a password or a security token. An engine restored from a snapshot does not carry a seed; seed it again with `setRandomSeed`.
  
  ## Verification
  
  A new suite pins the stream, the document seed line, repeatability across engines, variation when unseeded, reseeding and restoring, precedence, a line inserted above, identical lines, agreement between `parseDocument` and `evaluateDocument`, a re-draw after the seed line is edited in the incremental evaluator, and a single evaluated line. The dice, randomness and embedding pages are updated, with proven examples. `npm run verify:ci` passes: 9,807 tests across 496 suites, with the bundled-consumer contract.
- 281c2ab: Significant figures, engineering notation and compact form
  
  A line can now round to significant figures, and write a number in engineering notation or in the compact form a report headlines. `to N sf` rounds the way `to N dp` does, counting figures from the first digit that is not zero, which is how a measured value is reported. `as engineering` is scientific notation with the exponent kept to a multiple of three, the steps the metric prefixes take. `as compact` writes 3,300,000 as `3.3M`.
  
  | expression | before | now |
  | --- | --- | --- |
  | `1234567 to 3 sf` | error: Undefined variable: sf | 1,230,000 |
  | `0.0012345 to 2 sf` | error | 0.0012 |
  | `2.5 to 3 sf` | error | 2.50 |
  | `1234567 to 3 significant figures` | error: Unexpected token "figures" | 1,230,000 |
  | `12345 as engineering` | error: Unknown converter | 12.345e+3 |
  | `3 million + 10% as compact` | error: Unknown converter | 3.3M |
  | `$3300000 as compact` | error: Unknown converter | $3.3M |
  
  Significant figures show a trailing zero that is one of them (`2.5 to 3 sf` is 2.50), and a rounding that carries into the next power of ten keeps the count (`9.99 to 2 sf` is 10). An exact decimal rounds half away from zero, as `to N dp` does, and a unit or a currency is kept. `sf`, `sig figs`, `sig fig`, `significant figures` and `significant digits` are all spellings; `to N digits` is unchanged and still means decimal places.
  
  Compact form rounds to three significant figures and uses the suffix letters the engine reads back as input, `k`, `M`, `B` and `T`, so `3.3M` typed back in is 3,300,000 again. A thousand is a lowercase `k`, since `K` is kelvin. A figure that rounds up to the next suffix takes it (999,950 is `1M`), money keeps its symbol in front, and a quantity its unit after.
  
  The boundary: both notations answer text, as `as scientific` does, so they end a line rather than feed further arithmetic. Compact form is a per-line request; the default rendering of large numbers is unchanged, and a global setting for it remains undecided. The figure count for `to N sf` runs from 1 to 17, the most a double carries.
  
  ## Verification
  
  A new suite pins each rounding above including the carries, the exact-decimal half, every spelling, units and money, the refused count, and the unchanged `to N dp` and `to N digits`; engineering and compact form are pinned directly and through the engine, including the suffix round trip and a refused text value. The rounding and decimals pages gain proven examples. `npm run verify:ci` passes: 9,807 tests across 496 suites, with the bundled-consumer contract.
- 5540410: A table in a note can be looked up by its row's label, and a table of bands can be applied to an amount
  
  The tables package could total, average or summarise a whole column, and that was all a markdown table was good for. A price list or a rate schedule written as a table could not be read one cell at a time, and a banded charge (an income tax, a commission scheme, a tiered tariff) had to be worked out by hand, band by band. Three forms now read the nearest table above the line:
  
  - `column "cost" for "food"` reads one cell by its row's label, the first cell of the row. The match ignores case, and a row can be labelled with a number.
  - `column "rate" for 45,000 in bands above` reads the cell of the band an amount falls in, taking the first column as where each band starts. `in bands` is what makes it a band match rather than an exact one.
  - `45,000 through bands above` is the progressive total: each part of the amount is charged at the rate of the band it falls in, the rate being the last column.
  
  With a table of `item | cost` rows (`rent 1200`, `food 300`), and a band table of `from | rate` rows (`0 0%`, `10,000 20%`, `40,000 40%`) above the line:
  
  | expression | before | now |
  | --- | --- | --- |
  | `column "cost" for "food"` | error: unexpected token "cost" | 300 |
  | `column "cost" for "food" * 12` | error: unexpected token "cost" | 3,600 |
  | `column "cost" for "fuel"` | error: unexpected token "cost" | error: no row labelled "fuel"; its rows are "rent", "food" |
  | `45,000 through bands above` | error: unexpected token "bands" | 8,000 |
  | `$45,000 through bands above` | error: unexpected token "bands" | $8,000.00 |
  | `column "rate" for 45,000 in bands above` | error: unexpected token "rate" | 40.00% |
  
  The engine assumes no bands. The person writes them, so one form covers any country's income tax, any commission scheme and any tiered price, which is the same rule the tax forms follow: no rate is ever assumed. A rate can be a percentage (a share of the part in its band), a price such as `$0.18` (charged per unit, for a tariff on a count of units), or a plain number (a multiplier). A lookup answers with a number, an amount of money or a percentage, since those are what a price list and a rate schedule hold; money is read into an exact decimal and a total is summed in base ten, so `$10.10 through bands above` on a single 15% band is `$1.52`, where a double would round the half-cent down to `$1.51`.
  
  Every doubt is refused by name, with the line to fix, rather than answered with a number that might be wrong: a label that is not in the table, two rows with the same label, a column named twice, an empty cell or a cell of text, band starts that do not rise down the table, a first column headed `up to` (which reads as where bands end, and would be one row out), a total whose first band does not start at 0, a plain `20` among percentages (a likely missing `%`), rates mixing percentages and prices, and an amount in a different currency from the bands. Typed on its own, with no document to read, each form answers with an error saying a document is needed, never a number and never a throw.
  
  The boundary: a lookup matches the first column only, and answers with the one cell asked for; a cell of text is refused rather than handed on, since text in arithmetic reads as nothing. Units in cells (`12 kg`) are not read yet, and an amount with a unit is refused rather than compared with a table that does not state one. Rules beyond a table of starts and rates, such as an allowance that tapers with income or a flat fee per band, are not modelled; the payroll forms keep the full UK rules for England, Wales and Northern Ireland. The column aggregates (`sum of column`) are unchanged and still read plain numbers only, and only the nearest table above is read, as before. `column` becomes a lookup only when a quoted name follows it and `through` only in the phrase `through bands`, so a variable named `column` keeps working.
  
  ## Verification
  
  A new suite pins every form through both document passes line for line: the exact lookup and its addresses, number and variable keys, money and percentage cells, exact money arithmetic, the band lookup at and between band starts, the progressive total with shares, prices and plain rates, currency adoption and mismatch, each refusal and its code, error propagation from a failing key or amount, an edited table re-answering, and the cell reader directly. The cross-path suite adds the three forms in its standard shape: the document result, the agreement between `parseDocument` and `evaluateDocument`, and the single-line refusal as a structured Error. New Table lookups and Banded rates pages carry proven `solve-doc` examples, including the refusals.
  
  npm run verify:ci passes: 10,709 tests across 517 suites.
- 46c0e89: Units multiply, divide and cancel the way numbers do
  
  A product or quotient of two quantities now carries the unit the two make together, a rate cancels against the quantity it is per, and a root takes an area or a volume back to a length. Where the combined unit is not one the engine can show, the answer is a named error rather than a number wearing the left operand's unit. This is what makes paint and tile coverage, appliance running costs and journey times work as they are written.
  
  | expression | before | now |
  | --- | --- | --- |
  | `6 kWh * $0.30/kWh` | error: Undefined variable: kWh | $1.80 |
  | `3 kg * $5/kg` | 15.00 USD/kg | $15.00 |
  | `2 kW * 3 h * $0.30/kWh` | error: Undefined variable: kWh | $1.80 |
  | `2 kW * 3 h` | 21,600,000.00 J | 6.00 kWh |
  | `20 m² / (5 m²/l)` | error: Undefined variable: m² | 4.00 l |
  | `20 m2 / (5 m2/l)` | 4.00 m2/m2/l | 4.00 l |
  | `15 m2 / 3 m` | 5.00 m2/m | 5.00 m |
  | `(9 m2)^0.5` | error: cannot be raised to the power 0.5 | 3.00 m |
  | `10 lbf * 3 ft` | error: force and length cannot be multiplied | 40.67 J |
  | `60 mph * 2 hours` | error: speed and duration cannot be multiplied | 120.00 mi |
  | `120 km / 60 km/h` | 2.00 km/km/h | 2.00 h |
  | `100 miles / 30 mpg` | 3.33 miles/mpg | 3.33 gal |
  | `$100 / ($5/kg)` | 20.00 USD/USD/kg | 20.00 kg |
  | `$30/hour * 8 hours/day` | error: different measures | 240.00 USD/day |
  | `$500 at $20/h` | 25.00 hs | 25.00 h |
  | `15 m² in ft²` | error: Undefined variable: m² | 161.46 ft² |
  | `2 kg * 3 kg` | 6.00 kg | error: no unit |
  | `$5 * $3` | $15.00 | error: no unit |
  | `(100 km/h) / (2 h)` | 50.00 km/h/h | error: no unit |
  
  A price written straight after an amount (`$5/kg`, `£2 per kg`) is now one rate, where the rate used to attach to everything before it, which is why `3 kg * $5/kg` read as `(3 kg * $5) per kg`. A denominator spelled in capitals (`kWh`, `GB`, `MJ`) is recognised; the table is case-sensitive and the lookup only tried the lowercase spelling. The single-word rates (`mph`, `mpg`, `Mbps`, `lpm` and the rest) cancel as the slash spellings do. Two rates that share a unit cancel it between them, and a quotient of two rates of the same kind is a plain ratio. A count of what a price is per takes the word's plural, so `$100 / $5/hour` is 20 hours, and the plural must now be the same unit: `$500 at $20/h` answered 25 hectoseconds (`hs`) and `$500 at $20/m` 25 milliseconds, because a symbol with an `s` added is often another unit.
  
  An area over a length is a length, a volume over an area is a length, and a volume over a length is an area. A power of a half on an area, or a third on a volume, is its square or cube root. Every spelling of a mass, length, time, force, energy, power, pressure, voltage or current now takes part in naming a derived unit, so `10 lbf * 3 ft` is 40.67 J and `100 Pa * 2 m²` is 200.00 N, and a power for a time of a minute or more is named in watt-hours with the power's prefix.
  
  An area or volume the engine works out is now printed with a superscript, `15.00 m²` where it was `15.00 m2`. `m²`, `ft²` and `m³` are units as typed. Every spelling of one unit is the same table entry, so a worked-out `m²` converts, compares and adds with `m2`, `sq ft` and `square metres` (`5 m * 3 m == 15 m2` is true). An area in words is a power of the length it names, so `sqrt(9 square feet)` is 3.00 ft.
  
  A like product of anything but lengths is refused as `UNIT_PRODUCT_UNSUPPORTED`: a mass times a mass, a time times a time, money times money. A quotient with a compound rate that cancels nothing is refused as `UNIT_QUOTIENT_UNSUPPORTED`. Money times a count keeps its own rule, so `$30 * 4 days` is still $120.00. Two tests that pinned the old answers, `5 g * 10 g` as 50 and `$5 * $3` as not an error, now assert the refusal, and the allocation test that squared money in a loop is refused at its first step.
  
  The boundary: this is not a general algebra of units. A product with no unit in the table, such as a kilogram-metre or a metre to the fourth power, is refused rather than shown. A plain number divided by a quantity is covered separately, in #570. A rate cancels against the quantity it meets, so `$0.30/kWh * 2 kW * 3 h` is refused where `2 kW * 3 h * $0.30/kWh` works. A single capital letter after a slash (`$0.50/W`) stays a variable, since `N` and `W` are common names for a count. There is no unit for an amount of substance, so `mol` and gas-law formulas such as PV = nRT are a later addition.
  
  ## Verification
  
  A new suite pins every product, quotient, root, spelling and rate above, the named refusals, and the forms that keep their own rules (money times a count, a length over an area, a single capital after a slash); the derived units suite gains the wider spellings and the watt-hour naming. A new page, multiplying and dividing units, holds proven examples for each form, and the unit arithmetic, derived units and rates pages point to it. The unit reference is regenerated for the new spellings. `npm run verify:ci` passes: 11,654 tests across 535 suites, with the bundled-consumer contract.
- 939aaa8: What-if and sweeps: a line re-run with different inputs, without editing the note
  
  A note answered only for the inputs it held. Seeing what a different deposit would do meant editing the deposit, reading the answer and putting the deposit back, and goal seek, the one form that re-ran a line, could only vary a variable the target line named itself. `line 4 with deposit = 150000` now answers what line 4 would say if `deposit` were 150,000, and `line 4 for rate from 3% to 6% step 1%` lists line 4's answers across a range, the way a spreadsheet's data table does. Both re-run every line from the top of the note down to the target, so an input reaches the target through the lines between.
  
  The note below is `deposit = 100000`, `rate = 4%`, `payment = monthly repayment on deposit over 25 years at rate`, `payment * 12`. Line 4 reads `payment`, and only line 3 reads `deposit`.
  
  | line 5 | before | now |
  | --- | --- | --- |
  | `line 4 with deposit = 150000` | error: Unexpected token after expression: "=" | 9,501.06 |
  | `line 4 with deposit = 150000 and rate = 5%` | error: Unexpected token after expression: "=" | 10,522.62 |
  | `line 4 for rate from 3% to 6% step 1%` | error: Expected token type "AT" but got "FROM" ("from") | [5,690.54, 6,334.04, 7,015.08, 7,731.62] |
  | `line 4 for deposit from 100000 to 200000 step 50000` | error: Expected token type "AT" but got "FROM" ("from") | [6,334.04, 9,501.06, 12,668.08] |
  
  Several inputs change together when joined by `and` or a comma, and each value is an ordinary expression that keeps its unit: with `price = $100` and `qty = 3`, `line 3 with price = $120` is $360.00. An input is held at its new value on every line of the re-run, so the line that sets it reads as the override. A sweep's range is plain numbers, percentages, or quantities of one kind (mixed units of that kind are read in the start's unit); it runs down with a negative step, and includes its end when a step lands on it. The answers are listed as amounts, as every list in the engine is, so a money line's sweep lists its amounts and a percentage lists as its fraction.
  
  Nothing in the note changes. The lines are re-run from their text in a scratch engine built like the document's own (the same packages, configuration, locale, calendar and random seed) and discarded afterwards, so the note's variables, cached results and dependency graph are untouched, and the questions stay live as the note is edited. Because the re-run works from the text, `parseDocument` and the incremental evaluator give the same answers, and, unlike goal seek, the forms resolve through the batch pass as well.
  
  A host asks the same question with `engine.whatIf(text, overrides)`, which evaluates the whole note with the named inputs held fixed and returns the `ParsingResult` that `parseDocument` would, without touching the engine. An override is a number, text evaluated as an expression (`"$120"`, `"5%"`), or a `Value`. A package author reaches the same re-run from a plugin function through `LineExecutionContext.rerunLines(lineNumber)`, which opens a `LineRerun` session with `run(overrides)`, `uses(name)` and `close()`.
  
  The boundary: every case the engine cannot answer honestly is a named error, never a guess and never a hang. That covers a zero step or one that moves away from the end; more than 1,000 values, or more than 100,000 line re-runs, in one sweep; an input no line up to the target uses, which is almost always a misspelling; a target that is not a calculation; a what-if naming its own line or running inside another's re-run; a span holding a line that sets a `global :name`, since other documents read globals and a scenario's value would reach them; and live data the note has not already fetched, since a re-run never fetches. The target is a line number: `prev`, spans of lines and named scenarios (`line 5 in bull`) are not in this release. The re-run reads the note the way the batch pass does, so a goal seek inside the span reports that pass's refusal. Goal seek itself is unchanged and still needs its variable on the target line; the same re-run is what can later let it look through the lines between, and that is left to its own change. A sweep does not step dates or times.
  
  ## Verification
  
  A new suite pins the what-if through the lines between (including a user function, a running total and a target below the asking line), several inputs, kept units and money, the overridden line reading as the override, seeded draws repeating in the re-run, sweeps up, down, across units and over money, every named refusal, the note reading the same with and without the forms through both document passes, the engine's variables after a pass, an edit reaching the what-if in the incremental evaluator in agreement with a fresh pass, and `engine.whatIf` with its overrides and refusals. `CrossPathDocumentFeatures` gains the what-if and sweep in its house shape: the document result, agreement between `parseDocument` and `evaluateDocument`, and the single-line refusal. A new syntax page, "What-if and sweeps", carries proven examples, and the embedding guide and the plugin-function guide document the host API and `rerunLines`. `npm run verify:ci` passes: 11,248 tests across 532 suites, with the bundled-consumer contract.

### Patch Changes

- 8466f73: An aggregate refuses a value that is not a number, and `min` and `max` of dates give the date
  
  The list aggregates read every operand without a unit as a number, and a value with no numeric reading was read as whatever it happened to convert to. Text became 0 through `parseFloat`, so `total of "Travel"` in a note with a Travel section reported nothing spent. A date became its epoch milliseconds, and a bracketed list or a colour became 0. Each is now refused by name, with `AGGREGATE_NON_NUMERIC`, and the message points at what was probably meant.
  
  | expression | before | now |
  | --- | --- | --- |
  | `total of "Travel"` | 0 | error: text cannot be added; write `total of section "Travel"` for the lines under a heading, or tag them and use `total of #tag` |
  | `average of "a", 4` | 2 | error: text cannot be averaged |
  | `total of [1, 2, 3]` | 0 | error: a bracketed list; list the values with commas |
  | `total of 1:3` | 1,790,121,780,000 | error: a date or time cannot be added |
  | `standard deviation of "a", 2, 4` | 1.63 | error: text cannot be used in a standard deviation |
  | `larger of "a" and 3` | 3 | error: text cannot be compared |
  | `max(25/12/2026, 1/1/2027)` | 1,798,761,600,000 | Friday, January 1, 2027 |
  
  The forms covered are `total of`, `average of`, `median of`, `spread of`, `mode of`, the standard deviations and variances, `min`, `max`, `larger of` and `smaller of`. Numbers, quantities, percentages, booleans (as 1 and 0), hex and big integers are read as before, and `count of` counts anything, text included.
  
  `min` and `max` of a set made only of dates now return the earliest or latest date itself, which is the answer the question has; a date among plain numbers is refused like any other non-number. The `total above` and `total of #tag` forms already refused a non-numeric line and are unchanged.
  
  The boundary: a bracketed list is refused rather than expanded into its members, and a quoted name is refused rather than read as a section heading. Totalling a section by its heading is `total of section "Travel"`, which the message names (#508). `mode of` on text, where the most frequent word would be an answer, is refused for now rather than given a numeric mode of zero.
  
  ## Verification
  
  A new suite pins the reported document, every aggregate's refusal, the named kinds and hints, the forms that still answer, and `min`/`max` over dates. The statistics and number-functions pages gain the refusals and the date answer as proven examples. An A/B run of 3,863 expressions against the previous build differed only on random functions. `npm run verify:ci` passes: 9,745 tests across 493 suites, with the bundled-consumer contract.
- 54f290a: A value that lands after a fetch is re-run against the cache of the engine that asked for it
  
  When a fetched value arrives, the engine re-runs the lines waiting on it and reports each new answer to `onLineResult` and the event stream. A package reads a fetched value back through one shared slot that the engine fills with its own cache when it runs a line, and the re-run left that slot as it was. An engine whose first line fetches had filled nothing, because a line waiting at preflight never runs, so its re-run found no cache. With a second engine in the same process, the re-run read the second engine's cache and reported that engine's figure as the answer. The re-run now fills the slot with its own engine's cache for as long as it runs, and puts back whatever was there before.
  
  | case | before | now |
  | --- | --- | --- |
  | a new engine's first line, `crypto("BTC")`, re-run when a $60,000 price lands | `No cached result for "BTC"` | $60,000.00 |
  | engine A's `crypto("BTC")` ($60,000 from A's provider), re-run after engine B has run a line ($99,000 from B's) | $99,000.00 | $60,000.00 |
  
  The first answer the host saw was wrong only in the re-run's report: evaluating the line again read the right cache, which is why a host that re-evaluates the lines an event names already showed the right figure. A host that mirrors `onLineResult` into its own state, as the async guide describes, showed the error or the other engine's figure until the line was next evaluated. The slot itself is unchanged for anything outside a re-run: a plugin function called directly by a host still reads whichever cache the engine last published, as before.
  
  Fixes #568.
  
  ## Verification
  
  A new spec pins both cases with stub providers, a new engine whose first line fetches and two engines in one process, and that the slot reads as before once the re-run finishes; both cases fail without the fix. `npm run verify:ci` passes: 10,950 tests across 523 suites, with the bundled-consumer contract.
- e877998: A check compares exact values exactly and names two sides that read apart, and an exact large integer keeps its digits against an `n` whole number
  
  Three places where features in this release met each other and disagreed, found by the cross-feature review before it shipped.
  
  **A check agrees with its comparison (#581).** A check read both sides as doubles and treated them as equal within a relative 1e-12, a margin meant for a unit conversion's rounding. A decimal, money, a fraction and a whole number past 2^53 hold their value exactly, and `==` and the ordering operators compare them on it, so a check could pass what `==` called false and fail what `>` called true. Those kinds are now checked exactly; a pair of plain doubles keeps the margin, and `≈` and `within` are unchanged. An `n` whole number, which a check refused as incomparable, is compared on its digits.
  
  | line | before | now |
  | --- | --- | --- |
  | `check 2^53 + 1 > 2^53` | error: check failed: 9,007,199,254,740,993 is not more than 9,007,199,254,740,992 | ✓ |
  | `check 1.0000000000001 == 1` | ✓ | error: check failed: 1.0000000000001 is not equal to 1 |
  | `check 5n == 5` | error: check: 5 and 5 cannot be compared | ✓ |
  | `check 1 km == 1000 m` | ✓ | ✓ |
  | `check sqrt(2)^2 == 2` | ✓ | ✓ |
  
  **A failed check's sides read apart (#582).** A failure's sides differ, but they were shown at the result's usual two places, where `1.845` and `1.85` meet. They now widen a decimal place at a time until they part. Sides in different units are told apart in the left side's unit, since `1.00 km` and `1,000.00 m` read differently while meaning the same.
  
  | line | before | now |
  | --- | --- | --- |
  | `check 12.3 kWh * $0.15/kWh == $1.85` | error: check failed: $1.85 is not equal to $1.85 | error: check failed: $1.845 is not equal to $1.850 |
  | `check 3.1415926 ≈ 3.1415927` | error: check failed: 3.14159 is not equal to 3.14159 | error: check failed: 3.1415926 is not equal to 3.1415927 |
  | `check 1 km == 1000.001 m` | error: check failed: 1.00 km is not equal to 1,000.00 m | error: check failed: 1.000000 km is not equal to 1,000.001000 m |
  
  **An exact large integer against an `n` whole number (#583).** An exact result past 2^53 is a Number carrying its integer beside the nearest double. Where it met an `n` whole number, the arithmetic, bitwise and comparison paths read the double, which for `3^40` is 33 short.
  
  | expression | before | now |
  | --- | --- | --- |
  | `3^40 - 12157665459056928801n` | -33 | 0 |
  | `3^40 == 12157665459056928801n` | false | true |
  | `(2^53 + 1) & 1n` | 0 | 1 |
  
  The boundary: a number typed past 2^53 without the `n` suffix is still the double it was rounded to as it was read, as [big integers](/syntax/big-integers/) explains, so `check 3^40 == 12157665459056928801` fails, as `==` does. The checks section of [conditionals](/syntax/conditionals/) and the big-integers page carry proven examples of each change.
  
  ## Verification
  
  New tests pin each exact kind through a check (a large integer, a decimal, money, a fraction, an `n` whole number), each widened failure message and the unchanged ones, and the `n` operators against exact results. `npm run verify:ci` passes.
- 93e33a4: The VM's dispatch loop has room to grow again
  
  The function that runs every compiled line, `executeBytecode`, is one large loop with a branch for each instruction. V8, the JavaScript engine in Node and Chrome, only hands a function to its optimising compiler when the function's bytecode (V8's own compiled form of the source) is at most 61,440 bytes long: that is the `--max-optimized-bytecode-size` ceiling. Past it, on Node 22, the whole function runs unoptimised, and every instruction in every line is several times slower, `1 + 2` included, with no error and no change in any answer. Newer Node versions still reach an oversized function with Maglev, their middle tier, so there the loss is about a tenth, which is why a local run can miss what the benchmark job (on Node 22) reports.
  
  Compiled the way the test and benchmark suites compile it, the loop had reached 61,055 bytes, 385 short of the ceiling. The next feature to add a few lines to any instruction would cross it. Twelve rarely used instructions now live in their own functions outside the loop, moved unchanged: the working-day and weekday date steps, a clock time today, list and matrix literals, indexing and slicing, ranges, and `map`, `reduce` and `plot`. The loop reads each instruction's operands exactly as it did, in the same order, and hands them to the moved code.
  
  | `executeBytecode` bytecode | before | now | below the ceiling now |
  | --- | --- | --- | --- |
  | test and benchmark build (ES6) | 61,055 bytes | 44,267 bytes | 17,173 bytes |
  | shipped build (ES2020) | 44,735 bytes | 33,516 bytes | 27,924 bytes |
  
  Nothing a line answers changes. The common instructions (arithmetic, comparisons, variables, calls) stay in the loop, where they are fastest; a moved instruction costs one function call, which is small beside the work each of them does.
  
  The boundary: the ceiling is V8's, not the engine's, and nothing enforces the headroom. A change that grows the loop should measure it (run a spec in band under `node --print-bytecode --print-bytecode-filter=executeBytecode` and read the `Bytecode length`) and move a body out rather than let it cross again. The note beside the moved functions in `vm/VM.ts` says so. The shipped ES2020 build compiles smaller, so a published engine was not yet at the ceiling; the test build was, which is where the benchmark suite found it.
  
  ## Verification
  
  An A/B of every documented example, every expression the test suite evaluates, the moved instructions' success and error paths, and 6,000 generated lines, against the previous build with random draws seeded, shows no difference. The vm, pipeline, document-parse and cancellation-overhead benchmark suites, run alternately against the previous build, pass the regression gate, with suite geometric means between 0.98 and 1.01; run under `--no-maglev`, which stands in for Node 22, they stay at parity, where a loop past the ceiling measured the `vm` suite 3.2 times slower. `npm run verify:ci` passes: 10,950 tests across 523 suites, with the bundled-consumer contract.
- ccd8cf9: Every built-in package is exported from `solve-engine/packages`, and `errorValue` from `solve-engine/vm`
  
  Each syntax page names its package and says to register it explicitly for a slimmer engine, but 21 of the 41 packages it names had no export, so a host building a slim engine could not include them. Two, `PAYROLL_PACKAGE` and `SHOPPING_PACKAGE`, were not even exported from the module that assembles `BUILTIN_PACKAGES`. The plugin function guide also imported `errorValue` from `solve-engine/vm`, which did not export it, so its worked example did not compile.
  
  | import | before | now |
  | --- | --- | --- |
  | `import { GOALSEEK_PACKAGE } from "solve-engine/packages"` | undefined | the package |
  | `import { PAYROLL_PACKAGE } from "solve-engine/packages"` | undefined | the package |
  | `import { errorValue } from "solve-engine/vm"` | undefined | the function |
  
  The others now exported are the chart, colour, constants, cooking, encoding, geometry, coordinates, hash, health, IP, numerals, random, ratio, shopping, statistics, text, travel, uncertainty and web packages. Nothing changes for a host that uses `createEngine()`, which registers all of them already.
  
  The boundary: this adds exports and removes none. A new spec ties the list to the docs, so a package a syntax page names without an export fails the build.
  
  Fixes #556 and #557.
  
  ## Verification
  
  A new spec checks that every package a syntax page names, and every package in `BUILTIN_PACKAGES`, is exported from `solve-engine/packages`, and that `errorValue` is exported from `solve-engine/vm`. Every value import in the docs' TypeScript examples was checked against the built entry points. `npm run verify:ci` passes: 10,723 tests across 518 suites, with the bundled-consumer contract.
- 062b2ec: Whole numbers past 2^53 stay exact
  
  A double holds every whole number up to 9,007,199,254,740,991 exactly and only some of them beyond it, so an integer result past that line was rounded to its nearest double. The display then printed digits the answer does not have, and anything built on the result inherited the error: `7^77 mod 13` took its remainder from a number with the wrong low digits. Such a result is now computed exactly, as a bigint, whenever adding, subtracting, multiplying or raising whole numbers produces it.
  
  | expression | before | now |
  | --- | --- | --- |
  | `3^40` | 12,157,665,459,056,929,000 | 12,157,665,459,056,928,801 |
  | `2^53 + 1` | 9,007,199,254,740,992 | 9,007,199,254,740,993 |
  | `2^64` | 18,446,744,073,709,552,000 | 18,446,744,073,709,551,616 |
  | `fact(25)` | 15,511,210,043,330,986,000,000,000 | 15,511,210,043,330,985,984,000,000 |
  | `7^77 mod 13` | 2 | 11 |
  | `combination(56, 23)` | 3,167,295,784,216,201 | 3,167,295,784,216,200 |
  | `lcm(2^40, 3^20)` | 3,833,759,992,447,475,000,000 | 3,833,759,992,447,475,122,176 |
  | `(2^53 + 1) as hex` | 0x20000000000000 | 0x20000000000001 |
  | `(2^60 + 1) * $1` | $1,152,921,504,606,846,976.00 | $1,152,921,504,606,846,977.00 |
  
  The result is still a Number, not a bigint. The exact integer rides on it as the `rational` sidecar that integer division already uses for `1/3`, so the next `+`, `-`, `*`, `/`, comparison and `as fraction` read it without change, and a unit, a percentage or money meets an ordinary number. `mod`, `floor`, `ceil`, `round`, `trunc`, `int`, `abs`, `gcd`, `lcm`, `pow`, `fact`, `permutation`, `combination`, `as hex`, `as binary`, `as octal`, `to N dp` and money multiplication read the exact value; the formatter prints its digits, grouped and localised like any other number. `toNumber()` returns the nearest double, as before, so a host reading a result's number is unaffected, and `value.rational.n` holds every digit.
  
  This reverses a recorded decision. `ArithmeticFloatingPoint.spec.ts` pinned `2^53 + 1` as 2^53 and declined a promotion to BigInt because it would change an expression's type with its magnitude. Carrying the exact value on a Number keeps the type, which was the objection, so the test now asserts the exact integer. `fact(170)`'s double also moves from 7.257415615307994e306 to 7.257415615307999e306, the nearest double to the true value rather than a running product's drift.
  
  The boundary is provenance, and it is deliberate:
  
  - A number **typed** past the safe range is rounded as it is read, so its digits may already be invented. It seeds no exact value, and `1e16 + 1 - 1e16` is still 0, while `10^16 + 1 - 10^16` is now 1. The `n` suffix remains the way to type a large exact integer.
  - A result past a double's range (about 1.8 × 10^308) is Infinity, as it was, so `2 ^ 100000` is unchanged, and the exact work this adds is never more than 1,024 bits.
  - A fractional part, a unit (`(2^53 + 1) kg`) and a percentage read the nearest double. So do the transcendental functions, which have no exact integer answer to keep.
  
  A big integer typed with `n` still prints its digits without grouping; making the two displays agree is a separate decision. The big integers page is rewritten to explain the safe range, what stays exact and where it stops, and the TypeScript guide says where the exact value lives on a result.
  
  ## Verification
  
  A new suite pins each answer above, every operator and function that reads the exact value, each boundary, the display under separator and locale settings, and a variable carrying the value between lines. An A/B run of 3,863 expressions against the previous build differed on 543: 488 match an independent BigInt reference, 44 more are corrections checked by hand, and 11 are random functions; none regressed. An interleaved in-process benchmark of the plain `+`, `-`, `*`, `/` and `^` paths measured ratios between 0.96 and 1.06 across runs, within noise. The CI vm suite, which runs under Jest's sandbox, first measured `1 + 2` at twice its cost, because the range test read `Number.MAX_SAFE_INTEGER` off the global on every operation; the limit is now a module constant, and that suite measures 0.81 ms against the previous 0.80 to 0.84 ms per 2,000 runs. Differential fuzzing (the document generator, and 20,000 expression cases) found nothing. `npm run verify:ci` passes: 9,625 tests across 488 suites, with the bundled-consumer contract.
- 54f290a: Explaining a line no longer changes the document: hovering over `total += 5` leaves the total where it was
  
  `explainLine` builds a derivation from the values a line arrives at, so it has to run the line, and it ran it against the document's own state. A host puts a derivation behind a hover, which is called as often as the pointer moves, and each call applied the line again: a running total grew, an assignment set its variable, a unit definition replaced the unit and sent the whole document back for re-evaluation, and a global changed in every open document.
  
  | document, then explained | read back | before | now |
  | --- | --- | --- | --- |
  | `total += 5`, then `total += 5` three times | the three answers, then `total` | 10, 15, 20, then 20 | 10, 10, 10, then 5 |
  | `:x = 3`, then `:x = 30` | `x` | 30 | 3 |
  | `1 + 1`, then `z = 2 + 2` | `z` | 4 | error: Undefined variable: z |
  | a live editor with `1 sprint = 2 weeks`, `6 sprints in weeks`, then `1 sprint = 3 weeks` | `6 sprints in weeks` | 18 weeks, and both lines marked for re-evaluation | 12 weeks, and neither line marked |
  | a document with `global :g = 1` and another with `global :g * 10` (showing 10), then `global :g = 5` in the first | the second, after its next pass | 50 | 10 |
  
  The run now happens in scratch state that is discarded afterwards. The VM it runs on reads the document's variables, functions and equations and keeps its own writes; the process-wide store for `global` names holds the run's writes aside and tells no document about them; a cross-line read (a goal seek re-running its target, say) records its edge in a dependency graph of the run's own, and the line reads through a context of its own, so the document's graph and the pass's shared context are untouched; and a unit definition answers `sprint defined` without registering the unit. The running-total names and the random-draw bookkeeping are put back as they were. What the run still writes are the compile caches, memos keyed by the line's text that change no answer.
  
  Every explanation of a line now answers as its first one did before this change. Across 29 lines, ordinary derivations, dates, units and the state-changing shapes above, the first explanation is identical before and after.
  
  The boundary: the answer is still the one the line gives against the document as it stands, the same one `evaluateExpression` returns for it, not its answer at its own place in the document. With the total at 5, explaining `total += 5` answers 10, as it always has on the first hover. The scratch state costs a few microseconds per explanation (over eight lines, both builds in one process and interleaved, a median of 26 microseconds before and 29 now), which a hover does not notice.
  
  Fixes #566.
  
  ## Verification
  
  A new suite explains every kind of line that changes something when it runs, plus a global assignment, a goal seek and two ordinary derivations, three times each, after a batch pass and under a live editor, and requires every variable, running total, function (body included), equation, user unit, cached line result, dependency edge, global and document line (answer and dirty flag) to be unchanged, and every explanation to match the first. It pins the answers themselves, their agreement with `evaluateExpression` on an engine of its own, a global that notifies no document, a unit definition that leaves the live document clean, and a goal seek that leaves no edge. The scratch VM and the global store's scratch runs have specs of their own. The explaining a line page says explaining changes nothing. `npm run verify:ci` passes: 10,950 tests across 523 suites, with the bundled-consumer contract.
- a9d53ab: Every function keeps, reads or refuses a quantity by name: `trunc` and `hypot` keep the unit, the degree forms read an angle, the counting functions refuse a length, and `root` of a negative number is real for an odd degree
  
  After #587 refused a quantity in `sin`, `log` and `exp`, a sweep of every builtin with a quantity argument found more that read its bare number, the same in 2.39.0 (#592). Each is now sorted the way its siblings already were.
  
  | expression | before | now |
  | --- | --- | --- |
  | `trunc(3.7 m)` | 3 | 3.00 m, as `floor(3.7 m)` is |
  | `hypot(3 m, 400 cm)` | 400.01, the two lengths read as 3 and 400 | 5.00 m |
  | `sind(1 rad)` | 0.02, the sine of one degree | 0.84, the sine of one radian |
  | `fact(3 m)` | 6 | error: fact takes a plain number, not a length |
  | `gcd(4 m, 6 m)` | 2 | error: gcd takes a plain number, not a length |
  | `atan2(1 m, 2 kg)` | 0.46 | error: length and mass cannot be compared |
  | `pow(2, 3 m)` | 8 | error: An exponent cannot carry a unit (m), as `2^(3 m)` says |
  | `root(3, -8)` | NaN | -2 |
  | `root(2, -4)` | NaN | error: root(2, -4) has no real value |
  
  The functions that keep a unit are the ones that change a quantity's size without changing what it measures: the rounding family (`trunc` and `int` join `round`, `floor` and `ceil`), `abs`, and `hypot` of quantities that all measure one thing, read in the first one's unit. `atan2` of two such quantities is their angle, read in a shared unit. The degree forms (`sind`, `cosd`, `tand`) and `degtorad` read a bare number as degrees and an angle in its own unit; `radtodeg` reads a bare number as radians. The counting functions (`fact`, `gcd`, `lcm`, `permutation`, `combination`), the bit functions (`clz32`, `imul`, `fround`, `hex`, `bin`), `asind`, `acosd`, `atand`, and a unit on `root`'s degree are refused by name.
  
  The boundary: `sign` of a quantity is its sign, a plain number, as it was. A mix of a quantity and a plain number in `hypot` or `atan2` is refused rather than guessed at, since a side with no unit has no length to compare.
  
  The number-functions page carries proven examples.
  
  ## Verification
  
  New tests pin each function with a quantity, an angle and a plain number, and the plain forms that must not change. `npm run verify:ci` passes.
- 8466f73: Text is counted and reversed by the characters a reader sees
  
  `length of`, `characters in` and `reverse` worked on Unicode code points, so a character built from several code points counted as several and could be split in two. A thumbs-up with a skin tone is the thumb and a tone modifier, a flag is two regional-indicator symbols, and an accent can be a combining mark after its letter. Each now counts as the one character it looks like, and `reverse` keeps each whole.
  
  | expression | before | now |
  | --- | --- | --- |
  | `characters in "👍🏽"` | 2 | 1 |
  | `length of "🇬🇧"` | 2 | 1 |
  | `length of "👨‍👩‍👧"` | 5 | 1 |
  | `reverse "👍🏽a"` | a🏽👍 | a👍🏽 |
  | `reverse "🇬🇧🇫🇷"` | 🇷🇫🇧🇬 | 🇫🇷🇬🇧 |
  
  The text page promised this already ("an accent or an emoji counts as the one character it looks like"), and that was true only of an emoji that is a single code point.
  
  The boundary: the characters are grapheme clusters as the runtime's `Intl.Segmenter` finds them, which every current browser and Node.js provide. The segmenter is built on first use rather than when the package loads. On a runtime without one, counting falls back to code points, as before, which still keeps a surrogate pair together. Words and lines are counted as they were.
  
  ## Verification
  
  New tests pin each count and reversal above, and a separate suite removes `Intl.Segmenter` to pin the code-point fallback. The text operations page gains proven examples. `npm run verify:ci` passes: 9,745 tests across 493 suites, with the bundled-consumer contract.
- 939aaa8: Highlighting colours the conversion words alike, leaves a label uncoloured, and keeps a clock time's colon with its number
  
  `getSemanticTokens` coloured the same conversion word differently from one line to the next, painted a line's label as a variable the line reads, and painted the colon of a clock time as a variable's sigil.
  
  | line | word | before | now |
  | --- | --- | --- | --- |
  | `12 kg to lb` | `to` | unit | keyword |
  | `5 km in miles` | `in` | comparison | keyword |
  | `Total: 1 + 2` | `Total`, `:` | variable, variable | uncoloured |
  | `12:30 + 1` | `:` | variable | number |
  
  A label is found the way the engine finds it, through the same reader the reference-aware editing uses, and only on a line with a colon past its first character, so an ordinary line costs nothing more to highlight. A definition's own colon after a label (`rent: :rent = 1200`) is still the sigil.
  
  The boundary: only the category of these spans changes; which spans are coloured on any other line is unchanged.
  
  Fixes #576.
  
  ## Verification
  
  A new spec pins each case, and the category map spec now asserts the conversion words as keywords. `npm run verify:ci` passes: 11,248 tests across 532 suites, with the bundled-consumer contract.
- 54f290a: Highlighting a line no longer runs it: colouring `total += 5` leaves the total where it was
  
  The language service decides whether to colour a line by asking the engine whether it parses, through `tryCompileExpression`. Most lines do their work in the bytecode that check produces and never runs. A few do it while being compiled instead: a running total adds to its total, a bare assignment sets its variable, an equation is stored for a later `=>`, and a unit definition registers its unit. The check did that work too, so each highlight of `total += 5` added another 5, and an editor that highlights on every keystroke moved the total further with each one.
  
  | document, then highlighted | read back | before | now |
  | --- | --- | --- | --- |
  | `total += 5`, its line highlighted once | `total` | 10 | 5 |
  | `total += 5`, its line highlighted four times | `total` | 25 | 5 |
  | `total += 5`, then `total += prev` highlighted | `total` | error: Cross-line references require a real document | 5 |
  | empty, then `z = 2 + 2` highlighted | `z` | 4 | error: Undefined variable: z |
  | empty, then `w^2 - 4 = 0` highlighted | `w =>` | [-2, 2] | w |
  | `1 sprint = 3 weeks`, `3 sprints in weeks`, line 1 highlighted and then deleted | line 2 | 9 weeks | error: Undefined variable: sprints |
  
  The last row is the quiet one. Checking a unit definition registered the unit again as belonging to no line, so deleting its real line no longer removed it, and the conversion below went on answering from a definition the document no longer contained.
  
  `tryCompileExpression` now matches those shapes and compiles their operands, the same parse it always made, and runs and stores nothing. No variable, running total, function, equation, user unit, random draw, cached line result or dependency edge changes when a line is highlighted, completed or checked. What it still writes are the compile caches, memos keyed by the line's text that change no answer. A colon assignment (`:x = 3`), a function definition (`f(x) = x * 2`) and a `random seed 7` line were never affected: their work is in their bytecode, which the check has never run.
  
  Because nothing runs, the check now answers the question it was always asked, whether the line is well formed, the same way for every line. A running total whose step would fail when run still parses, as the expression it adds always has:
  
  | line | highlighted, before | highlighted, now |
  | --- | --- | --- |
  | `5 + nope` | `5` number, `+` operator, `nope` variable | unchanged |
  | `total += nope` | nothing | `total` variable, `+=` operator, `nope` variable |
  
  A running total's name is also painted as the variable it is. The lexer, which sees one word at a time, reads a lone `b` as the unit bit and a lone `s` as seconds, but the engine reads `b += 5` as adding to a variable called `b`.
  
  | line | before | now |
  | --- | --- | --- |
  | `b += 5` | `b` unit | `b` variable |
  | `s -= 2 kg` | `s` unit | `s` variable, `kg` unit |
  
  The boundary: only the check is read-only. `compileExpression` still applies a line's effect, because the incremental evaluator compiles through it and depends on the effect happening. `explainLine`, which a host puts behind a hover, has to run the line to build its derivation, so a check cannot serve it; it runs in discarded scratch state instead, a change of its own (#566). The name fix covers a running total's name only; a unit-letter name on the left of a bare assignment (`b = 5`) or in a function's parameters (`g(t) = t + 1`) is still painted with the lexer's category. Highlighting costs the same as before: over a 200-line document, both builds in one process, interleaved, a full pass from an empty cache took a median of 0.51 to 0.55 ms before and 0.47 to 0.54 ms now, across three runs of eleven.
  
  Fixes #559.
  
  ## Verification
  
  A new suite highlights, completes and checks every kind of line that changes something when it runs (running totals, colon and bare assignments, function definitions, unit definitions, random seeds, equations, `=>` and `expand`), several times over, after a batch pass and under a live editor, and requires every variable, running total, function, equation, user unit, cached line result and dependency edge to be unchanged afterwards. It also pins the unit definition that outlived its line, the check's agreement with `compileExpression` on every shape it now checks rather than runs, and the running total's name. The editor integration page says highlighting is read-only. `npm run verify:ci` passes: 10,950 tests across 523 suites, with the bundled-consumer contract.
- 54f290a: The incremental pass agrees with the batch pass on bare assignments, `=>` lines, equation solves and markdown list markers
  
  A live editor evaluates a note through the incremental evaluator (`ThreeTierEvaluator`, and `evaluateDocument`, which drives it for one pass), and a fresh read of the same text goes through `parseDocument`. On several ordinary forms they gave different answers, with nothing on screen to say which one was wrong.
  
  A bare assignment (`payment = deposit * 40`), a `=>` line (`a + 1 =>`), a stored equation (`a * x = 10`) and its solve (`x =>`) are all carried out while they compile, and leave no program behind. The live evaluator re-runs a clean line by executing its program, so for these it ran nothing, and they recorded neither the names they read nor, for a bare assignment, the one it wrote. An edit above such a line left its old answer in place while a colon line beside it updated, a name assigned twice held the later value at the earlier line, and a bare definition edited away went on defining its name. Each now records what it reads, a bare assignment records its write as `:name = ...` does, and a clean line with no program that depends on anything (a name, a position or a category tag it reads, or a name it writes) goes back through the full pipeline on every pass, which is what a fresh pass does with it. It is not held back until something it reads is seen to change, because a name's value belongs to the position it is read at, and the lines that already have a program are re-run on every pass for the same reason.
  
  Each row is a note, then one edit, then the answer the evaluator shows for the named line:
  
  | note, then the edit | line | before | now |
  | --- | --- | --- | --- |
  | `deposit = 100` / `payment = deposit * 40` / `:colon = deposit * 40`, then line 1 to `deposit = 150` | `payment` | 4,000 | 6,000 |
  | `x = 5` / `x + 1` / `x = 7`, then line 2 to `x + 2` | `x + 2` | 9 | 7 |
  | `x = 5` / `x + 1`, then line 1 to `# heading` | `x + 1` | 6 | error: Undefined variable: x |
  | `:a = 2` / `a + 1 =>`, then line 1 to `:a = 3` | `a + 1 =>` | 3 | 4 |
  | `:a = 2` / `a * x = 10` / `x =>`, then line 1 to `:a = 5` | `x =>` | 5 | 2 |
  | `:a = 4` / `x^2 - a = 0` / `x =>`, then line 1 to `:a = 9` | `x =>` | [-2, 2] | [-3, 3] |
  | `2` / `line 1 * 2 =>`, then line 1 to `5` | `line 1 * 2 =>` | 4 | 10 |
  | `:a = 1` / `expand((x + a)^2)`, then line 1 to `:a = 2` | `expand((x + a)^2)` | x^2+2x+1 | x^2+4x+4 |
  
  In each row the answer now is the one `parseDocument` gives for the edited text, and the colon line in the first row was already 6,000.
  
  A stored equation is kept by its unknown, apart from the line that stored it, so it outlived that line: edited away or deleted, the equation stayed, and `x =>` below went on solving it. Each equation, of either kind (the product-chain `a * x = 10` and the scalar `x^2 - a = 0`), now records the line that stored it, and goes when that line is edited, emptied or deleted, as a unit definition goes with its line. A line that still states it stores it again as it runs, and when two lines store one for the same unknown, it belongs to the later to run, so removing the other leaves it in place.
  
  | note, then the change | line | before | now |
  | --- | --- | --- | --- |
  | `:a = 2` / `a * x = 10` / `x =>`, then line 2 to `# heading` | `x =>` | 5 | x |
  | `:a = 2` / `a * x = 10` / `x =>`, then line 2 deleted | `x =>` | 5 | x |
  | `:a = 4` / `x^2 - a = 0` / `x =>`, then line 2 to `a + 1` | `x =>` | [-2, 2] | x |
  
  For this, `ExpressionEngine.compileExpression` takes an optional line number (the line a stored equation or a unit definition compiled out of view belongs to), and the `VM` interface gains `deleteEquation` and `deleteScalarEquation`.
  
  A markdown list marker is markup: `- 100 * 2` is a bullet holding `100 * 2`. The batch pass has set the marker aside since 1.0.2, but the incremental pass read the whole line, so `-` became a minus and the other markers did not evaluate at all. It now reads a list line from past the marker, using the same classification the batch pass slices by, so the two cannot disagree about what counts as one. Each row sits below a line holding `20`:
  
  | line | `parseDocument` | `evaluateDocument` before | now |
  | --- | --- | --- | --- |
  | `- line 1 + 1` | 21 | -19 | 21 |
  | `- 100 * 2` | 200 | -200 | 200 |
  | `1. 3 * 3` | 9 | error: Unexpected token after expression: "." | 9 |
  | `* 5 + 5` | 10 | error: No prefix parselet found for token: STAR ("*") | 10 |
  | `- [ ] 4 + 4` | 8 | error: A matrix literal cannot be empty | 8 |
  
  A minus with no space after it is still arithmetic in both passes: `-100 + 20` is -80.
  
  The boundary. A unit definition (`1 sprint = 2 weeks`) also has no program, but reads nothing and answers the same whatever is above it, so a clean one is not run again. A bare assignment or a `=>` line that reads a name defined only below it now takes the incremental path's tolerance of a forward reference, which the colon form already had: `y = a * 2` above `a = 3` answers `2a` on the first pass, as `parseDocument` does, and 6 once the note has run again. An equation stored below a solve is read by it the same way: in `:a = 2` / `x =>` / `a * x = 20`, the solve answers `x` on the first pass, as `parseDocument` does, and 10 once the note has run again. The single-expression path (`evaluateLine`) reads its text as an expression, not as markdown, so `- 100 * 2` is still -200 there.
  
  Fixes #555, #560, #565 and #569.
  
  ## Verification
  
  `CrossPathDocumentFeatures.spec.ts` gains every form in its shape: each edit or deletion through a live `ThreeTierEvaluator` matched against a fresh `parseDocument` of the edited text, both document passes agreeing value for value, and the single-expression refusal for a line reference inside a bullet and inside a `=>` line. The list-marker suite runs its table through `evaluateDocument` too, and the evaluator suite pins the tier each kind of line takes, that a clean unit definition is not run again, that a bare definition out of view does not send each scroll back to line 1, and that an equation stored out of view goes when its line is edited out of view. The differential document fuzzer's shapes gain bare assignments, `=>` lines, stored equations and their solves: on seed 1 each group reported disagreements before its fix (29, 8 and 1) and none after, and six seeds (2,400 editing sessions) report none. `npm run verify` passes: 10,950 tests across 523 suites, with the bundled-consumer contract.
- ccd8cf9: A label that repeats the variable's name assigns rather than storing an equation
  
  A line such as `rent: :rent = 1200` sets `rent` aside as a label and assigns the variable, as `Rent: :rent = 1200` and `monthly rent: :rent = 1200` already did. When the label was the same word as the variable, the left side held one unknown, and the scalar-equation reader claimed the line.
  
  | document | before | now |
  | --- | --- | --- |
  | `rent: :rent = 1200`, `rent * 2` | rent stored as an equation, then undefined variable: rent | 1,200, then 2,400 |
  | `2x + 1 = 7`, `x =>` | x stored as an equation, then 3 | x stored as an equation, then 3 |
  
  The boundary: a colon on the left of `=` now always means a label or an assignment, never part of an equation, which is how every other reading of the line already treated it.
  
  Fixes #561.
  
  ## Verification
  
  The labelled-line spec pins the repeated name and a real equation beside it. `npm run verify:ci` passes: 10,723 tests across 518 suites, with the bundled-consumer contract.
- cd9a1e6: Lengths multiply into areas and volumes
  
  Multiplying two lengths converted the right one into the left one's unit and then kept only that unit, so `5 m * 3 m` was reported as 15 m and a room's floor area came out as a length. A length times a length is now an area, and a length times an area is a volume, in either order. The left operand's unit sets the answer's, the same rule addition follows.
  
  | expression | before | now |
  | --- | --- | --- |
  | `5 m * 3 m` | 15.00 m | 15.00 m2 |
  | `5 m * 3 ft` | 4.57 m | 4.57 m2 |
  | `2 m * 3 m * 4 m` | 24.00 m | 24.00 m3 |
  | `5 m * 3 m in ft2` | error: a length cannot be converted to an area | 161.46 ft2 |
  | `5 m2 * 3 m` | error: area and length cannot be multiplied | 15.00 m3 |
  | `5 m2 * 3 m2` | 15.00 m2 | error: no unit |
  
  An area times an area, or a volume times anything, is a product of more than three lengths and has no unit, so it is refused by name where it used to be reported in the left operand's unit. The product keeps exact decimals, so `0.1 m * 0.2 m == 0.02 m2` is true. A test in the derived units suite pinned the old `15.00 m` and now asserts the area, and the derived units page, which described the old reading as intended, is corrected.
  
  The boundary: quotients are unchanged, so `15 m2 / 3 m` still shows as `5.00 m2/m` rather than simplifying to a length. That, and the rest of a fuller algebra of units, is #513.
  
  ## Verification
  
  New tests pin each product above, the refusals, the exact-decimal case, and the products that keep their own rules (a newton, a joule, a mass times a length). The unit arithmetic page gains proven examples for products of lengths. `npm run verify:ci` passes: 9,582 tests across 487 suites.
- 46c0e89: A refusal names a measure in words, not by its table key
  
  The unit tables key every two-word measure as one camelCase token, and a refusal dropped the key into its sentence as it was: `2 mpg * 3 m` answered "fuelEconomy and length cannot be multiplied". Every measure now has a reader's name, so the same sentence reads "fuel economy and length cannot be multiplied".
  
  | expression | before | now |
  | --- | --- | --- |
  | `2 mpg * 3 m` | fuelEconomy and length cannot be multiplied | fuel economy and length cannot be multiplied |
  | `2 Mbps + 3 kg` | dataRate and mass cannot be added | data rate and mass cannot be added |
  | `2 px in m` | a cssLength cannot be converted to a length | a CSS length cannot be converted to a length |
  | `2 l100km in kg` | a fuelConsumption cannot be converted to a mass | fuel consumption cannot be converted to a mass |
  | `2 ppm * 3 kg` | partsPer and mass cannot be multiplied | proportion and mass cannot be multiplied |
  | `2 kvar in m` | a reactivePower cannot be converted to a length | a reactive power cannot be converted to a length |
  | `2 lpm + 3 m` | volumeFlowRate and length cannot be added | volume flow rate and length cannot be added |
  
  The names come from one table beside the existing ones for a duration and a luminous intensity, and a measure added later without an entry is split into lowercase words rather than printed as its key. The fuel price check in the travel package names the measure the same way. Only the wording of a refusal changes: every error code is unchanged, so a host that branches on the code is unaffected.
  
  The boundary: the measure a completion item carries as its `detail` is still the table key (`fuelEconomy`), because it is data a host may match on rather than a sentence, and changing it is an API change of its own.
  
  Fixes #571.
  
  ## Verification
  
  A new suite names every measure in both unit tables through its representative unit, checks that the table of representatives covers every measure so a new one cannot slip past, and sweeps sums, products and conversions of each against a length and a mass, asserting that no refusal contains a camelCase measure key. `npm run verify:ci` passes: 11,654 tests across 535 suites, with the bundled-consumer contract.
- 5540410: Units written in more than one word are read as the unit they name
  
  The lexer reads a unit as one run of letters, so a unit spelled in two or three words arrived as separate words, and where the first word was not a unit on its own the spelling failed. `5 km in nautical miles` said the two did not measure the same thing, `5 nautical miles` and `5 cubic metres` were undefined variables, and `5 square feet` did not parse. The multi-word unit rule now reads every spelling the unit table carries with a space or a hyphen, after an amount or after the conversion word.
  
  | expression | before | now |
  | --- | --- | --- |
  | `5 km in nautical miles` | error: cannot convert km to nautical | 2.70 nautical miles |
  | `1 nautical mile in km` | error: undefined variable nautical | 1.85 km |
  | `5 cubic metres in litres` | error: undefined variable cubic | 5,000.00 litres |
  | `3 imperial gallons in litres` | error: undefined variable imperial | 13.64 litres |
  | `2 troy ounces in g` | error: undefined variable troy | 62.21 g |
  
  The spellings come from the unit table and nothing is invented, so the words must be separated the way the table writes them: one space, or a hyphen in `light-years`. The one allowance is a plural. The table mirrors its upstream, where a few entries (`troy ounce`, `watt-hour`, `foot-candle`) have no plural beside them, and the plural a reader writes reads as that unit. A symbol takes no plural: `kW h` is the kilowatt-hour and `kW hs` is not a unit.
  
  The boundary: a spelling the table does not carry is not guessed at. `light year` with a space is not a spelling there (`light-year` is), so it stays unread rather than being matched to the nearest entry.
  
  Fixes #548.
  
  ## Verification
  
  A new suite pins each spelling after an amount, as a conversion's source and target, the hyphenated and three-word forms, the plural allowance and the symbol that takes none, and the unchanged two-unit pairs. The converting units page gains a section with proven examples. `npm run verify:ci` passes: 10,709 tests across 517 suites, with the bundled-consumer contract.
- ccd8cf9: A negative amount of money is written with its sign before the currency symbol
  
  A prefix currency symbol was placed in front of the whole amount text, and that text already carried its minus sign, so a negative amount read with the sign between the symbol and the digits. The sign now leads, as money is written on a statement.
  
  | expression | before | now |
  | --- | --- | --- |
  | `-$5` | $-5.00 | -$5.00 |
  | `$50 - $80` | $-30.00 | -$30.00 |
  | `-£3.50` | £-3.50 | -£3.50 |
  | `npv of -$1,000, $300, $400, $500 at 10%` | $-21.04 | -$21.04 |
  | `-$1500 as compact` | -1.5k USD | -$1.5k |
  
  The compact and engineering forms fell back to the currency code for a negative amount, which the corrected full form no longer needs, so they now write `-$1.5k` too. A currency written after the amount, such as `-5.00 kr`, was already right and is unchanged. The value itself is untouched: this is how it is shown, and a host reading `toNumber()` sees the same number as before.
  
  Fixes #554.
  
  ## Verification
  
  The grouping spec and the cash-flow spec now pin the sign first, the notation spec adds the compact form, and the currency page gains a negative amount as a proven example. `npm run verify:ci` passes: 10,723 tests across 518 suites, with the bundled-consumer contract.
- e3a9e7a: Only a `check` line counts as a check, a check across an offset conversion agrees with `==`, renumbering moves what-if and sweep targets, a trace lists what sections and tables read, and a result goes through `JSON.stringify`
  
  Five defects in surfaces that first ship in this release, found by the design review for 3.0 while they could still change without breaking anyone (#594 to #598).
  
  **Only a line written with `check` counts as a check (#594).** A pass was recognised by its answer alone, any text beginning with a tick, so a line of text such as `"✓ shipped"` added to the host's pass count and `total above` stepped over it. A check is now a line written with the `check` keyword and answered with a check's tick or its failure.
  
  | document | before | now |
  | --- | --- | --- |
  | `"✓ shipped"`, then `check 1 == 2` | checks: 1 passed, 1 failed | checks: 0 passed, 1 failed |
  
  **A check across an offset conversion agrees with `==` (#595).** 32 F in Celsius is 5.7e-14 rather than 0, because the offset arithmetic runs in binary. `==` allows for that by scaling its margin with the sides as written; a check scaled it by the two converted values, both near zero, and failed.
  
  | line | before | now |
  | --- | --- | --- |
  | `check 0 C == 32 F` | error: check failed: 0.0000000000000 C is not equal to 32.0000000000000 F | ✓ |
  
  **Renumbering moves what-if and sweep targets (#596).** `shiftLineReferences` renumbered a plain `line N` but not the line a what-if or a sweep re-runs, since those fuse their `line N` into a token of their own. After a line was inserted above, `line 2 with x = 5` quietly re-ran whatever had moved into line 2. It is now renumbered with the rest, and a target whose line was deleted says so, as a plain reference does.
  
  | after inserting a heading above | before | now |
  | --- | --- | --- |
  | `line 2 with x = 5` | left as `line 2`, now reading `x = 1` | `line 3 with x = 5`, same answer |
  | `line deleted with x = 5` | error: There is no line NaN to re-run | error: This reference pointed at a line that has been deleted |
  
  **A trace lists what sections and tables read (#597).** `inputs of line N` read line references, ranges, `above` and tags, so a section total and a table read reported that they read no other line, and `total above` listed the check line it had stepped over. A section total now lists the lines under its heading, a table read lists the table's rows by their labels, and a total's trace leaves out the lines the total leaves out.
  
  | line | before | now |
  | --- | --- | --- |
  | `inputs of line 6` (a column lookup) | c 10 (line 6) reads no other line | c 10 (line 6) <- food (line 3), rent (line 4) |
  | `inputs of line 4` (a total over a check) | 15 (line 4) <- 10 (line 1), ✓ (line 2), 5 (line 3) | 15 (line 4) <- 10 (line 1), 5 (line 3) |
  
  **A result goes through `JSON.stringify` (#598).** A value with an exact sidecar threw "Do not know how to serialize a BigInt". A typed decimal always had one; exact decimals and exact large integers put one on most computed answers too, so in this release most results with a decimal point, and every whole number past 2^53, would have stopped serialising. `Value.toJSON()` writes `type`, `value` and `unit`, then each sidecar that is set, with bigints as strings.
  
  | expression | before | now |
  | --- | --- | --- |
  | `JSON.stringify(0.1 + 0.2)` | throws: Do not know how to serialize a BigInt | `{"type":0,"value":0.3,"exact":"0.3"}` |
  
  The boundary: a table lookup reads one row, but its key can come from another line, so the trace lists the rows it chose among rather than guessing the one it picked. A `check` after a label (`Budget: check a < b`) still does not parse; that is a separate gap. `Value.toJSON()` is for reading a result, not a snapshot format; `engine.toJSON()` is the one that restores.
  
  The conditionals, tracing, reference-aware editing and TypeScript pages change with these.
  
  ## Verification
  
  New tests pin the check count through both document passes, checks across offset conversions, the renumbered and deleted what-if and sweep targets with their answers before and after, the section, table and `total above` traces through both passes in CrossPathDocumentFeatures, and the JSON of each kind of sidecar. `npm run verify:ci` passes.
- 5540410: A list cell, a conversion and arithmetic refuse a value with no single amount
  
  Three places read a value through `toNumber()` as if every value had a number inside it. A bracketed list and a colour read as 0 that way, and text as its leading digits or 0, so each place answered with a plausible number that had nothing to do with the question. Each is now a named error.
  
  | expression | before | now |
  | --- | --- | --- |
  | `[(1, 2), 3]` | [0, 3] | error: a list cannot hold a list inside it (`MATRIX_CELL_NON_NUMERIC`) |
  | `["a", 1]` | [0, 1] | error: text cannot be a cell of a list |
  | `(1, 2) in miles` | 0.00 miles | error: a bracketed list has no single amount to convert to miles (`CONVERT_NON_NUMERIC`) |
  | `"11:00 PM" + 2` | 13 | error: text and a number cannot be added (`TEXT_ARITHMETIC`) |
  | `"hello" + 5` | 5 | error: text and a number cannot be added |
  | `"5" * 2` | 10 | error: text cannot be used in arithmetic |
  | `"11:00 PM" as number` | 11 | error: not a number (`TEXT_NOT_A_NUMBER`) |
  | `"1,234.5" as number` | 1 | 1,234.50 |
  
  The last rows are the widest change. `"5" + 5` used to answer 10, which the text operations page documented, but a reader who writes it means either 10 or `55`, and a quoted time plus a number answered 13 with no sign that anything was wrong. Text still joins to text with `+`; any other arithmetic with text on either side is refused, and the message points at `as number`, the conversion for a number that arrives as text (a pasted value, a decoded query field). That conversion took the same `parseFloat` reading, so it now reads text only when the whole of it is a number, with commas grouping thousands allowed, and refuses anything else.
  
  A list cell still holds a number, a `true` or `false`, or an unknown (a formula cell), and a conversion still takes a number, a quantity or a date. The refused kinds are the ones an aggregate has refused since #530: text, a date, a bracketed list, a range, a colour, an IP address, a chart and a split.
  
  The boundary: a quantity in a list cell is still stored as its magnitude, so `[1 km, 2]` is `[1, 2]`. That drops the unit rather than inventing a number, and giving a list cell a unit is its own change.
  
  Fixes #546, #547 and #549.
  
  ## Verification
  
  A new suite pins each refusal by code and message, the forms that still answer (numbers, booleans and unknowns as cells; numbers, quantities and dates converted; text joined to text), and `as number` on text that is and is not a number. Four existing tests that pinned the old reading of text as a number now expect the refusal. The text operations, converting units and vectors pages gain the refusals as proven examples. An A/B run of 3,899 expressions against the previous build differed only where intended. `npm run verify:ci` passes: 10,709 tests across 517 suites, with the bundled-consumer contract.
- dfc86bb: `normalcdf` and `normalpdf` take a mean and a standard deviation, and no statistics call drops an argument
  
  `normalcdf` and `normalpdf` read only their first argument, so `normalcdf(110, 100, 15)` took 110 as a z-score and answered 1, and the mean and standard deviation were discarded without a word. Both now accept a value, a mean and a standard deviation, in the order a spreadsheet's `NORM.DIST` uses, and standardise the value as `(x - mean) / sd`. The one-argument forms on the standard normal are unchanged.
  
  | expression | before | now |
  | --- | --- | --- |
  | `normalcdf(110, 100, 15)` | 1 | 0.75 |
  | `normalpdf(110, 100, 15)` | 0 | 0.02 |
  | `normalcdf(110, 100)` | 1 | error: takes 1 or 3 arguments |
  | `normalcdf(110, 100, 0)` | 1 | error: a standard deviation must be greater than zero |
  | `percentile([1, 2, 3], 50, 9)` | 2 | error: takes 2 arguments |
  | `zscore(1, [1, 2, 3], 5)` | -1.22 | error: takes 2 arguments |
  | `correlation([1, 2, 3], [2, 4, 6], [1, 1, 1])` | 1 | error: takes 2 arguments |
  
  The density in the three-argument form is divided by the standard deviation, because it is a density per unit of the value rather than per standard deviation, so `normalpdf(100, 100, 15)` is 0.3989 / 15.
  
  The same silent drop was in every statistics call form: each handler read the arguments it wanted and ignored the rest. Every one now checks its argument count and refuses any other with `STAT_ARGUMENT_COUNT`, naming the count it takes and an example call. The phrase forms (`correlation of A and B`) always pass two lists and are unaffected.
  
  The boundary: the normal functions take one argument or three. Two are refused rather than guessed at, since a mean with no standard deviation has no scale. A graphing calculator's four-argument `normalcdf(lower, upper, mean, sd)` is not a form here, and is refused by count rather than misread; the difference of two calls gives the same share. The arguments are plain numbers, not quantities with units, and the results carry the existing error-function approximation, accurate to about seven decimal places. The inverse normal and the other distributions are #517. This change covers the statistics package's own functions; other packages' plugin functions validate their own arguments.
  
  ## Verification
  
  New tests pin the three-argument answers against the standardised one-argument form, the density's scaling, each refusal and its code, and the argument-count guard across percentile, z-score and the two-list call forms, with the phrase forms unchanged. The statistics page gains proven examples for the mean-and-deviation form and a `solve-doc` block of the refusals. `npm run verify:ci` passes: 9,593 tests across 487 suites, with the bundled-consumer contract.
- bd4480c: A negative half rounds away from zero, a zero has no sign, `m/s²` reads back and is named in words, a function refuses a quantity it has no reading of, and an odd root of a negative number is real
  
  Six gaps older than this release, found by the cross-feature review before it and the same in 2.39.0.
  
  **A half rounds away from zero, however rounding is written (#584).** `round(-2.5)`, `-2.5 rounded` and `to nearest` took a half towards positive infinity, while `round(-2.5, 0)` and `to N dp` took it away from zero, so one function gave two answers. Every form now takes a half away from zero, the rule a spreadsheet's `ROUND` follows. `rounded up` and `rounded down` name their own direction and are unchanged.
  
  | expression | before | now |
  | --- | --- | --- |
  | `round(-2.5)` | -2 | -3 |
  | `-2.5 rounded` | -2 | -3 |
  | `-25 to nearest 10` | -20 | -30 |
  | `round(-$2.50)` | -$2.00 | -$3.00 |
  | `-2.5 to 0 dp` | -3 | -3 |
  | `-2.5 rounded up` | -2 | -2 |
  
  **A zero is written without a sign (#585).** A double has a negative zero, equal to zero in every comparison, and the formatter wrote its sign. The value keeps it, since `1 / (0 * -1)` is -∞ where `1 / 0` is ∞; only the display drops it.
  
  | expression | before | now |
  | --- | --- | --- |
  | `ceil(-0.5)` | -0 | 0 |
  | `0 * -1` | -0 | 0 |
  | `-0.001%` | -0.00% | 0.00% |
  
  **`m/s²` reads as the acceleration the engine writes (#586).** The lexer reads `s²` as one word, and no unit is spelled that way, so the answer `9.81 m/s²` could not be typed back.
  
  | expression | before | now |
  | --- | --- | --- |
  | `9.81 m/s²` | error: Undefined variable: s² | 9.81 m/s² |
  | `10 kg * 9.81 m/s²` | error: Undefined variable: s² | 98.10 N |
  
  **A function refuses a quantity it has no reading of (#587).** A sine, a logarithm or an exponential of a length has no meaning, and read as its bare number the answer depended on the unit written: `sin(1 m)` was 0.84 and `sin(100 cm)` -0.51. These are refused by name, as `sqrt(4 m)` already was. An angle, a plain number and a ratio that cancels still answer.
  
  | expression | before | now |
  | --- | --- | --- |
  | `sin(1 m)` | 0.84 | error: sin takes an angle or a plain number, not a length |
  | `log(10 kg)` | 2.30 | error: log takes a plain number, not a mass |
  | `sin(30 degrees)` | 0.50 | 0.50 |
  | `sin(1 m / 2 m)` | 0.48 | 0.48 |
  
  **An odd root of a negative number is real, and an even one is refused (#588).** A negative number to a fractional power answered NaN. The exponent is known as a fraction when written as one (`1/3`) or typed as a decimal (`0.2` is a fifth), so an odd denominator gives the real root and anything else has no real value, refused by name as `log(-1)` is.
  
  | expression | before | now |
  | --- | --- | --- |
  | `(-8)^(1/3)` | NaN | -2 |
  | `(-8)^(2/3)` | NaN | 4 |
  | `(-32)^0.2` | NaN | -2 |
  | `(-1)^0.5` | NaN | error: (-1)^0.5 has no real value |
  
  **An acceleration is named in words (#590).** `m/s^2` is held as the unit `mps2`, which has a dimension but no measure in the tables, so a conversion to it was refused as `"mps2" is not a unit`, even from an acceleration, and other refusals named `mps2` too. It now converts to itself, and every refusal calls it an acceleration.
  
  | expression | before | now |
  | --- | --- | --- |
  | `9.81 m/s^2 in m/s^2` | error: "mps2" is not a unit. | 9.81 m/s² |
  | `5 kg in m/s^2` | error: "mps2" is not a unit. | error: a mass cannot be converted to an acceleration |
  | `9.81 m/s^2 in N` | error: Cannot convert mps2 to N: they do not measure the same thing | error: an acceleration cannot be converted to a force |
  | `9.81 m/s^2 * 3 s` | error: Cannot combine incompatible units: mps2 and s | error: acceleration and duration cannot be multiplied |
  
  The boundary: `^` stays in the real numbers, so `sqrt(-1)` is still `i` while `(-1)^0.5` is refused. `0/0` stays NaN and `1/0` stays infinity, the floating-point standard's defined answers rather than missing ones. `m/s²` is the one acceleration unit; `ft/s^2` and standard gravity as a unit are not in the tables, and an acceleration times a duration is not yet a speed.
  
  The rounding, number-functions, operators, unit-arithmetic and derived-units pages carry proven examples of each change.
  
  ## Verification
  
  A new test file per issue pins each case above, the forms that must not change, and, for #585, that the value keeps the sign division can see. Four existing tests that pinned the old answers now pin the new ones. `npm run verify:ci` passes.
- ccd8cf9: A blank line or a heading inside a summed range is passed over, and a line below is described as the refusal it is
  
  `sum(line 1 : line 3)` read every line in the span and took a line with no answer for a forward reference, so a blank line inside it, typed by pressing Enter in the middle of a column, turned the sum into an error. A blank line or a heading now has no figure to add and is passed over, the way a spreadsheet's `SUM` passes over an empty cell, in both document passes.
  
  | document | before | now |
  | --- | --- | --- |
  | `10`, blank, `30`, `sum(line 1 : line 3)` | Line 2 has not been evaluated yet | 40 |
  | `10`, `# Mid`, `30`, `average(line 1 : line 3)` | Line 2 has not been evaluated yet | 20 |
  | blank, blank, `sum(line 1 : line 2)` | Line 1 has not been evaluated yet | error: lines 1 to 2 hold no figures to add up |
  
  The line references page also said that `line 2 + 1` above `7` answers 8. It does not: a line below is refused in both passes, as the page's own cycle example shows, and the page now says so with a proven example.
  
  The boundary: only a blank line or a heading is passed over. A line of prose inside the span is a line that failed, and still makes the sum an error, and a span that runs past the last line still reports the first line that is not there.
  
  Fixes #562 and #563.
  
  ## Verification
  
  The cross-path spec pins a span over a blank line and a heading, an empty span and a span past the end through `parseDocument` and `evaluateDocument`, which agree. The line references page gains both as proven examples. `npm run verify:ci` passes: 10,723 tests across 518 suites, with the bundled-consumer contract.
- 54f290a: Semantic token spans are measured on the line as written: a quoted line and a list item colour the characters they name
  
  A host colours the characters between a span's `from` and `to`, so a span has to be measured on the line the host handed over. On a quoted line it was not. The highlighter set the `> ` aside before tokenizing and measured every span from there, two columns short, so the colours landed on the wrong characters. A list item had the opposite fault: it was tokenized marker and all, so a bullet was coloured as a minus sign, and a `*`, `1.` or task-box marker, which does not parse as an operator, left the whole line uncoloured, although the engine evaluates each of them as the list item it is.
  
  | line | the engine answers | coloured, before | coloured, now |
  | --- | --- | --- | --- |
  | `> 1 + 2` | (a quote, not evaluated) | `>` as a number, `1` as an operator, `+` as a number | `1` number, `+` operator, `2` number |
  | `> total += 5` | (a quote, not evaluated) | `> tot` as a variable, `l ` as an operator, `=` as a number | `total` variable, `+=` operator, `5` number |
  | `- 100 + 20` | 120 | `-` operator, `100` number, `+` operator, `20` number | `100` number, `+` operator, `20` number |
  | `* 5 kg` | 5.00 kg | nothing | `5` number, `kg` unit |
  | `1. 12 km` | 12.00 km | nothing | `12` number, `km` unit |
  | `- [ ] total += 5` | 5 | nothing | `total` variable, `+=` operator, `5` number |
  | `-100 + 20` | -80 | `-` operator, `100` number, `+` operator, `20` number | unchanged |
  
  The lexer now starts past the marker, the way the evaluator already did for a list item, and keeps every offset and column those of the whole line. So a line behind any marker (a quote, a bullet, a numbered item, a task box, an indented or quoted list item) is coloured exactly as its content is on a line of its own, moved along by the marker, and the marker itself is left uncoloured. `Lexer.getHighlightTokens` and `getHighlightTokenObjects` measure the same way, and take the start as an optional second argument; `Lexer.highlightContentStart` says where it is.
  
  The boundary: a quoted line is still coloured and still not evaluated, as before; this changes where its colours land, not whether the engine reads it. A minus written with no space after it (`-100`) is arithmetic, as the evaluator reads it, and keeps its colour. Colouring costs the same: over a 200-line document with quoted and list lines in it, both builds in one process, interleaved, a full pass from an empty cache took a median of 0.38 ms before and now, and 0.80 ms before and 0.79 ms now with normalized highlighting, across two runs of eleven.
  
  Fixes #567.
  
  ## Verification
  
  A new suite puts twelve markers in front of eleven expressions, in both highlighting modes, and requires each line to be coloured exactly as its content alone is, moved along by the marker. It pins the issue's line, the bullet that is no longer a minus, the list items that are now coloured with the answer the evaluator gives them, the known-name gate behind a marker, an inline solve inside a list item, structure that still colours nothing, and the lexer's own offsets and columns. The editor integration page says what a span is measured on and which markers are left uncoloured. `npm run verify:ci` passes: 10,950 tests across 523 suites, with the bundled-consumer contract.
- ccd8cf9: A sparkline's label reads as its list does, at the same decimal places
  
  The text a sparkline answers with, which a reader with no canvas sees, was built from the list's raw digits, so it disagreed with how the same list reads on its own line.
  
  | expression | before | now |
  | --- | --- | --- |
  | `[1.23456, 2.5, 3.14159] as sparkline` | [1.23456, 2.5, 3.14159] | [1.23, 2.50, 3.14] |
  | `[120, 135, 128] as sparkline` | [120, 135, 128] | [120, 135, 128] |
  
  The drawn points keep their full precision; only the label is written at the display places. The boundary: the label uses the default formatting, as the value is built before a host's display settings are known.
  
  Fixes #558.
  
  ## Verification
  
  The chart spec pins the label against the list's own display, and the charts page gains a fractional list as a proven example. `npm run verify:ci` passes: 10,723 tests across 518 suites, with the bundled-consumer contract.
- 3873a26: `total above` leaves a subtotal out, and a reference to a failed line says it failed in both document passes
  
  `total above`, `sum above` and `average above` read every line up to the block's boundary, a subtotal included, so a running total counted the figures under it twice. They now leave out a line that is itself a total, by the same test the section totals from #508 use, so the two forms agree about one note.
  
  | document | before | now |
  | --- | --- | --- |
  | `10`, `total above`, `5`, `total above` | 25 | 15 |
  | `10`, `5`, `Subtotal: total above`, `average above` | 10 | 7.50 |
  | `10`, `20`, `30`, `sum above`, `average above` | 30 | 20 |
  
  A reference to a line that ran and failed, a line of prose say, was worded differently by the two document passes. `parseDocument` said the line had not been evaluated yet, as if it were a forward reference, and `evaluateDocument` said it had an error. Both now say it has an error, which is what happened.
  
  | document | pass | before | now |
  | --- | --- | --- | --- |
  | `this is prose`, `line 1 + 1` | `parseDocument` | Line 1 has not been evaluated yet (forward reference, or out of range) | Line 1 has an error |
  | `this is prose`, `line 1 + 1` | `evaluateDocument` | Line 1 has an error | Line 1 has an error |
  
  The boundary: a total is recognised from its text, with any label before a colon set aside, so a line that happens to compute a total some other way, `10 + 5` under a column of 10 and 5, is still a figure. A reference to a line below, or to a blank line, is still reported as not evaluated yet, since nothing has run there.
  
  Fixes #551 and #552.
  
  ## Verification
  
  The cross-path spec gains both cases, each run through `parseDocument` and `evaluateDocument` and required to agree. The line references page gains the subtotal as a proven example, and an existing test whose comment already asked for the average over the figures alone (60/3), while its assertion pinned 120/4, now asserts what its comment says. The operators page also gains a sentence on `-2^2`, which is 4 here as in a spreadsheet, and the brackets that make it -4. `npm run verify:ci` passes: 10,713 tests across 517 suites, with the bundled-consumer contract.
- 8466f73: `tan` at an odd multiple of a right angle is refused rather than answered with a huge number
  
  The tangent of 90° has no value: the curve runs off to infinity on either side. The double nearest π/2 is not π/2, though, so `tan(90 degrees)` returned the tangent of a slightly smaller angle, 16,331,239,353,195,370, as if that were the answer. An angle within the conversion's own rounding of an odd number of right angles is now refused with `TRIG_UNDEFINED`, naming the angle in degrees.
  
  | expression | before | now |
  | --- | --- | --- |
  | `tan(90 degrees)` | 16,331,239,353,195,370 | error: tan is undefined at 90 degrees |
  | `tan(270 degrees)` | 5,443,746,451,065,123 | error: tan is undefined at 270 degrees |
  | `tan(pi/2)` | 16,331,239,353,195,370 | error: tan is undefined at 90 degrees |
  | `tan(89.9 degrees)` | 572.96 | 572.96 |
  
  The tolerance is the conversion's rounding, scaled to the size of the angle, so a ten-thousandth of a degree either side of the asymptote still answers. Past a trillion right angles a double cannot place an angle against an asymptote at all, and there `tan` keeps its ordinary answer.
  
  Trigonometry had no page in the syntax reference; the number functions page now explains `sin`, `cos` and `tan`, radians against degrees, and this refusal, with proven examples.
  
  The boundary: only `tan`'s undefined points are recognised. The other special angles are not yet exact, so `sin(180 degrees)` is still the 1.22e-16 the approximation of π leaves rather than 0; exact special angles and the wider domain errors are #510.
  
  ## Verification
  
  New tests pin each refused angle in degrees, radians and gradians, the message, the angles just either side of the asymptote, the ordinary angles, and a very large angle that keeps `Math.tan`'s answer. `npm run verify:ci` passes: 9,745 tests across 493 suites, with the bundled-consumer contract.
- d0cab52: A tolerance written as a percentage or in another unit has the right width
  
  The spread in `value ± spread` was read as a bare number whatever it was written as. A percentage became its proportion, so `100 ± 5%` was `100 ± 0.05`; and a tolerance in a different unit from the value had both units dropped before either was converted, so `5 m ± 1 cm` was `5 ± 1`, a spread a hundred times too wide. A percentage tolerance is now relative to the value, and a tolerance with a unit is converted into the value's unit before the unit is dropped.
  
  | expression | before | now |
  | --- | --- | --- |
  | `100 +/- 5%` | 100 ± 0.05 | 100 ± 5.0 |
  | `12.3 +/- 2%` | 12.3 ± 0.02 | 12.3 ± 0.25 |
  | `5 m +/- 1 cm` | 5 ± 1.0 | 5 ± 0.01 |
  | `1 kg +/- 5 g` | 1 ± 5.0 | 1 ± 0.005 (shown as 0.01 at two places) |
  | `20 C +/- 1 F` | 20 ± 1.0 | 20 ± 0.56 |
  | `5 m +/- 1 kg` | 5 ± 1.0 | error: they do not measure the same thing |
  | `5 +/- 1 cm` | 5 ± 1.0 | error: the value has no unit to read it in |
  | `45% +/- 3%` | 0.45 ± 0.03 | 0.45 ± 0.03 |
  
  A temperature tolerance is converted as a width rather than as a reading, so 1 °F on a Celsius value is 5/9 of a degree, not the -17.2 °C that converting 1 °F as a temperature gives. On a value that is itself a percentage the tolerance stays in percentage points, as a poll's margin of error is read, so `45% ± 3%` is unchanged.
  
  The boundary: the value's own unit is still dropped once the spread is converted, as the uncertainty page documents, since carrying units through the quadrature rules is a larger change. A tolerance in a unit that cannot be converted to the value's, or on a value with no unit, is refused with `UNCERTAINTY_UNIT_MISMATCH` rather than having its unit discarded. A currency tolerance in a different currency converts at the cached rate and is refused when none is available.
  
  ## Verification
  
  A new suite pins each form above, including the temperature interval, the percentage-point reading, propagation of a relative spread, and the refusals, with the existing percentage-arithmetic suites unchanged. The uncertainty page gains sections on percentage and unit tolerances with proven examples and a `solve-doc` block of the refusals. An A/B run of 3,863 expressions against the previous build differed only on random functions. `npm run verify:ci` passes: 9,647 tests across 489 suites, with the bundled-consumer contract.
- 8466f73: A variable named like a unit symbol divides as a variable: with `m` and `s` defined, `m/s^2` is their quotient
  
  The lexer reads every word the unit table knows as a unit, including single letters people use as variable names, and three normaliser rules fused those words wherever they stood. With `m = 3` and `s = 2`, the acceleration rule turned `m/s^2` into the unit `mps2` and the line failed with "Undefined variable: mps2"; the compound-unit rule read `m/s` as a speed, and the bare-denominator rule read `/ s` as "per second". Each rule now leaves a unit-named word alone where the expression expects a value: at the start of a line, or after an operator, bracket, comma or `=`.
  
  | document | before | now |
  | --- | --- | --- |
  | `m = 3`, `s = 2`, `m/s^2` | error: Undefined variable: mps2 | 0.75 |
  | `m = 3`, `s = 2`, `m/s` | error: Undefined variable: m/s | 1.50 |
  | `h = 4`, `km = 8`, `km/h` | error: Undefined variable: km/h | 2 |
  | `9.81 m/s^2` | 9.81 m/s² | 9.81 m/s² |
  | `100 km / h` | 100.00 km/h | 100.00 km/h |
  
  A unit written after a value is fused exactly as before: after a number (`9.81 m/s^2`), a closing bracket (`(2+3) m/s^2`), a variable (`x m/s^2`) or a conversion keyword (`in km/h`). The position test is shared, in `normalizer/ValuePosition.ts`.
  
  The boundary: this is about position, not about which names are defined. A unit-named variable written after a value is still read as a unit (`2 m` is two metres even with `m` defined), and a line that is only unit words with no variables defined (`m/s^2`) is refused as an undefined variable rather than read as an acceleration with no number.
  
  ## Verification
  
  A new suite pins the reported document and its neighbours, and every rate, speed and acceleration form that still fuses after a value. The variables page gains a proven `solve-doc` example. `npm run verify:ci` passes: 9,745 tests across 493 suites, with the bundled-consumer contract.
- 8466f73: A unit after a power of ten belongs to the power, and two units side by side are refused
  
  A unit binds tighter than `^`, so `10^3 m` parsed as ten to the power of three metres. The power read its exponent as a bare 3 and answered the plain number 1,000, and `10^3 m in km` then labelled that 1,000 as kilometres. Scientific notation puts the unit after the power, so a unit inside an exponent's operand now belongs to the whole power: `10^3 m` is a thousand metres and `10^-3 m` a millimetre. An exponent that still carries a unit, written inside brackets, is refused by name.
  
  A second unit written straight after a quantity relabelled it, so `5 kg m` was five metres and `5 kg m in cm` 500 cm, the kilograms discarded without a word. Two units side by side name nothing the engine knows, so that is refused with `UNIT_AFTER_UNIT`.
  
  | expression | before | now |
  | --- | --- | --- |
  | `10^3 m` | 1,000 | 1,000.00 m |
  | `10^3 m in km` | 1,000.00 km | 1.00 km |
  | `1.5 * 10^3 kg` | 1,500 | 1,500.00 kg |
  | `10^-3 m in mm` | 0.001 mm | 1.00 mm |
  | `2^(3 m)` | 8 | error: an exponent cannot carry a unit |
  | `5 kg m` | 5.00 m | error: a quantity in kg cannot take a second unit |
  | `5 kg m in cm` | 500.00 cm | error: a quantity in kg cannot take a second unit |
  | `5 USD GBP` | £5.00 | error: a quantity in USD cannot take a second unit |
  | `$5 CAD` | $5.00 in US dollars | $5.00 in Canadian dollars |
  | `$5 kg` | $5.00 | error: a quantity in USD cannot take a second unit |
  
  Two readings that leaned on the relabel are now made directly. A currency symbol is shared by several currencies, so a code after the amount that names one of them says which is meant: `$5 CAD` is Canadian dollars and `¥500 CNY` yuan, where the code used to be dropped. And `20 degrees C` is twenty degrees Celsius: a degree word between a number and a temperature scale names the scale, read by the degree rule rather than by relabelling an angle as a temperature.
  
  The boundary: the same unit twice (`5 kg kg`, `$5 USD`) is let through, since it changes nothing, and a word the unit table does not know after money (`£60,000 salary per month`) is still read as a label. Compound units written with a slash (`km/h`, `m/s^2`) are joined into one unit before this point and are unaffected.
  
  ## Verification
  
  A new suite pins every form above, the powers and conversions that are unchanged, the currency codes and labels, and the temperature-scale spellings. The unit arithmetic page gains sections on a unit after a power and on two units side by side, and the currency page on codes after a symbol, with proven examples. `npm run verify:ci` passes: 9,745 tests across 493 suites, with the bundled-consumer contract.
- e2ac39a: A power written on a unit makes an area or a volume, and a power with no unit to give is refused
  
  `5 m^2` was read as five metres, squared, and the power handler had no reading for a unit, so it answered a bare 25. `10 m^3 in litres` then labelled that bare 1,000 as litres, a tenth of the true answer. Each result looked plausible, and nothing on screen said the unit had gone.
  
  The power now belongs to the unit it is written on, the way a physics book reads it: `5 m^2` is five square metres. A quantity in brackets is raised as a whole, and a square or cube root takes an area or a volume back to a length.
  
  | expression | before | now |
  | --- | --- | --- |
  | `10 m^3 in litres` | 1,000.00 litres | 10,000.00 litres |
  | `1 m^3 in L` | 1.00 L | 1,000.00 L |
  | `5 m^2` | 25 | 5.00 m2 |
  | `5 m^2 in ft2` | 25.00 ft2 | 53.82 ft2 |
  | `(3 m)^2` | 9 | 9.00 m2 |
  | `sqrt(16 m^2)` | 16 | 4.00 m |
  | `sqrt(1 ha)` | 1 | 100.00 m |
  
  Only a length has a square or a cube with a unit, so any other power or root of a quantity is now an error instead of the bare number. That covers `5 kg^2`, `sqrt(16 m)`, a speed squared, and a power or root of an amount of money: `(5 USD)^2` used to answer 25 and `sqrt($100)` 10, and the tests that pinned those numbers now assert the refusal. A ratio of like amounts is a plain number, so `($2000 / $1000)^(1/5)` is unaffected. `m/s^2` is still read as acceleration; the same shape in any other unit, such as `9.81 ft/s^2`, which used to answer a bare 96.24, is refused.
  
  `1 m3 in L` now converts, where it used to be a parse error, and so does a currency symbol as the target, as in `100 EUR in €`. A unit literal takes a following `in` or `to` as its own conversion only when a unit, `?` or `best` comes next; the lexer marks neither `L` nor `€` as a unit, so those conversions are left to the outer `in`, which reads them.
  
  The boundary: this covers a length squared or cubed, and nothing wider. The superscript `m²` is not accepted as input. A unit written after an exponent, as in `10^3 m`, is the separate fix #535, and a product of two lengths, `5 m * 3 m`, is #533. A fuller algebra of units is #513.
  
  ## Verification
  
  New tests pin every form above, the named refusals, the forms that already worked, and the spelling helpers, and the unit arithmetic page gains proven examples for squares, cubes and roots. `npm run verify:ci` passes: 9,566 tests across 487 suites.

## 2.39.1

### Patch Changes

- 200b496: Cross-document cells carry the scope that owns them, and notify outside the value arena
  
  Internal groundwork for the workspace model in `docs-internal/plans/CROSS_SCOPE_CELLS.md`, with no change a caller can observe. Two seams land together.
  
  Every line now executes under a scope: the owner of a `global :name` cell it writes. The engine mints one anonymous scope per instance, carried on the execution context and set everywhere a context is built, the per-pass context, the fresh context a goal-seek probe allocates, and the hand-built context the async pipeline re-runs a settled line under. A run with no context of its own, a warm-up, the worker, a lone `evaluateExpression`, falls back to the engine's own scope. Nothing keys on the scope yet: the store stays realm-wide and keyed on the bare name, so two documents writing `global :total` still share one cell, exactly as before.
  
  A cell's notification now waits. During an evaluation pass the write still lands in the store at once, so a later line reads what an earlier one wrote, but the notification to listeners, a document's dirty marking and an async read's first-write promise, is staged and replayed in write order once the pass leaves the value arena, rather than firing synchronously mid-dispatch from inside it. A document's own dependents are marked through the dependency graph regardless, and another document re-evaluates on its own cadence after the pass returns either way, so the move is invisible. What it buys is a listener that may legitimately drive another pass, which a callback firing from inside the arena window cannot.
  
  The boundary: this is the seam, not the feature. Keying the store by scope so two documents' cells stop sharing, refusing a write to a foreign scope, and staging the writes rather than only their notifications, are the workspace model (Release D), not this change.
  
  ## Verification
  
  `npm run verify:ci` passes: 9,506 tests across 486 suites. The scope seam and the buffered notification are proven inert three ways. Every existing assertion is unchanged. The document differential fuzz reports zero disagreements over 2,400 sessions, the incremental path, where the staged notification lives, agreeing with a settled from-scratch oracle after every edit. New unit tests pin the staging order, read-your-writes during a pass, nested-pass flushing, and one anonymous scope per engine.

## 2.39.0

### Minor Changes

- 4376c37: Document-spanning variables are their own package, so a host can refuse them and keep ordinary ones
  
  `:name = expr` and `global :name` are different levels of functionality. One defines a value inside the
  document being evaluated. The other reaches outside it, into a store shared by every engine in the
  realm. A host can reasonably want the first and not the second: a single-document editor, a sandboxed
  evaluation, or a product where one document quietly reading another would be surprising.
  
  Both lived in `VARIABLES_PACKAGE`, so that choice could not be expressed. The documented way to drop a
  feature is to filter it out of `BUILTIN_PACKAGES`, and doing that here took `:x = 1` down with
  `global :x = 1`:
  
  | line | `filter(p => p !== VARIABLES_PACKAGE)`, before | now, `filter(p => p !== GLOBAL_VARIABLES_PACKAGE)` |
  | --- | --- | --- |
  | `:subtotal = 41` | parse error | 41 |
  | `:subtotal + 1` | parse error | 42 |
  | `global :x = 5` | parse error | parse error |
  
  A host that wanted only the document-spanning half refused had to register a replacement parselet for
  the `GLOBAL` token and rely on the later registration winning, which works but is not a supported
  interface and warns when it happens.
  
  `GLOBAL_VARIABLES_PACKAGE` is now exported alongside `VARIABLES_PACKAGE` and registered by default, so
  nothing changes for a consumer taking `BUILTIN_PACKAGES` as it comes. The async resolver that backs a
  read of a not-yet-declared name travels with it, since it exists only to serve that syntax. Neither
  package leans on the other: the global parselet consumes its own colon and name, so either can be
  registered without the other.
  
  Two things worth knowing, both unchanged by this and both pinned by tests:
  
  - Dropping the package removes the SYNTAX, not the values. The store is realm-wide and outlives any one
    engine, so whatever another engine already wrote is still there, merely unaddressable. The workspace
    in `docs-internal/plans/CROSS_SCOPE_CELLS.md` is what resolves that, after which refusing the feature
    is declining to pass a workspace.
  - The `global` keyword is claimed by the locale whether or not the package is registered, so a document
    containing `global :x` without it reports a parse error on that line rather than evaluating to
    something else. The rest of the document is unaffected.
  
  Marked a minor rather than a patch because it adds a public export and changes what filtering
  `VARIABLES_PACKAGE` removes. A host doing that today to drop variables entirely now keeps the
  document-spanning form and should filter both.
  
  ## Verification
  
  A new suite pinning the separation in both directions, that dropping either package leaves the other
  working, that the refusal is contained to its own line, and that the two descriptors do not register
  each other's parselets, so a later tidy-up that merges them back fails with a clear reason.
  `npm run verify` passes: 484 suites, 9,482 tests, plus the lint, docs, units, sidebar and package gates.

### Patch Changes

- b07ff5f: Borrowing an engine for one whole-document pass no longer redirects the host's later async results
  
  `evaluateDocument` stands up its own document model and evaluator on an engine the caller may already
  be driving, and its own comment promises that borrowing the engine "leaves nothing behind". It put the
  document model back and left one thing behind.
  
  Constructing a `ThreeTierEvaluator` wires both the document model and its own VM checkpointer onto the
  engine's async batcher, unconditionally. Only the model was restored. The checkpointer is not a
  cosmetic field: it is what the batcher uses to restore VM variable state when an async value arrives
  later, against checkpoints keyed by line position. So after one borrowed pass, a host's own async
  results were restored from checkpoints recorded for a document that no longer existed, at positions
  belonging to entirely different lines.
  
  The pass now takes the previous checkpointer before it constructs the evaluator that seizes it, and
  puts it back in the same `finally` that restores the document model, so a failed pass restores it too.
  
  The boundary: this restores what the borrowed pass displaced. Other state the pass legitimately leaves
  on a shared engine, such as cached bytecode for expressions both documents happen to contain, is
  unaffected and is not residue.
  
  ## Verification
  
  A new suite asserting that a host engine driving its own document has both its document model and its
  checkpointer restored after a borrowed pass, and after three of them in a row. The checkpointer
  assertions fail before this change. `npm run verify` passes: 480 suites, 9,124 tests.
- c36d01f: A line reading several not-yet-declared cross-document values waits once, not once per value
  
  `GlobalVariableAsyncResolver.preflight` scans a line's bytecode for `global :name` reads whose name no
  loaded document has declared yet, and returned at the first one it found. The engine then showed the
  line as pending, waited for that single name, re-executed the line, discovered the second name was
  still missing, and waited again.
  
  So a line reading three undeclared names needed three full pend-and-re-execute round trips before it
  could produce an answer, and each round trip re-ran the whole line. The scan already walked the entire
  program, so every one of those names was seen on the first pass and then discarded.
  
  The scan now collects them all and waits on all of them together. The names are deduplicated and
  ordered, so a line reading the same name twice waits once, and two lines reading the same pair agree
  on one key whichever order they read them in, which matters because that key is registered as a
  dependency and not only used as a label.
  
  A line with exactly one unresolved name is unchanged in every respect, including the spelling of its
  key.
  
  The waiting is for all of them rather than the first to arrive, because a line cannot produce an
  answer until every name it reads exists; resolving early would re-execute it straight back into the
  state it just left, which is the behaviour being replaced. A name that nobody ever declares leaves the
  line pending indefinitely, exactly as a single one always did. There is deliberately no timeout here
  and that has not changed.
  
  ## Verification
  
  Three tests: that two of three names arriving does not settle the wait while the third is outstanding,
  that a name read twice collapses to one wait and keeps the single-name key, and that the composite key
  does not depend on read order. The first and third fail before this change. `npm run verify` passes:
  479 suites, 9,124 tests.
- e700638: A cross-document value notifies its readers when it changes, and stops notifying them when it does not
  
  `GlobalVariableStore.set` decides whether a write is worth telling anyone about, and it was wrong in
  both directions at once.
  
  **It told readers nothing when a matrix changed shape and everything when it had not changed at all.**
  The comparison guarding the notification opened with an `Array.isArray` test on the payload, which can
  never be true: `Value.value`'s union has no array member. The arrays are one level further in, as a
  matrix's `data`. So every object-valued cell fell through to `Object.is` on two freshly-built objects,
  which is never equal, and a matrix, range, colour, split, chart, address or symbolic cell re-notified
  on every evaluation pass for ever. Each of those notifications dirties the whole downstream closure of
  every reader, so the cost was not one wasted comparison but a re-evaluation storm proportional to how
  many lines read the cell.
  
  **It stayed silent when a value changed in a way only the reader can see.** The comparison looked at
  `value`, `unit` and `timedOut`, and skipped every sidecar. But `1.5` and `1.5 to 2 dp` are the same
  double and render as `1.5` and `1.50`; `30` and `30 ± 2` are the same double and render as `= 30` and
  `= 30 ± 2.0`; a datetime's grain, zone and span decide whether an instant reads as a day, a wall-clock
  time or a duration. Those pairs compared equal, the notification was suppressed, and every reader kept
  displaying the old rendering with no event that would ever correct it.
  
  The two directions are not equally bad, which is why the comparison is now conservative. A redundant
  notification costs a re-evaluation that arrives at the same answer. A missing one is permanent, because
  nothing re-reads a cell it was not notified about. So the payload walk is bounded, and a payload too
  large to compare within that bound reports "not equal" rather than guessing.
  
  **A value the store held could be one no reader was ever told about.** `set` wrote first and checked
  the notification-depth bound second, inside `notify`, which returned before calling any listener. At
  the limit the value was therefore stored and announced to nobody. The bound is now checked before the
  write, so the store and its readers cannot disagree: either both see the new value or neither does.
  
  The boundary: this is not cross-document cycle detection and does not pretend to be. That bound guards
  a host listener that writes back on notification, and it is unreachable from engine code, because both
  engine-side listeners are non-reentrant. Cycles that span documents are specified separately in
  `docs-internal/plans/CROSS_SCOPE_CELLS.md`.
  
  ## Verification
  
  The suite's only cross-document cycle test passed vacuously: it wrote the received value straight back,
  so the second hop hit the unchanged-value short-circuit and the recursion stopped at depth 2 without
  ever reaching the bound it was named for. It now writes a different value on each hop, asserts that the
  engine's bound rather than the test's own guard is what terminates it, and asserts that every value the
  store holds is one its listeners were told about. Two further tests cover the object-valued and
  sidecar-only cases. All three fail before this change. `npm run verify` passes: 479 suites, 9,123 tests.
- b2a1121: A value that is still loading renders as a placeholder, not as its internal cache key
  
  `formatValue` had a case for every value type that carries a payload of its own
  except one. A `Pending` value stores its deduplication query key in `.value`, so
  it fell through to the default case and that key was rendered as the answer:
  
  | line | before | now |
  | --- | --- | --- |
  | `global :total`, awaiting a declaration | `= global:total` | `…` |
  | `100 USD in GBP`, rate not yet fetched | `= currency:USD:GBP` | `…` |
  
  This is the same leak that was fixed for `Error` values, one type along in the
  same switch. That case has a comment recording it: before the fix an error
  displayed its raw code rather than its message. `Pending` was missed.
  
  There is no result prefix on the placeholder, for the reason the `Error` case
  drops it too. A line whose value has not arrived has no answer yet, and
  prefixing it with `= ` presents one. `…` is what the
  [formatting guide](https://liamriddell.github.io/solve-engine/guide/formatting/)
  already teaches a host to render for this type, so the built-in formatter now
  agrees with the documented example instead of contradicting it.
  
  The boundary: this changes the built-in formatter only. A host that inspects
  `value.isPending()` and renders its own affordance, which the formatting guide
  recommends and which is what a host with a spinner does, is unaffected.
  
  ## Verification
  
  Two unit tests in the FormatEngine suite, asserting that a pending value neither
  contains its query key nor carries a result prefix. Both fail before the change
  with the exact strings in the table above. `npm run verify` passes: 479 suites,
  9,123 tests.

## 2.38.30

### Patch Changes

- 2cd5921: A data rate converts in both directions
  
  A data-rate unit (`Mbps`, `MBps`, `kB/s`, and the like) could be the source of a
  conversion but not its target, so one direction worked and its inverse was
  refused:
  
  | expression | before | now |
  | --- | --- | --- |
  | `0.5 MBps in kB/s` | `500 kB/s` | `500 kB/s` |
  | `500 kB/s in MBps` | `INCOMPATIBLE_UNITS` | `0.5 MBps` |
  
  `convertRate` expands a data-rate alias to bits per second when it is the source,
  but its target branch accepted only a speed alias and returned "no conversion"
  for a data-rate target. It now expands a data-rate target the same way, so the
  pair lines up both ways and round-trips.
  
  The boundary: this covers the data-rate aliases only. A rate whose two sides
  genuinely do not share a measure (a mass per time against a length per time) is
  still refused, as before.
  
  ## Verification
  
  The rate-conversion unit suite gains the data-rate round-trip, both directions
  and there-and-back, and the full suite is green. `npm run verify:ci` passes.

## 2.38.29

### Patch Changes

- ec6d130: A fractional gas mark reads as the dial setting it is, not a division of the whole mark beside it
  
  A gas oven's two slowest settings are written on the dial as the fractions `1/4`
  and `1/2`, and a recipe writes them the same way. Read forwards they were right,
  `110C in gas mark` is `gas 1/4`, but read the other way `gas 1/4` answered 35°C
  where it should stand for 110°C. The setting parselet took only the whole number
  beside `gas` and left the `/4` as an ordinary division applied to the result:
  `gas 1` is 140°C, and 140 / 4 is 35. So the round trip did not close, and both
  of the fractional marks a recipe reaches for were wrong.
  
  | expression     | before    | now        |
  | ---            | ---       | ---        |
  | `gas 1/4 in C` | `35.00 C` | `110.00 C` |
  | `gas 1/2 in C` | `70.00 C` | `120.00 C` |
  
  A fraction written on the setting is now folded into it and handed on as the
  single value it draws, so the lookup sees 0.25 and answers 110°C, the same table
  the forward direction reads. The whole marks were always right and are unchanged:
  `gas 4 in C` is still 180°C, and `gas 6 + 10` is still ten degrees above gas 6
  rather than gas 16, because only a fraction reaches past the number.
  
  The boundary is what counts as a dial fraction. Only a proper fraction, numerator
  below denominator, is one, the same test the mixed-number rule applies to
  `2 3/2`. So `gas 3/4` folds to 0.75 and is refused, because 3/4 is not a mark on
  this dial (it has only `1/4` and `1/2`), where before it quietly answered 42.5°C;
  and an improper `gas 6/2` is no fractional setting at all and keeps the ordinary
  division it reads as, 100°C, unchanged.
  
  ## Verification
  
  The full suite is green (9,474 tests across 483 suites), with new cooking cases
  that pin both fractional settings converting to 110°C and 120°C, the gas-mark
  table round-tripping value for value in both directions across the fractional and
  whole marks, the `gas 3/4` refusal, and the improper `gas 6/2` staying the
  division it was. A proven docs example on the cooking page now shows the reverse
  fractional conversion, so it cannot drift from the engine again. The type check,
  the linters, the build and the bundled-consumer contract are green, the gates
  `npm run verify:ci` runs for the release.

## 2.38.28

### Patch Changes

- b8f43e3: Evaluating untrusted input is bounded in memory, and a word used as a lookup key can no longer resolve to an inherited property
  
  Two hardening fixes for a host that evaluates input it does not control. Both
  are behaviour-preserving for every ordinary expression: they change what the
  engine does with input that was already wrong, never a real answer.
  
  ## The allocation budget now covers the values that grow without being a collection
  
  The budget is the running tally every evaluation is charged against, the one
  that already refuses an over-large matrix or an expanded range. It counted the
  things that are collections, matrix cells and range elements, and three values
  that grow without being one were never charged: a string joined to itself, a
  bigint multiplied by itself, and the exact decimal behind same-currency money.
  Each doubles every time the operator touches it, so a user-defined function that
  squares or concatenates its argument, nested a few dozen deep, built a
  near-gigabyte value from a document under a hundred characters long, while every
  between-opcode limit (instruction count, call depth, expression length) passed.
  
  | a one-line function, then its nested call | before                    | now                         |
  | ---                                       | ---                       | ---                         |
  | `d(s) = s + s`, then `d(d(…("ab")…))`     | a 256 MB string, no error | `ALLOCATION_LIMIT_EXCEEDED` |
  | `b(n) = n * n`, then `b(b(…(9)…))`        | a 27 MB integer, no error | `ALLOCATION_LIMIT_EXCEEDED` |
  | `m(x) = x * x`, then `m(m(…($9)…))`       | a 7 MB exact coefficient  | `ALLOCATION_LIMIT_EXCEEDED` |
  
  Each refusal trips at roughly two megabytes of accumulated growth, not at the
  hundreds of megabytes above, which are the sizes the same inputs reached with no
  charge in place. The three are now charged on birth, in the one place that kind
  of value is made, the same backstop `matrixValue()` already had; the running
  tally then accumulates the doubling chain and trips well before V8's own
  string-length or heap ceiling. `^` and `<<` on a bigint already refused past a
  fixed bit ceiling; plain multiply, which has none, is what this charge bounds.
  The charge is a no-op outside an evaluation (the formatter, a restored snapshot,
  a host call), and the everyday forms are untouched: `"foo" + " bar"`, a bigint
  sum, `$2.50 * 3`.
  
  ## A lookup key can no longer read an inherited property
  
  Several parts of the grammar resolve a word the reader typed by reading it from
  a table: a converter name (`as hex`), a rounding increment (`to nearest ten`), a
  compounding interval (`compounding monthly`), a timezone (`in Tokyo`), a
  currency alias, a `map`/`reduce` function, a cooking ingredient, a large-number
  suffix. Each was a plain object read by key, so a word that happens to name an
  inherited property, `constructor` or `__proto__` (and, for the tables read
  without lower-casing, `valueOf` or `toString`), read a value off the object's
  prototype instead of missing. The lookup treated that inherited function as a
  real entry, and the line returned a confident wrong answer or leaked an engine
  internal.
  
  | expression                  | before                     | now                |
  | ---                         | ---                        | ---                |
  | `5 as constructor`          | `5`                        | unknown converter  |
  | `5 to nearest constructor`  | `NaN`                      | refused            |
  | `2026-04-03 in constructor` | an internal bytecode error | unknown zone       |
  | `map(constructor, [1,2,3])` | an internal bytecode error | unknown function   |
  | `300g constructor in cups`  | `NaN`                      | unknown ingredient |
  
  Every such lookup now misses on a name it does not own, so a prototype name is
  unknown like any other unrecognised word, and the real names (`as hex`,
  `in Tokyo`, `map(double, …)`) work exactly as before. No table was ever written
  through one of these keys: `Object.prototype` is untouched, so this closes a
  wrong-answer and internal-error leak, not a prototype-pollution vector.
  
  The boundary: this is the lookup, not the feature. A genuinely unknown word
  already produced the honest "unknown X" error; the fix is that an inherited
  property name now produces that same error rather than a wrong value or a leaked
  internal code. The value charges change no result a legitimate expression
  produces, only the point at which an unbounded one is refused.
  
  ## Verification
  
  The full suite is green (9,470 tests across 483 suites), with two new hardening
  specs. One drives each of the three doubling chains to
  `ALLOCATION_LIMIT_EXCEEDED` on the default budget and confirms the everyday forms
  still evaluate and the refusal is recoverable. The other asserts that a prototype
  name gives the same honest "unknown" as any other word across every guarded
  lookup, including the ones whose result is emitted into bytecode, and that
  `Object.prototype` is untouched after every attempt. `npm run verify:ci` passes,
  including the bundled-consumer contract.

## 2.38.27

### Patch Changes

- 6ac84c3: Looking up a line by position no longer walks the order tree
  
  A document keeps its line order in a balanced tree, so `getLineAt(position)`
  turned a position into a line by walking it, an O(log n) recursion on every
  call. The cross-line forms lean on that hard: `total above`, a line range and
  every boundary check turn a position into a line this way, once for each line
  they scan, on every pass. A profile of an editing session — the notepad's real
  path, where a keystroke re-evaluates the document — put that one lookup at about
  a quarter of the whole re-evaluation, the single largest cost in it.
  
  Positions do not move between structural edits, so the lookup now reads a
  cached ordered-id array and is an array index. The cache is built in the same
  pass as the existing lineId→position map and invalidated with it, so an insert
  or a delete rebuilds it and an ordinary keystroke, which changes a line's text
  but moves no line, leaves it standing.
  
  Measured on a 300-line document heavy with cross-line forms, a hundred edits
  each followed by a re-evaluation, old and new run alternately in one process:
  
  | build | median | fastest |
  | ---   | ---    | ---     |
  | before | 151.4 ms | 146.1 ms |
  | now    | 121.6 ms | 115.4 ms |
  
  About 18 to 20 per cent off the re-evaluation an edit triggers, stable across
  runs and never slower.
  
  The boundary: this is the lookup, not the work. The aggregates still read the
  lines they cover and the VM still executes them; what is gone is the tree walk
  that stood between a position and its line. The batch `parseDocument` path,
  which reads lines by position too, gets the same lookup for free.
  
  ## Verification
  
  5 new tests in `DocumentOrderCache` pin that `getLineAt` and `getLinePosition`
  round-trip on a fresh document, that a text edit leaves the order standing (same
  line id, same position), that an insert and a delete each rebuild it, and that a
  run of structural and text edits stays consistent throughout. The engine suite
  is green, and the differential fuzz of documents, expressions and bytecode
  reports 0 disagreements, since the cache returns exactly what the tree did.

## 2.38.26

### Patch Changes

- 9c9d6be: The pipeline stages run direct when allocation tracking is off
  
  `AllocationTracker.track` wraps a pipeline stage to measure its time and heap,
  and it is off in production. Wrapping still cost two allocations on every
  evaluation whether or not it was on: the closure passed to `track`, built at the
  call site before `track` can decide anything, and the result object `track`
  returns. The lexer, parser and VM stages now call through directly when tracking
  is off, and wrap only when it is on.
  
  Nothing a caller sees changes, and the tracked path is untouched: when tracking
  is on, the stage is wrapped exactly as before and reports the same allocation
  figures. This is a reduction in the garbage a single evaluation makes, not a
  change to what it computes.
  
  | workload                                  | before   | now      |
  | ---                                       | ---      | ---      |
  | 6,000 distinct expressions, evaluated 4x  | 136.3 ms | 133.6 ms |
  
  About one per cent of wall time on the single-expression path, and never
  slower; the larger effect is on the garbage collector over a long session,
  which a short benchmark understates.
  
  The boundary: this removes the wrapper allocations, not the stage work. It is
  the companion to the profile's other allocation findings; the builder's
  `build`/`reset` were looked at and left alone, since a pooled builder already
  resets without reallocating and the bytecode it builds must own its buffers
  because the program is cached (#464).
  
  ## Verification
  
  The allocation-tracker and diagnostic-pipeline suites pass, so the tracked path
  still measures each stage; the engine suite is green; and the differential fuzz
  of documents, expressions and bytecode reports 0 disagreements, since the change
  is which object the stage's result travels in, not the result. Closes #463.

## 2.38.25

### Patch Changes

- 75b43f8: A single expression no longer touches the dependency graph
  
  `evaluateExpression` routes through `evaluateLine(-1, ...)`, where line -1 is
  the sentinel for "no document position". The dependency graph connects lines
  across a document, so an edge from a line that has no position and no siblings
  connects nothing any reader consults, yet every single-expression evaluation
  paid to scan its tags and register that edge. A profile of the pipeline put it
  at about a tenth of the single-expression path, spent on a graph nothing reads.
  
  Line -1 now skips the registration.
  
  | workload                                  | before   | now      |
  | ---                                       | ---      | ---      |
  | 6,000 distinct expressions, evaluated 4x  | 146.4 ms | 132.5 ms |
  
  Measured by running the old and new builds alternately in one process, and
  stable across runs: about 10% off the single-expression path, never slower.
  
  The boundary. This is the single-expression path only. A document evaluates in
  positive line numbers through the incremental evaluator, which reads the graph
  to decide what an edit affects, so its registration is untouched. The graph's
  other readers work in positive line numbers too: `evaluateLine(n, ...)` and
  `evaluateIncremental`. A broad version of this change, skipping registration
  whenever there was no document, was measured to break nineteen of them before it
  was narrowed to line -1 exactly. Two things a single expression does still rely
  on are kept: variables accumulate across calls through the VM, not the graph, so
  that is untouched, and the async data-source dependency that a pending value's
  arrival reads is registered separately and stays.
  
  One reachable difference, deliberate. The language service builds its
  completion namespace from the graph, and does not filter by line, so a variable
  defined only through `evaluateExpression` used to appear as a completion because
  line -1 leaked its edge in. It no longer does. The variable still evaluates;
  it is simply not part of the document's completions, which is what that feature
  is for, and the namespace a real notepad offers is built from its document
  (positive lines) and is unchanged. A consumer wanting single expressions in the
  list passes its own `variableNameSource`.
  
  ## Verification
  
  4 new tests in `ASingleExpressionSkipsTheGraph` pin that variables still
  accumulate across `evaluateExpression` calls (including across a read-only line
  and a line that writes nothing), that an error is still a value and a failed
  definition leaves the name as the lines above left it, that the graph is left
  empty for line -1 so the cost cannot creep back, and that the completion
  namespace is the document (a line-defined variable is offered, a
  single-expression one is not). The engine suite is green
  (the language-service, `evaluateIncremental` and cache-coherence suites, which
  exercise the graph without a document in positive line numbers, all pass), and
  the differential fuzz of documents, expressions and bytecode reports 0
  disagreements.

## 2.38.24

### Patch Changes

- e66415d: A line moved by a structural edit drops its answer below the viewport
  
  The incremental evaluator keeps a line's last answer so scrolling back to it
  costs nothing. An insert or a delete moves every line below it to a new
  position, and the answer such a line still holds was computed for where it used
  to sit. While the moved line stays below the viewport nothing re-runs it, so it
  went on showing that answer, and a line that reads its position read it back as
  a real value:
  
  ```solve-doc
  :x = 1
  :x = line 4 + x
  ```
  
  with `:x = 3` inserted above a trailing `x + 1`, viewed on lines 1 to 3:
  
  | line                | before                  | now                                                                     |
  | ---                 | ---                     | ---                                                                     |
  | `:x = line 4 + x`   | `Line 4 has an error`   | `Line 4 has not been evaluated yet (forward reference, or out of range)` |
  | `x + 1` (moved to 4) | the error it held at line 3 | no answer, until the viewport reaches it                            |
  
  A fresh pass driven to the same viewport never reaches line 4, so it reports
  that line 2 has not been evaluated yet and shows nothing on line 4. The
  incremental path now agrees: a moved line's answer is cleared on the next pass,
  once the viewport is known, for the moved lines that sit below the range that
  pass runs. A moved line inside the range re-runs from its cached bytecode and
  gets its answer straight back, so nothing a reader sees flickers.
  
  The boundary. The clearing is below the viewport only. A line that moved ABOVE
  the viewport keeps its answer, and that is not this bug: the incremental path
  shows a line scrolled off the top the answer it last computed, where a fresh
  pass driven straight to that viewport would not have reached it, and that
  difference is the scroll cache doing its job. It is the same with or without a
  structural edit in the way, and a fresh pass still shows a definition above the
  viewport through the checkpoint chain, so blanking one would be a divergence of
  its own. This change is only about the answer a moved line holds below the
  viewport, which a fresh pass genuinely never has.
  
  ## Verification
  
  7 new tests in `ALineThatMovedDropsItsAnswer` drive an edited session and a
  fresh pass to the same viewport and compare every line: the reported case, its
  healing as the viewport reaches the moved line, a position-independent line
  below the viewport, a positional reader that reads a line moved out of view, a
  delete, a scrolled viewport, and two that pin a definition above the viewport is
  not over-cleared. The engine suite is green, and the differential fuzz of
  editing sessions, expressions and bytecode reports 0 disagreements. The fuzzer's
  whole-document oracle settles on a full viewport, so it did not exercise this
  viewport-limited shape; teaching it to compare at a limited viewport without
  mistaking the scroll cache for a fault is tracked separately.

## 2.38.23

### Patch Changes

- 0ba29de: The evaluation pipeline allocates less per line
  
  A CPU profile of the pipeline end to end, over six thousand distinct
  expressions and a four-hundred-line document, showed two pieces of per-line work
  that the common case does not need, each running on every expression and every
  document line the engine evaluates.
  
  The tag scanner ran two regular expressions and allocated two arrays for every
  line, to find the `#food` category tags on it. A line with no `#` on it carries
  no tag, and most lines are that, so it now takes a single `indexOf` and returns
  before the regexes: the same empty result the scan produced, without the scan.
  The front half of an evaluation copied the token array to drop comment tokens,
  on every call, though the lexer has already dropped them by the time the tokens
  arrive; the copy is now taken only when a comment token is actually present,
  which no current caller produces. Neither changes what the engine computes: a
  line that does carry a tag takes the same scan it always did, and a token stream
  that does carry a comment is filtered exactly as before.
  
  Measured by running the old and new builds alternately in one process, sixty-one
  rounds of the mixed workload above:
  
  | build | median | fastest |
  | ---   | ---    | ---     |
  | before | 146.4 ms | 139.0 ms |
  | now    | 141.0 ms | 134.8 ms |
  
  About two to three per cent, and never slower across runs. The boundary is what
  that number is: this removes allocation, not algorithm, so it lightens the
  garbage the pipeline makes rather than the lexing, normalising, parsing and
  executing that dominate it. The largest remaining cost the profile found, the
  normaliser trying its rules at each token position, is a structural change and
  is not this one.
  
  ## Verification
  
  Four new tests in `TagScanner` pin that the `indexOf` exit returns what the full
  scan returns, for a line with no tag, a member tag, an aggregate query and a
  line's own leading tag; the comment path is already covered by
  `lexer/Comments` and `Issue180`. The engine suite is 470 suites, 9,048 tests
  passing and 4 skipped under `npx jest`. The differential fuzz of editing
  sessions, expressions and bytecode (`npm run fuzz`) reports 0 disagreements, so
  neither change moves a single answer on any of the three entry points.

## 2.38.22

### Patch Changes

- 76e671f: A line on a cycle runs the way a single fresh pass runs it
  
  Two lines that depend on each other have no answer of their own: each value
  one could hold is computed from the other's, and there is nothing to start
  from. The batch pass (`parseDocument`) has always said so, because it never
  runs a line twice: a member reads the line below it as not yet evaluated, and
  reports that. The incremental path ran its members again and again, and from
  the moment an edit or a pinned definition lent the cycle a number it chased it
  for as long as the note was open. #444 records seven attempts at this; each
  changed what a positional read returns, or when an answer is thrown away, and
  each traded the fault for one of the same size somewhere else.
  
  Eight passes after each action below, main was still climbing; now every line
  on the cycle reports it in the batch pass's words, and stays there:
  
  | document                                      | action                          | before                                  | now                                                                                                |
  | ---                                           | ---                             | ---                                     | ---                                                                                                |
  | `1 sprint = 2 weeks` / `prev + 5`             | line 1 to `line 2 + 5`          | `80`, `85`, ten larger a pass           | `Line 2 has not been evaluated yet (forward reference, or out of range)`, `Line 1 has an error`    |
  | `:v0 = v2 + 8` / `:v2 = 18` / `:v2 = v0 + 8`  | typed out                       | `218`, `18`, `226`, sixteen larger a pass | `Undefined variable: v2`, `18`, `Undefined variable: v0`                                          |
  | `:v3 = 44` / `:v3 = v3 + 3` / `v3`            | line 1 to `7 + 7`               | `14`, `71`, `71`, three larger a pass   | `14`, `Undefined variable: v3`, `Undefined variable: v3`                                           |
  | `spent += 9` / `9 #food`                      | `spent += line 2` inserted above | `72`, `81`, `9`, nine larger a pass    | `Line 2 has not been evaluated yet (forward reference, or out of range)` on both steps, then `9`   |
  | `f(x) = x + 4` / `f(9)`                       | line 1 emptied                  | `13`                                    | `Undefined function: f`                                                                            |
  | `:x = 5` / `x + 1`                            | line 1 to `:x = zz + 1`         | `6`                                     | `Undefined variable: x`                                                                            |
  
  The rule that closes all of them is the spreadsheet's, and it is what a single
  fresh pass already does: **a line that sits on a cycle runs the way a fresh
  pass runs it**, with every name it reads holding what the lines above left and
  every line below it counted as not yet evaluated. No member ever computes a
  number for another to read, so both paths report the cycle in the same words,
  and the words no longer depend on whether the text was typed out, inserted, or
  edited into place. Which lines sit on a cycle is recomputed only when the
  dependency graph changes, following positions, names and running totals alike,
  so a document with no cycle in it pays nothing per pass.
  
  Three things had to hold before that rule could be checked at all.
  
  The graph knows what a line reads now, not what it read last time. A
  positional edge was discovered while a line ran and then pinned, so a position
  the line stopped reading could not be un-discovered: `prev + 1` edited to `7`
  still read line 1 as far as the graph knew, and `total above` kept its edges to
  the lines above a heading that had cut its block short. An edited line's
  positions go before it runs, a run cuts a line's positions back to the ones it
  read, and an aggregate (`sum(line 2 : line 6)`, `total above`, `total of
  #food`) declares its whole span before reading any of it, since the walk stops
  at the first line it cannot use and a cycle that closes through a later one
  must still be known. A goal seek takes a positional edge to its target, the way
  `line N` does.
  
  When a definition runs, each name it writes holds what the lines above left.
  `:v3 = 44` above `:v3 = v3 + 3` is 47 on every fresh pass because line 1 puts
  44 back first; edit line 1 away and nothing did, so line 2 read its own answer
  and climbed by three a pass. A definition is put back to the prefix before it
  runs, and again if it fails (a throw, or a line that does not compile; an
  answer that is an error is a value and is stored like one). The prefix comes
  from the checkpoint chain, which records what each line wrote in document
  order, and which now drops the entry of a line that stopped writing and
  replaces the entry of one that threw. A function is a definition too: the
  engine can unbind one, and does when its defining line is edited away or
  deleted.
  
  A goal seek's unknown is neither a read nor a write of the document. `solve
  line 2 for v1 = 27` varies `v1` inside the seek's own call frame and stores
  nothing; claiming the write held the name open after the `:v1 = 7` above it
  had been edited into the seek, so `v1 + 7` went on answering `14` where a fresh
  pass says `Undefined variable: v1`. The 2.38.21 note drew its boundary at a
  seek that runs still defining its variable; that boundary moves, because the
  seek never defined it. That note's other change, dropping the declared write of
  a definition that answered with an error, is reverted: a running total whose
  step failed recorded no write, so the reseed that re-runs every total each pass
  never found it again, and it stayed on the error after the line it read had
  been fixed.
  
  An adversarial review of the change (three readers over the diff, three probes
  past what the generator writes, two verifiers on every finding) found five more
  things, three of them introduced by the first version of this change, and each
  has a test now. A range declares only the part of its span the document has:
  `sum(line 1 : line 3000000)` declared three million positions and exhausted
  the heap, where the walk that reads them had always stopped at line 4. The
  document's length is asked for each time rather than copied into the context,
  since a copy taken before an insert cut `sum(line 4 : line 5)` a line short
  and hid the cycle through line 5. A member's positional edges follow its run
  like any other line's, now that every aggregate declares its span; keeping a
  member's forward edges regardless kept an edge to a line it had stopped
  reading, and that phantom cycle outlived the real one. The checkpoint chain
  follows the lines through a structural edit instead of being cleared by one: a
  clean line above the viewport never runs again to put its entry back, so
  `:a = 5` above the viewport was reported as `Undefined variable: a` by the
  definition under it. A definition scrolled out of view runs under the same
  discipline as one in view, put back before it runs and put back if it fails,
  where it used to keep its old value out of view, and to climb by its step every
  pass if it read its own name. And a name bound as both a function and a
  variable (`f(x) = x + 4` above `:f = 9`) has each binding put back on its own,
  including when its line is emptied, where stopping at the function left the
  variable holding what the edited line wrote. One wording change came out of the
  same review: a goal seek that names its own line is refused as a seek
  targeting a seek, rather than as a line that does not use its variable.
  
  The boundaries. A pinned cycle that used to converge on the incremental path
  reports the cycle now, as the batch pass always did: `:v3 = v2 + 7` / `:v2 =
  line 1 + 8` / `:v2 = 31` settled at `38`, `46`, `31` and gives `Undefined
  variable: v2`, `Line 1 has an error`, `31`, because a line that depends on
  itself has no answer of its own whatever a pin lends it. A plain forward
  reference is untouched: `line 2 + 1` above `7` is still `8`, and `x + 1` above
  `:x = 5` is still `6`, since neither line depends on itself. A column of
  running-total steps is not a cycle: each step depends on the steps above it,
  never on those below. And one wording difference between the paths is older
  than this and stays: where the member a line reads is a definition that
  failed, the incremental path says `Line 1 has an error` and the batch pass,
  which stores no result for an errored line, says `Line 1 has not been evaluated
  yet`. And the bookkeeping has a cost on a document with no cycle in it: a pass
  over a 1,000-line document of mixed shapes took 4.5 ms against 3.8 ms before,
  measured in alternation on the same machine, a sixth more.
  
  ## Verification
  
  Five specs, 69 new tests: `AnOrdinaryEditIntoAPositionalCycle` (26: the edit
  shapes, the goal-seek cycle, the shrunk and re-grown block, and the
  from-scratch answers and pass counts of eight shapes, taken from the batch
  pass), `ACycleThroughANameReportsIt` (18: cycles through a name, a running
  total and a function, a pinned cycle, a viewport pass, a long history of
  edits, a name bound as both a function and a variable, the phantom cycle, the
  range declared after an insert), `ALineThatErroredDefinedNothing` (13 more: a
  failed definition, a redefinition, a same-line pair, a failed total step
  re-seeded once its input is fixed, and the prefix out of view and across a
  structural edit), `PositionalEdges` (11 more, for the graph, among them the
  span cut to the document) and `GoalSeek` (1). The two skipped #444 tests run
  again, and the cycle example on the line-references page proves both its
  lines. The full run (`npm run test:full`, the counts in `testStats.json`) is
  478 suites, 9,434 tests, 4 skipped; the engine's own `npx jest` is 470 suites,
  9,044 tests.
  
  The differential fuzz of editing sessions (`npm run fuzz --
  --generator=document`) had its generator widened with a definition that reads a
  position or another name, a definition that fails, a total that reads a
  position, and a user function. Over the same ten ranges of 300 sessions,
  unmodified main reports 110 findings and this change reports 0. Eight further
  ranges of 300, never run against the code before, report 0; one of them (seed
  60000091) reported the copied line count above before it was fixed, and the
  review's own probe ran six more document ranges, 500 expression cases and 500
  bytecode cases at 0.

## 2.38.21

### Patch Changes

- 6939b32: A goal seek that could not run stops holding its variable open
  
  The write set recorded on a line comes from its compiled form, which says what
  the line *would* assign. Goal seek is where that parts company with what
  happened: `solve line 5 for v1 = 22` compiles as a line that writes `v1`, and
  when there is no line 5 it assigns nothing and reports so.
  
  That recorded write is what the end-of-pass settle asks when deciding whether a
  name is still defined by anyone. A line claiming a write it never made held the
  name open, so the value from a definition that had been edited away stayed in
  the engine:
  
  | document                                                       | before                   | now                      |
  | ---                                                            | ---                      | ---                      |
  | `v1 * v2` / `solve line 5 for v1 = 22` / `prev + 3` / `69 + 2` | `Undefined variable: v2` | `Undefined variable: v1` |
  
  Both are errors, which is what let it survive: the line was wrong about *which*
  name was missing, because `v1` still held `44` from a definition no line made any
  more. A pass over the same text has never seen that value and says `v1`.
  
  A pending value still counts as a definition. It has not failed, it has not
  arrived, and forgetting the name while it loads would leave every reader of it
  undefined in the meantime.
  
  Found by the differential fuzz of editing sessions, once its generator was
  taught the cross-line forms: goal seek, line ranges (`sum(line 1 : line 3)`) and
  markdown table columns. Those are the forms that carry the most state between
  passes, so they are the ones most worth driving through an editing session, and
  this was the first thing they found.
  
  ## Verification
  
  5 new tests: the failing goal seek no longer holding its variable, the write set
  it records being empty, a goal seek that *does* run still defining its variable,
  an ordinary definition untouched, and a definition that still stands not being
  forgotten because a later line failed.

## 2.38.20

### Patch Changes

- 956dcca: `det` of a matrix with no rows answers instead of leaking a TypeError
  
  `determinant` accepts a 0x0 matrix, because it is square, and then took the
  integer route, which ends by reading the last pivot at `rows[n - 1][n - 1]`.
  With no rows that is `rows[-1]`, so the host was handed `Cannot read properties
  of undefined (reading '-1')` as an `UNEXPECTED_ERROR`: a raw JavaScript
  exception wearing an engine error's clothes, which is the one thing the VM's
  contract says cannot happen.
  
  | input          | before                              | now |
  | ---            | ---                                 | --- |
  | `det` of a 0x0 | `UNEXPECTED_ERROR` from a TypeError | `1` |
  
  One is the empty product, and it is not a new opinion: the numeric and symbolic
  routes already returned `1` for the same matrix, since their elimination loops
  do not run and they return the `1` they started from. The integer route was the
  only one that disagreed, and it disagreed by crashing.
  
  The boundary: no expression can build such a matrix. A literal `[]` is refused
  for having no shape, and there is a test asserting that, so the day it becomes
  constructible the same page says what the answer should be. The VM is reachable
  without the parser, through bytecode and through plugins, and its promise not to
  leak an exception is made to those callers too.
  
  Found by the bytecode fuzzer in a six-opcode program: build a 0x0 matrix, call
  `det`. The case is in the regression corpus.
  
  ## Verification
  
  5 new tests: no `UNEXPECTED_ERROR`, the empty product as the answer, a one-cell
  matrix unaffected, a singular matrix still exactly zero, and the literal `[]`
  still refused.

## 2.38.19

### Patch Changes

- 3b57566: An insert or a delete that creates a positional cycle reports it
  
  A line that reads a position (`prev`, `line 7`, a range, the `above`
  aggregates, a table column) is marked dirty when an insert or a delete moves
  what that position holds. That says it must run again. It does not stop another
  line reading what it said in the meantime, and what it said was about a document
  that no longer exists.
  
  | document                    | action                | before  | now                   |
  | ---                         | ---                   | ---     | ---                   |
  | `:v = 46` / `average above` | insert `line 3 + 5`   | `54.75` | `Line 3 has an error` |
  
  The inserted line reads line 3, and line 3 averages the block above it, which
  now contains the inserted line. Given a value to start from, the two chased each
  other by a smaller amount each pass, so `54.75` was not an answer at all, it was
  a snapshot of an unfinished iteration: the same document left alone gave a
  different number every pass. A structural edit now takes those lines' answers
  with it, so neither has anything to chase, both report the cycle, and the
  document is still.
  
  Only the lines that read a position, and only on a structural edit. An ordinary
  edit leaves every position meaning what it meant, so a reader's answer is still
  about this document, and taking it away would show an error to whoever asked
  before it ran again.
  
  Two wider rules were tried against the differential fuzz and both made it worse,
  which is why the narrow one shipped. Refusing to read a dirty line at all fixed
  the cycle and traded it for `total of #food` reporting the tagged line below it
  as unevaluated. Forgetting the answers of every reader of every changed position
  produced six times as many disagreements as it fixed.
  
  The boundary, measured rather than assumed: a cycle an *ordinary* edit creates is
  not covered, because this is keyed to the structural change. Over 3,200 random
  editing sessions it is now the only shape the fuzz reports, at roughly one
  session in six hundred, down from every kind of positional staleness before.
  
  The fuzzer's oracle changed with it. Both sides now run until their answers stop
  moving rather than for a fixed three passes, because a forward reference resolves
  one hop per pass and a fixed count reported the oracle's own impatience as an
  engine fault.
  
  ## Verification
  
  7 new tests: an insert and a delete each reporting the cycle, the document
  staying still over eight further passes, a cycle written from the start still
  reported, an aggregate below an insert still answering, an ordinary edit keeping
  its reader's answer, and a document with no positional reader untouched.

## 2.38.18

### Patch Changes

- a69fcf5: Constructing an engine no longer builds an event stream nobody asked for
  
  `AsyncResolutionBatcher` created its `ReadableStream` in its constructor, so
  every engine built one whether or not anything ever read it. A `ReadableStream`
  is not free to build: its start algorithm queues promise reactions, and those
  are only collected once the host yields to the microtask queue. A host that
  builds engines in a synchronous loop, a batch job, a test suite, a server
  rendering many documents in one turn, never yields, so the reactions accumulated
  for the length of the loop.
  
  | engines built in one synchronous loop | before  | now    |
  | ---                                   | ---     | ---    |
  | retained per engine                   | 12.5 KB | 0.1 KB |
  | 6,400 engines                         | 78 MB   | 0.8 MB |
  
  Measured with `--expose-gc`, forcing a collection either side, so the figures
  are what survives collection rather than what has yet to be collected.
  
  The stream is built on first use now, and *use* is deliberately wider than
  *subscribe*. The stream buffers up to its high-water mark with no reader
  attached, so a consumer that subscribes after some events have already flowed
  still receives them. Building it only when someone subscribes would have dropped
  exactly those, so the emit path asks for it too. An engine that never resolves
  anything asynchronously and never subscribes is the only one that never builds
  it, which is nearly all of them.
  
  Nothing about delivery changed: the same events reach the same consumers in the
  same order, a cancelled stream is still not rebuilt, and `clear()` still leaves
  the batcher able to serve a new subscriber. `listenerCount` answers without
  building a stream to answer with, since it is asked by hosts deciding whether to
  subscribe at all.
  
  ## Verification
  
  6 new tests asserting an engine builds no stream on construction, none after an
  ordinary expression, one as soon as a consumer asks, the same one every time, a
  listener count that does not create one, and a thousand engines in a synchronous
  loop leaving no streams behind. The batcher's own 67 stream and delivery tests
  cover the behaviour that had to stay the same, including a subscriber that
  arrives after the event it wants.
  
  Found by a differential fuzz of the incremental evaluator: it constructs an
  engine per case and died of this on a 256 MB heap.
- 0095ab0: The fuzzer can now edit a document and check the answers
  
  The two generators the fuzzer had both ask the same kind of question: does the
  engine survive this input. They corrupt an opcode stream, or write a line of
  source, and a run passes when nothing crashed, hung or threw. Neither can catch
  the engine being wrong, because neither has anything to be right against.
  
  A third generator does. It builds a document, drives it through a session of
  editor actions (change a line, insert one, delete one, move the viewport), and
  after every action compares every line against a pass over the same text with no
  editing history behind it. That pass is the answer the document has, so anything
  a host does to reach the same text has to agree with it, line for line. A
  mismatch is reported as a new outcome kind, `disagreement`, and it is the one
  failure here that does not look like a failure: the engine returned, promptly,
  without throwing, and gave a different answer than it gives when asked the same
  question twice.
  
  Two things about the comparison are load-bearing, and both were learned by
  getting them wrong. The oracle has to be **settled**, since a whole-document
  feature can need more than one pass to reach its answer, and comparing against a
  single pass reported sixty disagreements that were nothing but the oracle being
  read too early. And both sides need the **same number** of passes, or the run
  stops measuring correctness and starts measuring which of them converges faster.
  
  The shapes it generates are narrower than the grammar allows, on purpose. A case
  is only useful if a settled pass has an opinion about it, so every line is
  something that evaluates, and the interesting ones reach across lines: a name
  defined on one line and read on another, a running total, a category tag, a line
  reference, a unit definition. Anything whose answer is not a fixed function of
  the text (a dice roll, a live rate, a date relative to now) is left out, since a
  fuzzer whose oracle disagrees with itself reports nothing but its own noise.
  
  The findings are signed by their input rather than by their wording, unlike
  every other kind. The wording does distinguish them, but only through the two
  answers, and the signature normalisation replaces every quoted fragment and
  number, so one wrong answer would otherwise silence every other.
  
  The soak now splits its wall-clock budget between the generators instead of
  giving them one deadline to queue behind. A document case replays a whole
  session and builds a settled oracle after every action, so it costs what
  thousands of expression cases cost, and under a single deadline the cheap
  generator at the front of the list spent the entire run.
  
  ## What it found
  
  Three bugs before it was even committed, each after the one before it was fixed:
  a variable whose defining line was gone, a user unit whose defining line was
  gone, and a line edited into a heading never withdrawing what it used to define.
  All three are released. A fourth is open, and this generator found it in sixty
  cases: a `line 5` reference is not re-evaluated after an insert or a delete
  moves what position five holds.
  
  It also found a memory fault by dying of one. Constructing an engine per case
  exhausted a 256MB heap, which turned out to be a `ReadableStream` built by every
  engine whether or not anything read it.
  
  ## Verification
  
  12 new tests covering the generator and the oracle: a seed always meaning the
  same session, a session that agrees reporting nothing, an action past the end of
  a shortened document being skipped rather than throwing, a delete never taking a
  document below two lines, and a shrink that renumbers its actions when it drops
  a line, so a reduction is still the same session it started as.
- 3af108b: A line reference follows the position after an insert or a delete
  
  `line 5` names wherever line five happens to be, so inserting a line above it
  changes what it refers to without changing a character of the line doing the
  referring. The same is true of `prev`, which names a different neighbour, and of
  the `above` aggregates, which cover a different block. None of that reached the
  invalidation a structural edit performs, which followed the names a deleted line
  wrote and nothing else, so a positional reader kept the answer it had computed
  about a position that now holds something else.
  
  | document            | action           | before | now                             |
  | ---                 | ---              | ---    | ---                             |
  | `10` / `line 1 + 5` | insert `20` at 1 | `15`   | `25`                            |
  | `line 2 + 4` / `10` | insert `5` at 1  | `14`   | `Line 2 has not been evaluated` |
  
  Every positional reader is re-run, not only the ones whose target moved. The
  second row is why: `line 2 + 4` at position 1 is an ordinary reference, and the
  insert leaves the same text at position 2, referring to itself. That is not
  visible from the target alone, and positional readers are a small minority of a
  document's lines, so re-running all of them costs almost nothing and cannot be
  wrong.
  
  A line also refuses to read its own position now, rather than being handed its
  own previous result. From scratch that never came up: a line's result is not
  there yet when it runs, so reading its own position gave nothing and the line
  reported it. Only a structural edit could produce a self-reference that already
  had a perfectly good value, from when it meant something else.
  
  Refusing it closed a disagreement between the entry points as well. A
  self-reference used to report `Line 1 has an error` through `evaluateDocument`,
  which is what a line says when the line it read holds an error, and `Line 1 has
  not been evaluated yet` through `parseDocument`, which is what the case actually
  is. Both give the second sentence now.
  
  The boundary: this is about a position's meaning changing, not about evaluation
  order. A plain forward reference still resolves the way it always has on the
  incremental path, which reaches its answer by running the document again rather
  than in one sweep.
  
  ## Verification
  
  8 new tests: a reference following an insert and a delete, a reader shifted onto
  itself, a self-reference written as one, the two entry points agreeing on it,
  `total above` and `prev` following their block after an insert, and a document
  with no positional reader left untouched.
  
  Found by the differential fuzz of editing sessions, which now covers line
  references and positional aggregates: it reported this in the first sixty cases
  it ran.

## 2.38.17

### Patch Changes

- cf0189e: A line edited into a heading stops defining what it defined
  
  A heading, a comment or a blank line has nothing to evaluate, so the evaluator
  skips it before anything is compiled. That is the right thing to do and it went
  one step too far: a skipped line never reached the registration that tells the
  dependency graph what it writes, so the edges it had before the edit stood. A
  line that used to be a definition went on defining for the rest of the session.
  
  | document                     | action                  | before | now                     |
  | ---                          | ---                     | ---    | ---                     |
  | `:x = 12` / `x + 4`          | line 1 to `# a heading` | `16`   | `Undefined variable: x` |
  | `:x = 12` / `x + 4`          | line 1 emptied          | `16`   | `Undefined variable: x` |
  | `1 sprint = 3 weeks` / `3 sprints in weeks` | line 1 to `# a heading` | `9 weeks` | `Undefined` |
  
  A dirty line that turns out to have nothing to evaluate now registers writing
  nothing, which is what withdraws the edges, and drops any unit it had defined.
  Only a dirty one: a line that was already a heading has nothing to take back, and
  re-registering every heading on every pass would cost a document its headings in
  work each time.
  
  The wording of an error was the tell. `v3 * v0` with `v3` left standing gets past
  its first name and reports `v0` as the undefined one, where a pass over the same
  text reports `v3`. Both are errors and both look reasonable on their own, which
  is exactly why a settled pass, rather than a plausible-looking answer, is what
  the fuzzer compares against.
  
  A related fix rides with it: a user unit is now keyed by the persistent id of the
  line that defined it rather than by the line's position. Positions move, so
  deleting a line above a definition renumbered it and a removal keyed on where it
  used to sit matched nothing.
  
  ## Verification
  
  7 new tests: a heading and an emptied line each leaving the readers undefined,
  the first-undefined-name wording, a clean heading withdrawing nothing across four
  passes, a unit definition edited into a heading, and a unit surviving a delete
  above it before going with its own line.
  
  Found by the same differential fuzz, and it closes it. Across 2,000 random
  editing sessions and 19,200 whole-document comparisons the incremental evaluator
  now agrees with a settled pass on every line, with no disagreement of any kind
  remaining, where the run that found this one reported seven.
  
  9,315 tests in 469 suites.
- e60df59: A name whose defining line is gone reads as undefined
  
  The VM's variable store only ever accumulated. Nothing removed a binding when
  the line that created it was deleted or edited into something else, so the value
  outlived the document:
  
  | document            | action            | before | now                     |
  | ---                 | ---               | ---    | ---                     |
  | `:x = 12` / `x + 4` | delete line 1     | `16`   | `Undefined variable: x` |
  | `:x = 12` / `x + 4` | line 1 to `5 + 5` | `16`   | `Undefined variable: x` |
  
  Both survived any number of further passes: nothing ever removed the name.
  
  The dependency graph already knew. It drops a line from the producers of a key
  it no longer writes, so a key with no producers left is a name no line defines.
  It reports those now, and the engine acts on them: the value leaves the VM, and
  the checkpoint chain is told as well, since it records what each line wrote and
  would otherwise put the name back on the next restore.
  
  The decision is made once, at the end of a pass, and made against the document
  rather than the graph. Both halves of that are load-bearing. A line holding
  several inline expressions registers once per expression, so the one that
  defines a name is followed by one that does not; and the engine registers a line
  before the pass records that line's results, so its recorded write set is a pass
  behind. Either would answer wrongly mid-pass. And the graph itself cannot be
  asked afterwards, because a structural edit clears it and a viewport leaves the
  lines outside it unregistered, while a line's recorded write set survives both.
  
  The consequence is that the name is forgotten at the end of the pass that
  removed its definition, so the lines that read it show their new answer on the
  pass after that. An editor makes one anyway, and every way of making it sooner
  answers the question before it can be answered.
  
  The boundary: without a document there is no such authority.
  `evaluateExpression` reuses line numbers across independent calls, so
  re-registering line 1 replaces its edges every time, and variables accumulating
  across calls is that path's whole contract. It is unaffected.
  
  A user unit is not covered. `1 sprint = 2 weeks` lives in its own table rather
  than the VM, and removing its line still leaves the unit defined; that needs the
  table to know which line defined what, and is filed separately.
  
  ## Verification
  
  7 new tests: deleting the definition, editing it into something else, a name
  another line still defines being kept, re-adding it bringing the name back, a
  line holding several expressions keeping what it defines, the single-expression
  path keeping its variables across calls, and a restore not putting a removed
  name back. Found by a differential fuzz against a settled pass.
- cf0189e: A unit whose defining line is gone stops converting
  
  `1 sprint = 2 weeks` registers a unit on the engine, and nothing removed it when
  the line that said so was deleted or edited into something else. The conversions
  below it went on working from a definition the document no longer contained:
  
  | document                                    | action              | before    | now         |
  | ---                                         | ---                 | ---       | ---         |
  | `1 sprint = 3 weeks` / `3 sprints in weeks` | delete line 1       | `9 weeks` | `Undefined` |
  | the same                                    | line 1 to `:v = 47` | `9 weeks` | `Undefined` |
  
  A definition belongs to the line that made it now. A line drops its own
  definitions on the way through being compiled again, so a line that has stopped
  being a definition stops defining, and one that still says the same thing puts it
  straight back. A deleted line never compiles again, so its definitions are
  dropped as it goes.
  
  Losing a unit has to reach the lines that used it, because a unit is expanded
  while a line is compiled and those lines hold bytecode built around it. That
  invalidation is driven by comparing the units in scope before and after a pass
  rather than by counting removals, and the difference matters: a line that
  redefines the same unit on every pass removes and re-adds it every time, so
  invalidating on the removal alone would recompile the document for ever.
  
  ## Verification
  
  6 new tests: editing the definition away, deleting it, a definition that has not
  changed surviving five passes, re-adding it bringing the unit back, one
  definition going while another stands, and the batch pass being unaffected.
  
  Found by a differential fuzz that drives random documents through random editor
  actions and compares every line against a settled pass over the same text. It
  was the last shape reported after the variable half was fixed: over 1,200
  whole-document comparisons the disagreements went from 8 to 4, and the 4 that
  remain are a different shape still being read.

## 2.38.16

### Patch Changes

- a1032e2: A running total is re-seeded after a line is inserted or deleted
  
  `spent += 5` re-applies its delta over whatever the total currently holds, so a
  pass resets each total to its seed and re-runs every line that touches it. The
  step that finds those lines asked the dependency graph what each one writes, and
  a structural edit clears the graph and lets the next pass rebuild it. On the
  pass that follows an insert or a delete the graph therefore answered nothing at
  all, no line was marked, none re-ran, and the totals below the edit kept the
  previous pass's sum:
  
  | document                                       | before | now |
  | ---                                            | ---    | --- |
  | `spent += 7`, with `spent += 2` inserted above | `7`    | `9` |
  
  A line's own write set is recorded on the line and survives the edit, so that is
  what it reads now.
  
  Found by a differential fuzz that drives random documents through random editor
  actions, insert, delete, edit and scroll, and compares every line against a
  settled pass over the same text. Over 900 whole-document comparisons it was the
  last remaining case of two different numbers; what is left after it is the known
  staleness of a definition whose line has been removed, which is filed separately.
  
  ## Verification
  
  5 new tests: an accumulator inserted above another being counted, one deleted
  from the middle no longer counting, a total not growing when the same text is
  evaluated again, several edits in a row each leaving the total right, and two
  totals kept apart. Four of the five fail without the fix.

## 2.38.15

### Patch Changes

- 848326a: A line's answer no longer depends on where the viewport is
  
  `ThreeTierEvaluator` builds a `VMCheckpointer` for itself now, instead of taking
  one as an optional argument that nothing supplied.
  
  The argument was not a preference. A name written on more than one line has a
  value per position, and the VM holds whichever write ran last, so anything
  re-running part of a document read the state the document ENDS in rather than
  the state its own line sits in. `setViewport` has always asked for the right
  state (`restoreTo(startLine - 1)`) and got nothing back, because there was
  nothing to ask:
  
  | `:x = 1` / `x + 100` / `:x = 99` / `x + 200` | line 2 |
  | ---                                          | ---    |
  | evaluated whole                              | `101`  |
  | then scrolled to, before                     | `199`  |
  | then scrolled to, now                        | `101`  |
  
  The answer changed because the reader scrolled to it. A host had to know to
  construct a checkpointer to avoid that, and nothing said so. A caller may still
  pass its own, to share a chain or to inspect it.
  
  ## A checkpoint is replaced, not followed by a truncation
  
  Turning it on exposed a fault in the checkpointer itself, introduced when the
  ordering was fixed in 2.38.11. Taking a checkpoint dropped every entry at or
  after that line, on the reasoning that a pass runs in document order and re-takes
  them as it goes. That holds only for a pass that runs from line 1. A pass limited
  to a viewport re-records the lines it covers and never reaches the definitions
  below its end line, so the chain lost them, and `restoreTo` then reset the VM and
  replayed a prefix that no longer mentioned them.
  
  The result was worse than no checkpointer at all. With no chain the VM only ever
  accumulates, so its failure is a stale number; with a truncated one the restore
  SUBTRACTS, and a line further down reading a dropped definition answered
  `Undefined variable` where it had answered a number. Measured on a document
  defining `top` at line 1 and `mid` at line 25, read at lines 41 to 60, after a
  full pass, an edit, a pass over the first twenty lines, and a scroll to the
  bottom: `509` without a checkpointer, `Undefined variable: mid` with one.
  
  A line's checkpoint is now replaced where it stands, and nothing else is touched.
  Absent is worse than stale here: a stale entry is what the document is showing
  anyway, and the pass corrects it when it reaches that line.
  
  ## Restoring is no longer quadratic
  
  Rebuilding the state at a position walked the chain from the target back to the
  root and assembled it by pushing each entry onto the FRONT of an array, which
  shifts every entry already there. Five thousand definitions meant twelve million
  shifts, on every scroll.
  
  The chain from the root to any checkpoint is exactly the stored array up to that
  index, since each entry is created with the one before it as its parent, so there
  is nothing to assemble: the restore reads the array, and finds where to stop with
  a binary search rather than a scan. On a thirty-line viewport scrolled down a
  document of five thousand definitions that is 1.04 ms per scroll against 0.52 ms,
  and the old shape doubled between two and five thousand definitions where the new
  one barely moves.
  
  ## What it costs
  
  Restoring is work that was not being done at all, so a document made of
  definitions pays for it. Medians of nine, a thirty-line viewport walked down the
  document:
  
  | document                             | before   | now      |
  | ---                                  | ---      | ---      |
  | 2,000 plain lines, no definitions    | 0.146 ms | 0.157 ms |
  | 2,000 lines, a definition every 20   | 0.144 ms | 0.163 ms |
  | 2,000 lines, every line a definition | 0.095 ms | 0.259 ms |
  | 5,000 lines, every line a definition | 0.133 ms | 0.508 ms |
  
  A document that defines little pays almost nothing. The worst case is half a
  millisecond on a document that is nothing but definitions, against a frame of
  about sixteen, and it buys an answer that does not change when the reader scrolls
  to it.
  
  ## Two more the viewport path was hiding
  
  Rewinding the VM reached two faults that were latent while it never rewound.
  
  A `total += 5` line compiles to no bytecode, so a clean one cannot be re-run
  from cache and has to go back through the full pipeline. While the total simply
  stayed where the last pass left it that was harmless; restoring rewinds it, and
  a viewport containing the accumulator lines then had nothing to rebuild them
  from, so `spent += 10` / `spent += 20` / `spent` answered
  `Undefined variable: spent` on a scroll. A scroll re-seeds accumulators now, as
  a pass already did.
  
  And the sentence a definition answers with never goes through the VM's `HALT`,
  which is where a result is copied out of the Value arena, so the line was
  holding a slot the arena hands to a later one. `1 sprint = 2 weeks` read
  `sprint defined` after the pass that made it, and a number from four lines below
  it after the next, in the same object. The three places that produce such a
  sentence route through one helper that copies it while the arena is on. That one
  is not new: it behaves identically before this change, and the unit the line
  declares was never affected.
  
  ## Verification
  
  15 tests comparing an editor's behaviour against a single uninterrupted pass over
  the same text, which is the answer with no re-running in it: every viewport in a
  document that redefines two names, scrolling back and forth, an edit inside a
  narrow viewport, editing a redefinition, inserting and deleting lines, a session
  of seven alternating edits and scrolls checked at every step, the
  viewport-limited pass above, a running total surviving a scroll from two
  different viewports, and a definition and an equation each keeping their own
  sentence. Four more pin the chain: an entry replaced in place,
  the lines below it kept, every entry's parent being the entry before it, and the
  count holding through a partial pass.

## 2.38.14

### Patch Changes

- 1fb48c6: A line re-run when a value arrives reads the state its own position has
  
  When a data source resolves, the batcher re-executes a few lines out of the
  middle of a document against the engine's VM. That VM holds what the last full
  pass left in it, which is the state at the END of the document, and that is the
  right answer only for a name written once. A name written twice has a value per
  position:
  
  | line             | before | now   |
  | ---              | ---    | ---   |
  | `:x = <fetched>` | `7`    | `7`   |
  | `x + 100`        | `107`  | `107` |
  | `:x = 99`        | not re-run | not re-run |
  | `x + 200`        | `207`  | `299` |
  
  The arriving value leaked past the redefinition, because the line that redefines
  `x` was not itself affected and so was not re-run.
  
  `VMCheckpointer` exists to reconstruct that state and was built nowhere: the
  document path constructed its evaluator without one, so `restoreTo` was a no-op
  on every shipped path. It is built there now, and the batch runs as a sweep
  through the document: the VM is restored once to the state just before the
  earliest affected line, then each writing line passed on the way has its
  recorded bindings applied, so a line running at position N sees the prefix
  position N actually has. Restoring once and sweeping costs the chain once rather
  than once per line.
  
  A line that writes updates its own checkpoint in place rather than taking a new
  one, because taking one drops the chain after it and the sweep is about to walk
  through exactly those entries.
  
  ## The chain is flat now, and that is where the cost went
  
  Building it into the document path made a pass over a document of two thousand
  definitions nearly four times slower. Each checkpoint's bindings were created
  with the previous checkpoint's as their prototype, so the chain was as deep as
  the document has definitions, and creating and reading two thousand of those is
  what V8 charges for a prototype chain that long.
  
  Nothing needed the inheritance. `restoreTo` already walked the parent links and
  applied each checkpoint's own keys, which is the same set either way; only one
  query method read the prototype, and it walks the parent links too now. The
  bindings are flat, null-prototyped objects, so a variable named `constructor` is
  still a key like any other.
  
  | a pass over 2,000 lines        | before   | with the chain | flat     |
  | ---                            | ---      | ---            | ---      |
  | no definitions                 | 5.04 ms  | 5.04 ms        | 4.88 ms  |
  | every line a definition        | 6.04 ms  | 23.12 ms       | 6.73 ms  |
  | a definition every 20 lines    | 4.77 ms  | 4.81 ms        | 4.89 ms  |
  | 200 definitions and readers    | 4.56 ms  | 4.93 ms        | 4.78 ms  |
  
  ## The boundary
  
  This makes a re-run of a subset correct. It does not make the evaluator's full
  pass cheaper, which is a different question and was answered separately. A host
  driving the batcher itself supplies no chain and gets exactly the previous
  behaviour, rather than a half-applied sweep.
  
  ## Verification
  
  `AsyncPipelineIntegration.spec.ts` §6 is no longer skipped. It was skipped for
  this fault and its expectation was written against a `LOAD_VAR` that answered
  zero for an undefined name, so it asserted 10 where 15 is correct; both are
  fixed. 12 further tests: the twice-defined document through the batcher with and
  without a chain, the chain carrying an arrived value into the next batch, a
  checkpoint holding only its own line's bindings, a lookup across twenty
  definitions, shadowing, a variable named after an inherited property, and
  updating or applying one checkpoint without disturbing the rest.

## 2.38.13

### Patch Changes

- e722bf4: `getDependencies` says what it answers
  
  `DependencyGraph.getDependencies` was documented as "all variables that a line
  depends on (reads)". It is not. The map behind it is filled only on the branch
  of `registerLine` that stores a write set, so a line that reads a name and
  defines nothing answers with an empty set rather than with what it reads.
  
  That behaviour is deliberate, and pinned by a test: it is what lets a
  redefinition break the old chain rather than depend on itself. It is also a trap,
  and it has been walked into. The async batcher ordered the lines it was about to
  re-run by asking this what each one read, and a line defining nothing answered
  with nothing and got no ordering constraint at all, so `rate * 2` ran before the
  line that fetched `rate` and read the value from before the fetch. That fault
  was fixed in 2.38.11 by asking `getReads` instead; this is the doc that would
  have stopped it being written.
  
  No behaviour changes. The doc block now states the qualifier first, says why the
  behaviour is what it is, names the fault it caused, and points at `getReads` as
  the question almost every caller means.
  
  ## Verification
  
  4 new tests pinning the difference the doc now describes: `getDependencies`
  answering nothing for a line that writes nothing, `getReads` answering whether
  or not the line writes, a pinned data-source key appearing in one and not the
  other, and an unknown line answering empty.

## 2.38.12

### Patch Changes

- b1d467e: A line that reads another line's result depends on that position
  
  The dependency graph indexed names: variables, globals, category tags and data
  sources. The other half of what reads across lines has no name to index.
  `prev`, `line 7`, `sum(line 3 : line 9)`, the `above` aggregates and a table
  column all reach for a **position**, and registered nothing, so nothing asking
  the graph what an edit or an arriving value affects could name them.
  
  They are recorded now, and the visible half is the async path:
  
  | document                        | a rate arrives, before | now       |
  | ---                             | ---                    | ---       |
  | `:rate = 100 USD in EUR`        | updates                | updates   |
  | `prev * 2`                      | stays as it was        | updates   |
  
  The edge is taken where the read happens rather than in each form. Every one of
  those forms reads through the same closure, the per-line context's
  `getLineResult`, so one hook covers all of them and a form added later is
  covered without knowing about any of this.
  
  A positional read is discovered while the line runs, exactly as a data-source
  read is, so it is pinned the same way: the next registration of the line
  recovers its edges from its text, where a position it reached for at run time
  does not appear.
  
  On positions moving, which is the question this was filed to decide: a
  structural edit already clears the whole graph and the next pass rebuilds it,
  and that is what every other edge kind relies on. Keying by position and
  inheriting it is deliberate. A second invalidation policy for one kind would be
  the thing that drifts.
  
  The cost is the recording, and it is paid only by documents that read across
  lines. Measured on a 2,000-line document, one edit, median of nine:
  
  | document                        | before   | now      |
  | ---                             | ---      | ---      |
  | plain lines, no positional read | 1.979 ms | 2.007 ms |
  | a running total every 20 lines  | 12.59 ms | 12.92 ms |
  | every line a `prev` chain       | 2.279 ms | 2.448 ms |
  | every line reading `line 1`     | 2.440 ms | 2.575 ms |
  
  The second row is what made this worth measuring rather than assuming: an
  `above` aggregate re-reads every line back to its boundary on every pass, so
  recording naively cost 55% on that shape. Almost all of those calls describe an
  edge that already exists, and recognising that without building the key, and
  without a map lookup for a reader already being asked about, brought it back to
  the noise.
  
  ## Verification
  
  20 new tests: which positions each form registers, that the edge survives
  re-registration, a line reading itself recording nothing, a repeat recording
  one edge, a run of positions plus one far from it, removal and clearing, keys
  not colliding with a variable or a tag of the same name, an aggregate's reads
  being rebuilt after an edit, a structural edit clearing them and the next pass
  putting them back, and the async path re-running a line that reads by position.

## 2.38.11

### Patch Changes

- 38de291: A value arriving reaches the lines that read it
  
  When a data source resolves, the batcher re-executes the lines the dependency
  graph names for that query key. That set was the direct consumers of the key and
  was never expanded, so a line reading a variable the fetching line defines kept
  the number from before the fetch:
  
  | line                    | before        | now           |
  | ---                     | ---           | ---           |
  | `:rate = 100 USD in EUR` | updates       | updates       |
  | `rate * 2`              | stays as it was | updates too |
  
  until something else re-evaluated the document. The set is now closed over the
  graph: everything that reads what those lines write, and so on.
  
  Expanding it surfaced a second fault in the ordering, which is why the first
  attempt still answered with the old value. The batcher sorts the lines it is
  about to run so producers come before consumers, and it asked
  `getDependencies` for what each line reads. That map is only filled alongside a
  line's write set, so a line that defines nothing answered with nothing, and a
  line that defines nothing is exactly the line whose reads decide where it goes.
  `rate * 2` was ordered before the line that fetched `rate`. The graph now
  answers `getReads`, which is every key a line reads whether or not it writes
  anything, and the sort asks that instead.
  
  The boundary is the VM those lines run against. The batcher deliberately does
  not reset it, so a re-run reads whatever the last full pass left behind, and for
  a name written on more than one line that is the last write rather than the one
  governing the re-run line's position. Reconstructing that prefix needs the
  checkpointer, which nothing on this path builds yet. Positional reads
  (`prev`, `total above`, `line N`) register no edge at all and so still cannot be
  named; that is tracked separately.
  
  ## Verification
  
  4 new tests: a line reading the fetched value being re-run, the same to any
  depth with the values proving the order, a line reading something unrelated
  being left alone, and a cycle between two readers terminating the walk. Two of
  the four fail without the fix, and the depth one fails for both reasons in turn.
- 38de291: VM checkpoints stay in document order
  
  `VMCheckpointer.restoreTo` reads its checkpoint list as a walk through the
  document: it takes the last entry at or before a line, stopping at the first
  entry past it, and replays that entry's parent chain from the root. Both halves
  assume the list ascends, and a re-run appended instead of replacing, so it did
  not.
  
  A document whose lines 1, 2 and 3 each define something, with line 2 edited and
  run again, left the list as `[1, 2, 3, 2]`:
  
  | after editing line 2      | before                      | now         |
  | ---                       | ---                         | ---         |
  | `restoreTo(2)` gives      | the value from before the edit | the edited one |
  | line 2's parent chain     | line 3, which comes after it | line 1      |
  
  So a host restoring to a line read the value from before its own edit, and the
  chain it walked defined a variable from a line that had not run yet.
  
  A line snapshotted again now drops every checkpoint at or after it first, which
  keeps the list ordered and gives the new entry the line before it as its parent.
  Nothing is lost by dropping them: a pass runs in document order, and a line
  running from cache now takes a checkpoint too, so the entries removed are
  re-taken by the same pass as it continues.
  
  That second half was its own hole. Only a line the pass compiled recorded what
  it wrote, so a clean line sitting between two dirty ones left a gap in the
  chain, and the truncation above would have dropped entries nothing put back.
  
  The boundary: this is a fix to a published constructor argument, not a new
  behaviour. `evaluateDocument` still builds its evaluator without a checkpointer,
  so nothing inside the engine restores VM state yet. Making the incremental path
  depend on it is a separate piece of work, and it is what the async and
  positional-edge issues are both waiting on.
  
  ## Verification
  
  10 new tests: the list staying ordered, restoring after a re-run, not defining a
  variable from a later line, the parent chain, a forward pass being untouched,
  re-running the first line, and four through the evaluator covering one
  checkpoint per defining line, a clean line still checkpointing, the chain
  holding the edited value, and repeated passes not growing it. Five of the ten
  fail without the fix.

## 2.38.10

### Patch Changes

- cec887b: Changing a unit definition changes what reads it
  
  `1 sprint = 2 weeks` is expanded while a line is being compiled, so the compiled
  program for `3 sprints in weeks` has the ratio built into it. Editing the
  definition left every line that used it answering the old way:
  
  | step                           | `3 sprints in weeks` | `2 sprints in days` |
  | ---                            | ---                  | ---                 |
  | `1 sprint = 2 weeks`           | `6 weeks`            | `28 days`           |
  | edited to `1 sprint = 3 weeks` | `6 weeks` before     | `28 days` before    |
  | the same edit now              | `9 weeks`            | `42 days`           |
  
  The answer only corrected itself if the reading line was edited too, or
  otherwise made dirty.
  
  The engine already dropped its own compiled-program caches when a definition
  ran, and the comment saying why was right. What it missed is that the
  incremental path keeps a compiled program per line on the document, and that
  copy is the one it executes. Nothing dropped it, so the line stayed clean and
  went on running bytecode compiled against the old definition.
  
  The invalidation is conditional, and that is load-bearing. The handler that
  defines a unit runs every time its line is compiled, which on the incremental
  path is every pass in which that line is dirty. Invalidating unconditionally
  would dirty the document again on each of them, and every pass would recompile
  every line for ever. It fires only when the ratio or the base unit actually
  moved, so a pass after a redefinition settles with nothing left to compile.
  
  The boundary: this is about a definition that changes. A user unit is still not
  a dependency key, so the invalidation is the whole document rather than the
  lines that actually read the name. Definition edits are rare and a document
  recompile is what a keystroke on line 1 already costs, so the coarse answer is
  the right size for the problem; naming the readers would need the compiler to
  report which user units a line referenced, which it does not.
  
  ## Verification
  
  7 new tests: the readers updating, a changed base unit, a reader far below the
  viewport, that an unchanged definition does not re-dirty the document, that
  repeated passes after a redefinition settle rather than recompiling for ever, a
  second definition not disturbing the first, and both document paths agreeing on
  the same text. Four of the seven fail without the fix. `npm run verify:ci`, the
  bundled-consumer contract, and the playground build all pass.

## 2.38.9

### Patch Changes

- 4147375: An edit costs the viewport, not the distance from line 1
  
  A pass runs from line 1 to the end of the viewport, so scrolling down made every
  keystroke more expensive in proportion to how far down you had scrolled, while
  the number of lines actually evaluated never changed. Measured on the built
  package, a thirty-line viewport and one edit inside it:
  
  | lines  | at the bottom, before | now      | at the top |
  | ---    | ---                   | ---      | ---        |
  | 500    | 0.086 ms              | 0.056 ms | 0.045 ms   |
  | 1,000  | 0.158 ms              | 0.091 ms | 0.061 ms   |
  | 3,000  | 0.480 ms              | 0.173 ms | 0.072 ms   |
  | 10,000 | 1.415 ms              | 0.389 ms | 0.083 ms   |
  | 20,000 | 3.004 ms              | 0.847 ms | 0.083 ms   |
  
  Thirty executions in every row. The right-hand column is the same edit made near
  the top of the same document, where the distance is nil, and it is flat before
  and after: it is the walk between line 1 and the viewport that was being paid
  for.
  
  Two changes, neither of which alters what is evaluated or in what order:
  
  A clean line outside the viewport now returns before its text is scanned for
  emptiness and its expressions extracted. Neither can change what happens to a
  line that is neither compiled nor executed, and that line was arriving at the
  end of the dispatch having paid for both.
  
  And the span is walked once, in order, rather than descended into per position.
  The order tree answers a contiguous range in one pass; asking it for each
  position separately was a third of the cost of an edit on a long document. Two
  shapes of that were measured and the slower one discarded: resolving the ids
  inside the document model is 20% faster than handing them back and asking for
  each line individually.
  
  The boundary: a pass still visits every position up to the viewport, so the cost
  is still linear in that distance, with a much smaller constant. Not visiting
  them at all would change what `EvalResult.lines` contains, which is a published
  shape, so it is not done here.
  
  ## Verification
  
  6 new tests covering what must not have changed: the tier counts for a viewport
  at the bottom of a document, that the returned lines still cover every position
  from 1, that a dirty line below the fold is still compiled, that a definition
  above the viewport still reaches a line inside it, that a narrow viewport and a
  whole-document pass agree line for line, and that the span reads in document
  order after lines are inserted. `npm run verify:ci`, the bundled-consumer
  contract, and the playground build all pass.

## 2.38.8

### Patch Changes

- d56de68: A value that cannot be fetched settles, and stops starving the event loop
  
  The re-evaluate loop the async guide tells hosts to write, read the event stream
  and re-evaluate the lines each event names, was unbounded against a resolver
  whose value never becomes ready. Worse than unbounded: every hop of it is a
  microtask, and the microtask queue drains completely before a single timer runs.
  
  Measured against a resolver that always fails, through the documented loop:
  
  | | before | now |
  | --- | --- | --- |
  | rounds before it stopped | 3,000, the test's own cap | 6 |
  | preflights, so fetches started | 1,501 | 4 |
  | did a `setTimeout(..., 0)` armed beforehand fire? | no | yes |
  
  Two changes, and either alone leaves half the problem.
  
  **A repeated failure stops being announced.** The batcher is what tells a host a
  line changed, and the host answering that by re-evaluating the line is what
  starts the next fetch, so declining to announce is what ends the round trip.
  Three consecutive failures for a query, because a transient failure is ordinary,
  a flaky network or a service restarting, while a resolver that is genuinely down
  will not be up by the tenth attempt. A key that succeeds clears its own count, so
  an outage followed by a recovery is not held against it.
  
  The promise is still awaited rather than abandoned when the bound is reached. An
  earlier attempt returned before the await, which left the rejection unhandled,
  and in a host process an unhandled rejection is a crash rather than a log line.
  
  **A chain of flushes yields to the event loop.** Once several have run without a
  macrotask getting a turn, the next one is scheduled as a timer rather than a
  microtask, so timers, I/O and a host's own deadlines keep running. The counter
  that decides this is reset by a macrotask, so it can only be high while the loop
  is denying one, and it corrects itself the moment one lands. Four chained flushes
  before yielding, since an ordinary document settling several values wants them
  collapsed into as few passes as possible.
  
  [Async and live data](https://liamriddell.github.io/solve-engine/guide/async-and-live-data/)
  gains a section on what a host should do when a resolver never becomes ready, and
  says plainly that the engine stopping the machine spinning is not a substitute for
  showing the reader what happened.
- e0e5a47: DAG: ordering a change is roughly twice as fast, and never names a line twice
  
  `getAffectedLinesInOrder` is what the incremental engine re-runs after an edit,
  and in what order, so its cost is paid on every keystroke that moves a value.
  The topological sort has been rebuilt around dense integer nodes: lines and the
  keys between them are numbered into one range, the graph is held as a compressed
  sparse row rather than a map of arrays, and the edges are discovered once as
  integers rather than looked up by name in each of four passes.
  
  Measured on one machine, medians of eleven interleaved rounds of the committed
  graph against this one, in the same process:
  
  | shape                                | before  | now     | change |
  | ---                                  | ---     | ---     | ---    |
  | order a 2,000-line chain             | 1.54 ms | 0.60 ms | -61%   |
  | order a 5,000-line mixed document    | 0.32 ms | 0.12 ms | -62%   |
  | order 2,000 members and 2,000 totals | 1.28 ms | 0.58 ms | -55%   |
  | order a fan of 10,000 readers        | 3.60 ms | 1.92 ms | -47%   |
  | register a 5,000-line document       | 1.20 ms | 1.10 ms | -8%    |
  | remove 5,000 mixed lines             | 1.65 ms | 1.54 ms | -7%    |
  | walk 2,000 members and 2,000 totals  | 0.21 ms | 0.20 ms | -8%    |
  
  The registration and removal paths got the smaller half of it: one hash per edge
  instead of three, one read set per line rather than two identical ones, and no
  lookup at all into the two indexes a plain line cannot appear in.
  
  ## A line was named twice
  
  The same work found a fault in the sort, and it is the reason this is worth
  reading rather than only worth merging.
  
  When no node has a free edge, which is what a cycle looks like, the sort seeds
  itself with the lowest affected line rather than stopping. That line's own edges
  were then walked a second time when its last dependency drained, so it was
  emitted twice, and the second walk released lines that were not ready, which
  reordered the tail as well. Two lines that refer to each other are enough:
  
  | document                                | before         | now         |
  | ---                                     | ---            | ---         |
  | `:a = b + 1` / `:b = a + 1` / `a + b`   | `[1, 2, 3, 1]` | `[1, 2, 3]` |
  
  A line named twice is re-evaluated twice, and for an accumulator that is a
  different answer rather than a slower one.
  
  A differential fuzz of 8,000 random graphs, comparing the two implementations
  across 418,000 answers, found 1,566 results where the old sort repeated a line
  and none where the two disagreed about anything else. Audited against the
  contract directly over 19,640 orderings: 764 repeated lines before, none now,
  with the same ordering quality on the cyclic graphs where no valid order exists.
  
  ## The boundary
  
  This is the sort's constant factor and one fault in its fallback, not a change
  of algorithm: ordering was already linear in lines plus keys after 2.38.6, and
  still is. What is left in it is string hashing, roughly sixteen thousand map and
  set operations for a two-thousand-line chain, which only interning keys to
  integers at registration would remove. That is a change to every index in the
  file for a path that now costs 0.6 ms on a document that size, so it is not
  made here.
  
  ## Verification
  
  9,209 tests in 458 suites, 12 of them new: every affected line named exactly
  once on cyclic, self-referential and tag-keyed shapes, and every producer before
  every consumer on chains that run against document order, on a group with many
  members and many aggregates, and on a fan. Four benchmarks added for the shapes
  that had none, including the mixed document a notepad actually makes.
  `npm run verify:ci`, the bundled-consumer contract, and the playground build all
  pass.
- be76852: A definition keeps its answer when the document is evaluated again
  
  A live document is evaluated over and over rather than once, and a line whose
  expression compiles to a program with no opcodes lost its answer on the second
  pass, with nothing edited. A unit definition and an equation stored for later
  both do their work while being compiled and have nothing left to run:
  
  | line                 | pass 1                    | pass 2 before | now       |
  | ---                  | ---                       | ---           | ---       |
  | `1 sprint = 2 weeks` | `sprint defined`          | blank         | unchanged |
  | `y + 3 = 10`         | `y stored as an equation` | blank         | unchanged |
  
  Tier 2 skipped the empty programs, collected no results, and then assigned that
  empty collection over the answer Tier 1 had computed. Executing nothing produces
  no new result, which is not the same as producing an empty one, so a line that
  ran nothing now keeps what it had.
  
  The unit itself was never affected: `3 sprints in weeks` answered `6 weeks`
  throughout. It was only the definition line's own displayed result that went.
  
  Keeping the old result was not enough on its own, and the second half of this is
  the more interesting one. A pass runs with the Value arena on, and a result that
  never came back through the VM's `HALT` was never copied on the way out, so the
  line held an arena slot that a later line is then handed. Read again after the
  line below it had run, `sprint defined` had become that line's number, in the
  same object. The kept result is therefore a copy, not a reference.
  
  The boundary: this is about a line keeping an answer it already had. Changing a
  definition still does not update the lines that already used it, because a user
  unit is not a dependency key and the lines reading it keep bytecode compiled
  against the old definition. That is filed separately.
  
  ## Verification
  
  5 new tests, including the plainest property the evaluator has and one nothing
  pinned before: four passes over an unchanged document leave every answer exactly
  as the first pass left it. On `main` four of the five fail. `npm run verify:ci`,
  the bundled-consumer contract, and the playground build all pass.

## 2.38.7

### Patch Changes

- b574894: Tags: a total reads its own members, not the whole document
  
  `total of #tag` walked every line of the document asking each one whether it
  carried the tag, so a document of D aggregates over N lines cost D x N per pass.
  Both document paths now keep a tag to lines index and the aggregate reads it.
  Measured through `parseDocument`, N lines of `<i> #a` followed by N lines of
  `total of #a`:
  
  | total lines | before  | now    |
  | ---         | ---     | ---    |
  | 2,000       | 1.97 s  | 0.04 s |
  | 5,000       | 11.83 s | 0.25 s |
  | 10,000      | 49.22 s | 0.87 s |
  | 20,000      | 250 s   | 3.33 s |
  
  An ordinary notepad, tagged amounts with a total every twenty lines, went from
  2.55 s to 0.15 s at ten thousand lines through the batch pass, and from 3.28 s
  to 0.73 s through the incremental one, which is the pass an editor pays per
  keystroke.
  
  The boundary: the shape above stays quadratic, because it is. Ten thousand
  totals over ten thousand members is a hundred million additions however the
  members are found. What is gone is the document walk on top of that, so with the
  number of aggregates fixed a pass is linear in the document, and twenty thousand
  untagged lines around a total now cost their parse and nothing more.
  
  Category tags also register in the dependency graph now, as a key a member line
  writes and an aggregate reads:
  
  | an edit to      | before                  | now                             |
  | ---             | ---                     | ---                             |
  | a tagged line   | dirtied nothing by name | names the aggregates over its tag |
  
  They were being registered and then wiped inside the same pass, because a line
  registers from five places across the engine and the evaluator and the later
  registration keeps only its own edges. All five route through one helper now.
  
  Nothing a reader writes changes. A tag is still read case-insensitively, a
  `#heading` is still not a member of its own name, and asking about a group still
  does not join it.
  
  ## Verification
  
  9,193 tests in 456 suites, including 25 new ones covering the index directly:
  which lines a group holds, that the first unreadable member a total reports is
  still the first one in the document, that an index maintained across edits and
  one built fresh from the same text agree, and that the graph edges survive a
  whole pass. `npm run verify:ci` and the bundled-consumer contract both pass.

## 2.38.6

### Patch Changes

- 2d5e1b2: The dependency graph indexes edges, and a kind is only a prefix
  
  The graph began as variable tracking and grew a second, parallel mechanism for
  data sources: `dataSourceDependencies` and `dataSourceConsumers` were a copy of
  the `lineReads` and `consumers` pair with a hand-built string key. Two mechanisms
  doing one job is the sign the first was not general enough, and category tags
  would have been a third copy.
  
  There is one key space now, namespaced by kind, and one pair of indexes over it.
  `edgeKey(kind, name)` names the space: a variable's key is the bare name, which
  is what every existing caller already passes and which cannot collide, since an
  identifier can hold neither a colon nor a leading hash; `global:` is preserved
  verbatim from where it already existed; tags and data sources take their own
  prefixes. Adding a kind is adding a prefix, not a mechanism.
  
  The half that was missing is the reverse direction. `consumers` answers "which
  lines read this", and nothing answered "which lines write it" — which is exactly
  what a group needs in order to know its own membership, and why a category-tag
  aggregate walks the whole document rather than asking. `producers` is that index,
  maintained when a line registers, unhooked when a line is re-registered into
  different groups, and cleaned when a line is removed.
  
  Data-source edges are ordinary reads in those same indexes now, and their two
  maps are gone. They are tracked as *pinned* reads, because they are discovered
  while a line runs rather than recovered from its text, so the registration that
  follows must not treat them as edges that went away.
  `getAffectedLinesByDataSource` and the diagnostic snapshot keep the shapes they
  had, and the snapshot gains the new direction alongside them.
  
  No behaviour changes: this is the mechanism the tag and positional work in #388
  and #397 needs, landed on its own so those are wiring rather than redesign.
- 8b3276d: The dependency walk visits each edge once, and orders against every producer
  
  Two faults in the dependency graph, both invisible while every key had exactly
  one writer, and both load-bearing the moment a key can have many, which is what
  a category tag is: one key whose producers are the group's members.
  
  **The walk was quadratic in producers by consumers.** `getAffectedLines` pushed a
  key onto its queue once per line that wrote it, and rescanned that key's whole
  consumer set on each pop. A tagged column with aggregates over it is exactly that
  shape.
  
  | tagged column | before | now |
  | --- | --- | --- |
  | 250 members, 250 aggregates | 1.1 ms | 0.2 ms |
  | 500 + 500 | 0.9 ms | 0.2 ms |
  | 1,000 + 1,000 | 4.5 ms | 0.5 ms |
  | 2,000 + 2,000 | 15.5 ms | 0.8 ms |
  
  Four times per doubling before, two times now: the walk is over the edges once.
  
  **Ordering recorded one producer per key.** `getAffectedLinesInOrder` built a
  key-to-producer map with last-seen-wins, so an aggregate got an ordering edge to
  one member of its group and none to the rest. I could not construct an observably
  wrong order while keys had single writers, which is why it survived; the edges
  were incomplete by construction rather than by accident, and the spec pins the
  completeness rather than the luck.
  
  **Ordering ran through the key rather than between every pair.** Ordering a line
  after everything it depends on means, for a key, ordering every reader after
  every writer. Written as edges between lines that is one edge per pair, so the
  same tagged column cost members times aggregates. The key is a node in the sort
  now: every writer points at it and it points at every reader, which says the same
  thing in members plus aggregates.
  
  | tagged column, ordered | as pairs | through the key |
  | --- | --- | --- |
  | 250 + 250 | 6.4 ms | 0.8 ms |
  | 500 + 500 | 8.4 ms | 0.8 ms |
  | 1,000 + 1,000 | 32.6 ms | 1.7 ms |
  | 2,000 + 2,000 | 150.7 ms | 2.6 ms |
  
  **A lookup that misses allocates nothing.** `getConsumers`, `getProducers`,
  `getDependencies` and `getWrites` each built a fresh empty `Set` on a miss, about
  176 nanoseconds of pure garbage per call, and the evaluator misses once per line
  that writes nothing on every pass. They share one empty set now, and return
  `ReadonlySet`, which says what was already true: these hand back the graph's own
  sets rather than copies.
  
  | 1,000,000 lookups that miss | before | now |
  | --- | --- | --- |
  | `getWrites` | 176.0 ms | 2.0 ms |
  | `getConsumers` | 179.7 ms | 1.5 ms |
  
  **A line whose edges have not moved is left alone.** Re-registering unhooked
  every old edge and hooked the same ones back up, allocating a set or three doing
  it, and that is the editor's ordinary case rather than a rare one, since a line
  re-runs because a value it reads changed while its own text, which is where its
  edges come from, did not.
  
  | 20,000 re-registrations | before | now |
  | --- | --- | --- |
  | one read, one write | 31.9 ms | 4.9 ms |
  | five reads, one write | 27.4 ms | 2.2 ms |
  | no edges at all | 8.9 ms | 3.8 ms |
  
  Fresh registration is unchanged. The comparison is deliberately conservative:
  duplicate names make the stored set smaller than the array, and it falls through
  to the full path rather than guessing.
  
  Two smaller corrections came with it. A line that stops writing now drops its
  recorded dependencies as well as its writes, since `dependencies` is only ever
  written alongside `writes` and leaving it behind kept a set describing a line
  that no longer defines anything.
  
  End to end, a 2,000-line document whose every line reads one definition costs
  3.5 ms per keystroke against 4.4 ms, about a fifth less. The larger multiples
  above are the graph in isolation; the graph is one part of a pass.
  
  Registration, removal, and the chain and fan shapes were measured before and
  after and are unchanged: they were already linear.

## 2.38.5

### Patch Changes

- c96dc11: A document grown by editing stays a tree, so long documents stop crashing
  
  The document's order tree took its node priorities from `pseudoRandom(mid)`,
  where `mid` is the midpoint of the range being built. A single-line insert is
  always a one-element build, so `mid` was always `0` — and zero is a fixed point
  of that hash, surviving the shift, the xor and the multiply unchanged, so
  `pseudoRandom(0)` was exactly `0`.
  
  Every inserting edit therefore minted a node with the lowest priority a node can
  have, and `merge` breaks ties the same way, so they chained into a strictly
  linear spine. Depth equalled the number of edits.
  
  | document grown by | before | now |
  | --- | --- | --- |
  | 1,000 appends | depth 1,001 | depth 23 |
  | 4,000 appends | depth 4,001 | depth 24 |
  | 16,000 appends | depth 16,001 | depth 32 |
  | 4,000 prepends | depth 4,001 | depth 24 |
  | 4,000 middle inserts | depth 4,002 | depth 24 |
  | `setDocument` of 16,001 lines | depth 14 | depth 14 |
  
  `nodeAt`, `split`, `merge`, `collectRange` and the iterator all recurse on that
  depth, so reads overflowed the stack and the `RangeError` escaped to the caller
  rather than arriving as an error Value: the scroll path at about 5,400 edits,
  `getAllLines` at about 7,900, `ThreeTierEvaluator.evaluate` at about 8,000, and
  the edits themselves at about 12,400. After the first overflow the model stayed
  bricked. A document grown to 30,000 lines now reads without throwing.
  
  Loading the same text in one `setDocument` always built a balanced tree, which is
  what isolated the fault to the incremental path — the one a live editor uses.
  
  Two things changed. The priority now comes from the line's own id rather than its
  position in the build, because position carries no entropy across separate builds
  while an id is unique and stable, so the same set of lines still produces the same
  shape. And the hash offsets its seed by a large odd constant, so no input maps to
  itself, with the result read as unsigned so the range really is `[0, 1)`.
  
  The assertions are structural rather than timed: depth is a property of the tree,
  so it is asserted exactly.

## 2.38.4

### Patch Changes

- 266af7b: A goal seek finishes, whatever its target is
  
  Goal seek reads its target as an exact rational, and an ordinary floating-point
  sum is not a tidy one. `0.1 + 0.2` is `0.30000000000000004`, whose denominator is
  around 10^17, and the rational-root search begins by trial-dividing to the square
  root of that: about 1.7 billion candidates. The loop is synchronous, so no
  timeout, watchdog or test deadline could interrupt it, and the path it sits on is
  the one a live editor drives on every keystroke.
  
  | document | before | now |
  | --- | --- | --- |
  | `0.1` / `0.2` / `solve line 2 for x = total above` | 12,584 ms, then a refusal | 2 ms, `-4.85` |
  | `1.1 + 2.2` / `solve line 2 for x = prev` | 7,000 ms, then a refusal | 1 ms, `-3.35` |
  | `1 / 3` / `solve line 2 for x = prev` | 7,944 ms, `-4.833333333333334` | 1 ms, `-4.833333333333334` |
  | `1e-320` / `solve line 2 for x = prev` | never returned | 1 ms, `-5` |
  
  Two changes, and the first is why the answers are better rather than only faster.
  
  **A line has one root and it is closed form.** `bx + c` is zero at `-c/b`.
  Reaching for the rational-root theorem at degree one means factoring both
  coefficients to rediscover a division, which is exactly where the time went. It
  is answered directly now, so the first two rows above go from a twelve-second
  refusal to the correct negative root. Those roots lie outside the numeric
  bisection range, which is why only the exact route could ever find them, and why
  the third row had to keep the answer it already gave.
  
  **A candidate cap for everything above degree one.** The existing limit bounds
  the divisors *found*, which stops a highly composite coefficient; it does nothing
  for the opposite shape, where a value with very few divisors runs the whole trial
  division to find none. A hundred thousand candidates costs about five
  milliseconds and factors any magnitude up to 10^10 completely, which is every
  coefficient a written expression produces. Past that the value is float noise
  rather than something anyone typed, and the caller already treats "not factorable
  this way" as a fallback.
  
  `parseDocument` and `evaluateExpression` were never affected: they refuse goal
  seek with `GOAL_SEEK_NO_DOCUMENT` in a millisecond or two.

## 2.38.3

### Patch Changes

- 0e5c453: The tag scanner is linear again, so a long line cannot stall a document
  
  A regression introduced in 2.38.1. Teaching `lineCarriesTag` to examine every
  occurrence of a tag, so a line can query one group and join another, made each
  occurrence cost the length of the line: it copied the whole prefix, then ran the
  opener pattern over that copy. The pattern is anchored at its end but not its
  start, so the regex engine scans from every position.
  
  A line whose occurrences are all queries never takes the early return, so it paid
  that per occurrence.
  
  | occurrences | line | 2.38.0 | 2.38.1 | now |
  | --- | --- | --- | --- | --- |
  | 1,000 | 12 KB | 0.10 ms | 11.4 ms | 0.52 ms |
  | 4,000 | 48 KB | 0.02 ms | 143 ms | 1.28 ms |
  | 16,000 | 192 KB | 0.09 ms | 2,145 ms | 4.44 ms |
  | 200,000 | 2.4 MB | — | ~5 min | 62 ms |
  
  Whether anything precedes a `#` is one property of the line, so it is found once
  rather than by copying the prefix at each occurrence. And the opener pattern is
  anchored at its end, so only the characters immediately in front of the `#` can
  match it: testing a fixed window of those is the same answer, in constant time.
  
  The boundary, and it is the old behaviour rather than a new answer: past that
  window an opener is not recognised, so `total of` separated from its tag by more
  than fifty-three characters of whitespace reads as a member, which is what such a
  line was before queries were distinguished at all.
  
  Every reading 2.38.1 established is unchanged and pinned: a mark joins, a query
  names without joining for all four openers, a line can do both, a heading is not
  a tagged line, and the tag must be the whole word.
  
  The shape that reached this is not a hand-written line. `aggregateTagged` runs
  the scanner over the raw text of every line, including ones the evaluator
  classifies as skippable markdown, so a table cell holding the text is enough and
  the expression-length guard never applies.

## 2.38.2

### Patch Changes

- 6ef425f: `min of column` on a long column answers instead of overflowing the stack
  
  The three table reductions that take an extreme were written as
  `Math.min(...cells)`, which makes the whole column into an argument list. Past
  roughly 126,000 arguments V8 overflows, so a table well inside the engine's own
  document-line cap came back as *Maximum call stack size exceeded*, and through
  `evaluateLine` it escaped as a thrown error rather than arriving as a value.
  
  | expression, 130,000-row column | before | now |
  | --- | --- | --- |
  | `min of column "n" above` | `Maximum call stack size exceeded` | `1` |
  | `max of column "n" above` | `Maximum call stack size exceeded` | `130,000` |
  | `spread of column "n" above` | `Maximum call stack size exceeded` | `129,999` |
  | `sum of column "n" above` | `8,450,065,000` | `8,450,065,000` |
  
  `sum` on the byte-identical table always answered, because it folds, and that is
  what isolated the cause to the three that spread.
  
  They fold now, in a single pass for `spread`, which needs both ends. The fold is
  seeded with the identities `Math.min()` and `Math.max()` return for no arguments,
  so an empty column reads exactly as it did, and folding keeps the NaN
  propagation and the `-0` preference the spread form had.
  
  The regression test asserts the raw spread form still throws at the size the
  document uses, so a future V8 that raises the argument limit reports itself
  rather than letting the test pass vacuously.
  
  Found by an adversarial sweep for crashes reachable from a document, alongside
  #384, #385, #387, #388 and #389.

## 2.38.1

### Patch Changes

- 5522e56: Asking about a tag no longer joins it, so one tag can answer several questions
  
  Two aggregate lines over the same category tag made each other unreadable. Each
  walked every line whose text carried the tag, found the other still being
  evaluated, and reported it.
  
  | document | before | now |
  | --- | --- | --- |
  | `10 #a` / `20 #a` / `total of #a` | `30` | `30` |
  | `10 #a` / `20 #a` / `total of #a` / `average of #a` | `Line 4 has not been evaluated yet` and `Line 3 has an error` | `30` and `15` |
  
  Deleting either aggregate made the other answer, which is what made it a defect
  rather than a limit: asking two questions of one tagged column is the ordinary
  thing to do with one.
  
  A `#tag` after `total of`, `sum of`, `average of` or `count of` names the group
  rather than joining it. The querying line's own text was already skipped, by line
  number, so this only extends that to the other queries and says the same thing
  about all of them.
  
  The rule is about each `#` rather than about the line, so a line can query one
  tag and be a member of another: `total of #grocery #reviewed` asks about the
  first and joins the second.
  
  The boundary, which the issue asked for explicitly: a line that genuinely has not
  been evaluated is still reported rather than quietly dropped. An aggregate placed
  above its own members is a forward reference, and the engine reads a document
  downwards, so it still says so.
  
  [Category tags](https://liamriddell.github.io/solve-engine/syntax/category-tags/)
  gains a proven section stating the rule.

## 2.38.0

### Minor Changes

- b653a2c: `1 1/2 cups` reads as a cup and a half
  
  A recipe is written in mixed numbers and the engine ships a cooking package
  aimed squarely at that reader, but the spelling was a parse error.
  
  | expression | before | now |
  | --- | --- | --- |
  | `1 1/2 cups in ml` | a parse error | `354.88 ml` |
  | `2 1/4 kg in lb` | a parse error | `4.96 lb` |
  | `½ tsp in ml` | `Undefined variable: ½` | `2.46 ml` |
  | `2 ½ cups in ml` | `Undefined variable: ½` | `591.47 ml` |
  | `1 and 1/2 cups in ml` | `119.29 ml` | `354.88 ml` |
  
  The last row is the reason this is more than a convenience. That spelling
  answered, and answered wrongly: it computed `1 + (1/2 cups)` rather than
  `(1 + 1/2) cups`, so a cup and a half came out as a third of what it is. Each
  new form is pinned against the decimal it stands for, so the two cannot drift.
  
  Three shapes, one reading. A whole number and a proper fraction beside it are
  that mixed number; a whole number and a vulgar fraction beside it are the same
  thing written shorter; and a vulgar fraction on its own is the fraction it draws,
  handed on as a numerator over a denominator so it keeps the exact behaviour
  typing `1/2` has. The whole Unicode fraction block is taken, since each character
  means one fraction and nothing else.
  
  The `and` spelling is claimed only in front of a unit, and only for the word.
  `1 + 1/2 cups` lexes as an ordinary sum and stays `119.29 ml`, because changing
  what a sum answers is not a spelling question. `1 and 1/2` on its own already
  answered one and a half and is untouched.
  
  The boundaries the issue asked for: the hyphenated `1-1/2` is ambiguous against
  subtraction and is left as the subtraction it reads as; an improper fraction is
  not a mixed number, so `3/2` and `1/2 + 1/3` are unchanged; and nothing here
  changes how a fraction prints, so `1.5 as fraction` is still `3/2`.
  
  [Cooking](https://liamriddell.github.io/solve-engine/syntax/cooking/) gains a
  proven section, including the sum that is deliberately still a sum.

## 2.37.0

### Minor Changes

- 75e0450: `30 days from 3 March 2026`, a date offset in words
  
  The harder, rarer sibling already shipped and the ordinary one did not.
  `30 working days from 3 March 2026` has always answered, because that is a fixed
  three-word phrase the package fuses; the plain spelling was a parse error, which
  is an asymmetry anyone with a deadline, a renewal, a notice period or an invoice
  term meets within a week.
  
  | expression | before | now |
  | --- | --- | --- |
  | `30 days from 3 March 2026` | a parse error | `Thursday, April 2, 2026` |
  | `2 weeks after 3 March 2026` | a parse error | `Tuesday, March 17, 2026` |
  | `30 days before 3 March 2026` | a parse error | `Sunday, February 1, 2026` |
  | `3 months from 3 March 2026` | a parse error | `Wednesday, June 3, 2026` |
  
  The arithmetic was never the gap. `3 March 2026 + 30 days` has always been right,
  month clamping included, so this is the spelling and nothing else: each form is
  pinned to answer exactly what the operator answers.
  
  A fixed phrase could not cover it, because the unit is part of what the reader
  writes and days, weeks, months and years all have to work. So the unit and the
  connector are fused instead, which is the shape `days between` already uses.
  
  Fusing is also what keeps the connectors out of each other's way. `after` is the
  finance package's own infix, and `$1,000 after 3 years at 7%` still answers
  `$1,225.04`, because the word is read this way only when a **time** unit sits
  directly in front of it. `30 kg after` is not a duration and cannot offset a
  date, so it is untouched too.
  
  `to` is deliberately not claimed. `2 April 2026 to 6 September 2026` already
  means something, and quietly turning it into an offset would take that away.
  
  [Date arithmetic](https://liamriddell.github.io/solve-engine/syntax/date-arithmetic/)
  gains a proven section, beside the operator spelling it agrees with. It goes
  there rather than on the relative-dates page the issue suggested, because that
  page has no fixed results and carries no proven examples by design.

## 2.36.0

### Minor Changes

- e1f782e: `fridays between two dates` counts the weekday
  
  Planning against a weekday is an ordinary thing to want and there was no form
  for it. The nearest approximation ignores which weekday the range starts and
  ends on, so it is wrong at both ends.
  
  | expression | before | now |
  | --- | --- | --- |
  | `fridays between 01/06/2026 and 31/08/2026` | a parse error | `13` |
  | `how many fridays between 01/06/2026 and 31/08/2026` | a parse error | `13` |
  | `mondays between 01/06/2026 and 31/08/2026` | a parse error | `14` |
  | `weeks between 01/06/2026 and 31/08/2026` | `13 weeks` | `13 weeks` |
  
  Those are the same three months in each row. The range holds fourteen Mondays
  and thirteen of everything else, because 1 June 2026 and 31 August 2026 are both
  Mondays, which is exactly what `weeks between` cannot tell you: it answers
  thirteen whichever weekday you meant.
  
  Every weekday name is taken, in the plural a person counting writes and in the
  singular the lexer already knows, and `until` and `since` count against today
  the way their unit siblings do. Only the singulars were lexer keywords, since
  those are the forms a date needs (`next friday`), so the plural is recognised in
  this one place rather than claimed globally.
  
  **Both endpoints are included.** A range written to a Friday was written to
  include it, and someone counting shifts or rent days means the ones on the
  boundary. It follows that a single day counts as one if it is that weekday and
  none if it is not, and that `fridays until` a Friday counts today. Order does
  not matter either: a weekday falls in a range the same number of times whichever
  end you start from.
  
  The boundary is holidays. This counts calendar weekdays and does not consult a
  holiday calendar, because a Friday that is a public holiday is still a Friday.
  `working days between` is the form that skips them, and it already exists.
  
  [Date differences](https://liamriddell.github.io/solve-engine/syntax/date-differences/)
  gains a proven section, with the Monday range beside the week count so the
  difference between the two questions is visible.

## 2.35.0

### Minor Changes

- 509e07a: `20°C` reads as a temperature
  
  `°C` and `°F` are in the unit table and could never reach it. The lexer reads a
  unit as one run of `[A-Za-z0-9_]`, so a non-ASCII character cannot become a unit
  token, and the line arrived at the parser as a number and an identifier nobody
  had defined.
  
  | expression | before | now |
  | --- | --- | --- |
  | `20°C in F` | `Undefined variable: °C` | `68.00 F` |
  | `100°F in C` | `Undefined variable: °F` | `37.78 C` |
  | `180°C in gas mark` | `Undefined variable: °C` | `gas 4` |
  | `37°C` | `Undefined variable: °C` | `37.00 °C` |
  
  Meanwhile every other spelling of the same question already answered, so
  `20 C in F` was `68.00 F` and `20° C in F`, with a space, was too. A refusal with
  the answer one retyped character away is a gap rather than a boundary.
  
  The precomposed `℃` and `℉` that some keyboards emit read the same way, and `°K`
  is kelvin, which has no degree sign of its own and is spelled `K` in the table.
  
  The scale letter is what claims the shape, so `90°` is still ninety degrees of
  arc and `sin(90°)` is still `1`. The two rules share a character and only one of
  them may have it: the angle rule takes the symbol standing alone, this one takes
  it only when a letter is attached.
  
  The boundary is the symbol forms only. `C` is still Celsius and `c` is still the
  cooking cup, no ordinary word is claimed, and the case sensitivity of the unit
  table is untouched: the five spellings above are the whole of it.
  
  Two `test.failing` cases in the units-table integrity spec, which pinned this as
  a known defect, are ordinary passing tests now.
  
  [Converting units](https://liamriddell.github.io/solve-engine/syntax/converting-units/)
  gains a proven section for the symbol forms.

## 2.34.6

### Patch Changes

- 1744d39: `4:30/km` is a pace, and reads as one
  
  A two-part clock literal is a time of day everywhere else in the engine, and
  reading it as one before a unit produced the epoch divided by that unit.
  
  | expression | before | now |
  | --- | --- | --- |
  | `4:30/km` | `1,788,665,400,000.00 /km` | `4:30 /km` |
  | `10 km at 4:30/km as laptime` | `2484257500:00:00` | `00:45:00` |
  | `4m30s/km` | `270.00 seconds/km` | `4:30 /km` |
  | `4:30/km in min/mi` | `7.24 min/mi` | `7:15 /mi` |
  | `1:30:00/km` | `5,400.00 s/km` | `1:30:00 /km` |
  
  Two things were missing, and the arithmetic was not one of them: `4m30s/km` has
  always been 270 seconds per kilometre. What was missing was the spelling a runner
  writes, and a display they can read.
  
  **The reading.** A two-part clock literal before a slash and a distance is
  minutes and seconds. The distance is what claims the shape, so `12:00/day` is
  untouched: hours per day is a time over a time and has no pace in it. A
  three-part literal is left alone too, since `1:30:00/km` already arrived at the
  right number through the ordinary duration path.
  
  **The display.** A quantity whose unit is a time over a length now shows on a
  clock, which is what the `pace` function has always printed. That reaches every
  spelling of the same quantity, so `4m30s/km` and a converted `min/mi` read the
  same way.
  
  Everything else is exactly as it was: `4:30` on its own is half past four in the
  morning, `8:15 + 7:45` is sixteen hours, `9:00 to 17:30` is a shift, and
  `90 km/h` is a speed rather than a pace because it is a distance over a time.
  
  The boundary is a pace faster than a minute per unit. A clock shows whole
  seconds, and rounding one that fast would change the number, so it keeps its
  digits: a swim written `1:30/100m` reads `0.90 seconds/m`, because the
  denominator reduces to a single metre.
  
  [Health and fitness](https://liamriddell.github.io/solve-engine/syntax/health/)
  gains a proven section beside the `pace` function it now matches.

## 2.34.5

### Patch Changes

- 1bede41: A value that is not zero never prints as one
  
  Two decimal places is the right budget for almost everything the engine answers,
  and wrong for the answers that live below it. A conversion can land several
  orders of magnitude down, and `0.00 MHz` cannot be told apart from a real zero.
  
  | expression | before | now |
  | --- | --- | --- |
  | `1 Hz in MHz` | `0.00 MHz` | `1e-6 MHz` |
  | `1 byte in GB` | `0.00 GB` | `1e-9 GB` |
  | `1 g in tonnes` | `0.00 tonnes` | `1e-6 tonnes` |
  | `1 second in years` | `0.00 years` | `3.17e-8 years` |
  | `0.001 km` | `0.00 km` | `0.001 km` |
  | `1/1000000` | `0.00` | `1e-6` |
  
  A magnitude that would round away is shown to three significant digits instead:
  as a decimal while the zeros are still countable, and in exponent form once they
  are not. Three digits rather than everything the double holds, because a
  conversion is not more precise than what went into it.
  
  Money is the exception, because a currency zero is a real answer rather than a
  rounding artefact. A tenth of a penny is not a payable amount, so `$0.001` is
  `$0.00` and stays that way. So does a genuine `0 kg`, and so does every value
  that already rendered legibly.
  
  Fixed in the same pass, since it is the same display path: **`to N dp` is now
  obeyed on a quantity.** `1.23456 km to 4 dp` was answering `1.23 km`, the
  setting's two places, because a quantity's own place count was never read the way
  a plain number's already was. It now answers `1.2346 km`, and `5 km to 0 dp` is
  `5 km`. An explicit place count also beats the display floor in both directions,
  because a line that names its precision has said what it wants.
  
  [Decimals](https://liamriddell.github.io/solve-engine/syntax/decimals/) gains
  proven sections for both, and documents `as scientific`, which was the existing
  escape hatch and was written down nowhere.
  
  Five pinned strings move with this: `12/25/2026` read as division under the
  `onAmbiguous: 'arithmetic'` opt-out now reads `0.000237` rather than `0.00`. The
  arithmetic is unchanged; it is the same division, now legible.

## 2.34.4

### Patch Changes

- 3da03e9: One rule for aggregating quantities: the first unit written, or a refusal
  
  `total of` over a comma list threw the unit away and added values of different
  measures as though they were the same number. The document forms carried the
  unit but refused a column that spelled one measure two ways, so the four ways of
  naming a set disagreed with each other.
  
  | expression | before | now |
  | --- | --- | --- |
  | `total of $4.99, $12.50, $3.20` | `20.69` | `$20.69` |
  | `total of 1.2 km, 3 km, 800 m` | `804.20` | `5.00 km` |
  | `average of 5 kg, 3 m` | `4` | `mass and length cannot be averaged` |
  | `1.2 km` / `800 m` / `total above` | a refusal | `2.00 km` |
  
  The second row is the worse one: kilometres and metres were added as equals, so
  the answer was wrong by three orders of magnitude on the last term.
  
  The rule now, everywhere: read the whole set in the first unit written, and
  refuse a set that mixes measures by naming the two dimensions. It is the rule
  `min` and `max` have always followed, applied to the aggregates. The unit is the
  first one written rather than the smallest, so the same three distances answer
  `5.00 km` written one way round and `5,000.00 m` the other, which is the unit the
  reader started in.
  
  All four ways of naming a set follow it, and a test pins them to the same answers:
  the inline `total of X, Y, Z` list, `total above`, `total of #tag`, and
  `total(line1 : line3)`. `average`, `median` and `spread` carry the unit too.
  
  The boundary is a bare number sitting in a list of quantities. It contributes its
  magnitude, which is what a count written beside a column of measurements has
  always done, so `total of 1 km, 500` is `501.00 km`. `count of` counts, so it
  carries no unit. Standard deviation and variance are unchanged, because a
  variance carries the square of its data's unit and that is its own decision.
  
  [Statistics](https://liamriddell.github.io/solve-engine/syntax/statistics/) gains
  a proven section for a list with units and states the refusal.

## 2.34.3

### Patch Changes

- 6988053: `12 in in cm` is 30.48 cm: the inch abbreviation reads as a unit
  
  `in` is how the engine spells the conversion itself, so the unit table
  deliberately refuses to claim the spelling and the word lexes as a keyword
  wherever it appears. That was right for `12 in ft` and wrong everywhere else:
  the abbreviation took the magnitude and relabelled it with the target unit, and
  lost the unit entirely under arithmetic.
  
  | expression | before | now |
  | --- | --- | --- |
  | `12 in in cm` | `12.00 cm` | `30.48 cm` |
  | `5 in in mm` | `5.00 mm` | `127.00 mm` |
  | `2 in + 3 in` | `5` | `5.00 in` |
  | `12 in` | `12` | `12.00 in` |
  
  The shape that separates the unit from the preposition is what follows the word.
  A conversion needs something to convert into, so `in` is read as inches only
  directly after a number and only where there is plainly nothing there: at the
  end of a line, before an operator, or before a second `in` or a `to`, which is
  the `12 in in cm` case itself.
  
  Every other continuation keeps the reading the line already had. `12 in ft`,
  `5 km in miles`, `100 in USD`, `$500 in 1990 dollars` and `99 in binary` are
  unchanged, and so is `3 ft in in`, where the word follows a unit rather than a
  number and is doing its ordinary job. The guard is a list of what ends a
  quantity rather than a list of conversion targets, because a spelling missing
  from the first list leaves the old reading in place, while one missing from the
  second would turn a working conversion into inches.
  
  The boundary: `12 in ft` still relabels a unitless number, exactly as it did
  before. Whether a bare number should be convertible at all is a separate
  question from whether `in` is a unit here.
  
  [Converting units](https://liamriddell.github.io/solve-engine/syntax/converting-units/)
  gains a proven section saying which spellings of inches are read and why.

## 2.34.2

### Patch Changes

- 472bef3: Milliseconds: a quantity is shown as a quantity, and a stretch of time as a clock
  
  `ms` used to be a unit nobody could type, so every value carrying it was the gap
  between two clock times and the formatter could show all of them on a clock. It
  is typeable now, and a latency budget was being read as a time of day.
  
  | expression | before | now |
  | --- | --- | --- |
  | `40ms + 120ms + 30ms` | `0:00` | `190.00 ms` |
  | `95ms * 3` | `0:00` | `285.00 ms` |
  | `2 minutes in ms` | `0:02` | `120,000.00 ms` |
  | `9:30 - 8:30` | `1:00` | `1:00` |
  
  The two readings share a unit, so the engine now records which one it measured:
  subtracting one datetime from another marks the result as a stretch of time, and
  only a marked value is shown on a clock.
  
  The mark survives the arithmetic that keeps a stretch a stretch, which is what a
  timesheet needs. Two of them add, one scales by a plain number, and a column of
  them totals, by position or by category tag:
  
  ```
  9:30 - 8:30
  12:00 - 11:00
  18:00 - 12:55
  total above          7:05
  ```
  
  It deliberately does not survive two things. A conversion drops it, because
  `(9:30 - 8:30) in minutes` named the unit it wanted and is given `60 minutes`.
  And combining a stretch with a quantity somebody typed drops it, so
  `(9:30 - 8:30) + 40ms` is a count of milliseconds rather than a clock implying it
  is still a shift. Both fail towards the plain number, which is the direction that
  cannot mislead.
  
  [Timesheets](https://liamriddell.github.io/solve-engine/syntax/timesheets/) gains
  a proven section covering both readings, which is the example that would have
  caught this.

## 2.34.1

### Patch Changes

- 161eaab: An interest term carries its unit, so 45 days is no longer charged as 45 years.
  
  The term in a finance form was read as its bare magnitude and the unit thrown away, so every unit meant years.
  
  | | before | now |
  | --- | --- | --- |
  | `interest on £2,400 over 45 days at 8%` | `£74,209.08` | `£22.88` |
  | `interest on £2,400 over 1 month at 8%` | `£192.00` | `£15.44` |
  | `interest on £2,400 over 18 months at 8%` | `£7,190.45` | `£293.69` |
  | `interest on £2,400 over 1 year at 8%` | `£192.00` | `£192.00` |
  | `interest on £2,400 over 3 years at 8%` | `£623.31` | `£623.31` |
  
  `over 1 month` and `over 1 year` answering the same figure was the tell. Nothing that names its term in years changes, which is every documented form and every function-call spelling, and a bare number is still years.
  
  Two conventions come with it, both stated on the page because both are conventions rather than calendar arithmetic. **A month is a twelfth of a year**, so 18 months is a year and a half and `monthly repayment on £200,000 over 300 months at 4.5%` is `£1,111.66`, exactly what the same mortgage over 25 years answers. That is the financial reading and it deliberately differs from the engine's general one, where a month is thirty days and `18 months in years` answers `1.48`: a 300-month mortgage under a thirty-day month would be four months short. **Everything else converts against a 365-day year**, so a 45-day term is the same in February as in March.
  
  A term that is not a length of time is now refused by measure rather than read as a number of years:
  
  ```
  interest on £2,400 over 5 kg at 8%    a term is a length of time, and "kg" is not: write it as days, months or years
  ```
  
  The reason this survived the build-time example gate is that no page showed a term shorter than a year. The page now does.

## 2.34.0

### Minor Changes

- ca5df43: A duration written without spaces, the way a stopwatch prints one.
  
  | before | now |
  | --- | --- |
  | `2h30m` was `Undefined variable: h30m` | `150 minutes` |
  | `45m30s` was `Undefined variable: m30s` | `2,730 seconds` |
  | `1d6h` was `Undefined variable: d6h` | `30 hours` |
  | `1h30m15s` was `Undefined variable: h30m15s` | `5,415 seconds` |
  
  `2h 30m` already read as 150 minutes. The same duration typed without the space did not, because the lexer leaves `h30m` as one identifier and the line became two hours times a variable nobody declared. Both spellings now read the same, which matters because a stopwatch, a video player and most timers print the compact one, and that is the spelling people paste in. It is an ordinary duration once read, so `1h30m in minutes` is `90 minutes`.
  
  The boundary is `m`. On its own it is metres, and `90m` still is: it reads as minutes only beside a larger time unit, which is the only place this looks at it. That is what makes `45m30s` forty-five minutes and thirty seconds rather than forty-five metres.
  
  The parts must run from the larger unit to the smaller, which is what a duration written this way means. Anything that does not descend is not one and keeps whatever meaning it had: `2m30h`, `1m2m` and `100m50cm` are all still undefined variables, and `2x3` is still a multiplication.

## 2.33.0

### Minor Changes

- 6b2ef12: The second wave of work on the parser pipeline: the normaliser stops running to its pass budget, the lexer's vocabulary edges are hardened, an operator can declare its associativity, and the benchmark suites measure what they name. Figures are medians from the engine's own benchmark suites on one machine.
  
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
  
  ## What was measured, and how
  
  The figures above were re-measured against this branch's own merge base, both builds loaded into one process with the passes interleaved, so machine drift hits each equally. That method matters here: measuring the two builds one after the other, which is what the continuous-integration comparison does, reported this branch as 1.4x to 1.8x **slower** on several cases. Interleaved, the same cases invert.
  
  | case | merge base | now | |
  | --- | --- | --- | --- |
  | a cached expression, evaluated again | 1.77 µs | 1.05 µs | 0.59x |
  | a 200-line document, re-parsed warm | 0.519 ms | 0.346 ms | 0.67x |
  | a 50-line document, parsed cold on a new engine | 1.10 ms | 0.98 ms | 0.89x |
  | constructing an engine with every package | 0.44 ms | 0.44 ms | no difference |
  
  Engine construction was the one thing that looked like it had a cost, and it does not: across four interleaved runs the ratio flips sign (0.94x, 1.06x, 1.08x, 1.06x), which is what no difference looks like on a machine this noisy. Single-line micro-cases at the microsecond scale are below what could be resolved at all and are not claimed either way.
  
  The benchmark suites measure what they name. The parser suite took a mean of `performance.now()` deltas around a loop that rebuilt a ten-package registry per iteration, so its figure was registry construction; it now holds one parser and records a mitata median (0.8 µs to 1.6 µs per parse). The micro suite's `process.hrtime` pair per iteration is replaced by the same measurement, the suite-geomean bands sit at 1.1 and 1.3 now that every suite records a median, and the pipeline suite times engine construction on its own (`create_engine`, 442 µs for every built-in package on this machine).

## 2.32.0

### Minor Changes

- d06f263: Take-home pay: HMRC's bands take pounds, and everyone else states a rate.
  
  The bands behind `after tax` are a fact about the United Kingdom. They were applied to whatever the line carried, and the answer printed in that currency, so a dollar salary got a confident figure about a country the bands say nothing about, and a bare number got Britain assumed in silence.
  
  | before | now |
  | --- | --- |
  | `$50,000 after tax` was `$39,519.60` | `these are HMRC's bands, which say nothing about USD: state a rate instead, as in "50,000 after 20% tax"` |
  | `50000 after tax` was `39,519.60` | `these are HMRC's bands, so this needs a pound salary: write "£50,000 after tax", or state a rate with "50,000 after 20% tax"` |
  | `£50,000 after tax` was `£39,519.60` | `£39,519.60`, unchanged |
  
  The refusal names a form that now exists, because the question behind those lines is a real one:
  
  ```
  £50,000 after 20% tax    £40,000.00
  $50,000 after 20% tax    $40,000.00
  50000 after 20% tax      40,000
  ```
  
  Nothing about a stated rate is national, so it takes any currency and a bare number, and it binds the way the banded form does: `50000 + 2000 after 20% tax` is `41,600`. A rate outside 0 to 100 is refused rather than applied. `vat` reads the same as `tax`.
  
  Three boundaries worth stating. `hourly for` is **not** gated, because a salary over a working year is a division with no bands in it, so `hourly for $45,000` is `$23.44`. `after` on its own is untouched: the whole shape, closing word included, is required before the phrase is claimed. And Scotland is still not covered, which is now one case of a general rule rather than a lone footnote: a rate that is not shipped is not assumed.
  
  This changes documented behaviour. `50000 after tax` was a proven example on the payroll page and is now written `£50,000 after tax`; the page says why, and shows the stated-rate form beside it.

## 2.31.1

### Patch Changes

- 2056a78: `convertUnit` refuses a pair that is not the same kind of thing, wherever the units came from.
  
  It always refused one from the base table: `convertUnit(5, "kg", "metre")` throws. It did not refuse one from the extended table, and that branch multiplied the two units' base ratios without comparing their measures.
  
  | | before | now |
  | --- | --- | --- |
  | `canConvert("mpg", "l100km")` | `false` | `false` |
  | `convertUnit(35, "mpg", "l100km")` | `1488.002976005952` | throws `Cannot convert between different measures: mpg and l100km` |
  
  Miles per gallon is distance over volume and litres per hundred kilometres is volume over distance, so the engine files them as different measures and `canConvert` has always said so. `convertUnit` did it anyway and returned a number with no meaning, which a first version of the travel package's trip arithmetic was built on: a 300-mile drive that burned 7,184 litres. The refusal now reads the same as the base table's, so one kind of mistake has one message.
  
  The boundary is measures, not extended units. Two extended units of the same measure still convert (`convertUnit(35, "mpg", "kmpl")` is `14.88`), and reciprocal pairs still relate through `convertRate`, which is what it is for: `40 mpg in l/100km` is still `5.88 l/100km`, and `6 l/100km in mpg` is still `39.20 mpg`.
  
  No expression changes. Every engine-level form already went through the paths that were correct; this closes the one a package author could reach for and be quietly wrong.

## 2.31.0

### Minor Changes

- abe329b: The engine's own compile worker gets the full vocabulary, and leaves your bundle.
  
  The evaluator compiles the lines just past the viewport ahead of time, and can run batches of compiled bytecode, so scrolling pays for neither. Both were meant to happen on a worker. Neither did, and the way they failed cost something.
  
  The worker's compile engine was built with no packages, so it refused every line a package gives meaning to, which is nearly every line: each one fell back to the main thread having gained nothing. Giving it the packages was not a one-line fix, because the pools **imported the worker module directly**, and a static import puts whatever it reaches into the importing bundle. The vocabulary would have gone in with it.
  
  The pools now ask the host for a worker instead of importing one.
  
  ```ts
  import { setEngineWorkerFactory } from "solve-engine";
  
  setEngineWorkerFactory(() =>
    new Worker(new URL("solve-engine/engine-worker", import.meta.url), { type: "module" }),
  );
  ```
  
  `solve-engine/engine-worker` is a new entry, a bundle of its own carrying every built-in package, so the compile worker now understands the same lines the main thread does. Nothing but a host that registers a factory reaches it.
  
  Measured on the published build, a consumer that does not register one now carries less than before:
  
  | | before | now |
  | --- | --- | --- |
  | importing one package | 104,917 B gzipped | 104,348 B |
  | importing everything | 150,969 B | 150,403 B |
  
  The library cannot make the worker itself: the file a worker runs has to be a URL the host's bundler produced, and every bundler spells that differently. Asking is the honest version of what the old code did, which was to import a stub that threw and treat the throw as the answer.
  
  The boundary: registering nothing is a supported state, not a degraded one. It is what every published build did until now, and the fallbacks are the paths that were always taken, so a host that ignores this sees no change. This is also unrelated to `solve-engine/worker`, which moves a host's own calls off the thread; this one only lets the engine get ahead of itself on work nobody asked for directly.

## 2.30.0

### Minor Changes

- 3b05a61: Clock times added together are the timesheet column, not two times of day.
  
  `8:15 + 7:45 + 8:30` was refused, and read strictly it deserved to be: there is no such thing as half past eight plus quarter to eight. But a timesheet writes each day as hours and minutes and adds the column up, and that is the only reading the line can have.
  
  | before | now |
  | --- | --- |
  | `8:15 + 7:45` was `Cannot add two datetimes together` | `960 minutes` |
  | `8:15 + 7:45 + 8:30` was the same refusal | `1,470 minutes` |
  
  The total is an ordinary duration, so everything a duration already does applies without any of it being written twice.
  
  ```
  8:15 + 7:45 + 8:30 in hours    24.50 hours
  8:15 + 7:45 + 30 minutes       990 minutes
  8:15 + 7:45 at £15/hour        £240.00
  ```
  
  The boundary is what stays a time of day. `8:15` on its own is still quarter past eight this morning, and `8:15 + 30 minutes` is still quarter to nine that same morning. A time written with `am` or `pm` is a time of day and nothing else, so `9am + 5:30pm` is still refused rather than answered with a number that means nothing. A `-` between two clock times is left alone, because it is genuinely ambiguous: `5pm - 7pm` reads as a range and `5pm - 2pm` as a subtraction, and the interval form already refuses to guess between them.
  
  Spans and hourly rates are unchanged and now documented alongside the sum: `9:00 to 17:30` is `510 minutes`, `9pm to 5am` is `480 minutes` rather than a negative span, and `9:00 to 17:30 at £15/hour` is `£127.50`. There is a new [Timesheets](https://liamriddell.github.io/solve-engine/syntax/timesheets/) page for the three of them together.
  
  One internal change comes with it: a fused clock-time token now carries its own source text instead of a copy of its minutes value. Nothing reads that text as a payload, the minutes stay in the token's value, and it is what lets a sum tell `8:15` from `8:15am`. Spans reported against a clock time now cover what was actually written.

## 2.29.0

### Minor Changes

- 2eca6ed: The shape of a screen, the other side of a resize, and a root font size that is not 16px.
  
  `px in rem` already converted both ways, treating one `rem` as the CSS default of 16px. Three things that default cannot answer are new.
  
  | expression | result |
  | --- | --- |
  | `1920x1080 as ratio` | `16:9` |
  | `1024x768 as ratio` | `4:3` |
  | `resize 4000x3000 to 1200 wide` | `1200 x 900` |
  | `resize 4000x3000 to 900 tall` | `1200 x 900` |
  | `1.5rem at 20px base` | `30.00 px` |
  | `24px at 20px base` | `1.20 rem` |
  
  A pair may be written with or without the spaces (`1920 x 1080`), `in` reads the same as `as`, and each side of a resize has the words a person actually types: `width` and `across` read as `wide`, `height` and `high` as `tall`. The `at <n>px base` form converts to the other unit, so it reads both ways round, and it binds to the size beside it: `2rem + 8px at 20px base` is `2.40 rem`.
  
  The other side of a resize is rounded to a whole pixel, because that is what an image file holds: `resize 1000x333 to 500 wide` is `500 x 167`, not `500 x 166.5`.
  
  The boundary is what these forms refuse to claim. `1920x1080` on its own is still 1920 times a variable called `x1080`, `3x4` still means what it did, `resize` is still an ordinary word in `:resize = 2`, and `at` is still the rate operator in `30 hours at $30/hour`. Each form is read only when its whole shape is there: a pair after `resize` or before `as ratio`, and a base with the closing word `base` behind it. A rule that claimed every `<number>x<number>` or every `at` would quietly change what existing lines mean.
  
  `em` is still deliberately not converted. What an `em` is worth depends on the element it sits in, so no single number is right for it.

## 2.28.0

### Minor Changes

- c5e81ff: What a journey burns, and what that costs.
  
  Fuel economy conversion and drive time already shipped. What was missing is the pair of sums that join a distance, a car's economy and the price at the pump, neither of which a unit conversion can express, because each needs two quantities of different kinds.
  
  | expression | result |
  | --- | --- |
  | `fuel for 500 km at 7 l/100km` | `35.00 litre` |
  | `fuel for 300 miles at 35 mpg` | `32.45 litre` |
  | `cost to drive 500 km at 7 l/100km at £1.50/litre` | `£52.50` |
  | `cost to drive 300 miles at 35 mpg at £1.50/litre` | `£48.67` |
  | `cost to drive 300 miles at 35 mpg at $4.20/gallon` | `$36.00` |
  
  Either way of writing economy works with either kind of distance, and `fuel to drive` and `per` read the same as `fuel for` and the slash. The price carries its own volume, so a pump quoting gallons works with a trip measured in kilometres, which is the ordinary state of affairs in a hire car: the litres are converted into what the pump quoted before multiplying.
  
  Each part must be the kind of thing it claims to be, and a line that is not says which part was wrong rather than answering with a number.
  
  ```
  fuel for 500 km at 35 kg      "kg" is not a fuel economy: write it as mpg or l/100km
  fuel for 50 kg at 7 l/100km   a trip starts with a distance, as in "fuel for 500 km at 7 l/100km"
  ```
  
  The boundary: no live fuel prices. A pump price is local and changes daily, so the price is stated on the line and nothing here reaches the network.
  
  The reciprocal is the thing this had to get right. Miles per gallon is distance over volume and litres per hundred kilometres is volume over distance, so the two are filed as different measures, and `canConvert` between them is false. Asked to convert anyway, `convertUnit` does not refuse: it answers 1,488 for 35 mpg, a number with no meaning, which is what a first version of this arithmetic built a seven-thousand-litre trip on. The economy now goes through `convertRate`, the path the engine's own `40 mpg in l/100km` takes, which answers null rather than a wrong number, and a spec pins both directions against hand-computed figures.

## 2.27.0

### Minor Changes

- 9ad7d8d: Oven gas marks, and scaling a recipe by its servings.
  
  A British gas oven is not marked in degrees: its dial runs from a quarter to nine, and each mark stands for a temperature. That is a lookup rather than a sum, because the steps are uneven, so no unit conversion could express it.
  
  | expression | result |
  | --- | --- |
  | `180C in gas mark` | `gas 4` |
  | `350F in gas mark` | `gas 4` |
  | `gas mark 4` | `180.00 C` |
  | `gas 6` | `200.00 C` |
  | `gas 6 in F` | `392.00 F` |
  
  Both spellings a recipe uses are read, and the answer to `in gas mark` is text because "gas 4" is what the dial says. That also keeps the two slow settings readable: 110°C is `gas 1/4`, a dial position rather than the number a quarter. A temperature between marks reads as the nearer one within ten degrees, half the widest step in the table; further out is not a gas setting at all and says so.
  
  ```
  300C in gas mark    300C is not a gas setting: the dial runs from gas 1/4 (110C) to gas 9 (240C)
  ```
  
  Scaling gives the factor to multiply quantities by when you are cooking for a different number of people.
  
  | expression | result |
  | --- | --- |
  | `scale 4 servings to 6` | `1.50` |
  | `scale 6 servings to 4` | `0.67` |
  | `scale 4 people to 10` | `2.50` |
  | `scale 2 to 5` | `2.50` |
  
  The word for what you are counting is yours (`servings`, `serves`, `people`, `portions`) or you can leave it out. This is a factor, not a recipe parser: it hands you the number and you apply it to the quantities you care about.
  
  The boundary is that neither word is claimed. `gas` and `scale` stay ordinary identifiers everywhere else, and are read as cooking only when the rest of the phrase is present: a number after `gas`, and a complete `scale ... to ...` around `scale`. So `:scale = 1.5` still defines a variable, which a lexer keyword would have broken, and the playground's own recipe example still runs.
  
  Nothing was added for ingredients or Fahrenheit. `2 cups flour in grams` already works through the units' ingredient densities, and `180C in F` is an ordinary conversion; this package is only what those two cannot express.

## 2.26.0

### Minor Changes

- 32b1273: Every date the engine computes now goes through one calendar backend, and the backend is an engine option.
  
  ```ts
  import { createEngine } from "solve-engine";
  import { DATE_CALENDAR } from "solve-engine/engine";
  
  const engine = createEngine({ calendar: DATE_CALENDAR });
  ```
  
  The `calendar` option takes a `CalendarBackend`, the interface behind which the engine reads which local day an instant falls on, steps days and months, walks working days, reads `now`, parses and writes ISO 8601, formats a date and resolves a named time zone. It defaults to the built-in `Date` backend, which is the code the engine has always run moved behind the interface method by method, so an engine that sets nothing computes exactly what it did before: every date result, in every zone, is unchanged. The option exists so a later release can ship a `Temporal` backend, behind its own entry point, that carries a time zone of its own; the engine still imports no polyfill.
  
  An `as` converter now receives the same optional execution context a plugin function does, `(value, context?) => Value`, so a converter that reads a date computes through the engine's backend rather than a module-level default. A converter that ignores the second argument is unchanged.
  
  Every site the engine owns reads the option: the VM's date opcodes, the plugin functions and `as` converters, the rules that fuse a date literal, and the parser for the forms that read a literal while parsing (`days in <period>`, the stocks and historical-currency date phrases). Two sites sit outside the engine and are told separately. `formatValue` is a free function with no engine in hand, so `FormattingSettings` gains an optional `calendar` field: pass the same backend the engine was given and a date displays in the zone it was computed in; leave it out and the display reads the `Date` backend, as before. A worker runtime takes it on a new `WorkerRuntimeOptions.calendar`: a backend is an object of functions and does not cross the message boundary, so a host with its own bakes it into its worker entry, as it does for a custom package, and the runtime applies it to the formatting the main side sends. The inline offload worker computes with the `Date` backend.
- 32b1273: A date the engine cannot read is refused by name, instead of quietly becoming arithmetic.
  
  A written date is ambiguous. `03/04` is 3 April or 4 March depending on where you are, and the engine used to settle it by the separator: a slash date read day first, a hyphen date month first. When that guess failed there was nowhere to fail to, so the line fell through to the arithmetic it is spelled like and showed a plausible number. A wrong date is bad; a wrong date wearing the clothes of a right answer is worse.
  
  | expression | before | now |
  | --- | --- | --- |
  | `29 February 2026` | `51,327,216,000,000` | not a real date: February 2026 has 28 days |
  | `31 April 2026` | `55,024,938,000,000` | not a real date: April 2026 has 30 days |
  | `12/25/2026` | `0.00` | not a date read day first: there is no month 25. Read month first it is 25 December 2026 |
  | `2026-13-45` | `1,968` | not a real date: there is no month 13 |
  | `31/04/2026 + 1 day` | `1.01 day` | the refusal, carried through the line |
  
  The refusal is a value, not a throw, so one bad line never takes the document down with it. Every message names the reading that failed and the one that would have worked, because a reader who typed `12/25/2026` meant something, and the engine knows what.
  
  The divisions that are divisions stay divisions: `1024/8/2` is still `64`, `2000/12/25` still `6.67`, `1000/10/5` still `20`, and `2024 - 5 - 3`, written with spaces, is still `2,016`. A run of one- and two-digit groups (`12/13/14`) keeps its old reading too. What changed is only a run carrying a four-digit year that no configured order can read.
  
  Set `date.onAmbiguous: "arithmetic"` to restore the old behaviour exactly, value for value.
  
  **The order can now come from the reader's locale.** `date.inputOrder: "locale"` infers day-month order from the host, and `date.inputLocale` names a tag when the host's own locale is not the reader's, which on a server it never is. Inference is opt-in in this release and stays so until the next major; nothing infers unless asked, and an engine given no configuration constructs no `Intl` formatter at all.
  
  **A line can say how it was read.** `engine.getDateReading()` reports the order in force and where it came from, `engine.readDates(text)` reports one reading per literal with its span, and `explainLine` gains a first step for a literal whose reading was not obvious.
  
  ```
  03/04/2026 read as 3 April 2026, day first, the default for a slash date.
  Month first would be 4 March 2026.
  ```
  
  Nothing about `formatValue` output changes for a date that reads cleanly.
  
  **A date can be read in a time zone.** `<date> in <zone>` names the zone and shows the answer in it.
  
  | expression | before | now |
  | --- | --- | --- |
  | `3 April 2026 in Tokyo` | `1,775,170,800,000.00 Tokyo` | `Friday, April 3, 2026` |
  | `2026-04-03T09:00 in Tokyo` | `1,775,203,200,000.00 Tokyo` | `Friday, April 3, 2026, 9:00:00 AM` |
  | `3 April 2026 in New York` | a parse error | `Friday, April 3, 2026` |
  
  A two-word city name works, so does a standard abbreviation, and so does `UTC`. A signed offset does not: `in GMT+9` reads as `(in GMT) + 9`, which adds nine milliseconds, because a date plus a bare number is milliseconds throughout the engine. The time page says so and points at `in Tokyo` or `in JST`.
  
  The boundary this release draws: an ISO literal carrying `Z` or an explicit offset records that offset and keeps displaying in the zone the engine computes in, unchanged. Whether such a literal should display in the offset it names is a separate question, and moving it would change every document that pastes a timestamp, so it waits for the next major.
  
  Two defects found while building this and fixed here: a wall-clock reading near a daylight-saving transition resolved backwards in any zone behind UTC, so asking for midnight on a spring-forward morning in Santiago landed on the previous day; and a calendar day re-anchored into another zone read the host's wall clock rather than the day, which named the wrong day on a host whose local midnight does not exist.
- 32b1273: The engine computes dates on `Temporal` wherever the runtime has one.
  
  `Temporal` is the JavaScript standard library's replacement for `Date`, and it is no longer a curiosity: Chrome, Edge, Firefox and Opera ship it, Node ships it from 26, and it covers about 71% of browsers by usage. Where it is absent (Node 22 and 24, Safari, iOS) the engine falls back to `Date`, which is what every engine computed with before.
  
  Nothing is asked of a host to get this, and no polyfill is bundled. What the engine carries is the adapter, the code that translates its calendar contract onto whichever implementation it finds.
  
  | root bundle, gzipped | bytes |
  | --- | --- |
  | before | 98,981 |
  | now, with the adapter | 100,626 |
  | had a polyfill been bundled instead | about 118,000 |
  
  The adapter costs 1,645 bytes. The smallest polyfill is 20.4 KB gzipped, twelve times that, and on a runtime that already has `Temporal` it would only duplicate what is there. A smoke test walks every chunk the root entry loads and fails if one names a polyfill package, or if the adapter has gone missing and the engine can no longer prefer `Temporal` at all.
  
  The `calendar` option pins the choice when it matters.
  
  | `calendar` | what the engine computes on |
  | --- | --- |
  | omitted, or `"auto"` | `Temporal` where the runtime has it, `Date` otherwise |
  | `"temporal"` | `Temporal`, refusing to build an engine on a runtime without one |
  | `"date"` | `Date`, whatever the runtime has |
  | a backend | the one you built, from a polyfill or bound to a time zone |
  
  Pin `"date"` when a result must not depend on where it was computed, and `"temporal"` when you would rather an engine refuse to start than quietly compute on `Date`; that refusal is a coded `CALENDAR_TEMPORAL_UNAVAILABLE` error naming both ways out.
  
  No result changes. The two backends are held to the same answers, which is what makes preferring one safe rather than a coin toss: `npm run test:temporal` runs the date suites under both in three time zones, and a differential suite compares them case by case. A reader on Firefox and a reader on Safari see the same number.
  
  The boundary: this changes which implementation computes a date, not what a date means. The engine's payload is still epoch milliseconds with no zone attached, so a `Temporal` engine does not yet answer a question a `Date` engine could not. What it buys is the ground for the zone-aware work to stand on, and one fewer reason to reach for a polyfill.

### Patch Changes

- 790a93f: The take-home figures name the tax year they are for, and the package ships a table for each year rather than one.
  
  The payroll package carried a single table labelled 2024/25 and used it as the default for good, so the label went stale when the tax year rolled over and nothing said which year an answer was on. There is now a table for 2024/25, 2025/26 and 2026/27, a lookup by the year as a reader writes it (`2025/26`, `2025-26`, `2025/2026`), and the default is the latest table shipped.
  
  | | before | now |
  | --- | --- | --- |
  | the year an answer is on | 2024/25, whatever the date | 2026/27, the latest table shipped |
  | a year the package has no figures for | not askable | answered as unknown, never the nearest year |
  
  No result changes. HMRC left the employee figures unchanged across all three years (the £12,570 personal allowance tapering above £100,000, income tax at 20%, 40% and 45%, and employee National Insurance at 8% between £12,570 and £50,270 then 2% above), so `50000 after tax` is `39,519.60` under each.
  
  The default is deliberately the latest table rather than a year read off today's date. A tax year the package has no figures for would otherwise be answered with the previous year's, silently, which is the same mistake as assuming a sales-tax rate. The employer's National Insurance rate and secondary threshold did move in April 2025; this package models an employee's deductions only, so those do not appear.
- 6b3c0a6: An ISO date is read as ISO whatever `date.inputOrder` is set to.
  
  `date.inputOrder` fixes how an ambiguous numeric date is read. `DMY` and `MDY` require a one- or two-digit leading group, so a hyphen date starting with a four-digit year matched no reading, the rule fell through, and the line became the arithmetic it is spelled identically to. A host that set `MDY` for its US readers turned every bare ISO date in every document into a subtraction, silently.
  
  | expression, with `inputOrder: "MDY"` | before | now |
  | --- | --- | --- |
  | `2026-04-03` | `2,019` | `Friday, April 3, 2026` |
  | `2026-04-03 + 1 day` | `2,020 day` | `Saturday, April 4, 2026` |
  | `2024-5-3` | `2,016` | `Friday, May 3, 2024` |
  
  A four-digit leading group is neither a day nor a month, so there is nothing there for an order to resolve: the ISO reading is now taken before the order is consulted at all. The `DateInputOrder` documentation already claimed this held.
  
  The boundary is hyphens. A slash date starting with four digits (`2023/12/25`) is still claimed by `YMD` alone, which is what the input-order table on the date-literals page documents, and a spaced chain (`2024 - 5 - 3`) is still subtraction under every order.
- 32b1273: The span between two dates is counted in calendar days, so it no longer depends on where the reader is.
  
  `<unit> between <a> and <b>` measured the raw millisecond gap and divided it by a fixed 86,400,000. A daylight-saving transition between the two dates therefore leaked an hour into the answer, and its sign followed the hemisphere.
  
  | expression | before, London | before, Auckland | now, everywhere |
  | --- | --- | --- | --- |
  | `days between 01/01/2024 and 01/06/2024` | 151.96 days | 152.04 days | 152 days |
  | `days between 01/03/2024 and 01/04/2024` | 30.96 days | 31 days | 31 days |
  | `weeks between 01/01/2024 and 01/06/2024` | 21.71 weeks | 21.72 weeks | 21.71 weeks |
  
  The hour is real, but it is not what the question asks: two calendar days apart is two days wherever you read it. This was found by the differential suite that runs the date behaviour under three time zones, where the documented `weeks between` example failed in Auckland alone.
  
  The boundary is a time of day. Either endpoint carrying one makes the span elapsed time again, because `hours between 9am and 5pm` is a duration and a transition genuinely belongs in it. A span with no transition in it is unchanged, and `between` still has no direction, so the endpoints may be written either way round.

## 2.25.0

### Minor Changes

- 74dc963: The parser pipeline is faster on the paths an editor exercises most, and it fails better. Figures are medians from the engine's own benchmark suites on one machine, before and after this release.
  
  Lexing a line is two to three times faster. The scanner used to be a generator, and every token paid a resume plus a second pass to copy the tokens out; it now scans into an array the caller owns.
  
  | line | before | now |
  | --- | --- | --- |
  | `1 + 2 * 3` | 1.10 µs | 0.40 µs |
  | `$10 + 50% of 200 - 3 kg` | 1.51 µs | 0.67 µs |
  | `100 km/h to m/s` | 1.83 µs | 0.71 µs |
  | fifty `1+1` terms | 11.76 µs | 7.60 µs |
  
  Scanning a whole document no longer searches the rest of the document from every prose line. The inline-solve and wikilink checks were unbounded, so a long note paid a cost proportional to its size on every line.
  
  | document | before | now |
  | --- | --- | --- |
  | 1,000 lines | 11.1 ms | 9.4 ms |
  | 5,000 lines | 75 ms | 35 ms |
  | 10,000 lines | 220 ms | 61 ms |
  | 20,000 lines | 765 ms | 129 ms |
  
  An expression that has already been compiled is answered without lexing or normalising it again, and a line that does not parse is remembered so the next evaluation skips its front half and the throw. A line being typed does not parse for most of its life, and every re-evaluation of the document was paying for it in full.
  
  | single evaluation | before | now |
  | --- | --- | --- |
  | cached expression | 3.80 µs | 1.58 µs |
  | line that does not parse, repeated | 9.30 µs | 1.04 µs |
  
  The normaliser tries fewer rules at each token position. Every rule now declares the token types it can start on, and the first pass over a document is filtered by that declaration the way later passes already were: attempts per token on a cold first pass fall from 52.7 to 14.1, and on a warm pass from 9.0 to 7.0, with the normalised stream proven identical over every example in the docs and the normaliser specs.
  
  Parse errors now say where. Every error the parser raises carries a `span`, the offending token's or an empty span just after the last token when the line stops short, so an editor can underline the position rather than show a sentence. Codes and messages are unchanged.
  
  ```ts
  try {
    engine.evaluateExpression("2 +* 3");
  } catch (e) {
    (e as EngineError).span; // { start: 3, end: 4, line: 1, col: 4 }
  }
  ```
  
  A minus sign or an en dash pasted from a word processor or a web page now subtracts. Both were filed as unknown identifiers.
  
  | expression | before | now |
  | --- | --- | --- |
  | `10 − 3` | Undefined variable | `7` |
  | `10 – 3` | Undefined variable | `7` |
  
  The em dash is deliberately not an operator: it is a sentence mark, and a line carrying one is prose.
  
  A tokeniser fault stays on its line. An unterminated quote part way through a document used to abort the whole scan, so one half-typed line blanked every other line's result; the line now carries its error and the scan continues. Highlighting paints the tokens read before the fault instead of blanking the line.
  
  The parser and the bytecode builder refuse what they used to truncate. An index or byte operand outside 0 to 255 throws `BYTECODE_OPERAND_OUT_OF_RANGE` instead of being written modulo 256; a jump patched outside the emitted stream is refused; numeric literals are interned, so a line that repeats one literal three hundred times uses one constant-pool slot, and `TOO_MANY_NUMERIC_CONSTANTS` now counts distinct literals; and the parser restores its nesting depth, its builder and the binding power exposed to parselets after a throw, not only on the success path.
  
  Package registration is exact. A vocabulary (keywords, operators, units) is registered all at once, so a collision on the third keyword no longer leaves the first two behind. Each keyword, unit, operator and `callFusions` word remembers which packages claimed it: the newest claim is in force, as before, and unregistering one package hands the word back to the other rather than deleting it for both. Registering a package now clears the compiled caches, since a package can change what a line means.
  
  Smaller corrections: a diagnostics collector sees the normaliser's fusion events on a repeated evaluation of a cached line, which the cache's early return had been skipping; the postfix `%` parselet reports the binding power the parser uses (Postfix, not Prefix); a lone `.` lexes as `DOT` rather than as a number; and the parser benchmark now times parsing (0.5 µs to 1.6 µs per line) rather than the registry construction it was measuring before (about 14 µs).
  
  Deprecated: `buildTokenLookup` and the lookup parameter of `Lexer` and `ExpressionLexer`. The lexer never read the lookup it was handed, and the engine no longer builds one. Both stay for one more major and are removed in 3.0.

## 2.24.0

### Minor Changes

- a5f4cec: The root entry now exports `Value`, `ValueType`, `formatValue` and the `FormattingSettings` type, so reading and displaying a result needs no import from `solve-engine/vm` or `solve-engine/format`. Both subpaths keep exporting them; this is the same binding under the name a first-time reader reaches for.
  
  ```ts
  import { createEngine, ValueType, formatValue } from "solve-engine";
  ```
  
  The worker DTO `SerializedValue` is renamed `SerializedWorkerValue`. The old name stays as a deprecated alias for at least one minor release. The root entry's `SerializedValue`, the snapshot shape, is unchanged, and the two carrying one name from two subpaths was the clash this resolves.
  
  The batcher's "onLineResult is not set" warning no longer fires for a host reading `getEventStream()`, which is the documented way to consume live values; it fires only when nothing at all is listening, and its wording names both options.
- 43dd772: Hardening from the production-readiness review: a network switch, honest failures where the engine used to fail soft, and grouped money.
  
  **`network.enabled`.** A host that must not make outbound requests switches live data off when it constructs the engine: `createEngine({ config: { network: { enabled: false } } })`. No async resolver runs, so no request is started, and every live-data form answers with a `NETWORK_DISABLED` error naming the setting. Rates primed by hand keep converting, and a global variable still waits for the line that declares it. The default is on, which is what every existing consumer gets today. A package resolver that reads engine state rather than a network declares `local: true` to keep running with the switch off; see the async data source guide. The boundary: a plugin function that returns a promise directly has already run by the time the engine sees it, so the engine refuses the result but cannot recall a request the function started. The built-in packages all fetch through resolvers, which the switch stops before they run.
  
  **Text operations are budgeted.** `x repeated 400000000 times` allocated eight hundred megabytes inside one opcode, invisible to the instruction and stack limits. `repeated` and `replace` now charge their result against `vm.maxAllocatedElements` before building it, and refuse with `ALLOCATION_LIMIT_EXCEEDED` the way a matrix product does.
  
  **Snapshots are validated before they run.** `fromJSON` checked only the envelope; the opcodes, constant pools and nested bodies went into an executable program on trust, and a crafted snapshot could nest bodies until the native stack overflowed. Every field is now checked against the format and refused with `SNAPSHOT_MALFORMED` naming the path to it. Bodies nest at most 32 deep.
  
  **The VM reports instead of guessing.** Four paths answered a fault with a plausible number: a stack underflow read as `0`, a push past `maxStackDepth` dropped the value, a plugin index nothing was registered at pushed `0`, and an unknown builtin index popped its arguments and pushed nothing. Each is now a named error (`STACK_UNDERFLOW`, `STACK_LIMIT_EXCEEDED`, `UNKNOWN_PLUGIN_FUNCTION`, `UNKNOWN_BUILTIN_FUNCTION`). These are package or bytecode faults, never a typed line, so no expression that evaluated before evaluates differently now.
  
  **A hung worker is replaced.** The execution pool answered a 30-second timeout or a crash with an empty result and kept dispatching to the same worker, so one bad input degraded a quarter of the pool for the rest of the process. It now terminates and replaces that worker, and every line it was holding gets a `WORKER_TIMEOUT` or `WORKER_EXECUTION_ERROR` result, so the host sees the failure rather than a Pending state that never clears. Batches on the other workers are untouched.
  
  **Money and quantities group their digits.** A plain `52000` showed as `52,000` while `£52000` showed as `£52000.00`, because the money path skipped the grouping the number path used. Both now follow `enableSeperator` and the locale's own decimal mark.
  
  | expression | before | now |
  | --- | --- | --- |
  | `£52000` | `£52000.00` | `£52,000.00` |
  | `1234567 km` | `1234567.00 km` | `1,234,567.00 km` |
  | `1000 days` | `1000 days` | `1,000 days` |
  
  **Smaller repairs.** The async cache key names each argument's type and unit, so `5`, `"5"` and `5 kg` no longer share one cached answer. The lexer's private copy of the built-in phrase table, which had never learned `divided by`, is gone in favour of the one table the normaliser reads. Three `daysInMonth` implementations with two different month conventions are one. Currency requests are built with `URLSearchParams`. A `?__proto__=x` query key decodes as an ordinary entry rather than vanishing.

## 2.23.0

### Minor Changes

- dfebe3c: Compare two prices with `vs`.
  
  ```
  £3 / 500g vs £4 / 750g    the second is cheaper, 11% less
  £3 vs £4                  the first is cheaper, 25% less
  ```
  
  The discount and unit-price maths a shopper wants is already ordinary arithmetic
  (`£80 - 20% - 10%` stacks discounts, `£3 / 500g` is a per-gram price); this adds
  the one piece that was missing, putting two of them side by side. Lower is
  cheaper, and the two sides have to be the same kind of thing, so a price against
  a weight is an error rather than a meaningless answer. `versus` is an alias, and
  two equal amounts read as `the same`.

## 2.22.0

### Minor Changes

- c222736: A distance or a data size *at* a rate is now a duration.
  
  ```
  250 miles at 60 mph    4.17 h
  4 GB at 50 Mbps        10.67 min
  ```
  
  `at` a speed answers a drive time; `at` a bandwidth answers a transfer time. New
  bandwidth units back the second one: `Mbps`, `Gbps`, `kbps`, and the byte forms
  `MBps`, `GBps` (the bit/byte distinction riding the unit's case, as it does for
  data sizes). The answer comes back in the largest sensible time unit; convert the
  whole thing for another, `(250 miles at 60 mph) in minutes`.
  
  The money `at`-rate is untouched: `$500 at $20/hour` is still `25 hours`. The new
  behaviour applies only when the quantity is a distance or a data size that
  matches the rate; anything else is reported as an error, not a wrong number.

## 2.21.0

### Minor Changes

- 684d44f: Look up crypto prices, `crypto("BTC")`.
  
  The price comes back as ordinary money, so the rest of the language does the
  arithmetic: `0.5 * crypto("BTC")` is the value of half a coin, and `... in GBP`
  converts it through the currency package. So the "half a Bitcoin in dollars" a
  reader wants is `0.5 * crypto("BTC")`, in whatever currency the provider quotes.
  
  Like stocks, and for the same reason, the package is opt-in and not in the
  default engine: there is no free, keyless crypto price API to bundle, so a host
  supplies `fetchPrice` via `createCryptoPackage({ fetchPrice })`. Without it, a
  crypto expression resolves to an honest `CRYPTO_NOT_CONFIGURED` error, never a
  faked or zero price.

## 2.20.0

### Minor Changes

- 25c57e2: Work out UK take-home pay from a salary.
  
  `<salary> after tax` (and `take home on <salary>`) subtracts income tax and
  National Insurance:
  
  ```
  50000 after tax     39,519.60
  120000 after tax    76,157.40
  ```
  
  `per month after tax` gives the monthly figure, and `hourly for <salary>` is the
  gross as an hourly rate. A salary keeps its currency, so a `£` figure answers in
  `£`.
  
  The figures are the full HMRC bands for England, Wales and Northern Ireland, tax
  year 2024/25: the personal-allowance taper over £100,000, the 20/40/45% income
  tax bands, and employee NI at 8% then 2%. Scotland sets its own income tax bands
  and is not covered, the same boundary the sales-tax rule draws: a rate that is
  not shipped is not assumed.

## 2.19.0

### Minor Changes

- 5b201ca: Convert between CSS pixels and rem.
  
  `px` and `rem` are now units, for the front-end habit of switching between them:
  
  ```
  16px in rem     1.00 rem
  1.5rem in px    24.00 px
  ```
  
  One rem is 16px, the CSS default root font size. They add and subtract like any
  other unit, and are a measure of their own, kept apart from physical length: a
  CSS pixel is a reference pixel, not a slice of a centimetre. `em` is left out on
  purpose, since it is relative to an element's own font size rather than the root,
  so a single fixed value would be misleading.

## 2.18.0

### Minor Changes

- 0eaec98: Decode a JSON Web Token or a URL query string, in the encoding package.
  
  `jwt(...)` (also `... from jwt`) reads a JWT's payload, the claims it carries, and
  returns them as JSON:
  
  ```
  jwt("eyJhbGci…")    {"sub":"1234567890","name":"John Doe","iat":1516239022}
  ```
  
  The signature is never checked, and that is deliberate: verifying it needs the
  signing key, and a calculator is the wrong place to imply a token is genuine.
  `jwt` reports what a token says, and a malformed one is an error rather than a
  half-read result.
  
  `query(...)` (also `... from query`) parses a URL query string into JSON,
  decoding the percent-escapes and reading `+` as a space:
  
  ```
  query("name=John+Doe&page=2")    {"name":"John Doe","page":"2"}
  ```
  
  Both extend the existing encoding package, alongside base64, URL and hex bytes.

## 2.17.0

### Minor Changes

- 2bb7c57: Index the normalizer's rules by the shape they match, and measure the stage.
  
  Normalising a token stream tried every registered rule at every position. With
  the built-in packages that is 57 rules, and the existing `startTokenTypes` hint
  did not narrow it: only thirteen rules carried one and all thirteen named
  `IDENT`, the commonest token in prose, so an identifier was a candidate for 53
  of the 57 and a number for 45. Rules now declare the shape they match and the
  normalizer intersects those declarations, which takes a position from 55
  candidate rules to 9.
  
  ## Declaring a shape
  
  A rule states what the tokens from its match position onward may be, one slot
  per position, by type and by value:
  
  ```ts
  // 9:00am, 16:00 — a clock time is a number followed by a colon
  shape: [{ types: ["NUMBER"] }, { types: ["COLON"] }]
  
  // sha256("hi") — a known word followed by an opening parenthesis
  shape: [{ types: ["IDENT"], values: HASH_NAMES }, { types: ["LPAREN"] }]
  ```
  
  The second slot is what the older hint could not express. Every rule firing on a
  bare number declares the same start type, so start type alone leaves them all
  candidates at every number; what separates them is the token after it, a colon
  opening a clock time where a slash opens a network address. The value axis does
  the same job for the call-fusion rules, which share a start type and are told
  apart only by the word.
  
  `startTokenTypes` still works and means what it always did. `shape` supersedes
  it, and 50 of the 57 built-in rules now carry one.
  
  ## What it costs to reject a position
  
  Each declared slot becomes a flat array of rule bitmasks indexed by token type
  id. A position ANDs them and walks the surviving bits, so one instruction tests
  32 rules and the common answer, that nothing can fire here, costs a few array
  loads rather than a call per rule.
  
  Measured against 2.16.0, which had already bucketed rules by their first token:
  
  | normalising | 2.16.0 | now |
  | --- | --- | --- |
  | 500-line document | 1.384 ms | 0.664 ms (2.1x) |
  | phrase fusion | 7.4 µs | 2.9 µs (2.6x) |
  | plain arithmetic | 5.3 µs | 2.4 µs (2.2x) |
  | implicit multiplication | 12.6 µs | 5.9 µs (2.1x) |
  | unit conversion | 4.1 µs | 3.1 µs (1.3x) |
  
  Bucketing by first token could not separate these: every rule that fires on a
  bare number declares the same start type, so they all stayed candidates at every
  number. The second slot is what tells them apart, a colon opening a clock time
  where a slash opens a network address.
  
  The two designs compose. `callFusions` collapses the seven `name(` rules into
  one shared map lookup, so there are 51 rules to index rather than 57, and the
  shape index then separates what remains by its second slot. Candidates per
  position fall from 46.7 to 7.5.
  
  ## Compiling
  
  `build()` runs once per compiled expression and was attaching an empty `Map` to
  every program for a field nothing populates, plus an empty array and an empty
  typed array for programs that emit no strings or numbers. Dropping the map and
  sharing frozen empties cut parse-and-compile by 17% to 34% depending on the
  expression, most on short ones where the fixed cost dominated.
  
  A document of complex expressions parses about 17% faster end to end. A document
  of ordinary mixed content is unchanged, which is what the stage split predicts:
  normalising is now 19% of the pipeline, so halving it moves the total very
  little.
  
  ## Errors stopped capturing stack traces they never needed
  
  A recoverable `EngineError` is a value, not a fault: a line of prose is not an
  expression, so parsing it fails, and that failure is the answer for the line. It
  was nonetheless capturing a full JavaScript stack, twice, once in the `Error`
  constructor and again to trim one frame from it.
  
  Capturing a stack costs more the deeper the stack is, and the throw sits about a
  dozen frames down inside a document pass, so each cost around 62 microseconds. A
  250-line document built 74 of them. A CPU profile put the error constructor at
  **46% of the whole pipeline**, more than lexing, normalising, parsing and
  executing together.
  
  | document | 2.16.0 | now |
  | --- | --- | --- |
  | 200 lines of prose | 11.04 ms | 2.27 ms (4.9x) |
  | 1000 lines, warm | 44.07 ms | 14.77 ms (3.0x) |
  | 250 lines, warm | 8.80 ms | 3.17 ms (2.8x) |
  | 200 complex expressions | 4.97 ms | 3.22 ms (1.5x) |
  
  Across the document suite, 2.64x faster with no case slower.
  
  An error that is not recoverable is a genuine fault and still captures a full
  stack. `EngineError.captureRecoverableStacks = true` restores them for the rest
  while debugging.
  
  ## Number literals
  
  Parsing `144` ran six `startsWith` checks, two regular expressions, a locale
  lookup and a `split`/`join` that allocated whether or not the separator was
  present. A profile put that path at over a third of parse-and-compile. One
  character scan now settles the common shapes, the locale's separators are read
  once per parser rather than once per literal, and `reset()` no longer clears
  collections that are already empty.
  
  Parse-and-compile CPU fell 54% on a fixed workload.
  
  ## Ordering the guards
  
  Separately, four rules tested an expensive condition before a cheap one.
  `isInsideRangeContext` walks back to the start of the line to decide whether a
  position sits inside a matrix literal, and the three time-literal rules called it
  as their first statement, ahead of the test for whether the token was a number at
  all: a line of prose with no digits paid three backward walks per word, and the
  cost grew with the square of the line length. Implicit multiplication likewise
  lower-cased the next token's text before checking the current token's type.
  
  Reordering is safe in one direction and this is that direction: each of these
  guards only ever declines a match, so testing it later among a run of declining
  guards cannot change a result.
  
  ## The stage that was not being measured
  
  The pipeline throughput benchmark built its token stream without the normalizer,
  so its per-stage breakdown described a four-stage pipeline in three numbers.
  
  | stage | reported | measured before | now |
  | --- | --- | --- | --- |
  | Lex | 30.1% | 11.5% | 23.1% |
  | Normalise | not measured | 51.2% | 27.5% |
  | Parse and compile | 58.8% | 22.9% | 34.2% |
  | Execute | 11.2% | 12.6% | 15.3% |
  
  Normalising was the largest stage in the pipeline and was invisible. A new
  `normalizer` benchmark suite now covers it directly, with a committed baseline.
  The lines-per-second figures in the same file were computed per millisecond, so
  every recorded one read a thousand times slower than the run had been.
  
  ## The boundary
  
  This narrows which rules are tried, not what they do. Rule bodies, priorities and
  first-match-wins are unchanged, and a rule declaring no shape is still tried
  everywhere, which is why seven procedural rules (unbounded scans, a mutable
  user-unit table) keep the candidate floor above zero. The multi-pass fixpoint and
  the per-pass array allocation are untouched and are the next targets.
  
  ## Verification
  
  `npm run verify` passes: 8,180 tests across 375 suites, including the 613 proven
  documentation examples, plus the build, the packaged smoke test and the
  bundled-consumer tree-shaking contract.
  
  Two specs guard the index specifically, because behaviour parity alone cannot
  tell a working index from one that admits everything. `NormalizerIndexFidelity`
  runs every rule unfiltered over a corpus and asserts the index admits every
  position a rule really matches, then asserts the indexed and unindexed walks
  agree token for token; a new `ignoreRuleIndex` option exists for that comparison.
  `NormalizerIndexSelectivity` asserts the candidate count actually falls, which is
  the failure the older hint had: it was correct, and it filtered nothing.

## 2.16.0

### Minor Changes

- 6e429f9: Route normalizer rules by first token type, and share one call-fusion rule (no behaviour change).
  
  The token normaliser rewrites the token stream between lexing and parsing, and it
  tried every registered rule at every token position. Two changes cut that work,
  with no change to what any expression evaluates to.
  
  ## Bucket rules by their first token type
  
  Most rules only fire on one kind of token (a `NUMBER`, a `UNIT`, a particular
  keyword). Each rule now declares that first token type, and the normaliser tries a
  rule only at a position whose token matches, skipping it everywhere else. This is
  behaviour-identical, since the rule would have matched nothing at those positions
  anyway. It drops the average from tens of rule attempts per position to a handful.
  
  ## One shared call-fusion rule, via a new `callFusions` field
  
  The `name(` function-call rules (`sha256(`, `length(`, `percentile(`, `ratio(`,
  `bmi(`, `pick(`, ...) were seven near-identical normaliser rules, each tried at
  every identifier. A new declarative package field,
  `IEnginePackage.callFusions`, maps a lower-cased word to the token type to mint
  when it is followed by `(`; the engine merges every package's entries into one
  map and runs a single rule for all of them. Adding a function is now one map entry
  rather than one more rule tried everywhere.
  
  ## Result
  
  Parse-heavy paths are faster with no regression. On the benchmark comparison the
  syntax-highlighting suite (which re-normalises on every keystroke) is about 16%
  faster overall, with individual cases up to 1.6x; the evaluation pipeline and the
  diagnostic pipeline improve by a few per cent. Nothing regressed over the
  comparison threshold.
  
  For package authors: `callFusions` is documented in the
  [recognising phrases and words](/packages/recognising-phrases/) guide, with its
  boundary (the plain `word (` shape; anything more stays a hand-written
  `normalizerRules` entry).
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks. New test:
  `normalizer/CallFusions.spec.ts` (the consolidated fusion, and that unregistering
  a package drops exactly its call words).

## 2.15.0

### Minor Changes

- b2644b2: Raise the plugin-function ceiling past 256, index the normalizer, and remove dead code.
  
  Three internal changes, no change to any documented behaviour.
  
  ## More than 256 plugin functions
  
  The plugin-function index is a bytecode operand and was a single byte, so a
  process could register at most 256 plugin functions before the allocator threw
  (the built-ins already use 137). A new `CALL_PLUGIN_WIDE` opcode carries a
  two-byte index and is emitted only when an index exceeds 255; the one-byte
  `CALL_PLUGIN` is unchanged, so existing compiled bytecode and snapshots are
  byte-for-byte identical. The ceiling rises to 65536. A test proves a function
  past index 255 dispatches to the exact slot (index 300 stays 300, not the
  wrapped 44).
  
  ## Faster document parsing
  
  The token normaliser tried every registered rule at every token position. Most
  rules begin with a single first-token guard (a call-fusion rule only fires on an
  identifier), so trying them at the many number and operator tokens in a document
  was wasted work. Rules now carry an optional `startTokenTypes` hint and the
  normaliser only tries a rule at a matching position, which is behaviour-identical
  because the rule would have returned nothing elsewhere. Parse-heavy benchmarks
  improve by a few per cent with no regression.
  
  ## Dead code
  
  Removed six unused internal exports (`isComplexOne`, `consumeVariableName`, the
  `DebugInfo` tooling interface, the `EventType` alias, `functionCallsUsed`,
  `registerLocale`), an accidental duplicate declaration of `DiagnosticReportJSON`,
  and the imports they left behind. None was on the public API surface.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks. The benchmark comparison
  against the merge base reports no regression over threshold. New test:
  `vm/WidePluginIndex.spec.ts`.

## 2.14.1

### Patch Changes

- 293f387: Make engine construction dramatically faster (no behaviour change).
  
  Constructing an `ExpressionEngine` with the built-in packages had grown to about
  2ms, almost all of it in registration rather than in evaluating anything, and it
  scaled worse than linearly as packages were added. Three fixes remove that cost,
  with no change to what the engine does:
  
  - **The package-compatibility check was O(packages²).** Registering each package
    re-ran the pairwise `checkPackageCompatibility` against every package already
    registered, so with the full set that scan alone was the majority of
    construction. It is now an incremental index that checks a new package only
    against the ones sharing a declaration with it (a parselet token type, a
    phrase, a converter or plugin-function name, a lexer keyword, ...): a package
    that shares nothing can conflict with nothing, so the result is identical, in
    linear time. A parity test pins the index to the old pairwise result on the
    real built-ins and on crafted collisions across every category.
  
  - **The lexer rebuilt its 1000+ entry unit set on every keyword registration.**
    The merged keyword map and the merged unit set were rebuilt together on each
    `registerVocabulary`, and the unit set is the whole built-in vocabulary, so
    every keyword-only package copied more than a thousand entries for nothing. The
    two are now rebuilt independently, and the common no-plugin-units case shares
    the built-in set directly rather than copying it.
  
  - **The merged keyword map is maintained incrementally.** A plugin keyword can
    never shadow a built-in, so it is added straight to the merged map rather than
    rebuilding the whole thing.
  
  | measure | before | now |
  | --- | --- | --- |
  | engine construction | ~2.0 ms | ~0.46 ms |
  | a single cold evaluation | ~2.1 ms | ~0.6 ms |
  
  Every cold-start benchmark improves accordingly (`single_eval_cold` about 3.4×
  faster, and the pipeline suite about 2.5× overall), with no benchmark regressing.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks. The benchmark comparison
  against the merge base reports the improvement with no regression over threshold.
  New test: `api/PackageCompatibilityIndex.spec.ts` (index-vs-pairwise parity).

## 2.14.0

### Minor Changes

- c67defa: Add constants and health helpers (issues #256, #257).
  
  Two utilities to round out the everyday-maths set, each its own on-by-default,
  removable package.
  
  ## Constants
  
  Named physical and mathematical constants, reached by name. Where a constant has
  a unit it arrives as a proper quantity, so it converts and takes part in unit
  arithmetic.
  
  | expression | result |
  | --- | --- |
  | `speed of light` | `299792458.00 m/s` |
  | `gravity` | `9.81 m/s²` |
  | `gravity * 70 kg as N` | `686.47 N` |
  | `tau` | `6.28` |
  | `golden ratio` | `1.62` |
  
  `gravity` is an acceleration, so gravity times a mass composes to a newton
  through the 2.8.0 derived-unit algebra. Also included: `avogadro`, `planck`,
  `boltzmann`, `elementary charge`, `gas constant`, `electron mass`, `proton mass`.
  `pi` and `e` already exist and are untouched.
  
  ## Health
  
  Everyday health and fitness sums, as functions with the numbers in the stated
  units (kilograms and metres, or kilometres and minutes).
  
  | expression | result |
  | --- | --- |
  | `bmi(70, 1.75)` | `22.86` |
  | `pace(10, 50)` | `5:00 /km` |
  | `speed(10, 50)` | `12.00 km/h` |
  
  `pace` and `speed` are the two ways of reading the same effort: time per
  distance, and distance per time.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks, and the docs example suite (the
  constants and health pages are proven live). New tests:
  `packages/constants/Constants.spec.ts` and `packages/health/Health.spec.ts`.

## 2.13.0

### Minor Changes

- 2ff14fb: Add ratios and geometry (issues #252, #253).
  
  Two everyday-maths utilities, each its own on-by-default, removable package.
  
  ## Ratios
  
  Reduce a ratio to its lowest whole-number terms.
  
  | expression | result |
  | --- | --- |
  | `ratio(1920, 1080)` | `16:9` |
  | `ratio(4, 8)` | `1:2` |
  | `ratio(2, 4, 6)` | `1:2:3` |
  
  It is a function rather than a `1920:1080` literal, because a colon between two
  numbers already builds a range (`1:10`). Parts must be whole positive numbers,
  and there must be at least two.
  
  ## Geometry
  
  Area, perimeter and volume of the common shapes, from their dimensions.
  
  | expression | result |
  | --- | --- |
  | `area of circle radius 5` | `78.54` |
  | `area of rectangle width 4, height 6` | `24` |
  | `area of triangle base 3, height 4` | `6` |
  | `volume of sphere radius 3` | `113.10` |
  | `volume of cylinder radius 2, height 5` | `62.83` |
  
  Circle, square, rectangle, triangle, sphere, cube, cylinder and cone are covered.
  A shape with two dimensions takes them as a comma-separated pair (`width 4,
  height 6`): the comma keeps the measurements apart, and it is what lets the
  dimension words (`width`, `height`, `radius`, ...) stay ordinary identifiers you
  can still use as names, rather than reserved keywords.
  
  ## The boundaries
  
  Only the measure triggers (`area of`, `volume of`, ...) are fused phrases; the
  shape and dimension words are read in context. Dimensions are plain numbers in
  this slice (a squared or cubed result does not yet carry a unit). A measure a
  shape does not define, or a missing dimension, is answered with a structured
  Error naming what it needed.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks, and the docs example suite (the
  ratios and geometry pages are proven live). New tests:
  `packages/ratio/Ratio.spec.ts` and `packages/geometry/Geometry.spec.ts`.

## 2.12.0

### Minor Changes

- a6d18ad: Add numeral spellings: words, ordinals and Roman numerals (issues #248, #249).
  
  The `as` converter set was binary, hex, fraction and percent. This adds the three
  classic missing spellings of a number, and reads Roman numerals back. A new
  `solve-numerals` package, on by default and removable.
  
  ## In words and as an ordinal
  
  | expression | result |
  | --- | --- |
  | `1234 as words` | `one thousand two hundred and thirty-four` |
  | `105 as words` | `one hundred and five` |
  | `3 as ordinal` | `3rd` |
  | `22 as ordinal` | `22nd` |
  | `11 as ordinal` | `11th` |
  
  Words use British spelling and the "and" of "one hundred and five"; a negative is
  spelled with "minus", and a decimal is read digit by digit after "point".
  
  ## Roman numerals, both directions
  
  | expression | result |
  | --- | --- |
  | `2024 as roman` | `MMXXIV` |
  | `1994 as roman` | `MCMXCIV` |
  | `"MMXXIV" from roman` | `2,024` |
  
  The reverse takes the numeral in `"quotation marks"` rather than as a bare
  `MMXXIV` literal, because the Roman letters `M C D L X V I` are already units and
  variable names (`V` is the volt, `C` a temperature), so a bare literal would be
  ambiguous. `from roman` is a fused phrase, so the bare `from` used by `plot` and
  `clamp` is untouched.
  
  ## The boundaries
  
  Roman numerals cover the classic range 1 to 3999. A value outside that, or a
  string that is not a valid, canonical Roman numeral (`"IIII"`, `"IC"`), is
  answered with a structured Error rather than a wrong number; canonicity is
  checked by round-tripping the parse.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks, and the docs example suite (the
  numerals page's examples are proven live). New tests:
  `packages/numerals/NumeralOps.spec.ts` and
  `packages/numerals/NumeralsEngine.spec.ts`.

## 2.11.0

### Minor Changes

- 80a7cff: Add the second tier of statistics (issues #244, #245).
  
  The statistics page had a list's centre and spread; this adds the relationship
  between two lists, and position within one. A new `solve-statistics` package, on
  by default and removable, alongside the existing maths-phrases aggregates.
  
  ## Relationships between two lists
  
  | expression | result |
  | --- | --- |
  | `correlation of [1, 2, 3, 4] and [2, 4, 5, 8]` | `0.98` |
  | `slope of [1, 2, 3, 4] and [2, 4, 5, 8]` | `1.90` |
  | `intercept of [1, 2, 3, 4] and [2, 4, 5, 8]` | `0` |
  | `rsquared([1, 2, 3, 4], [2, 4, 5, 8])` | `0.96` |
  
  Correlation is Pearson's coefficient (-1 to 1); slope and intercept are the
  least-squares line of best fit; r squared is the share of variation it explains.
  Each two-list form also has a call spelling.
  
  ## Position and the normal distribution
  
  | expression | result |
  | --- | --- |
  | `percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)` | `9.10` |
  | `zscore(9, [2, 4, 4, 4, 5, 5, 7, 9])` | `2` |
  | `normalcdf(1.96)` | `0.98` |
  | `normalpdf(0)` | `0.40` |
  
  Percentile uses linear interpolation (the NumPy default); `normalcdf` is the
  standard-normal cumulative probability, via a published error-function
  approximation. `median of ...` already ships in the maths-phrases package.
  
  ## The boundaries
  
  Lists are `[bracketed]` vectors (or an integer range). Two lists of different
  lengths, fewer than two points, or a percentile outside 0 to 100 are answered
  with a structured Error rather than a wrong number. Standard deviations here use
  the population form, matching the engine's existing `stdev`.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks, and the docs example suite (the
  new statistics examples are proven live). New tests:
  `packages/statistics/StatisticsMath.spec.ts` and
  `packages/statistics/StatisticsEngine.spec.ts`.

## 2.10.0

### Minor Changes

- 2c6cf1d: Add hashing and randomness (issues #240, #241).
  
  Two developer-facing utilities, each its own on-by-default, removable package.
  
  ## Hashing
  
  Turn a piece of text into its digest, the short fixed-length fingerprint a
  download page means by "SHA-256 checksum". Written as functions, answering
  lowercase hex.
  
  | expression | result |
  | --- | --- |
  | `sha256("hello")` | `2cf24dba…938b9824` |
  | `sha1("hello")` | `aaf4c61d…aea9434d` |
  | `md5("hello")` | `5d41402a…1017c592` |
  | `crc32("hello")` | `3610a686` |
  
  `sha512` is the longer SHA-2 member. The implementations are pure and
  synchronous (no Node `crypto`, no async Web Crypto), so a digest is an ordinary
  value produced on the spot and works unchanged in the browser worker; each is
  pinned against its canonical vectors. `md5` and `sha1` are offered for
  compatibility and are documented as no longer collision-resistant.
  
  ## Randomness
  
  Everyday random helpers, the companion to the dice package's dice-notation rolls.
  
  | form | gives |
  | --- | --- |
  | `uuid` | a random version-4 UUID |
  | `random hex 8` | 8 random hex digits |
  | `pick("a", "b", "c")` | one option at random |
  | `shuffle [3, 1, 2]` | the list in a random order |
  | `coin` | `heads` or `tails` |
  
  These draw fresh each run, so the randomness page carries no proven example
  values (it is listed, with a reason, in the docs example suite's `unprovable`
  map, the same treatment as dice).
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks, and the docs example suite (the
  hashing page's digests are proven live). New tests:
  `packages/hash/Hashes.spec.ts`, `packages/hash/HashEngine.spec.ts` and
  `packages/random/Random.spec.ts`.

## 2.9.0

### Minor Changes

- 9910933: Add text operations on String values (issues #236, #237).
  
  Text in quotation marks has always been a value, but there was no way to operate
  on one. This adds the everyday string handling a note needs alongside its sums:
  measuring text, testing it, and reshaping it, in a new `solve-text` package that
  is on by default and removable like the other utilities.
  
  ## Measuring and joining
  
  | expression | result |
  | --- | --- |
  | `length of "hello"` | `5` |
  | `words in "the quick brown fox"` | `4` |
  | `characters in "hello"` | `5` |
  | `"hello" + " world"` | `hello world` |
  
  Counting is by character, not by byte, so an accent or an emoji counts as one.
  
  ## Testing
  
  `contains`, `starts with` and `ends with` each answer a boolean, so they sit
  inside a condition.
  
  | expression | result |
  | --- | --- |
  | `"hello" contains "ell"` | `true` |
  | `"report" ends with "port"` | `true` |
  
  ## Reshaping
  
  | expression | result |
  | --- | --- |
  | `trim "  spaced out  "` | `spaced out` |
  | `reverse "hello"` | `olleh` |
  | `"ha" repeated 3 times` | `hahaha` |
  | `"the lord of the rings" as title` | `The Lord Of The Rings` |
  | `"Hello, World!" as slug` | `hello-world` |
  | `replace("banana", "a", "@")` | `b@n@n@` |
  
  Every measuring and reshaping form has a call spelling too (`length("hi")`,
  `upper("hi")`, `slug("A B C")`).
  
  ## The boundaries
  
  Two forms give way to words the language already owns, and the give-way is
  deliberate rather than a gap:
  
  - **`replace` is a function**, `replace(text, find, replacement)`, not the
    sentence "replace A with B in C", because "with" is already the word form of
    "+" (`40 with 2` is 42).
  - **"times" in `X repeated N times` is optional**, because it is the word form of
    "\*" (`8 times 9` is 72); it is recognised here only as a trailing flourish on
    the count, so `"ha" repeated 3` works too.
  - **Replacement is literal**: `find` is matched character for character, with no
    pattern matching. Regular expressions are a possible later addition.
  - **A join is text with text**: `"a" + "b"` is `ab`; a text value plus a number
    is left alone rather than coerced.
  
  Non-text input to any operation is answered with a structured Error that names
  what it wanted, never a wrong value.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks, and the docs example suite (the
  text-operations page's examples are proven live). New tests:
  `packages/text/TextOperations.spec.ts`.

## 2.8.0

### Minor Changes

- 4a360a6: Add fuel economy and named derived units (issues #190, #191).
  
  Two unit features. Fuel economy converts between the two ways it is quoted; named
  derived units let a product of quantities read out under its proper name for the
  first time.
  
  ## Fuel economy
  
  Miles per gallon and litres per 100 km measure the same thing opposite ways
  round (distance per fuel against fuel per distance), so converting between them
  is a reciprocal, not a rescale. That conversion is new.
  
  | expression | result |
  | --- | --- |
  | `40 mpg in l/100km` | `5.88 l/100km` |
  | `6 l/100km in mpg` | `39.20 mpg` |
  | `30 mpg in km/l` | `12.75 km/l` |
  
  `mpg` is miles per US gallon (the shipped gallon). A distance-per-fuel to
  distance-per-fuel conversion (`mpg` to `km/l`) already rescaled each axis; only
  the reciprocal pairing needed the new route.
  
  ## Named derived units
  
  Multiplying two compatible quantities now tracks the unit exponents through the
  operation, so a compound maps back to its named derived unit on output. This is
  the slice the 1.1.0 changelog deferred, because the engine had no dimensional
  algebra.
  
  | expression | result |
  | --- | --- |
  | `70 kg * 9.81 m/s^2 as N` | `686.70 N` |
  | `230 V * 13 A as W` | `2990.00 W` |
  | `50 N * 4 m as J` | `200.00 J` |
  | `2000 W * 3 hours as kWh` | `6.00 kWh` |
  
  `m/s^2` finally means acceleration rather than a squared rate, and the newton
  symbol `N`, the joule `J`, and the volt `V` now lex so the quantities can be
  typed. The engine also names the result without an explicit `as`.
  
  ## The boundaries
  
  - **It stops at compatible quantities.** A product that names a derived unit
    (`kg * m/s^2` is a newton) composes; one that names nothing (`m * m`) is left
    exactly as it was, and a genuine mismatch (`kg * m`) is still reported as one.
    A fuller algebra of units, and units to arbitrary powers, are a later slice.
  - **The gallon is the US gallon**, so `mpg` is miles per US gallon; a UK variant
    would be a separate spelling rather than a silent regional switch.
  - **`V` is the volt.** It does collide with the Visa stock ticker, but the
    bare-ticker form is opt-in and volts is the broader reading of `V` after a
    number.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks, and the docs example suite (the
  fuel-economy and derived-unit examples are proven live on the units page). New
  tests: `packages/fuel/FuelEconomy.spec.ts` and `packages/derived/DerivedUnits.spec.ts`.

## 2.7.0

### Minor Changes

- 1e6b354: Add text-encoding converters and IPv4 subnet arithmetic (issues #188, #189).
  
  Two developer tools that a note used to have to leave for another window: turning
  text into a safe transport form, and answering the everyday subnet questions.
  Both are new packages, on by default and removable.
  
  ## Text encoding
  
  `as` encodes a string and `from` decodes it, so a value can be turned into a form
  on one line and read back on the next.
  
  | expression | result |
  | --- | --- |
  | `"hello" as base64` | `aGVsbG8=` |
  | `"aGVsbG8=" from base64` | `hello` |
  | `"a b&c=1" as url` | `a%20b%26c%3D1` |
  | `"Hi" as hex bytes` | `48 69` |
  | `base64("Hello, World!")` | `SGVsbG8sIFdvcmxkIQ==` |
  
  `hex bytes` is two words on purpose: `as hex` already means a number shown in
  base 16, so the byte encoding is kept separate and neither reading is ambiguous.
  Encoding expects text and reports a non-text input as an error; decoding checks
  its input and reports one that is not valid, rather than handing back mangled
  text. Multi-byte characters survive the round trip.
  
  ## IPv4 subnet arithmetic
  
  An address like `192.168.1.10` names one machine; a subnet like `192.168.1.0/24`
  names a block of them, where the `/24` fixes the first 24 bits as the shared
  network.
  
  | expression | result |
  | --- | --- |
  | `hosts in 192.168.1.0/24` | `254` |
  | `netmask of /24` | `255.255.255.0` |
  | `broadcast of 192.168.1.0/24` | `192.168.1.255` |
  | `192.168.1.10 in 10.0.0.0/8` | `false` |
  | `10.0.0.0/8 as int` | `167,772,160` |
  
  ## The boundaries
  
  - **A dotted address reads as one only when written as a single run.** With
    spaces around the slash it is division, and a plain `10 / 2` is always `5`, so
    the address literal never steals a number from ordinary arithmetic. A part
    above 255 is not a valid address either.
  - **IPv6 is a later addition.** Its 128-bit colon-notation addresses need their
    own literal and arithmetic; the dotted-quad IPv4 form covers the common case.
  - **Round trips are honest.** An encode followed by the matching decode returns
    the original, and an invalid input is reported rather than guessed.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks, and the docs example suite (the
  encoding and subnet examples are proven live on the new text-encoding and
  networking pages). New tests: `packages/encoding/Encoding.spec.ts` and
  `packages/ip/Ip.spec.ts`, both including the worker-DTO round-trip.

## 2.6.0

### Minor Changes

- 05f6b27: Add charts: sparklines and function plots, emitted as data (issues #186, #187).
  
  A note could hold a series of numbers or the shape of a function, but not see
  either. Both now produce a `Chart` value: a specification a host draws with its
  own charting library. The engine emits the points, the axes' extents and a
  label, never pixels, the same split the colour swatch uses.
  
  ## One value type
  
  `<vector> as sparkline` and `plot <expr> from <a> to <b>` both produce a single
  `ValueType.Chart`, discriminated by a `kind`. A host reads `kind` to choose a
  renderer and draws `points` scaled to `domain` × `range`; new chart kinds are
  added without breaking a host that already switches on it.
  
  ## Sparklines
  
  | expression | result |
  | --- | --- |
  | `[120, 135, 128, 150, 162] as sparkline` | `[120, 135, 128, 150, 162]` (a sparkline chart) |
  | `map(x^2, 0:5) as sparkline` | `[0, 1, 4, 9, 16, 25]` (a sparkline chart) |
  
  Only a purely numeric vector or a range can become a sparkline; anything else is
  a clear error. The text answer keeps the numbers, so a reader with no canvas
  still sees them, and the series is downsampled to at most 32 points.
  
  ## Function plots
  
  | expression | result |
  | --- | --- |
  | `plot x^2 from -3 to 3` | `x^2 over [-3, 3]` |
  | `plot sin(x) from 0 to 2pi` | `sin(x) over [0, 6.28]` |
  | `plot 1/x from 0.5 to 5` | `1/x over [0.5, 5]` |
  
  The variable is `x`, the same reserved name `map` binds, and the expression is
  re-evaluated at each of 64 sample points, so the sample is exact. This re-entrant
  evaluation is built on the same machinery `map` uses.
  
  ## The boundaries
  
  - **Data, never pixels.** A `Chart` carries the `(x, y)` points, the domain and
    range they scale to, and a plain-text label; the developer brings the charting
    library that draws them.
  - **Opt-out.** Charts are a new `solve-chart` package, on by default and
    removable: an engine that wants no charting drops it and the two forms stop
    parsing, exactly like the colour package.
  - **A gap is not a failure.** A sample the expression cannot evaluate, `1/x` at
    zero, is left as a hole in the curve.
  - **`plot` stays an ordinary word.** It is claimed as syntax only when it starts
    a plot clause, so `:plot = 5` still defines a variable and `plot + 1` reads it.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke script
  and the bundled-consumer tree-shaking contract) passes, along with `npm run
  lint`, the comment-style and doc-coverage checks, and the docs example suite (the
  sparkline and plot examples are proven on the new charts page). New tests:
  `packages/chart/Chart.spec.ts`, including the worker-DTO round-trip and that the
  package is removable.

## 2.5.0

### Minor Changes

- 398bc2f: Add spread and shape aggregates and a weighted average (issues #184, #185).
  
  The aggregate family could find a list's centre (`average of`, `median of`) but
  said nothing about its variation, and averaged every value as equal. Both gaps
  are filled in place, over a bare list and over a table column.
  
  ## Spread and shape
  
  `standard deviation`, `variance`, `spread` and `mode` join `average` and
  `median`, reading a bare list or a named column the same way.
  
  | expression | result |
  | --- | --- |
  | `standard deviation of 2, 4, 4, 4, 5, 5, 7, 9` | `2` |
  | `variance of 2, 4, 4, 4, 5, 5, 7, 9` | `4` |
  | `spread of 3, 7, 2, 9` | `7` |
  | `mode of 4, 2, 4, 3, 4, 2` | `4` |
  | `standard deviation of column "score" above` | the column's spread |
  
  Standard deviation and variance take the **population** form by default, since a
  note over a fixed column of readings is usually the whole set rather than a draw
  from a larger one; the sample form is a named variant (`sample standard
  deviation of ...`, `sample variance of ...`). `spread` is the largest minus the
  smallest, spelled that way because `range` already means a `start:end` interval
  elsewhere in the engine. A tie for `mode` is broken by first appearance, so the
  same list always gives the same answer.
  
  ## Weighted average
  
  `weighted average of` pairs each value with its own weight through `at`, for the
  grades, scorecards, portfolio splits and blended rates a plain mean gets wrong.
  
  | expression | result |
  | --- | --- |
  | `weighted average of 72 at 30%, 88 at 70%` | `83.20` |
  | `weighted average of 4.0 at 3 credits, 3.0 at 1 credit` | `3.75` |
  | `weighted average of 10 at 2, 20 at 3` | `16` |
  
  The weights are normalised by their own total, so they need not sum to 1 or to
  100%: the grade-point case divides by the four credits, and percentages that
  already sum to 100 come out unchanged. A trailing label on a weight (`3
  credits`) is read for its number and the word ignored.
  
  ## The boundaries
  
  - **The missing weight is an error, not a silent 1.** A value written with no
    `at` clause (`weighted average of 72, 88`) is reported rather than filled in
    with a weight of one, because guessing would quietly change the answer of a
    list that was simply mistyped. In a document it surfaces as that line's error
    and leaves the others working.
  - **Population is the default, sample is named.** The classic set above gives a
    population standard deviation of exactly `2`; the sample form is asked for by
    name.
  - **`spread`, not `range`.** `range` keeps its existing `start:end` meaning.
  - **Percentiles and quartiles are a follow-up.** They need a leading ordinal
    (`90th percentile of ...`) and are deliberately out of this slice.
  
  ## Verification
  
  `npm run verify` (typecheck, the full test suite, build, the package smoke
  script and the bundled-consumer tree-shaking contract) passes, along with
  `npm run lint`, the comment-style and doc-coverage checks, and the docs example
  suite (the spread/shape and weighted-average examples are proven live on the
  statistics and table-columns pages). New tests: `SpreadShapeAggregates.spec.ts`
  (the inline forms and the weighted-average boundary) and `ColumnSpreadShape.spec.ts`
  (the column forms).

## 2.4.0

### Minor Changes

- 7397cc5: Add calendar-aware date forms and configurable date formats (issues #182, #183).
  
  The datetime package gained the two calendar forms it was missing, and dates
  became configurable at both ends: the order an ambiguous numeric literal is read
  in, and the form a date is displayed in.
  
  ## The nth weekday of a month
  
  The date of the nth, or last, occurrence of a weekday in a month, computed from
  a fixed month or a relative one.
  
  | expression | result |
  | --- | --- |
  | `2nd Tuesday of March 2026` | `Tuesday, March 10, 2026` |
  | `4th Thursday of November 2026` | `Thursday, November 26, 2026` |
  | `last Friday of November 2026` | `Friday, November 27, 2026` |
  | `1st Monday of next month` | the first Monday of next month |
  
  The result is an ordinary date, so it composes (`2nd Tuesday of March 2026 as
  weekday` is `Tuesday`). An occurrence the month does not have is refused rather
  than wrapped: April 2026 has four Fridays, so `5th Friday of April 2026` is an
  error, not the first Friday of May. The bare `next Friday` and `last Monday`
  forms are untouched: only an ordinal weekday followed by `of` reads this way.
  
  `next month`, `this month` and `last month` come with it, each the first of its
  month, the same anchor `March 2026` gives.
  
  ## Age
  
  Whole calendar years from a birth date, reckoned at now unless an `on <date>`
  gives another reference, or the full years/months/days breakdown.
  
  | expression | result |
  | --- | --- |
  | `age of 15/06/1990 on 25/12/2030` | `40 years` |
  | `age of 15/06/1990 on 26/08/2026 in years, months and days` | `36 years, 2 months, 11 days` |
  
  Age walks the calendar rather than dividing a fixed-length span, so the leap
  cases are right: a 29 February birth is a year older on 1 March in a non-leap
  year, where `years between` (which divides by a 365-day year) drifts. The two
  sit side by side: `years between` for a rough span, `age of` for the count a
  birthday gives.
  
  ## Choosing the input order
  
  A numeric date was read by its separator: a slash date day first, a hyphen date
  month first unless it opened with a four-digit year. A US reader's `12/25/2023`
  therefore did not parse at all, because day 25 of month 12 is not a date. The
  new `date.inputOrder` setting fixes the order for every numeric separator.
  
  | `inputOrder` | `12/25/2023` | `25/12/2023` | `2023/12/25` |
  | --- | --- | --- | --- |
  | `"auto"` (default, as before) | not a date | 25 December 2023 | not a date |
  | `"MDY"` | 25 December 2023 | not a date | not a date |
  | `"DMY"` | not a date | 25 December 2023 | not a date |
  | `"YMD"` | not a date | not a date | 25 December 2023 |
  
  ```ts
  new ExpressionEngine({ config: { date: { inputOrder: "MDY" } } });
  ```
  
  Only the all-numeric literals are affected: a spelled-out month (`March 9,
  2024`) is never ambiguous, and a full ISO timestamp is always read as ISO.
  
  ## Choosing the output format
  
  A date showed spelled out and nothing else. The new `dateResult.format`
  formatting setting picks the form.
  
  | `format` | `25/12/2023` shows as |
  | --- | --- |
  | `"long"` (default, as before) | `Monday, December 25, 2023` |
  | `"iso"` | `2023-12-25` |
  | `"dmy"` | `25/12/2023` |
  | `"mdy"` | `12/25/2023` |
  
  ```ts
  formatValue(value, { ...settings, dateResult: { format: "iso" } });
  ```
  
  The long form still localises its weekday and month names through the configured
  locale; the numeric forms are locale-neutral. The field is optional, so a host
  that built a `FormattingSettings` before it existed keeps the long form.
  
  ## Boundaries
  
  - **`inputOrder` is per engine, read live by the literal rule.** It is
    registered against the engine's own config, so a slimmer engine built without
    the datetime package neither reads nor fuses a date literal.
  - **`dateResult` flows per render.** It reaches the formatter with the other
    formatting settings, so no engine rebuild is needed to change it.
  - **The nth-weekday month anchor is a month, not a day.** Only the anchor's year
    and month are read, so `2nd Tuesday of 15/03/2026` and `2nd Tuesday of March
    2026` agree.
  
  ## Verification
  
  `npm run verify` (typecheck, 7,890 tests across 350 suites, build, the package
  smoke script and the bundled-consumer tree-shaking contract) passes, along with
  `npm run lint`, the comment-style and doc-coverage checks, and the docs example
  suite. The calendar arithmetic is proven on its own in `DateArithmetic.spec.ts`,
  and the grammar and both settings through the engine in `NthWeekdayAndAge.spec.ts`
  and `DateFormatConfig.spec.ts`.

## 2.3.0

### Minor Changes

- 8794584: Add proactive background refresh for live async values (issue #212).
  
  Async resolution was pull-based: a live value refetched only when its line was
  re-evaluated (a keystroke) and had gone stale. A note left open, showing
  `stock(AAPL)` or `100 USD in GBP`, held whatever it last resolved. Nothing
  refetched it in the background, so a document a reader was looking at rather than
  editing silently aged.
  
  Background refresh drives the refetch for you, for the values currently on
  screen, and pushes the fresh result to the host over the existing event stream.
  
  | | before | now (opted in) |
  | --- | --- | --- |
  | a live line, note left open | holds the last resolved value | refetches on its own cadence and updates |
  | a line the reader edited away | (n/a) | stops refreshing at once, no leaked timer or request |
  | a headless or batch host | pull-only | pull-only, unchanged (off by default) |
  
  Two knobs, independent, both per resolver:
  
  - `staleTimeMs` (as before) governs the pull path: how long a value stays fresh
    before the next re-evaluation refetches it.
  - `refetchIntervalMs` (new) governs the push path: how often an on-screen value
    refetches on its own. A live quote might set a minute, an FX rate a few
    minutes, an immutable historical close nothing at all.
  
  ```ts
  const engine = createEngine({ config: { backgroundRefresh: { enabled: true } } });
  
  const stocks = createStocksPackage({
    fetchQuote: async (ticker, signal) => { /* ... */ },
    refetchIntervalMs: 60_000, // refresh an on-screen quote once a minute
  });
  ```
  
  The fresh value arrives as a `lines-updated` event on `getEventStream()`, the
  same stream the pull path uses, so a host already consuming it needs no changes.
  
  The boundaries are deliberate:
  
  - **Off by default.** It needs timers and a live editor consuming the stream, so
    a headless or batch host leaves it off and pays nothing.
  - **Per-resolver cadence, not one global timer.** The interval comes from the
    resolver, the same place `staleTime` does; a value with no cadence stays
    pull-only.
  - **Only what is live.** A value no line references any more stops at once, so an
    open note leaks no timers or network.
  - **Back-pressure and failure.** A refetch still running when the next is due is
    skipped rather than stacked, and a failed one is swallowed, the pull path
    surfaces the failure on the next re-evaluation.
  
  query-core stays and owns the fetching, dedup and cache; this wires its
  background refetch to the live values on screen and the host re-render, rather
  than reimplementing a cache.
  
  ## Verification
  
  `npm run verify` (typecheck, the test suite, build, and the single-file and
  bundled smoke consumers). A new suite proves the manager in isolation (the
  timers, change detection, liveness, back-pressure and teardown), the resolver
  surface (`refetchIntervalMs` producing a working refetch, no cadence staying
  pull-only), and the engine wiring (off by default, present only when enabled,
  stopped on clear, and a background refetch reaching the event stream).

## 2.2.0

### Minor Changes

- 7f3759b: Add `evaluateDocument`, a whole-document entry point that resolves goal seek.
  
  The engine already had two ways to read a document, and they were not
  interchangeable. `parseDocument` is the batch pass: it reads earlier lines'
  results and skips markdown, which is everything line references, category tags
  and table columns need. What it cannot do is re-run an earlier line with a
  variable bound to a trial value, which is exactly what goal seek is, so
  `solve line N for x = target` came back as an error there.
  
  `evaluateDocument(engine, text)`, on the `solve-engine/engine` subpath, runs the
  incremental engine for one pass and returns the same `ParsingResult` shape
  `parseDocument` does, with the re-run primitive wired in:
  
  ```
  :deposit = 100000
  :rate = 4%
  monthly repayment on deposit over 25 years at rate
  solve line 3 for deposit = 900
  ```
  
  | entry point | line 4 (`solve line 3 for deposit = 900`) |
  | --- | --- |
  | `parseDocument` | error: goal seek has no document to solve against |
  | `evaluateDocument` | `170,507.23` |
  
  On every form both passes support (line references, category tags, table
  columns) they agree value for value; goal seek is the one `evaluateDocument`
  adds. It restores the engine's document model before returning, so a caller can
  borrow an engine for a single pass and leave it as it was.
  
  The boundary, deliberate: `evaluateDocument` does not skip a markdown table's own
  rows, where `parseDocument` does, so a document that mixes a raw table with goal
  seek reads the table through `parseDocument` and the goal seek through
  `evaluateDocument`. It also builds a fresh model per call, which suits occasional
  evaluation (a documentation notepad, a test) rather than the keystroke loop a
  live editor runs against one long-lived evaluator.
  
  With this in place, the documentation's whole-document examples, line
  references, category tags, table columns and goal seek, are now live, editable
  notepads whose results the build proves, rather than static listings.
  
  ## Verification
  
  `npm run verify` (typecheck, the test suite, build, and the single-file and
  bundled smoke consumers): 7,835 tests across 346 suites pass. The documentation
  example suite now evaluates every whole-document block the same way a notepad
  renders it and asserts each documented result, and a new cross-path suite pins
  each whole-document form through all three entry points at once: the single-line
  path must refuse with a structured error, and the two document passes must agree.

## 2.1.0

### Minor Changes

- 640a8d8: Category tags are now recognised the same way everywhere, fixing two cases where a tag was half-recognised or lost.
  
  ## A tag glued to a word or number is no longer half-recognised
  
  The lexer tagged any `#` followed by a letter, ignoring the character before it, while the aggregate scanner only counted a tag at a word boundary. So `100#food` was stripped from its own line as if tagged, yet left out of `total of #food`: a line that looked tagged but did not count.
  
  | line | before | now |
  | --- | --- | --- |
  | `100#food` | stripped to `100`, but excluded from the total | left whole (`#food` reads as a comment), and excluded |
  | `100 #food` | tagged and counted | tagged and counted |
  
  A `#` glued to the end of a word or number is now not a tag in either half, so `100#food` and `a#food` stay whole and only `100 #food`, with a space, tags the line. A `#` inside a word is kept out of the feature.
  
  ## A tag named after a grammar word is no longer swallowed
  
  The phrase trie fuses multi-word phrases by their written value, ahead of the tag rules, so a tag whose name completed a phrase was consumed as the bare word. `total of #column` errored ("expected a column name"), and `1200 #assuming` errored ("unexpected token"), instead of tagging the line.
  
  ```
  expression            result
  40 #column            = 40      (tagged #column)
  55 #column            = 55
  total of #column      = 95
  1200 #assuming        = 1,200
  ```
  
  The trie now skips a `TAG` token: a typed `#tag` never starts or completes a phrase, so a category can be named after a word wherever that word appears in the grammar.
  
  The boundary: aggregating a tag whose name is a package keyword (`total of #assuming`) is a separate, deeper collision through a different mechanism, fixed alongside this one in the same release (see the patch change below).
  
  ## Verification
  
  - Two regression specs pin the fixes. `Issue197` covers the two reported cases, the tag still being stripped from its own line, and a property test that every built-in phrase word survives as a `TAG` rather than fusing. `Issue198` covers the lexer now agreeing with the scanner on every boundary case, and a glued tag being neither shown as tagged nor counted.
  - The existing tag, lexer, normalizer, finance and math-phrase suites pass unchanged, and `npm run verify` (typecheck, `test:ci`, build, smoke, the bundled-consumer contract) is green.

### Patch Changes

- 44d9d0c: Category tags: an aggregate of a tag whose name is a package keyword now sums instead of erroring.
  
  `total of #tag` fuses to an internal aggregate token whose value is the tag name. When that name was also a lexer keyword, `assuming` from the finance package, the phrase trie re-read the fused token's value on the next normalizer pass and turned it back into the keyword, so `total of #assuming` collapsed to a bare `ASSUMING` and errored. A non-keyword tag (`total of #column`) and a plain data-line tag (`1200 #assuming`) were already fine; only the aggregate of a keyword-named tag broke.
  
  ```
  expression                result
  1200 #assuming            = 1,200
  800 #assuming             = 800
  total of #assuming        = 2,000
  ```
  
  The phrase trie's tag guard now covers the fused `TAG_SUM` / `TAG_COUNT` / `TAG_AVERAGE` tokens as well as the raw `TAG`, so a tag name is never re-interpreted as a keyword once the aggregate has claimed it.
  
  ## Verification
  
  - A regression spec (`Issue213`) aggregates a keyword-named tag through `total` / `sum` / `count` / `average`, and asserts the line fuses to a `TAG_SUM` token rather than the bare keyword.
  - The existing tag, finance and normalizer suites pass unchanged, and `npm run verify` is green.

## 2.0.0

### Major Changes

- e6edb4d: The public API is redesigned for 2.0: an options-object constructor, a bare-value return, first-class fault detection, and the removal of long-dead surface.
  
  ## The constructor takes an options object
  
  `ExpressionEngine` had five positional parameters, so a call that only wanted to pass a package list still had to spell out every slot before it. It now takes a single `EngineOptions` object, and every field is optional.
  
  ```typescript
  // before
  new ExpressionEngine("en", false, undefined, undefined, [ARITHMETIC_PACKAGE]);
  // now
  new ExpressionEngine({ packages: [ARITHMETIC_PACKAGE] });
  ```
  
  The fields are `locale`, `packages`, `config` and `diagnostics`. `config` takes an `EngineConfigOverride`, a per-section partial merged over the defaults, so overriding one validation limit no longer means restating a whole config section. The fourth positional slot, an internal diagnostic-pipeline injection point no consumer set, is gone. `createEngine`, `fromJSON` and the worker runtime take the same shape.
  
  ## `evaluateLine` and `evaluateExpression` return a Value
  
  Both methods returned a single-element `Value[]`, an array kept only for API stability. They now return the `Value` itself.
  
  ```typescript
  // before
  const [value] = engine.evaluateExpression("2 + 2 * 10");
  // now
  const value = engine.evaluateExpression("2 + 2 * 10");
  value.toNumber(); // 22
  ```
  
  `evaluateLineDetailed`, the `LineEvaluation` and `EvalResults` types are removed. The off-thread worker client's `evaluateExpression` collapses the same way, from `Promise<SerializedValue[]>` to `Promise<SerializedValue>`, so the two surfaces mirror each other.
  
  ## Faults are detectable, and no longer read as a silent zero
  
  An `Error` or a `Pending` value reads as the number `0` through `toNumber()`, so a caller that reached for the number without checking the type could not tell a fault apart from a real zero. `Value` now carries the guards the engine already used internally:
  
  ```
  expression            result
  5 kg to m             isError() → true, errorCode → the conversion error
  live price of silver  isPending() → true
  2 + 2                 isFault() → false
  ```
  
  `isError()`, `isPending()`, `isFault()` and the `errorCode` / `errorMessage` accessors make the distinction the engine makes. `evaluateNumber` applies it too: an impossible conversion returns `NaN` rather than the `0` that `toNumber()` would have handed back.
  
  | expression | evaluateNumber, before | now |
  | --- | --- | --- |
  | `5 kg to m` | `0` | `NaN` |
  
  ## Removed long-dead surface
  
  Three exports that registered into state nothing evaluated against are removed:
  
  - `IEnginePackage.variableSources` (with `IVariableSource`, `VariableResolver`, `IPackageRegistry.registerVariableSource` and the `solve-engine/variables` subpath): a package's named-variable sources were registered into a resolver no evaluation path ever queried, so a variable a source declared was never found. A package that needs to expose a value contributes a `pluginFunctions` entry instead.
  - The `PackageRegistry` class, its `packageRegistry` singleton and the `IPackageRegistry` interface: they wrote into process-wide singletons an engine does not read, since an engine builds its own parselet registry and its own lexer and classifies lines vocabulary-independently. Register on an engine instead, with `engine.registerPackage(pkg)` or `createEngine({ extraPackages })`.
  - `symbolToCurrency`: a backward-compatibility re-export of the currency-symbol alias table, which has lived in `uom/CurrencyAliases.ts` since.
  
  `IEnginePackage` also drops `variableSources`; its parselet and plugin-function fields change shape, covered next.
  
  ## Package descriptors are keyed, not lists
  
  A package's parselets and plugin functions were declared as arrays of little wrapper objects, and every plugin function carried a hand-allocated numeric index the author had to mint and thread through to the parselet that emitted it. Both are now keyed records, and the index is gone from the author's hands.
  
  `prefixParselets` and `infixParselets` move from an array of `{ tokenType, parselet }` to a record keyed by token type:
  
  ```typescript
  // before
  prefixParselets: [{ tokenType: "COLOUR_CALL", parselet: new ColourCallParselet() }],
  // now
  prefixParselets: { COLOUR_CALL: new ColourCallParselet() },
  ```
  
  `pluginFunctions` moves from an array of `{ index, handler }` to a record keyed by a package-local name. The engine assigns each name a `CALL_PLUGIN` index at registration, and a parselet emits the call by that name through the new `builder.emitPluginCall(name, argCount)`, never touching a numeric index:
  
  ```typescript
  // before
  const LIGHTEN_FN_IDX = allocatePluginFunctionIndex();
  pluginFunctions: [{ index: LIGHTEN_FN_IDX, handler: lightenHandler }],
  // in the parselet:
  builder.emitOpcode(OpCode.CALL_PLUGIN);
  builder.emitIndex(LIGHTEN_FN_IDX);
  builder.emitIndex(argCount);
  
  // now
  pluginFunctions: { lighten: lightenHandler },
  // in the parselet:
  builder.emitPluginCall("lighten", argCount);
  ```
  
  The old shape leaked an engine-internal detail, a process-global index counter, into every package author's code, and made a whole class of mistakes possible: two functions sharing an index, a parselet emitting an index its descriptor never registered, an index registered but never emitted. Naming the function once and letting the engine own the index removes all of them; a name a parselet emits but no descriptor declares is now a registration-time error, not a silent mis-dispatch. Two packages naming a function the same is a `checkPackageCompatibility` warning, resolved by the later registration, exactly as the other cross-package collisions already are.
  
  The boundary: an async resolver that scans *compiled* bytecode still works in numeric indices, because that is what bytecode is. Such a resolver looks its own function's index up by the qualified name the engine files it under (`pluginFunctionIndexFor("<package>:<name>")`) rather than owning a constant, so it reads the same index the engine assigned. The `examples/osrs` Grand Exchange resolver is the worked example.
  
  ## Verification
  
  - The whole engine suite runs against the new API: 7,790 tests in 342 suites, including the options-object construction, the bare-value return (its `Value[]` shape assertions inverted to assert a bare `Value`), the fault guards, the package-unregistration lifecycle moved off the removed `variableSources` onto `completionItems`, and every built-in package's descriptor and parselet-emit migrated to the keyed-record shape.
  - Every construction and call site across the suite, the tools, the worker runtimes, the package smoke checks and the consumer-e2e probe was migrated; the destructures and `[0]` unwraps were verified type-clean before the runtime run.
  - `npm run verify` (typecheck, `test:ci`, build, smoke, the bundled-consumer contract), plus `lint`, `lint:docs`, `lint:comments` and `lint:size`, all pass. Tree-shaking still holds: importing the engine plus one package bundles well under the full built-in set.
- 8439f10: Packages are explicit now, so the engine tree-shakes.
  
  The `ExpressionEngine` constructor registered all built-in packages by default, which meant importing the engine pulled every package into a consumer's bundle whether they used it or not: finance, colour, weather and the rest were unconditionally in the parse path. The constructor now registers only the packages it is given, so a consumer's bundler drops every built-in they never import.
  
  Parsed JavaScript, a consumer importing the engine and constructing it:
  
  | | parsed |
  | --- | --- |
  | before | 475 KB (all 25 packages, always) |
  | now, arithmetic only | 352 KB |
  
  **This is a breaking change.** `new ExpressionEngine()` with no `packages` argument now registers nothing, so `2 + 2` on a bare engine is an undefined-token parse error rather than `4`. Two ways to adopt it:
  
  For the common "I want everything" case, `createEngine()` is batteries-included: it registers the full built-in set in one call.
  
  ```typescript
  import { createEngine } from "solve-engine";
  const engine = createEngine();
  ```
  
  For a slimmer engine, pass the packages you want. Importing them from `solve-engine/packages` tree-shakes the rest away.
  
  ```typescript
  import { ExpressionEngine } from "solve-engine";
  import { ARITHMETIC_PACKAGE, UOM_PACKAGE } from "solve-engine/packages";
  const engine = new ExpressionEngine({ packages: [ARITHMETIC_PACKAGE, UOM_PACKAGE] });
  ```
  
  The `fromJSON` restore path takes the same `packages` argument, and must be given the same set the snapshot was taken with, since a snapshot's compiled bytecode only lines up against the packages present when it was written.
  
  The boundary: the built-in workers' offloaded compilation runs with a reduced vocabulary in a host that inlines them, since a package cannot cross the worker boundary. It falls back to main-thread compilation, so results are unaffected; giving those workers the full vocabulary without pulling the packages back into the main bundle is a separate change.
  
  ## Verification
  
  - The engine's whole test suite runs against explicit packages: the tree-shaking contract (a bare engine registers nothing) is pinned, and `createEngine` is covered by its own spec. Every construction site across the suite, the tools, the workers, and the bundled-consumer contract was migrated.
  - Tree-shaking is measured directly: a consumer importing `ExpressionEngine` plus one package bundles 123 KB smaller than one importing `BUILTIN_PACKAGES`.
  - 7,815 tests across 345 suites, no failures. `npm run verify` green, including the bundled-consumer `sideEffects` smoke test.

### Patch Changes

- 9f42488: Drop the bundled `semver`: about 25 KB less JavaScript to parse.
  
  `semver` was bundled for a single engine-version compatibility check, and its named-import slice pulled essentially the whole library in. That check now runs on a small internal range checker covering the grammar a package's declared `engineVersion` actually uses, and nothing more: exact, caret (with node-semver's documented `0.x` narrowing), tilde, the `>= <= > < =` comparators, whitespace for AND and `||` for OR, and the `*` wildcard.
  
  Parsed JavaScript, importing the whole engine:
  
  | | before | now |
  | --- | --- | --- |
  | minified | 505 KB | 480 KB |
  
  Package gating is unchanged: a prerelease engine still accepts a package written for the release it is a prerelease of, a `0.x` caret still narrows to the minor (`^0.1.0` accepts `0.1.5`, rejects `0.2.0`), and a malformed range is still reported as a distinct invalid-range error rather than a version mismatch.
  
  ## Verification
  
  - The engine-version-gate specs (25 cases) pass unchanged, and a new `SemverRange` spec (28 cases) pins the range grammar directly: caret across a major and the `0.x`/`0.0.x` narrowings, tilde, AND/OR clauses, wildcards, and the invalid-range forms.
  - The bundled-consumer contract confirms no `semver` identifier reaches the shipped bundle.
  - 7,812 tests across 344 suites, no failures. `npm run verify` green.
- 6dba292: Ship the engine minified, and pack the unit table: about 60% less JavaScript to parse.
  
  The build shipped unminified, so a consumer without their own bundler (Node, Deno, a CDN) parsed the full source, whitespace and all, on every load. The build now minifies, and the unit table is stored packed and decoded once at load rather than as 1,456 object entries that repeat 378 distinct ratios.
  
  Parsed JavaScript, importing the whole engine:
  
  | | before | now |
  | --- | --- | --- |
  | minified | 1,263 KB | 505 KB |
  
  Nothing a consumer computes changes. Source maps stay on, so a production stack trace still points at real source; the two are never dropped together. The unit table's packed form is asserted at generation time to decode to exactly the source table, so a packing bug fails the build rather than silently altering a conversion. A consumer who already runs their own bundler was minifying this code anyway and sees only the unit table's few kilobytes; the parse saving lands for everyone who does not.
  
  ## Verification
  
  - The generator asserts the packed unit table round-trips to its source over all 1,456 spellings; `UnitsTableIntegrity` and the conversion specs (115 cases) pass unchanged.
  - The bundled-consumer contract runs `verify` and `test:consumer` against the packed, minified tarball before publish: 21 checks, including 502 documented examples, on both the ESM and CJS builds.
  - 7,784 tests across 343 suites, no failures. `npm run verify` green.

## 1.2.0

### Minor Changes

- d9bd26d: Bill split and tip: one line that answers "X each".
  
  Splitting a bill had to be divided by hand and typed back in. A `split` clause answers it in place, in either spelling, and a tip written as a percentage composes on one line.
  
  ```
  split $120 between 3         $40.00 each
  $120 split 3 ways            $40.00 each
  split $100 between 4 people  $25.00 each
  $120 + 18% split 3 ways      $47.20 each
  10 split 3 ways              3.33 each
  ```
  
  The amount stays exact, so `$120 + 18%` is an exact `$141.60` before the split divides it, and money that was exact stays exact. A bare number splits to a bare number, so no currency is invented where none was written.
  
  The boundary is the odd penny. `split $100 between 3` is not a bare `$33.33 each` that quietly loses a penny: the extra penny is named, and the shares add back to the total to the cent.
  
  ```
  split $100 between 3         $33.33 each, with 1 share paying $33.34
  ```
  
  `split`, `ways` and `people` are ordinary words everywhere else: read as the split grammar only inside the full shape, so `:split = 5` and a variable named `split` keep working.
  
  ## Verification
  
  - A regression spec (16 cases) covers both spellings, the tip composition, the odd-penny reconciliation, the bare-number case, the arity error, and the collision safety.
  - 7,784 tests across 343 suites, no failures. `npm run verify` green.
- 756a5be: Category tags: label lines with `#tag`, and total them across a note.
  
  A running note often groups its numbers by hand, a shopping list or a set of expenses scattered down the page. A mid-line `#tag` labels a line's category and is dropped from that line's own result, and the aggregates gather every line carrying the tag, wherever they sit.
  
  ```
  40 + 15 #grocery      55
  petrol this week
  30 #transport         30
  
  12.50 #grocery        12.50
  total of #grocery     67.50
  ```
  
  `sum of` is a synonym for `total of`, and `average of` and `count of` read the same set:
  
  ```
  average of #grocery   33.75
  count of #grocery      2
  ```
  
  The boundaries are deliberate. A tag that is a line's first token is a heading, not a tagged figure, so `#grocery list` at the top of a note is a title. The match is on the whole tag, so `#housing` does not gather `#housingcost`, and tag names are matched case-insensitively. Money and units carry through: a tag whose lines are all in dollars totals to dollars, while mixing units under one tag is a clear error rather than a silent figure. `total` and `average` need numbers, so a non-numeric tagged line under them is an error; `count` is about presence, "how many lines carry the tag", so it counts a non-numeric line too. No tagged lines at all is an error for `total` and `average`, and zero for `count`.
  
  Like line references, these forms only work inside a document, since they read other lines. They return an error through the single-expression entry point, which has no document to gather from. Only one aggregate line per tag per note: an aggregate line carries the tag it sums, so a second would try to include the first, which is left out of scope rather than guessed at.
  
  A tag name starts with a letter, which keeps it clear of the colour literals: `#grocery` is a tag, `#c0ffee` is a colour, and `#12a` (all hex) is a colour too. A `#` followed by a space is still an ordinary heading or comment. `total`, `sum`, `count` and `average` remain ordinary words everywhere else, read as the tag grammar only inside the whole `... of #tag` phrase, so a variable named `total` keeps working.
  
  ## Verification
  
  - A regression spec (21 cases) covers the mid-line strip, the four aggregates across non-adjacent lines, money and mixed-unit handling, count-of-presence for a non-numeric line, the heading and prefix-collision boundaries, the empty and outside-a-document errors, `word of #tag` as prose, and the bounded lexer change. A separate unit spec (7 cases) pins the pure `#tag` scanner.
  - 7,784 tests across 343 suites, no failures. `npm run verify` green.
- a147c43: Named-bucket accumulators: a running balance with `+=` and `-=`.
  
  A named variable could be assigned but not updated: each new total had to be written out in full. `+=` and `-=` turn a note into a live ledger, where every line adjusts a balance in place.
  
  ```
  :budget = 500
  budget -= 120    380
  budget -= 63     317
  budget           317
  ```
  
  A first `+=` or `-=` on a name that has not been set yet starts it at zero, so a ledger can open straight into `spent += 10` rather than an undefined-variable error. The accumulation runs through the engine's own arithmetic, so money stays money and a unit stays its unit, and the right-hand side keeps its own precedence (`budget -= 1 + 2` subtracts three).
  
  The boundary: the compound forms apply to bare names, not the colon `:name` or `global :name` grammars, and a genuine typo on the right (`total += nope`) is still a real undefined-variable error. `+=` and `-=` are punctuation, so they never shadow an ordinary word.
  
  A running total is re-seeded on every re-evaluation, so a note that opens `spent += 10` reads the same total no matter how many times the document is re-parsed (a host re-parses on each keystroke) or the line is edited. The total is reset to its seed at the start of each pass and rebuilt from the ledger, rather than reading its own previous value and growing without bound.
  
  ## Verification
  
  - A regression spec covers the seed-zero first use, a running balance down a document, typed (money) accumulation, right-hand-side precedence, the undefined-name and half-typed errors, and the untouched colon grammar; a lexer spec pins `+=`/`-=` and that `=+`, `=-`, `++`, `= -5` and the ASCII uncertainty `+/-` are unchanged. A further spec pins re-evaluation stability across repeated re-parses and an in-place edit, on both the batch and the incremental evaluators.
  - 7,784 tests across 343 suites, no failures. `npm run verify` green.
- e3607ce: Savings goals: how long to save, and how much a month.
  
  The saving maths already ran forwards. It now runs backwards too, answering the two questions a savings note actually asks.
  
  ```
  how long to save $10,000 at $500 monthly       20 months
  how much per month to save $12,000 in 2 years  $500.00
  ```
  
  The interest-free forms are exact division. Add `at <rate>` and the money earns interest on the way (compounded monthly), so the goal arrives sooner or the monthly amount is smaller.
  
  ```
  how long to save $10,000 at $500 monthly at 12%      19 months
  how much per month to save $12,000 in 2 years at 6%  $471.85
  ```
  
  The duration answers in the contribution's own unit (`weekly` reads in weeks), and the count rounds up, because a part period has not yet reached the goal. The per-month form takes a duration in months or years, `reach` reads the same as `save`, and a bare-number target answers a bare number. The phrases fuse whole, so `save`, `reach` and `how` stay ordinary variable names.
  
  ## Verification
  
  - A regression spec covers both directions, the interest-free and annuity cases (hand-derived and cited), the period unit, the round-up, the bare-number target, the unknown-period and unsupported-duration errors, and the untouched variable names.
  - 7,784 tests across 343 suites, no failures. `npm run verify` green.

## 1.1.1

### Patch Changes

- b48d857: A line of only backslashes, or any run of characters the lexer discards, no longer evaluates to 0.
  
  `\`, `\\` and `\\\\` showed a result of **0** in the notepad and the playground, a number on screen for a line that holds no expression, while a blank line, a heading and a prose line all correctly showed nothing.
  
  ```
  \           was 0, now no result
  \\          was 0, now no result
  \\\\        was 0, now no result
  ```
  
  The lexer discards an unknown ASCII character, a backslash falls through to the same skip path as whitespace, so a line built only from them tokenises to an empty token stream. The line was still classified as an expression and evaluated, and the engine reports an empty token stream as the number 0. Such a line is now classified as empty, the same as a blank line, so every surface (the batch parse, the incremental evaluator, and the playground's prose gate) skips it rather than answering 0.
  
  A backslash next to real content is unchanged: `\1` is still 1 (the backslash is skipped), and `1 \ 2` still errors on the trailing 2.

## 1.1.0

### Minor Changes

- 1a2eb63: Business-day arithmetic. Deadlines count working days, and now the engine can say so.
  
  Date arithmetic counts calendar days, which is the wrong unit for an invoice term, an SLA or a notice period. `20/12/2024 + 5 workdays` already skipped weekends, but the deadline phrasing a person actually writes was not recognised, and there was no way to count the working days in a window:
  
  ```
  5 working days after 20/12/2024              was not recognised, now 27/12/2024
  3 business days from today                    was not recognised, now a working day
  2 working days before 25/12/2024              was not recognised, now counts back
  working days between 01/01/2024 and 31/01/2024   was not recognised, now 23
  ```
  
  `working` and `business` days are synonyms, and either reads in the singular for a count of one. The offset walks to a working day the same way `<date> + N workdays` always has, so the two spellings can never disagree; the count is inclusive of both endpoints and independent of the order the dates are written.
  
  Weekends are decidable from a date, but public holidays are not: they depend on the region and change year to year. So holidays are excluded only when the host supplies a calendar, the same "bring your own data source" shape stocks and weather already use, and left unconfigured the arithmetic skips weekends only rather than guessing a holiday it was never told about:
  
  ```ts
  new ExpressionEngine("en", false, {
    date: { holidays: ["2024-12-25", "2024-12-26"] },
    // or holidays: (date) => isPublicHoliday(date)
  });
  ```
  
  With that calendar, `1 working day after 24/12/2024` steps over Christmas and Boxing Day to the 27th, and `working days between ...` leaves them out of the count. The offset forms, `between`, and `<date> + N workdays` all consult it. `workdays in <span>` and the `is a workday` / `is a weekend` questions stay weekends-only by design: the first has no date to look a holiday up on, and the second reports the shape of the week, not whether a particular office is open.
- 2606ee4: Colours are values now, the way numbers and dates already are.
  
  Write a colour and the engine treats it as a value you can compute with, not as text. All four CSS hex forms are literals (`#f00` expands to `#ff0000`, `#ff0000ff` carries alpha), alongside `rgb()`/`rgba()`/`hsl()`/`hsla()` and every CSS colour name through `color("...")` (including `transparent` and `rebeccapurple`):
  
  ```
  #ff0000                     #ff0000
  rgb(255, 128, 0)            rgb(255, 128, 0)
  color("rebeccapurple")      rebeccapurple
  ```
  
  A DevTools-style function set adjusts them: `lighten`/`darken`, `saturate`/`desaturate`, `rotate` (hue), `complement`, `mix`, `grayscale`, `invert`, and `alpha`. The amount reads the same whether written `0.2`, `20%` or `20`. `contrast` and `luminance` return the WCAG contrast ratio and relative luminance as plain numbers, so they compose with the rest of the engine. `as rgb`/`as hsl`/`as hex` re-print a colour without changing it, and two colours are equal when their channels match however each was written.
  
  ```
  lighten(#3366cc, 20%)              #85a3e0
  mix(#ff0000, #0000ff)              #800080
  contrast(#ffffff, #767676)         4.54
  #ff0000 == rgb(255, 0, 0)          true
  ```
  
  Every colour result carries its channels, a hex string and a ready CSS string across the worker boundary, so a frontend can render an inline swatch beside the answer without recomputing anything.
  
  One behaviour to note: a bare `#` sequence that is exactly 3, 4, 6 or 8 hex digits now reads as a colour rather than as a markdown heading or tag, so `#face`, `#c0ffee` and `#deadbeef` evaluate to colours. A `#` followed by anything that is not one of those lengths, or by a non-hex character, is unchanged, so `# Heading` and `#todo` still behave as before. Colour arithmetic operators are deliberately out of scope; manipulate colours through the named functions.
- 26d5601: Line references and table aggregates now resolve when a document is parsed in one pass, not only while it is edited.
  
  A cross-line expression, `total above`, `line 3`, `sum(line 1 : line 4)`, `prev`, and the table-column aggregates, reads the lines before it through a document model. Only the incremental path an editor drives set that model up, so those expressions worked live but answered a no-document error through `parseDocument` and `evaluateLines`, the batch calls a library reaches for. The same document read differently depending on which method was used.
  
  The batch pass now wires a document model for its own duration, fills each line's result in as it computes it so a backward reference reads a real value, and restores whatever model was there before, so an engine that an editor already drives is left untouched:
  
  ```
  10
  20
  30
  total above     was LINE_REF_NO_DOCUMENT, now 60
  ```
  
  A document that uses no cross-line feature is unchanged in result, and pays only the cost of building the line index for the pass. A single-expression `evaluateExpression` still has no document, so a bare `total above` with nothing above it is still refused rather than reading a stale document.
- 5c9e7a5: `defineFunction`, a declarative way to add a function.
  
  The package contract is the supported way to add syntax, and it always will be, but its floor asked too much for the simplest contribution. Adding `vat(x)` meant allocating a plugin function index, writing a parselet, and emitting `CALL_PLUGIN` by hand: the parser and the bytecode VM, learned in full, to add something the engine already knew how to call.
  
  `defineFunction` derives all of that from a declaration and returns a package you register like any other:
  
  ```ts
  const vat = defineFunction({
    name: "vat",
    args: [{ name: "amount", type: "number" }],
    returns: "number",
    call: (amount) => amount * 1.2,
  });
  
  engine.evaluateExpression("vat(100)"); // 120
  ```
  
  From the spec alone it allocates the index, registers the name so it tokenises, builds the `name(args)` parselet, and wraps `call` in a handler that checks the call. `call` receives plain JavaScript values and returns one. Its parameters and return are typed from the declaration, so `(amount) => amount * 1.2` needs no annotations.
  
  The arity and type checks raise the engine's own structured errors, so a package gets the good messages for free rather than hand-rolling them:
  
  ```
  vat()       vat() takes 1 argument, but was given none
  vat("x")    vat() expects "amount" to be a number, but was given a string
  ```
  
  This sits on top of the contract and changes none of it. Arguments are a fixed-length list of `number`, `string`, or `boolean`, and `call` is synchronous. Variadic or optional arguments, other value types, async work, and any syntax that is not `name(args)` keep using the low-level contract, whose parselets and async resolvers are exactly as before. `defineFunction` is the shortcut for the common case, not a replacement for the floor.
- 95091df: Rates written in slash notation now convert.
  
  `100 kph in mph` answered **62.14 mph**, but `100 km/h in mph`, the same speed spelled the way it is read off a sign, answered **INCOMPATIBLE_UNITS**. The lexer split `km/h` into three tokens, so the compound was never one unit, and nothing could convert a rate once it was built.
  
  A slash between two units is now one unit whose spelling is the rate, and a rate converts to another rate, or to any single-word speed spelling, by converting the numerator and the denominator on their own:
  
  ```
  100 km/h in mph            was INCOMPATIBLE_UNITS,  now 62.14 mph
  10 m/s in km/h             was INCOMPATIBLE_UNITS,  now 36.00 km/h
  60 mph in km/h             was INCOMPATIBLE_UNITS,  now 96.56 km/h
  100 km/h to m/s            was 60.00 km/h (silent), now 27.78 m/s
  120 km / 2 hours in kph    was INCOMPATIBLE_UNITS,  now 60.00 kph
  ```
  
  The last one needed a second fix. A unit literal that is the right operand of `*` or `/` no longer swallows a trailing `in`/`to`, so `120 km / 2 hours in kph` groups as `(120 km / 2 hours) in kph` rather than dividing by an incompatible conversion. The same correction fixes negative quantities on offset scales, where the sign used to land on the converted number: **`-40 C in F` is now -40 F**, not -104.
  
  A numbered denominator is still a division, not a fused unit, so `90 km / 3 day` is unchanged, and rate arithmetic (`$50/hour * 3 hours` is `$150.00`) is untouched.
  
  Naming a compound derived unit on output, `9.81 m/s^2 * 70 kg` as `N` rather than `kg*m/s^2`, is deliberately left for a later slice: this change makes the rate a first-class value to hold and convert, which is what the written-out speeds needed.
- 82a932c: Money is exact. A price is a decimal, not a binary fraction.
  
  A currency value was an IEEE double underneath, so representation error reached a user who had only typed two prices. `$0.10 + $0.20` carried `0.30000000000000004`, and `$1.005` displayed as `$1.00`, because the double handed to `toFixed` already sat below the value that was typed. That is the one class of wrong answer a calculator you can write money in cannot afford.
  
  Amounts in a currency now carry an exact base-ten decimal (a bigint coefficient and a scale) alongside the double. Same-currency `+`, `-`, `*`, `/` and comparison read it, so the arithmetic is exact and a half-cent rounds away from zero the way a till rounds it:
  
  ```
  $0.10 + $0.20    was 0.30000000000000004, now $0.30
  $19.99 * 3       was $59.97 over a drifting double, now exactly $59.97
  $100 - $99.99    was 0.010000000000005116, now $0.01
  $0.70 * 1.10     now exactly $0.77
  $10 / 3          now $3.33
  $1.005           was $1.00, now $1.01
  $2.675           was $2.67, now $2.68
  ```
  
  The boundary is deliberate. Exactness holds wherever a currency is involved, a currency against a plain number included. A bare decimal on its own is unchanged, so `0.1 + 0.2` is still `0.30000000000000004` and `sqrt(2)^2` is still float. A conversion between two currencies goes through a live rate, which is a double, so it is not exact.
  
  The double is still there: reading a money value as a number through `.value` or `toNumber()` is unchanged, except that the double is now the correctly-rounded image of the exact amount (`0.3` rather than the drifted sum). Money is still a unit-of-measurement value, so every existing currency path, conversion, formatting and rate arithmetic is untouched.
- d0ab80c: Fractions are exact. A third written with `/` computes like a third.
  
  A quotient of two integers was an IEEE double from the moment it was written, so a chain of fractions drifted the way doubles do. `1/49 * 49` came back `0.9999999999999999`, `5/6 - 1/6 - 1/6 - 1/6 - 1/6 - 1/6` came back `1.6653345369377348e-16` instead of `0`, and `1/1000003 as fraction` answered `0/1`, because the continued-fraction guess ran past its ceiling and collapsed to zero. Those are the drifts a person who wrote a recipe, a split or a share notices.
  
  A fraction now carries an exact rational (a bigint numerator and denominator, always reduced) alongside the double. Integer division seeds it, `+`, `-`, `*`, `/`, unary minus and comparison keep it, and `as fraction` renders it exactly:
  
  ```
  1/3 + 1/3 + 1/3    exactly 1
  2/7 * 14           exactly 4
  1/49 * 49          was 0.9999999999999999, now exactly 1
  5/6 - 1/6*5        was 1.6e-16, now exactly 0
  1/3 as fraction    1/3
  10/4 as fraction   5/2
  (1/3 + 1/7) as fraction   was approximated, now exactly 10/21
  1/1000003 as fraction     was 0/1, now 1/1000003
  ```
  
  The boundary is deliberate, and chosen so no existing float result flips. A fraction is shown as its decimal by default, so `10/4` is still `2.50` and `1/3` is still `0.33`; ask for `as fraction` to see the fraction and `as decimal` for the decimal. Only a fraction written with `/` is exact: a decimal literal is unchanged, so `0.1 + 0.2` is still `0.30000000000000004`, a plain integer sum keeps its float association, so `1e16 + 1 - 1e16` is still `0`, transcendental work (`sqrt`, `sin`, a non-integer power) stays float, and a bigint quotient (`100n / 3n`) stays exact integer division.
  
  The double is still there and is recomputed from the reduced rational, so reading a fraction as a number through `.value` or `toNumber()` is unchanged, except that a fraction that reduces to a whole number now reads back as that number exactly rather than the double it drifted to.
- e62aff0: A line can now explain how it reached its answer.
  
  `explainLine(expression)` returns a readable derivation: the operations of a line
  in the order the engine evaluates them, each with the value it arrives at. It is
  for the person reading the note, not the developer diagnostic pipeline, which
  reports stages, opcodes and timings.
  
  ```
  (20% off 80) + 20%    76.80
  
    80 less 20%      64
    64 plus 20%      76.80
  ```
  
  The answer alone does not say whether the discount landed on the right side of
  the sum; the derivation does. Each step carries the running value down into the
  next, so a reader checks the engine's reading against their own without splitting
  the expression across the document.
  
  It is an API rather than an `explain` keyword: a host puts the derivation behind
  a hover or a disclosure, and a keyword would shadow a prose word in a document
  that mixes notes and arithmetic. Every value in a derivation is the engine's own
  answer for that piece of the line, re-evaluated rather than re-derived, so
  `explanation.result` always equals what `evaluateExpression` returns and no step
  can disagree with the answer.
  
  ```ts
  const explanation = engine.explainLine("(20% off 80) + 20%");
  explanation.steps.map((s) => `${s.description} = ${s.value.toNumber()}`);
  // ["80 less 20% = 64", "64 plus 20% = 76.8"]
  ```
  
  The derivation covers the common cases: arithmetic with its precedence and
  associativity, parentheses, percentages (`+ 20%`, `20% off`, `20% on`, `20% of`)
  and quantities in units and money. A bare literal, or a line built from a
  construct that is not covered yet (function calls, dates, matrices, symbolic
  algebra), reports its answer with an empty step list rather than a partial or
  misleading breakdown. A line that does not evaluate at all throws an
  `EngineError`, the same as `evaluateExpression`.
- ce68828: Set the decimal places on a number, and it shows exactly that many.
  
  A number shows to two places by default. Rounding it to a different precision, with `<x> to N dp` or the two-argument `round(x, N)`, used to round the value but still display at the default, so `3.14159 to 4 dp` read `3.14` and `100 to 2 dp` read `100` — the precision you asked for was invisible.
  
  ```
  3.14159 to 4 dp     was 3.14,  now 3.1416
  100 to 2 dp         was 100,   now 100.00
  round(1.5, 2)       new,       1.50
  ```
  
  The place count is now a precision carried on the value, so it shows exactly that many places with trailing zeros kept, reads the way you asked, and travels into the next line rather than being a global display setting. The rounding is exact where the number has an exact decimal, so a half at the last place rounds away from zero the way money already does:
  
  ```
  1.005 to 2 dp       was 1,     now 1.01
  round(2.675, 2)     2.68
  ```
  
  `round(x)` on its own is still the nearest whole number, and a number you did not ask to round is unchanged.
- c3c9d13: Interest and repayment read the term and the rate in either order.
  
  The interest and mortgage-repayment forms accepted only the term before the rate, so `interest on 1000 over 3 years at 5%` worked but the equally natural reverse threw a parse error:
  
  ```
  interest on 1000 at 5% over 3 years              was a parse error, now 157.63
  monthly repayment on 200000 at 4% over 25 years  was a parse error, now 1,055.67
  ```
  
  The two clauses are independent — `over` names the term, `at` names the rate — so a person has no way to know which order the grammar wants. Both orders now parse to the same result, for `interest on`, `compound interest on`, and every `daily`/`monthly`/`annual`/`total` repayment and loan-interest form, and a trailing `compounding monthly` still reads after either arrangement.
- a6be074: Goal seek: invert a line against a target.
  
  The engine computes forwards, so every "what input gives me this answer" meant editing a number and re-reading the result until it looked right. `solve line 4 for rate = 900` now does that search, reading as "find the value of `rate` that makes line four equal 900". The variable named after `for` must be one the target line uses, since changing it is how the target moves.
  
  ```
  :deposit = 100000
  :rate = 4%
  monthly repayment on deposit over 25 years at rate
  solve line 3 for deposit = 900      the deposit that makes the repayment 900
  ```
  
  Two mechanisms, chosen automatically. When the target line is closed form in the variable, the answer is inverted exactly, the same algebra the `solve(...)` verb already uses: `solve line 2 for x = 30` against `x*2+10` returns `10`, no search. When it is not (a finance formula, whose builtin has no symbolic reading), a bounded numeric search narrows in on it instead.
  
  The search is fenced in, so an untrusted document can never make it spin. It assumes the relationship rises or falls steadily and crosses the target once, looks for a positive input up to a billion, and stops after `vm.maxGoalSeekIterations` steps (a hundred by default). A target no input in range can reach, a relationship that jumps across the target rather than passing through it, and the step limit are each a structured error, never a guess and never a hang. Re-running the target line binds the variable in a call frame, so it shadows the document's own value for that one probe and leaves it untouched afterward, and a line that defines a variable is refused rather than have its definition overwritten.
  
  Scoped to line references for this first slice, since a line reference gives a well-defined target without inventing syntax for the relationship. The looser natural-language phrasing (`what deposit makes the repayment 900?`), solutions outside the positive search range, and relationships with several crossings are deliberately left for later.
- 6cb9416: Currency conversion can now name the day it happened.
  
  `100 USD in GBP` converts at today's rate, which is right for a live figure and wrong for an expense or an invoice reconciled after the fact: a note that was correct when written quietly stops being correct as the market moves. There was no way to pin the rate to a date, and `100 USD in GBP on 2024-01-15` was not recognised.
  
  A conversion may now carry an `on <date>` suffix, in either spelling the date parser already reads:
  
  ```
  100 USD in GBP on 2024-01-15     the rate on that day
  100 USD in GBP on 15 Jan 2024    the same day, written differently
  $100 in GBP on 2024-01-15        the symbol form works too
  ```
  
  Historical rates are a **host-supplied provider**, the same shape as stocks and weather. There is no free, keyless historical-FX endpoint to bake in the way Frankfurter backs the live rate, so a host passes one to `createCurrencyPackage`:
  
  ```ts
  import { createCurrencyPackage } from "solve-engine/packages";
  
  const currency = createCurrencyPackage({
    historicalRateProvider: async (from, to, isoDate, signal) => {
      const res = await fetch(`https://example.com/fx/${isoDate}?from=${from}&to=${to}`, { signal });
      return (await res.json()).rate;
    },
  });
  ```
  
  Unconfigured, a dated conversion reports `HISTORICAL_RATES_NOT_CONFIGURED` plainly rather than falling back to today's rate. Guessing a number the caller did not provide, and dressing a live rate as a historical one, is the failure mode the engine works hardest to avoid.
  
  A resolved historical rate is cached as **permanently fresh**: the rate on a fixed past date is immutable, so unlike a live rate the query cache never re-fetches it. The live `100 USD in GBP` conversion and existing date parsing are unchanged.
- 671d1a2: Matrices can render as a stacked, column-aligned grid.
  
  A matrix's value is still returned as the compact one-line form (`[1, 2; 3, 4]`), which stays the stable text the API and the worker DTO use. Alongside it, a new `formatMatrixAligned(matrix)` export in `solve-engine/format` renders a matrix the way it reads best: one row per line, each column right-padded to its widest cell.
  
  ```
  formatMatrixAligned  of  [1, 200; 300, 4]
  
  [   1  200 ]
  [ 300    4 ]
  ```
  
  The documentation notepad now uses this to show matrix answers as an aligned grid rather than a single line. Anything that wants the compact form (or one value per row) keeps reading `formatValue` as before.
- 5c51d75: More colour functions: channel readouts, HSV/HWB, tints, and readable-text helpers.
  
  The colour package gains a wider set of functions:
  
  - **Read a channel** as a number: `red`, `green`, `blue`, `hue`, `saturation`, `lightness`, and `alpha` (with one argument `alpha` reads rather than sets).
  - **More colour spaces**: `hsv` (also `hsb`) and `hwb` (CSS Color 4) join `rgb`/`hsl` as ways to build a colour.
  - **Tints and shades**: `tint`, `shade` and `tone` mix a colour toward white, black and grey; `negate` is a full invert.
  - **Accessible text**: `isDark`/`isLight` classify a background, and `readable` (also `contrastColor`) returns black or white, whichever has the better WCAG contrast on it.
  - **WCAG compliance**: `isContrastCompliant(a, b)` tests whether two colours meet a contrast bar (AA normal text by default; a level name like `"AAA"` or `"AA large"`, or a plain ratio, overrides it), and `wcagLevel(a, b)` (also `wcag`) reports the best rating a pair reaches (`AAA`, `AA`, `AA Large` or `Fail`).
  
  ```
  red(#3366cc)                             51
  hue(#ff0000)                             0
  hsv(120, 100, 100)                       #00ff00
  tint(#ff0000, 50%)                       #ff8080
  readable(#3366cc)                        #ffffff
  wcagLevel(#ffffff, #767676)              AA
  isContrastCompliant(#fff, #000, "AAA")   true
  ```
  
  Function names are matched case-insensitively, so the multi-word ones can be written in camelCase (`isDark`, `isContrastCompliant`, `wcagLevel`).
  
  All of these sit alongside the existing constructors and adjusters and follow the same conventions (an amount reads the same as `0.2`, `20%` or `20`; a non-colour argument gives a clear error).
- bf4ef9b: Evaluation can now run off the main thread.
  
  Parsing is synchronous and lands on whichever thread calls it. A 6,000-line document parses in roughly 50ms on a warm desktop, which is fine once and janky on every keystroke, and worse on a phone. The incremental path and viewport evaluation keep a re-parse small, but they do nothing for a first parse or a paste, which still block the caller.
  
  A new `solve-engine/worker` entry wraps the core evaluate methods behind a `postMessage` boundary, so a host can move that work to a Web Worker or a Node `worker_threads` thread without hand-rolling the protocol:
  
  ```ts
  import { createWorkerEngine, eventTargetTransport } from "solve-engine/worker";
  
  const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  const engine = await createWorkerEngine({ transport: eventTargetTransport(worker) });
  
  const result = await engine.parseDocument(text); // Promise<SerializedParsingResult>
  ```
  
  The worker entry is two lines: `startWorkerRuntime(eventTargetTransport(self))`.
  
  Three things had to be settled to make this safe:
  
  - **A serialisable result.** A `Value` carries BigInt, matrix objects, symbolic trees and the exact-decimal and rational sidecars, and structured cloning reproduces none of them faithfully (BigInt alone breaks `JSON`). Results cross as a DTO instead: `SerializedParsingResult` / `SerializedParsedLine` / `SerializedValue`, where each value carries its formatted `text`, a numeric reading, and a clone-safe payload (a BigInt as a base-ten string, a matrix as shape plus cells, a range as its bounds). The DTO survives both `structuredClone` and `JSON`, so a host can cache or forward it. A raw `Value` is never posted.
  
  - **Cancellation.** An `AbortSignal` on a call rejects the promise and posts a `cancel` for the same request, which maps onto the engine's existing keystroke signal on the worker side, so a superseded keystroke does not race a stale result home rather than duplicating the mechanism.
  
  - **A structured failure.** A worker-side throw is caught, flattened into a structured error, posted, and rebuilt on the main side, so a caller's `catch` sees the same `EngineError` (code, category, message) it would have seen in-process, never a lost promise.
  
  Both threading targets are reached through one small transport interface. `createLinkedTransports()` runs the whole protocol on one thread for tests and for a host that wants the message-passing shape without a second thread; `eventTargetTransport` and `messagePortTransport` adapt a browser `Worker` and a Node `worker_threads` port onto the same interface.
  
  Packages cross as names rather than objects, since a package carries functions `postMessage` cannot clone: the worker bundles the built-ins and the main side selects among them by name, and a host with a custom package bakes it into its own worker entry. Deferred for a later slice: streaming the async resolver's follow-up live-data events across the boundary. A synchronous or pending result crosses today; a later update does not yet.
  
  Nothing about the synchronous API changes, and `solve-engine/worker` is a separate, side-effect-free entry point, so a bundle that never imports it pays nothing.
- 63d53dc: A test kit for package authors, under `solve-engine/testing`.
  
  A package author had no supported way to test a package. The engine's own suites are thorough and internal, so anyone writing a package either reached into internals or asserted on whatever bytecode a parselet emitted, which pins the implementation rather than the behaviour: a refactor that keeps every answer correct still breaks the tests.
  
  The new entry point speaks in expressions. `createTestEngine` builds an engine with the built-ins and the package under test, and `expectExpression` evaluates a string and matches on the result or the failure code:
  
  ```ts
  import { createTestEngine, expectExpression } from "solve-engine/testing";
  
  const engine = createTestEngine([myPackage]);
  expectExpression(engine, "2 gp + 3 gp").toEqual(5, "gp");
  expectExpression(engine, "gp").toFailWith("UNDEFINED_VARIABLE");
  ```
  
  `toFailWith` reads the same error code whether the engine threw it or a plugin returned it, so a package's own codes are matched the way the built-in ones are. `toEvaluate`, `toBeError` and `toBePending` cover the coarser cases, and `.value` exposes the raw result for anything the matchers do not.
  
  `expectPackage` catches the three mistakes a package actually makes, from the descriptor alone, before an engine is built:
  
  ```ts
  expectPackage(myPackage).notToShadow(["price", "in", "of"]);
  expectPackage(myPackage).notToCollideWith(BUILTIN_PACKAGES);
  expectPackage(myPackage).toDeclareCompatibleEngineVersion();
  ```
  
  A trigger word that shadows ordinary prose, a keyword that collides with another package's vocabulary, and an `engineVersion` range that never resolves each had a documented failure mode and no way to test for it.
  
  The kit is framework-agnostic and runtime dependency-free: an assertion that fails throws an `ExpectationError`, one that passes returns, so it drops into any runner or a plain script. `createTestEngine` registers the package under test through `registerPackage`, so a version-incompatible or colliding package throws rather than being logged and skipped the way the `ExpressionEngine` constructor contains it.
  
  Resolving an async package result inside a matcher is left for a later slice: `toBePending` confirms the async path was taken, but the kit evaluates synchronously and does not drive a resolver to completion.
- 83c984d: Successive percentage changes, written as a sentence.
  
  **`120 up 10% then down 10%` is 118.80, not 120.** This is the arithmetic people misread most often, and the person writing it out by hand is exactly the person who reaches for 120. The 10% down comes off the larger 132, not the original 120, so the changes do not cancel. A calculator that reads like a sentence is the right place for the correct answer to be visible.
  
  `up N%` and `down N%` apply a percentage change to a value, `then` chains them so each change lands on the running total, and `N times` repeats a step:
  
  ```
  120 up 10% then down 10%   118.80   (the intuitive answer is 120)
  50 up 20%                  60
  80 down 15%                68
  100 up 10% three times     133.10
  ```
  
  Each step is `value * (1 ± N%)`, the same arithmetic as `increase value by N%`, so a chain is that step applied to the running total again and again. `then` is optional connective (`120 up 10% down 10%` reads the same), and the count in `N times` may be a digit or a word.
  
  The unit rides along, so `$300 up 10% then down 10%` is `$297.00`.
  
  `up` and `down` are ordinary English words, so they become operators only directly before a percentage, the one place `up 10%` can only mean a change. Prose that merely mentions them (`prices are up`, `scroll down`) and variables named after them are left alone, the same guard the `on`/`off` markup rule already relies on.
- c3e4cdf: Markdown table columns can now be read as data.
  
  A markdown table was the one block the engine saw and skipped. A separator row was classified and ignored, and a data row was handed to the evaluator, which errored on the pipes, so a note could hold a table of numbers and none of them could be totalled from where they sat.
  
  A column can now be named and aggregated in place:
  
  ```
  | item | cost |
  | ---- | ---- |
  | rent | 1200 |
  | food |  300 |
  | taxi |   12 |
  
  sum of column "cost" in table above       was an error, now 1,512
  average of column "cost" above             was an error, now 504
  ```
  
  `min`, `max`, `count`, and `median of column` read the same column, `total of column` and `mean of column` are accepted as synonyms of sum and average, and the result is an ordinary number, so `sum of column "cost" above + 100` adds to it.
  
  The decisions this slice makes, each surfaced as behaviour rather than left implicit:
  
  - **Addressing** is the nearest table above the query line. `sum of column "cost"`, `sum of column "cost" above`, and `sum of column "cost" in table above` all resolve the same way. An explicit table label is deferred.
  - **Non-numeric cells** are skipped, not errored, so a label row or a blank cell does not break an otherwise-numeric column. A column with no numbers at all, or a name that is not one of the headers, is a clear coded error rather than a silent zero.
  - **Currency and units in cells** are not read yet: a `$50` or `50 kg` cell is treated as non-numeric and skipped. Plain numbers first, on purpose, since reading the units is the larger, more useful version.
  
  Only tables whose rows begin with a pipe are recognised. The borderless form (`item | cost` with no leading pipe) is deferred, because a bare `a | b` line is ambiguous with a bitwise-or expression and needs cross-line context to tell the two apart. Existing per-line classification of table rows is unchanged.
- f024778: A recurring schedule adds itself up.
  
  Subscriptions, salaries and instalments are the most common thing anyone adds up in a note, and there was no way to write the series. The total had to be worked out elsewhere and typed back in as a number, which is the part worth checking. `<amount> <period> for <duration>` now answers it:
  
  ```
  450 monthly for 18 months        was 450 * 18 by hand, now 8,100
  12.99 monthly for 2 years        now 311.76
  2000 every 2 weeks for 6 months  now 26,000
  ```
  
  The period is `daily`, `weekly`, `monthly`, `yearly` (also `annually`), or `every N days/weeks/months/years`. Money rides along, and where the per-payment amount is exact so is the total, through the same money-multiply path that makes `£12.99 * 24` exactly `£311.76`:
  
  ```
  £450 monthly for 18 months   now £8100.00
  $12.99 monthly for 2 years   now $311.76
  ```
  
  The total is the primary result. The number of payments is the secondary detail that produced it (total is the amount times the count), and the count is a whole number: one payment per completed period, on a scheduling year where a month is one of twelve and a week one of fifty-two. That is what makes `every 2 weeks for 6 months` thirteen payments over half a year, rather than the twelve a thirty-day month would give. A final part-period has not come due and is not counted, so `every 2 weeks for 5 weeks` is two payments, not three.
  
  The word `for` is shared with the investment grammar (`$1,000 for 3 years at 7%`) and the rate grammar (`$24 a day for a year`). A schedule is claimed only when a period word sits before `for` and a plain duration follows it, so both of those keep working, and a bare `monthly` or `weekly` is still an ordinary variable name.
- 27752a4: Snapshot and restore engine state. A session can be persisted and warm-started rather than re-evaluated.
  
  Everything a session builds up, its named variables, its user-defined functions, and its per-line result and bytecode caches, lived only in memory, so a host that wanted to persist a document, warm-start a process, or move a document between contexts had to re-evaluate the whole thing. That gets slower with the document, and it re-runs every async resolver as a side effect.
  
  `engine.toJSON()` now captures that state as a plain object, and `ExpressionEngine.fromJSON(state, { packages })` restores it onto a fresh engine that answers later expressions exactly as the one that evaluated the document would have:
  
  ```ts
  const state = engine.toJSON();
  const engine = ExpressionEngine.fromJSON(state, { packages });
  ```
  
  The snapshot is plain JSON and survives `JSON.stringify`/`JSON.parse` unchanged: a `bigint` is written as a string, a non-finite number (`Infinity`, `NaN`) is named rather than turned into `null`, and the compiled bytecode is carried as ordinary arrays. Exact money and exact fractions keep their sidecars, so `$0.10 + $0.20` is still exactly `$0.30` and `1/3 + 1/3 + 1/3` is still exactly `1` after a restore.
  
  What is carried: variables, user-defined functions, the line cache (each line's result, bytecode, and the variables it reads and writes, so incremental re-evaluation still works), and the expression-keyed bytecode cache.
  
  What is deliberately not carried: **resolved async values**. Weather, stock and currency results are point-in-time and must be re-fetched, not restored stale, so every line backed by an async resolver is dropped from the snapshot, along with any variable whose most recent definition came from one. Package-contributed state is not carried either (core engine state only for now, a package opt-in is planned), and symbolic algebra values are deferred: a variable holding one makes `toJSON()` throw a clear, coded error rather than dropping it silently, and a cached line whose result is symbolic is skipped and re-evaluates on restore.
  
  Every snapshot carries a format version. `fromJSON` restores only the version it was built for and refuses anything else, or any object that is not a snapshot, with a coded `SNAPSHOT_VERSION_MISMATCH` error rather than restoring it wrongly. Restoring requires the same package set the snapshot was taken with, since the carried bytecode's plugin indices and operators line up against the packages that were present when it was written.
- 6ae427b: Measurements carry a tolerance, and the tolerance travels through the arithmetic.
  
  A reading usually comes with an error term, and until now there was no way to carry it: you tracked it by hand on a second line, which stopped being practical after one operation. Write `12.3 ± 0.5`, or the ASCII `12.3 +/- 0.5` since the symbol is awkward to type, and the number carries a one-sigma uncertainty of `0.5`. `+`, `-`, `*` and `/` propagate it, combining independent errors in quadrature:
  
  ```
  12.3 +/- 0.5              12.3 ± 0.5
  (12.3 +/- 0.5) * 4        49.2 ± 2.0
  (10 +/- 1) + (20 +/- 2)   30 ± 2.24
  ```
  
  A sum or difference adds the spreads as `sqrt(a² + b²)`; a product or quotient adds the relative spreads the same way. A plain number counts as an exact operand, so a scalar multiply scales the spread by the factor. The `±` binds tighter than `+ - * /`, so `12.3 ± 0.5 * 4` is `(12.3 ± 0.5) * 4`; parenthesise to group otherwise.
  
  The boundary is deliberate. Uncertainty is a sidecar on an ordinary Number, so a value with no tolerance behaves exactly as a plain number always did, and everything other than the four arithmetic ops reads the centre and drops the tolerance: a comparison compares the centres, and `sqrt`, `sin` and the like work on the centre alone. Correlated errors are a much larger problem and out of scope, as is a tolerance on a value that also carries a unit.
- 870a2cf: A document can now define its own units, the way it can already define a function.
  
  `f(x) = 2*x + 1` worked, but `1 sprint = 2 weeks` did not, so anyone working in a unit the engine does not ship had to keep the conversion factor in their head and write it out on every line. Now the name is taught once and used everywhere below it:
  
  ```
  1 sprint = 2 weeks         was a parse error, now sprint defined
  6 sprints in days          was Undefined variable,  now 84 days
  1 story point = 4 hours    was a parse error, now story point defined
  13 story points            was Undefined variable,  now 52 hours
  ```
  
  A defined unit is an alias for a real unit, so it inherits that unit's dimension. `6 sprints in days` converts and `6 sprints in kg` is refused the same way `2 weeks in kg` is, reporting that a duration is not a mass. Plurals and multi-word names both work, and the value is reported in the base unit (`6 sprints` is `12 weeks`).
  
  The shape is deliberately narrow so it cannot swallow an equation. Only the natural `1 <name> = <quantity> <unit>` form defines a unit: the coefficient must be `1`, the name must not be a built-in unit, and the base must be a known unit. `2 x = 10` is still a scalar equation, `x = 5` is still an assignment, and a built-in unit still cannot be redefined.
  
  Definitions are document-scoped, the way a user-defined function is. They are rebuilt top-to-bottom on every pass, so a definition holds only for the document that wrote it, a later line redefining a name replaces the earlier one, and nothing leaks between documents. A defined name only activates after a quantity, so a bare word in prose, or a same-named variable, is never rewritten into arithmetic.
  
  Free-standing (dimensionless) units and a host-supplied definition table are deliberately left for a later slice: this change gives the document-scoped, dimensioned case, which is what planning, recipes and house units all wanted.
- c2c6634: Live values now stream back from the worker.
  
  The off-main-thread harness shipped with one of its three points deferred: a value that resolves inside the worker AFTER a request already answered had no way home. A document parsed off-thread came back with its synchronous and pending results, but when a currency rate, a weather reading or a historical FX rate settled a moment later, that resolution stayed trapped in the worker and the host never saw it. Live data is a headline feature, and off-thread it did not arrive. This completes the async-streaming point deferred from the initial worker slice.
  
  `WorkerEngine` gains two subscriptions:
  
  ```ts
  const stop = engine.onResolved((lines) => {
    for (const { lineNumber, value } of lines) render(lineNumber, value.text);
  });
  
  engine.onAsyncError(({ queryKey, packageId, error }) => {
    console.warn(`${packageId} could not resolve ${queryKey}: ${error.message}`);
  });
  ```
  
  These are subscriptions rather than per-call promises because a resolution is tied to no single request: it belongs to whichever document is current when the value lands. `onResolved` delivers a batch, since the engine collapses every resolution that settles in one tick into one update, and each line arrives already re-evaluated as a `SerializedValue` the host can render without a further round-trip. `onAsyncError` carries the same structured `EngineError` an in-process resolver failure would surface. Both return an unsubscribe function.
  
  The worker holds one engine and one document context, so the most recent evaluate call is the live one. Parsing a new document supersedes the old one: a value still resolving for the superseded document is dropped at the engine's own staleness guard rather than delivered against the current document. That guard is the existing per-resolution `AbortSignal`, the same mechanism the cancellation point already leans on, so a stale resolution never reaches the host as if it were current.
  
  The other two points are unchanged and still hold: results cross as a serialisable DTO, never as a raw `Value`, and an `AbortSignal` on a call still maps onto a `cancel` message worker-side. `solve-engine/worker` remains a separate, side-effect-free entry point.

### Patch Changes

- e988885: A parenthesised thousands number reads as one number again: `(1,000)` is `1000`, not a vector.
  
  The comma-separator change suppressed the thousands-comma inside every paren, but `(` groups as well as calls. A bare grouping paren was wrongly treated like a function call, so `(1,000)` split into the two-element vector `[1, 0]` and silently corrupted the arithmetic around it:
  
  ```
  (1,000)          was [1, 0],   now 1000
  (1,000 + 500)    was a vector, now 1500
  2 * (1,000)      was a vector, now 2000
  ```
  
  The lexer now tells a call from a grouping by what precedes the `(`: an identifier or a closing bracket makes it a call (`rgb(255,255,255)`, `vec2(1,2)` — commas separate), while an operator or the line start makes it a grouping (`(1,000)`, `2 * (1,000)` — the comma still groups thousands). `[...]` stays a separator context, so `[100,200,300]` is unchanged, and `2(1,000)` reads as implicit multiplication over the grouping rather than a call.
- 57d4116: A comma inside a call or bracket is read as a separator, so `rgb(255,255,255)` and `[100,200,300]` work without spaces.
  
  A comma followed by exactly three digits was always coalesced into the number as a thousands group, whatever surrounded it, so a comma-separated list written without a space after each comma fused into one number:
  
  ```
  rgb(255,255,255)     was an arity error,       now white
  hsl(0,100,50)        was an arity error,       now the colour
  [100,200,300]        was [100200300] (1x1),    now a 1x3 vector
  ```
  
  `255,255,255` reads identically to the thousands-grouped `255255255`, so nothing local to the number could tell them apart — only the surrounding `(` or `[` can. The lexer now tracks that nesting: a comma inside a call or a bracket is an argument or element separator and is not coalesced, while a top-level comma still groups thousands (`1,000,000` is unchanged). The space form (`rgb(255, 255, 255)`) already worked and still does, and `.`-grouping is untouched.
- 52338f4: `explainLine` reports the answer alone when a line mixes arithmetic with an operator it does not break down, instead of a misleading step.
  
  The derivation explains arithmetic (`+ - * / ^`, `of`, a percentage on a quantity), and a line built from anything else, a comparison, a conversion, a logical operator, is meant to come back with the answer and an empty step list. `2 + 2 == 4` broke that: it emitted `["2 plus 2 == 4", 1]`, an arithmetic step whose text glued the comparison on and whose result was actually the Boolean the line evaluates to.
  
  ```
  explainLine("2 + 2 == 4")     was [["2 plus 2 == 4", 1]], now []
  explainLine("100 + 20 in kg") was [["100 plus 20 in kg", 120]], now []
  explainLine("3 * 4 > 10")     was [["3 times 4 > 10", 1]], now []
  ```
  
  The operand scan stopped only at the operators the derivation models, so an unmodelled one (`==`, `<`, `in`, `to`, `and`, a bitwise op) was swallowed into a leaf rather than ending the line. An operand run is now a span of value tokens, so any operator that is not modelled ends it and the line falls back to reporting its answer with no steps, the same as a bare comparison always did. Arithmetic that the derivation does model is unchanged, and the answer itself was always correct.
- 70d2f2c: Implicit multiplication over a grouping keeps thousands: `(2)(1,000)` is `2,000`, not a vector.
  
  A `(` right after `)` or `]` was read as a function call, so a thousands number in the following grouping paren was split on its comma and `(2)(1,000)` became the vector `[2, 0]`:
  
  ```
  (2)(1,000)     was [2, 0],      now 2000
  (5)(2,500)     was [10, 2,500], now 12500
  ```
  
  This grammar has no curried or first-class calls (`f(1000)(2000)` errors) and no index-application (`[1,2,3](0)` errors), so `)(` and `](` are implicit multiplication over a grouping, never a call. The lexer now treats only an identifier or a function keyword as a call target, so a `(` after a closing bracket is a grouping and its comma stays a thousands separator, matching the no-comma form `(2)(1000)` = `2000`.
- 169a86b: A thousands number in a grouping paren survives a keyword operator too: `100 mod (1,000)` is `100`, not a vector.
  
  The grouping-vs-call rule told a function call from a grouping by the symbol before the paren, but a **keyword** operator (`mod`, `xor`, `and`, `or`, `to`) is a word, so it was mistaken for a function name and the thousands number inside the following paren was split on its comma:
  
  ```
  100 mod (1,000)    was [0, NaN],  now 100
  255 xor (1,000)    was 255,       now 791
  1 and (1,000)      was [2, 1],    now 1001
  ```
  
  The lexer now checks the word against its keyword table: a keyword that is not a function (an operator, connective, or constant like `mod`, `to`, `pi`) is not a call, so the `(...)` after it is a grouping and its comma stays a thousands separator, while a real function name (`rgb`, `sqrt`) or a variable still opens a call where the comma separates.
- 0fadb0b: A dated currency conversion never fetches a rate the amount does not resolve to.
  
  When the source was a subexpression in which a foreign amount cancels out — `(100 USD * (5 JPY / 5 JPY)) in GBP on <date>` — the pre-fetch guessed the source from the nearest currency literal (the cancelled JPY) and fetched JPY→GBP, a wasted call that, against a real provider lacking that pair, fails. The converted value was already correct (the runtime read the true USD source), but the phantom fetch was not.
  
  The rate is now fetched ahead of evaluation only when the amount's operand strings name exactly one currency (an unambiguous source, as a plain `100 USD in GBP on <date>` does). A mixed-currency subexpression is left to the runtime, which reads the source off the computed amount, so a single correct fetch happens and no invented pair is ever requested.
- cd6a52d: A dated currency conversion works when the amount is a variable, not only a literal.
  
  ```
  x = 100 USD
  x in GBP on 2024-01-15
  ```
  
  With a `historicalRateProvider` configured, the second line returned an internal `HISTORICAL_RATE_NOT_PREFLIGHTED` error and the provider was never called. The rate is fetched ahead of evaluation by scanning the compiled line for its source currency, and a variable left operand carries no currency literal to find, so nothing was fetched and the conversion had no rate to apply.
  
  The source currency is known at evaluation time regardless — it is the amount's own unit — so the conversion now fetches the rate itself when the pre-scan could not, the same way any live-data lookup resolves: the line reads as pending, the rate arrives, and the line settles on the converted amount. A literal source (`100 USD in GBP on 2024-01-15`) is unchanged, and with no provider the honest `HISTORICAL_RATES_NOT_CONFIGURED` error is reported rather than an internal one.
- e96500f: Percentage arithmetic stays exact and keeps uncertainty in two more spots: a chained percentage of money, and a percentage divided by an uncertain number.
  
  ```
  50% of 1% of $3      was $0.01,  now $0.02
  10% / (2 +/- 0.1)    was 0.05,   now 0.05 ± 0.0025
  ```
  
  `50% of 1% of $3` reduces `50% of 1%` to a bare `0.005` before it multiplies the money, and the money multiply only stayed exact when an operand was literally a percentage — so the chained form drifted a cent while `$3 * 0.005` and `50% of (1% of $3)` did not, making the answer depend on grouping. Money times any scalar (a percentage, or a plain or computed number) now goes through the exact base-ten path, while a rational scalar like `$3 * 2/7` still keeps its exact fraction.
  
  `10% / (2 +/- 0.1)` is `0.1 / 2`, a plain number, so the divisor's spread carries through; the uncertainty handling was one-directional and dropped it. It now handles a percentage over an uncertain number as well as an uncertain number over a percentage, guarding a zero divisor either way.
- 8dca760: Fix percentage arithmetic dropping exactness and uncertainty.
  
  Two related defects in `X ± N%` (and `X * N%` / `N% of X`):
  
  - **Money drifted a cent.** `$0.10 + 15%` answered `$0.11` instead of `$0.12`. The result was a bare double (`0.10 * 1.15 = 0.1149999...`) with no exact-decimal sidecar, so the half-cent rounded down, even though the identical `$0.10 * 1.15` was exact. Percentage scaling of money now goes through the same base-ten path, so `$0.10 + 15%` is `$0.12` and `$4.55 + 10%` is `$5.01`.
  - **Uncertainty was silently lost.** `(100 ± 5) + 10%` answered `110` instead of `110 ± 5.5`. A percentage is a scalar multiply, so a carried tolerance now scales by the same factor across `+`, `-`, `*` and `of`.
  
  Non-money units, plain numbers, and percentages without a tolerance are unchanged.
- 19253ed: Percentage arithmetic keeps money exact and uncertainty intact across `*` and `/` too, not only `+` and `-`.
  
  Two gaps remained after the percentage-on-money and percentage-on-uncertainty fixes:
  
  ```
  15% of $0.10        was $0.01, now $0.02   (a percentage times money was not exact)
  $0.10 * 15%         was $0.01, now $0.02
  (100 +/- 5) / 10%   was 1000,  now 1000 ± 50   (division dropped the tolerance)
  ```
  
  `15% of $0.10` is `$0.015`, which the half-cent rule rounds to `$0.02` — the same answer `$0.10 + 15%` and the exact multiply `$0.10 * 0.15` already give. And `X / 10%` is `X / 0.1`, a scalar multiply, so an uncertain `X` keeps its relative spread. Both now go through the same base-ten money scaling and the same percentage-uncertainty handling the `+`/`-` and `*` paths use (`of` compiles to a multiply, so both spellings are covered), making the guarantee that percentage arithmetic preserves money exactness and uncertainty true across all four operators.
- e578a2e: Fix markdown table-column aggregates through `parseDocument` / `evaluateLines`.
  
  `sum of column "cost" above` (and the average/min/max/count/median siblings) resolved correctly while a document was edited but returned a `TABLE_NO_DOCUMENT` error when the same document was evaluated in one pass through the batch library APIs. The per-line context wired the raw-line reader only for the incremental path; it now also reads from the batch scan, so a table aggregate resolves the same way through both, as the other cross-line reads already do.
- d1de194: `tax off` and `tax in` on money round the half-cent like a till, matching `tax on`.
  
  The exact-money rounding reached the multiply tax forms but not the divide forms, so extracting or removing tax drifted a cent while adding it did not:
  
  ```
  tax off $0.09 at 20%   was $0.07, now $0.08   (true net $0.075)
  tax in  $0.09 at 20%   was $0.01, now $0.02   (true $0.015)
  ```
  
  The same $0.075 reached through `tax on` already displayed $0.08, so the engine showed two different cents for one amount depending on the operation, and `tax off` plus `tax in` no longer summed back to the gross. Both divide forms now go through exact decimal division — exact where the quotient terminates (the cases that can land on a half-cent, at 20%/25%/50%), and rounded far below the cent where it does not, so the displayed cent is right either way. A tax on a bare number or a non-currency unit is unchanged.
- 0eb9957: Tax on money rounds the half-cent the way a till does.
  
  `tax on $0.10 at 15%` is fifteen percent of ten cents, exactly $0.015, and the money rules round a half-cent away from zero. It answered `$0.01`: the tax builtin multiplied `amount * rate` as a plain double (`0.10 * 0.15 = 0.0149999...`) with no exact-decimal sidecar, so the formatter rounded the drifted value down. The mathematically identical `$0.10 * 0.15` was already exact, which made the two disagree.
  
  ```
  tax on $0.10 at 15%     was $0.01, now $0.02
  tax on $10.10 at 15%    was $1.51, now $1.52
  ```
  
  Tax on money now runs through the same base-ten scaling the `$X + p%` percentage already uses, so it is exact wherever the amount is. `taxAdd`, the tax-inclusive total, shares the mechanism and is fixed with it. A tax on a bare number, or on a non-currency unit, is unchanged.
- 7f05be3: A matrix that contains a non-finite number survives the worker DTO's JSON round-trip.
  
  The scalar guard for `1/0` and `0/0` did not reach a non-finite number sitting inside a matrix cell, so a `[1/0, 2]` result serialised with a raw `Infinity` in its cells. `structuredClone` kept it but `JSON.stringify` turned it into `null`, so the two transport paths disagreed and the value could not be cached and reloaded — the same break the scalar fix removed, one container deeper.
  
  A non-finite matrix cell now carries the same `"Infinity"`/`"-Infinity"`/`"NaN"` string tag the scalar field uses (the cell type already allows strings, alongside the formatted-string form symbolic cells take), so both round-trips agree and a host recovers the value with `Number(cell)`. Finite numeric and boolean cells are unchanged.
- 67deec0: Fix a non-finite worker result breaking the DTO's JSON round-trip.
  
  A value whose numeric reading is non-finite (`1/0` -> Infinity, `0/0` -> NaN, an overflow) put `Infinity`/`NaN` in the serialized `number` field. That survives `structuredClone` (postMessage) but `JSON.stringify` turns it into `null`, so a host that cached and reloaded the result got a different value, breaking the round-trip the worker DTO guarantees.
  
  `SerializedValue.number` is now always finite (0 when the reading is non-finite), and a new optional `nonFinite` field (`"Infinity"` / `"-Infinity"` / `"NaN"`) names the real value, so both `structuredClone` and `JSON` agree. Read `nonFinite ? Number(nonFinite) : number` to recover the reading.
- 7751aea: Cross-line features in a batch parse no longer build a document model per pass.
  
  The support for line references and table columns in `parseDocument` and
  `evaluateLines` was added by pointing the pass at a freshly built `DocumentModel`.
  That allocated a line record and index for every line of every document, even
  one that used no cross-line feature at all, adding a few milliseconds to a large
  parse and needless heap churn. The batch cross-line source now reads earlier
  lines straight from the scan and the results array the pass already holds, which
  are references rather than new allocations, so a document that uses no such
  feature pays nothing. Line references and table aggregates resolve exactly as
  before.
- d65f5ed: Unit mismatches now read as sentences instead of a bare code.
  
  `5 kg + 3 m` and `1 hour in metres` both surfaced the raw **INCOMPATIBLE_UNITS**, which told a reader nothing and was the same string whether they had added mass to length, their mistake, or asked for a conversion the engine cannot do, a different situation. Now that dimensions are tracked there is something specific to name, and the two causes read differently:
  
  ```
  5 kg + 3 m           was INCOMPATIBLE_UNITS,  now "mass and length cannot be added"
  5 kg - 3 m           was INCOMPATIBLE_UNITS,  now "mass and length cannot be subtracted"
  1 hour in metres     was INCOMPATIBLE_UNITS,  now "a duration cannot be converted to a length"
  5 kg in m            was INCOMPATIBLE_UNITS,  now "a mass cannot be converted to a length"
  $100 in kg           was INCOMPATIBLE_UNITS,  now "money cannot be converted to a mass"
  5 kg < 3 m           was INCOMPATIBLE_UNITS,  now "mass and length cannot be compared"
  ```
  
  The dimension is named from the same measure table the converter already uses, so a quantity of time reads as a "duration" and a currency as "money". Combining, converting, comparing, and `min`/`max` across dimensions all read this way.
  
  The error **code is unchanged**: it is still `INCOMPATIBLE_UNITS`, so anything matching on the code keeps working. Only the human-readable message changed, and no expression that used to evaluate changed its result.
  
  A pair with no single dimension to name keeps the older message that names the units instead, so the sentence never trails off into "undefined". That covers a compound rate such as `km/h`, a currency code the exchange does not recognise, and two different currencies with no cached rate (both are money, a missing-rate case rather than a dimension mismatch), which still reports "Cannot combine incompatible units: BTC and ETH".

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
