# solve-engine

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
