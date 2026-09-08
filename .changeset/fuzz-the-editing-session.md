---
"solve-engine": patch
---

The fuzzer can now edit a document and check the answers

The two generators the fuzzer had both ask the same kind of question: does the
engine survive this input. They corrupt an opcode stream, or write a line of
source, and a run passes when nothing crashed, hung or threw. Neither can catch
the engine being wrong, because neither has anything to be right against.

A third generator does. It builds a document, drives it through a session of
editor actions (change a line, insert one, delete one, move the viewport), and
after every action compares every line against a pass over the same text with no
editing history behind it. That pass is the answer the document has, so anything
a host does to reach the same text has to agree with it, line for line. A
mismatch is reported as a new outcome kind, `disagreement`, and it is the one
failure here that does not look like a failure: the engine returned, promptly,
without throwing, and gave a different answer than it gives when asked the same
question twice.

Two things about the comparison are load-bearing, and both were learned by
getting them wrong. The oracle has to be **settled**, since a whole-document
feature can need more than one pass to reach its answer, and comparing against a
single pass reported sixty disagreements that were nothing but the oracle being
read too early. And both sides need the **same number** of passes, or the run
stops measuring correctness and starts measuring which of them converges faster.

The shapes it generates are narrower than the grammar allows, on purpose. A case
is only useful if a settled pass has an opinion about it, so every line is
something that evaluates, and the interesting ones reach across lines: a name
defined on one line and read on another, a running total, a category tag, a line
reference, a unit definition. Anything whose answer is not a fixed function of
the text (a dice roll, a live rate, a date relative to now) is left out, since a
fuzzer whose oracle disagrees with itself reports nothing but its own noise.

The findings are signed by their input rather than by their wording, unlike
every other kind. The wording does distinguish them, but only through the two
answers, and the signature normalisation replaces every quoted fragment and
number, so one wrong answer would otherwise silence every other.

The soak now splits its wall-clock budget between the generators instead of
giving them one deadline to queue behind. A document case replays a whole
session and builds a settled oracle after every action, so it costs what
thousands of expression cases cost, and under a single deadline the cheap
generator at the front of the list spent the entire run.

## What it found

Three bugs before it was even committed, each after the one before it was fixed:
a variable whose defining line was gone, a user unit whose defining line was
gone, and a line edited into a heading never withdrawing what it used to define.
All three are released. A fourth is open, and this generator found it in sixty
cases: a `line 5` reference is not re-evaluated after an insert or a delete
moves what position five holds.

It also found a memory fault by dying of one. Constructing an engine per case
exhausted a 256MB heap, which turned out to be a `ReadableStream` built by every
engine whether or not anything read it.

## Verification

12 new tests covering the generator and the oracle: a seed always meaning the
same session, a session that agrees reporting nothing, an action past the end of
a shortened document being skipped rather than throwing, a delete never taking a
document below two lines, and a shrink that renumbers its actions when it drops
a line, so a reduction is still the same session it started as.
