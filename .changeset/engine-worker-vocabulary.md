---
"solve-engine": minor
---

The engine's own compile worker gets the full vocabulary, and leaves your bundle.

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
