# solve-engine

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
