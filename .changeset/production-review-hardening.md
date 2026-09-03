---
"solve-engine": minor
---

Hardening from the production-readiness review: a network switch, honest failures where the engine used to fail soft, and grouped money.

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
