# solve-engine

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
