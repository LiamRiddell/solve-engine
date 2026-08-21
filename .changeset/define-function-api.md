---
"solve-engine": minor
---

`defineFunction`, a declarative way to add a function.

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
