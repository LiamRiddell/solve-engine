---
"solve-engine": minor
---

Raise the minimum Node version to 22.

`engines` now says `>=22` rather than `>=20`, and CI tests on 22 and 24 rather
than 20, 22 and 24.

This is a correction rather than a change of direction. The repository already
could not install on Node 20: `size-limit` depends on `nanoid` 6, which requires
`^22 || ^24 || >=26`, and `.npmrc` sets `engine-strict`, so `npm ci` refused
outright. The Node 20 entry in the matrix had been failing at the install step,
which meant nothing was verifying the support the package claimed. Declaring a
floor nothing tests is worse than declaring a higher one honestly.

The engine's own code is unaffected. Nothing in it uses an API newer than Node
20, so a consumer already on Node 20 will most likely keep working; it is simply
no longer a version this project tests or supports.
