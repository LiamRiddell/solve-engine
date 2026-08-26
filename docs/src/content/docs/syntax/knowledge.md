---
title: Knowledge
description: Free-text lookups answered by a function you supply, in two phrasings.
---

> **Package:** opt-in. `createKnowledgePackage({ answerQuery })` is not among the built-ins `createEngine()` registers; you construct it with your own answering function and add it to the engine's `packages` (see [choosing packages](/getting-started/installation/)).

A knowledge line is a plain-English question the engine hands, verbatim, to a
function you supply. The engine recognises the phrasing and routes the text; it
does not answer anything itself, and ships no provider, so nothing is guessed.

```ts
import { createKnowledgePackage } from "solve-engine/packages";

const knowledge = createKnowledgePackage({
  answerQuery: async (query, signal) => {
    const res = await fetch(`https://example.com/answer?q=${encodeURIComponent(query)}`, { signal });
    return (await res.json()).answer;
  },
});
```

Two phrasings are recognised, and mean the same thing:

| Expression | Result |
| --- | --- |
| `search: distance to the moon` | whatever your `answerQuery` returns |
| `ask: distance to the moon` | the same; `search`, `ask` and `google` are synonyms |
| `distance to the moon = ?` | the same question, with a trailing `= ?` instead |

The leading verb needs a literal colon (`search:`, not `search `). Without it,
`search 5` is a line reading the ordinary variable `search`, which `:search = 5`
can still define. See [trigger words](/syntax/trigger-words/) for why an everyday
word is not a keyword.

Without an `answerQuery`, a knowledge line returns a clearly named
`KNOWLEDGE_NOT_CONFIGURED` error rather than a made-up answer. The lookup reaches
your provider, so its first result is a pending value and the answer arrives once
the call returns. See [async and live data](/guide/async-and-live-data/) for how
a host waits on that.

The answers come from your provider, so they are shown here rather than asserted.
