# Third-party notices

This project ships one runtime dependency, `@tanstack/query-core`, which a
consumer installs and can see, patch and audit for themselves. Everything else
that third-party code contributes is compiled into the published bundle, where a
consumer cannot see it. Those parts and their licences are listed here.

## semver

`packages/engine/src/api/EngineVersionCompatibility.ts` calls `satisfies`,
`validRange` and `coerce` from [`semver`](https://github.com/npm/node-semver),
and the build inlines the reachable part of that package into `dist` rather than
declaring it as a runtime dependency.

It is bundled because it is an implementation detail: it decides whether a
package's declared `engineVersion` range admits the running engine, and it never
reaches the public type surface. Inlining keeps it out of a consumer's lockfile,
and tree-shaking means only the code those three functions reach is carried.

The trade is worth stating. A bundled dependency cannot be patched by the person
who installed this package, so if `semver` needs a security update it has to come
through a release here. `@tanstack/query-core` is deliberately left external for
that reason, being both larger and part of what this package's types expose.

```
The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## convert

`packages/engine/src/uom/generated/UnitTable.generated.ts` contains unit
conversion tables ported from the [`convert`](https://github.com/citycide/convert)
npm package, version 7.0.2. The tables are reproduced substantially unchanged;
the conversion logic in `packages/engine/src/uom/UnitConversion.ts` is a
reimplementation of the same algorithm.

They were ported so the engine could stop depending on `convert` at runtime.
See `scripts/generate-unit-table.mjs` for how the tables are produced and why
they are mirrored rather than rewritten.

```
MIT License

Copyright (c) 2020 Jonah Snider

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
