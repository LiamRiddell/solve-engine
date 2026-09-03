---
title: Recognising phrases and words
description: Make a multi-word phrase, or an ordinary word, behave as syntax without turning it into a reserved word.
---

The engine reads prose, so a package's syntax is usually a phrase a person would
write, `total of`, `next friday`, `weather in London`, not a symbol. The
challenge is claiming those words without breaking the ones a reader might use for
something else: `total` is also a fine variable name. There are two mechanisms,
and choosing the right one is most of the work.

- A **phrase** that is always the same words in the same order: use the
  declarative `phrases` field.
- A **word that must stay ordinary elsewhere**, special only in one position
  (before a `(`, next to another token): use a `normalizerRules` rule, and give
  it a `shape` so the normalizer knows where it can fire.

Both run in the normalizer, the step between lexing and parsing, and both fuse
several tokens into one that a parselet then handles.

## The declarative way: `phrases`

`phrases` is a map from a space-separated phrase to the token type it fuses into:

```ts
import type { IEnginePackage } from "solve-engine";

export const myPackage: IEnginePackage = {
  name: "my-aggregates",
  phrases: {
    "total of": "TOTAL_OF",
    "average of": "AVERAGE_OF",
  },
  prefixParselets: {
    TOTAL_OF: new AggregateParselet(TOTAL),
    AVERAGE_OF: new AggregateParselet(AVERAGE),
  },
};
```

That is the whole loop: **phrase → a token type you name → a parselet keyed by that
type**. When the reader writes `total of 1, 2, 3`, the normalizer fuses the two
words `total of` into a single `TOTAL_OF` token, and the parser hands that token
to your `AggregateParselet` exactly as if the lexer had produced it. Register the
parselet under the same string you targeted, and see
[adding functions and operators](/packages/functions-and-operators/) for what the
parselet itself does.

Phrases go into a trie, so you get two things for free:

- **Longest match wins, with no priority to set.** Register both `power of` and
  `to the power of` and the longer one is taken when both could match.
- **It is cheap.** A phrase is rejected on its first word in one lookup, and a
  number or a bracket never enters the trie at all.

A phrase never fuses across a tag, and its words are matched case-insensitively.
The `mathphrases` package is the smallest complete example to read: a row of
`phrases` and the matching row of `prefixParselets`.

## Function-call words: `callFusions`

A very common shape is a single word that becomes a function call when it is
immediately followed by `(`: `sha256("hi")`, `length("hi")`, `percentile([...],
90)`. It reads as a variable everywhere else (`sha256` on its own, or
`:sha256 = ...`). Rather than hand-write a normalizer rule for each such word,
declare it:

```ts
callFusions: {
  sha256: "HASH_CALL",
  md5: "HASH_CALL",
  // ...or, mapping a whole set of names to one token type:
  // ...Object.fromEntries(Object.keys(FUNCS).map((n) => [n, "HASH_CALL"])),
}
```

Each entry maps the **lower-cased word** to the **token type to mint** when the
word is followed by `(`. The engine merges every package's `callFusions` into one
shared map and runs a single rule for all of them, so adding a function is one map
entry rather than one more rule tried at every identifier. The fused token carries
the lower-cased word as its value (your call parselet reads it to pick the
function) and the original text as its raw value; a matching `prefixParselet` on
the token type does the actual call parsing (see
[Functions and operators](/packages/functions-and-operators/)). The `:name = ...`
variable case is handled for you: a word after a `:` is left alone.
Two packages may declare the same word; the one registered last is in force, and
unregistering it hands the word back to the other.

