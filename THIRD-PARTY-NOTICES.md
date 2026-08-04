# Third-party notices

This project ships no runtime dependencies, but parts of it are derived from
third-party open-source work. Those parts and their licences are listed here.

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
