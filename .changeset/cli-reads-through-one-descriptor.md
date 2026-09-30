---
"solve-engine-cli": patch
---

`solve <file>` opens the file once and checks and reads it through that one descriptor, so the file cannot be swapped between the check and the read.

The command used to `stat` the path to check its size and kind, and then read the path again, which left a window in which the file could be replaced (by a link to a device, or by a larger file); CodeQL reported it as a file system race. The size and kind are now read with `fstat` on the open descriptor, and at most one byte past the limit is read from it, so a file that grows after the check is still refused as too large.

| input | before | now |
| --- | --- | --- |
| a directory | refused: is a directory | refused: is a directory |
| `/dev/null` | refused: not a regular file (from the earlier path check) | refused: not a regular file (from the descriptor) |
| a file one byte past the limit | refused as too large | refused as too large |

The boundary: the path is still classified first (a file, an expression, or refused), and the messages are unchanged.

## Verification

`Issue774_solveCli.spec.ts` gains three tests, 92 in all: a directory and a device refused by kind through the descriptor, a file exactly at the limit read and one byte past it refused, and `readBounded` reading to the end or the bound. `npm run smoke:cli`, `typecheck`, `typecheck:tests`, `lint` and `lint:comments` pass.
