---
"solve-engine": patch
---

`Value.toJSON` copies a payload key named `__proto__` as a key, rather than as a request to replace the output object's prototype.

The JSON-safe walk behind `toJSON` built each plain object by assignment, so a payload carrying an own `__proto__` key (as `JSON.parse` makes one) lost that key from the output, and the output object inherited from the payload's value instead. CodeQL reported the write as a remote property injection. Each key is now defined as an own property.

| payload | before | now |
| --- | --- | --- |
| `{"__proto__": {"polluted": true}, "a": 1}` | `{ a: 1 }`, and `.polluted` reads `true` | `{ "__proto__": { polluted: true }, a: 1 }`, and `.polluted` is undefined |

The walk only reached the output object, never `Object.prototype`, so no other object was affected. Bigints still become decimal strings at any depth.

## Verification

`__tests__/hardening/ValueToJsonPrototypeKeys.spec.ts` (4 tests, 2 of which fail on the previous walk) covers the `__proto__` key, every word in `PROTOTYPE_WORDS` at two depths, bigints at depth, and empty and scalar payloads. The `Value.toJSON` and results-as-JSON specs still pass, and `typecheck`, `typecheck:tests`, `lint` and `lint:comments` are clean.