The boundary is deliberately narrow. `callFusions` is only the plain `word (`
shape with that one `:` guard. If your rule needs a different lookbehind, a deeper
lookahead, or any value logic beyond "is this word one of mine", write a
[`normalizerRules`](#the-declarative-way-phrases) entry by hand instead.

## When a word must stay a variable too

`factor(x^2-4)` should call the algebra solver, but `:factor = 1.5` should still
define a variable named `factor`. A `phrases` entry, or a lexer keyword, would
claim `factor` everywhere and lose the variable. The fix is a rule that fuses the
word **only in the position where it means something**, here, only when the very
next token is an opening parenthesis.

A rule is an object with a name, a priority, and a `match` that either returns a
replacement or `null`:

```ts
import type { NormalizerRule } from "solve-engine/normalizer";
import { LexerToken, tokenTypeId } from "solve-engine/lexer";

export function factorCallRule(priority = 80): NormalizerRule {
  return {
    name: "my-algebra:factor-call",
    priority,
    // The same two conditions the guards below check, stated as data so the
    // normalizer can skip this rule everywhere they cannot hold.
    shape: [{ types: ["IDENT"], values: ["factor"] }, { types: ["LPAREN"] }],
    match(tokens, pos) {
      const token = tokens[pos];
      if (!token || token.type !== "IDENT" || token.value.toLowerCase() !== "factor") return null;
      if (tokens[pos + 1]?.type !== "LPAREN") return null; // the position condition

      // Fuse just the word; the "(" stays for the parselet to read.
      return {
        consumed: 1,
        replacement: [
          new LexerToken("FACTOR_FN", tokenTypeId("FACTOR_FN"), token.value, token.value, token.offset, 0, token.line, token.col),
        ],
        ruleName: "my-algebra:factor-call",
      };
    },
  };
}
```

Register it with `normalizerRules: [factorCallRule()]`. `match` must be pure: it
looks at the tokens from `pos` and returns without mutating anything. `consumed`
is how many tokens it replaces (one here, only the word), and `replacement` is
what to put in their place (one minted `FACTOR_FN` token). Return `null` the
instant the shape is not yours.

## Declare the shape you match

`shape` is the same information as the first few guards in `match`, written as
data. Each entry describes one token position from the match point onward, by
type, by value, or by both, and an entry with neither constrains nothing.

Without it, a rule is tried at every position of every line. With it, the
normalizer intersects the declarations of every registered rule and tries only
the ones that could possibly fire. On the built-in packages that takes a position
from 55 candidate rules to 9, because the alternative discriminates poorly: every
call-fusion rule starts at an identifier, the commonest token in prose, so the
start type alone leaves all of them candidates at every word. The word, and the
token after it, are what tell them apart.

```ts
// Two positions: a known word, then an opening parenthesis.
shape: [{ types: ["IDENT"], values: ["factor"] }, { types: ["LPAREN"] }]

// A clock time is a number followed by a colon.
shape: [{ types: ["NUMBER"] }, { types: ["COLON"] }]

// Reach past a position you do not care about.
shape: [{ types: ["NUMBER"] }, {}, { types: ["UNIT"] }]
```

**The one rule to get right:** a shape may admit more than the rule matches, but
never less. Admitting more costs a `match()` call that returns `null`, which is
what happens without a shape at all. Admitting less makes the rule unreachable at
the positions left out, and nothing announces it: no error, no failing type, just
a spelling that quietly stops working. So when a rule has two forms, the shape is
their **union**. The clock-time rule accepts both `9:00am` and the bare `4pm`, so
its second slot is `["COLON", "IDENT"]`, not `["COLON"]`.

If in doubt, declare less, or omit `shape` entirely. Being unindexed is slow, not
wrong.

`startTokenTypes` is the older, narrower form of the same idea, constraining only
the first token. It still works; `shape` supersedes it.

This is how the `symbolic` package claims `factor`, `solve` and `expand`, and how
the `lines` package claims `sum(` and `average(`. Both also refuse to fire right
after a colon, so `:solve = 2` is never touched.

## Ordering is by priority, not registration

The normalizer runs the token stream through several passes, and at each position
it tries rules from **highest priority first**. This is the whole ordering
contract, and it is why the order you register packages in does not matter.

The rule to internalise: **a rule that reads a token another rule mints must have a
lower priority.** A freshly minted token only becomes visible on the next pass, so
the producer runs first (higher priority), the consumer after (lower).

Goal seek is the canonical example. `solve line 4 for rate = 900` involves two
packages:

- The `lines` package fuses `line 4` into a `LINE_REF` token, at priority 80.
- The `goal-seek` package, at priority 75, matches `solve` sitting beside a
  `LINE_REF` and mints `GOAL_SEEK`, leaving the `LINE_REF` for its parselet.

Because 75 is lower than 80, the `LINE_REF` exists by the time goal seek looks for
it, and the two compose in either registration order. As a rough guide, use the
bands the built-ins use: around 100 for a long phrase, 80 for a short one, 50 for
an implicit operator, 20 for a domain rule, and go lower than the rule whose
output you read.

## Name each rule, uniquely

Name a rule `yourpackage:what-it-does`, the way the built-ins do
(`symbolic:call`, `lines:line-ref`, `goalseek:solve-line`). The name is not just a
label: the normalizer unregisters rules **by name, and removes every rule that
shares it**. Two rules with the same name cannot be removed independently, so
unloading one package would silently drop the other's rule. Give every rule its
own name. Phrases do not have this hazard, they live in the trie by their text and
are simply replaced if registered twice.
