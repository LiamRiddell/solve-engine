# solve-package-starter

A starting point for a package of your own for
[solve-engine](https://liamriddell.github.io/solve-engine/), the engine that
reads lines like `15% of 2400` and `5 km to miles` and answers them. A package
teaches the engine new things to read: a function, a phrase, a conversion, a
figure fetched from somewhere. This one teaches it one of each, so each piece is
something to copy.

It depends on `solve-engine` by name and imports only its public entry points
(`solve-engine`, `solve-engine/parser`, `solve-engine/vm`, `solve-engine/lexer`,
`solve-engine/resolvers`, `solve-engine/testing`, `solve-engine/packages`), so it
compiles against exactly what you install. The engine's own build packs it against the published tarball
and runs these tests on every change, so a change to that surface that would
break a package like this one fails there first.

## Using it

Copy this directory, rename the package in `package.json`, and install:

```bash
npm install
npm test        # builds with tsc, then runs the tests under node --test
```

A host registers the packages it exports:

```ts
import { createEngine } from "solve-engine";
import { createStarterPackages } from "solve-package-starter";

const engine = createEngine({
  extraPackages: createStarterPackages({ fetchRainfall: myRainfallService }),
});
engine.evaluateExpression("tip(40, 15)"); // = 6
```

If you are working inside the solve-engine repository itself, on a package that
ships with the engine, use `npm run new:package` there instead: it scaffolds a
built-in package, wired into the engine's own registry, docs and tests. This
starter is for a package that lives in its own repository and depends on the
published engine.

## The pieces

Everything is in `src/index.ts`, and each piece is tested in
`test/starter.test.ts`.

### A function: `tip(40, 15)`

A function is a name followed by brackets. `defineFunction` writes everything a
simple one needs from a description of its arguments: the word, the parsing, and
the checks, so `tip("x", 15)` is refused with the code
`DEFINE_FUNCTION_ARGUMENT_TYPE` instead of being computed on. The word is a
*call word*: it means the function only where `(` follows it, so `:tip = 3`
still defines a variable called `tip`.

```ts
tip(40, 15)     // = 6
tip("x", 15)    // DEFINE_FUNCTION_ARGUMENT_TYPE
```

### A phrase: `tea break`

A phrase is a run of words the engine reads as one token. Two words are safer
than one: neither `tea` nor `break` is claimed on its own, so both stay free for
variables and ordinary prose. The phrase's parser rule, `TeaBreakParselet`,
emits a call to the package function that answers a quarter of an hour.

```ts
tea break       // = 15 minutes
2 * tea break   // = 30 minutes
```

### A conversion: `7 as tally`

An `as` converter is a plain function from one value to another, reached by
`as <name>` (and `in <name>`). This one writes a small whole count as tally
marks in fives, and hands back anything else unchanged rather than throwing,
since a converter that throws takes the whole line down.

```ts
7 as tally      // = ||||| ||
2.5 as tally    // = 2.5
```

The name is `tally` because no built-in package registers it. The converter
registry is shared by every engine in a process, so reusing a built-in's name
(`roman`, say) would replace the built-in for all of them.

### A live lookup: `rainfall("Oslo")`

A figure fetched from somewhere cannot be known the moment a line is typed, so
the engine answers **Pending** first and the real figure when it arrives, never
a stale or zero number in between. The piece that fetches is an *async
resolver*: before a line runs, the engine asks each resolver whether the line
needs data it does not have yet, and a resolver that says yes starts the fetch
and hands the engine the promise. When it settles, the engine runs the line
again and the package's function reads the answer from the engine's cache.

The engine's `createQueryResolver`, from `solve-engine/resolvers`, builds that
resolver and its reading function together for the common shape, one quoted
query in and one value out, so a package supplies only the fetch. The package
never reaches a network itself: the host passes `fetchRainfall`, which is also
how the tests hand it a stub.

```ts
rainfall("Oslo")          // Pending, then = 4.5 mm
rainfall("../etc")        // STARTER_BAD_PLACE, and the host's fetch is never called
rainfall(42)              // STARTER_BAD_PLACE, at once
rainfall(where)           // STARTER_PLACE_NOT_QUOTED: the place must be in the line
rainfall("Atlantis")      // STARTER_RAINFALL_FAILED, when the service fails
```

What `createQueryResolver` does for you, which any live lookup should:

- **It fetches each place once.** The answer is kept in the engine's own cache
  for five minutes (`staleTimeMs`), and two lines asking for the same place
  while the first fetch is on its way share it.
- **It bounds the fetches.** At most six run at once (`maxConcurrent`), and a
  service that has not answered in ten seconds (`timeoutMs`) is given up on.
- **It answers a failure with a coded error value, never a throw or a number**
  (`onError`), and keeps that failure only for thirty seconds before asking
  again, so an outage is neither retried on every keystroke nor remembered as
  the answer.
- **It refreshes on a schedule if you ask.** `refreshEveryMs` here becomes its
  `refetchIntervalMs`, which a host with background refresh switched on uses to
  keep an on-screen figure current.

What the package still does itself:

- **It checks its input before sending it on.** A place is at most 80
  characters with no slash or control character (`placeProblem`), so a host
  that builds a URL from it is never handed `../` or a pasted paragraph. The
  check runs in the fetch, which every query passes through, and again in the
  function, for an argument that was never a quoted place.
- **It files its function under the index the resolver watches.**
  `pluginFunctionIndexFor("package-starter:rainfall")` is the index the engine
  gives the `rainfall` plugin function of the package named `package-starter`,
  so the two agree without a number of your own.

The boundary: the resolver reads the place from the line as written, before it
runs, so a place held in a variable (`rainfall(where)`) is refused by name
rather than fetched. A lookup whose input is known only as the line runs needs
the other shape the engine's
[async data source guide](https://liamriddell.github.io/solve-engine/guide/async-data-sources/)
describes, a function that fetches on a cache miss.

## Testing it

The tests use `solve-engine/testing`, which speaks in expressions:

```ts
const engine = createTestEngine(createStarterPackages({ fetchRainfall: async () => 4.5 }));

expectExpression(engine, "tip(40, 15)").toEqual(6);
expectExpression(engine, 'rainfall("Oslo")').toBePending();
await expectExpression(engine, 'rainfall("Oslo")').toResolveTo(4.5, "mm");
(await expectDocument(engine, ':wet = rainfall("Oslo")\nwet * 2')).line(2).toEqual(9, "mm");
```

`createTestEngine` registers the package the strict way, so a package the engine
would refuse (an `engineVersion` it does not satisfy, a keyword a built-in owns)
fails the test instead of being skipped. `toResolveTo` waits for the live value
to settle; `expectDocument` evaluates a whole note, so line references and
variables across lines work. Each piece also has a test that tries to break it:
a hostile place name, a wrong argument type, a place named like a property every
object has (`constructor`).
