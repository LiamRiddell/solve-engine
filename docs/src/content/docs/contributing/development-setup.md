---
title: Development setup
description: Getting the repository running locally.
---

```bash
git clone https://github.com/LiamRiddell/solve-engine.git
cd solve-engine
npm install
```

## The verification gate

One command runs everything that must pass:

```bash
npm run verify
```

That is a type check, the full test suite, and the package build. Add the
playground build with:

```bash
npm run verify:all
```

## Layout

| Path | Contents |
| --- | --- |
| `packages/engine` | The published package |
| `packages/playground-bridge` | Shared glue between the engine and the playground |
| `playground` | The interactive playground application |
| `docs` | This documentation site |
| `docs-internal` | Maintainer notes, not published |

## Running the playground

```bash
npm run dev --prefix playground
```

## Running the docs site

```bash
npm run dev --prefix docs
```
