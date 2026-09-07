/**
 * Dependency-graph benchmarks.
 *
 * The graph is the incremental engine's index: every edit asks it what to
 * re-run, so a regression here is felt on every keystroke rather than on one
 * feature. It had never been benchmarked, which is how a quadratic walk sat in
 * it unnoticed — invisible while every key had one writer, and quadratic the
 * moment a key can have many, which is what a category tag is.
 *
 * The shapes below are the ones a real document makes: a variable chain, a fan
 * in and out of one definition, and a tagged column with aggregates over it.
 *
 * Absolute bounds follow the rule set in #364: at least four times the slowest
 * median the shared runner has been measured delivering, so they catch a
 * collapse without measuring the runner. The merge-base comparison is what
 * catches an ordinary regression.
 */
import { describe, expect, test, afterAll } from "@jest/globals";
import { DependencyGraph, edgeKey } from "@solve-js/vm/DependencyGraph";
import { benchmarkFn } from "@tools/testUtils";
import { recordSample, writeBenchmarkResults, BenchmarkResults } from "@tools/benchmarkIO";

/** line i writes v(i) and reads v(i-1): one long dependency chain. */
function chain(lines: number): DependencyGraph {
  const dag = new DependencyGraph();
  for (let i = 0; i < lines; i++) dag.registerLine(i + 1, i === 0 ? [] : [`v${i - 1}`], [`v${i}`]);
  return dag;
}

/** A tag group of `members` lines with `aggregates` readers over the same key. */
function taggedColumn(members: number, aggregates: number): DependencyGraph {
  const dag = new DependencyGraph();
  const tag = edgeKey("tag", "food");
  for (let i = 0; i < members; i++) dag.registerLine(i + 1, ["seed"], [tag]);
  for (let i = 0; i < aggregates; i++) dag.registerLine(members + 1 + i, [tag], [`agg${i}`]);
  return dag;
}

/** One definition read by many lines, each defining a name of its own. */
function fan(readers: number): DependencyGraph {
  const dag = new DependencyGraph();
  dag.registerLine(1, ["seed"], ["root"]);
  for (let i = 0; i < readers; i++) dag.registerLine(i + 2, ["root"], [`r${i}`]);
  return dag;
}

/**
 * A document shaped the way a notepad is, rather than the way a stress test is.
 *
 * Most lines depend on nothing, a few define names other lines read, a few join
 * a category, and a few total it. The shapes above each isolate one cost; this
 * one is the mixture the evaluator actually walks, and it is here so an
 * optimisation that only helps a pathological shape shows as flat.
 */
function mixed(lines: number): DependencyGraph {
  const dag = new DependencyGraph();
  const tag = edgeKey("tag", "food");
  for (let i = 0; i < lines; i++) {
    const n = i + 1;
    if (i % 7 === 0) dag.registerLine(n, [], [`v${i}`]);
    else if (i % 7 === 1) dag.registerLine(n, [`v${i - 1}`], [`w${i}`]);
    else if (i % 7 === 2) dag.registerLine(n, ["seed"], [tag]);
    else if (i % 7 === 3) dag.registerLine(n, [tag], []);
    else dag.registerLine(n, [], []);
  }
  return dag;
}

describe("DependencyGraph Benchmarks", () => {
  const results: BenchmarkResults = {};

  afterAll(() => {
    writeBenchmarkResults("dependency-graph", results, "ms");
  });

  test("registers 5,000 lines in < 200ms", async () => {
    const r = await benchmarkFn(() => { chain(5_000); }, 20, 3);
    recordSample(results, "register_5k_lines", r);
    expect(r.medianMs).toBeLessThan(200);
  });

  test("walks a 4,000-line chain in < 20ms", async () => {
    const dag = chain(4_000);
    const r = await benchmarkFn(() => { dag.getAffectedLines("v0"); }, 200, 20);
    recordSample(results, "affected_chain_4k", r);
    expect(r.medianMs).toBeLessThan(20);
  });

  test("walks a tagged column of 2,000 members and 2,000 aggregates in < 20ms", async () => {
    // The shape that was quadratic: one key with many producers and many
    // consumers. 15.5 ms before keys were visited once, 0.8 ms after.
    const dag = taggedColumn(2_000, 2_000);
    const r = await benchmarkFn(() => { dag.getAffectedLines("seed"); }, 100, 10);
    recordSample(results, "affected_tagged_column_2k", r);
    expect(r.medianMs).toBeLessThan(20);
  });

  test("orders a 2,000-line chain in < 40ms", async () => {
    const dag = chain(2_000);
    const r = await benchmarkFn(() => { dag.getAffectedLinesInOrder("v0"); }, 100, 10);
    recordSample(results, "ordered_chain_2k", r);
    expect(r.medianMs).toBeLessThan(40);
  });

  test("orders a tagged column of 2,000 and 2,000 in < 40ms", async () => {
    // The shape that made ordering quadratic: every reader of a key has to come
    // after every writer of it, which is one edge per pair unless the key is a
    // node in its own right. 150.7 ms as pairs, 2.6 ms through the key.
    const dag = taggedColumn(2_000, 2_000);
    const r = await benchmarkFn(() => { dag.getAffectedLinesInOrder("seed"); }, 100, 10);
    recordSample(results, "ordered_tagged_column_2k", r);
    expect(r.medianMs).toBeLessThan(40);
  });

  test("orders a fan of 10,000 readers in < 40ms", async () => {
    // Nothing an affected line writes is read by another, so the sort has no
    // constraint to apply and should cost the walk and nothing more.
    const dag = fan(10_000);
    const r = await benchmarkFn(() => { dag.getAffectedLinesInOrder("seed"); }, 100, 10);
    recordSample(results, "ordered_fan_10k", r);
    expect(r.medianMs).toBeLessThan(40);
  });

  test("orders a mixed 5,000-line document in < 20ms", async () => {
    const dag = mixed(5_000);
    const r = await benchmarkFn(() => { dag.getAffectedLinesInOrder("seed"); }, 100, 10);
    recordSample(results, "ordered_mixed_5k", r);
    expect(r.medianMs).toBeLessThan(20);
  });

  test("registers a mixed 5,000-line document in < 60ms", async () => {
    const r = await benchmarkFn(() => { mixed(5_000); }, 20, 3);
    recordSample(results, "register_mixed_5k", r);
    expect(r.medianMs).toBeLessThan(60);
  });

  test("re-registers 5,000 unchanged lines in < 40ms", async () => {
    // The editor's ordinary case: a line re-runs because something it reads
    // moved, and its own text, which is where its edges come from, did not.
    const dag = chain(5_000);
    const r = await benchmarkFn(() => {
      for (let i = 0; i < 5_000; i++) dag.registerLine(i + 1, i === 0 ? [] : [`v${i - 1}`], [`v${i}`]);
    }, 20, 3);
    recordSample(results, "rereg_unchanged_5k", r);
    expect(r.medianMs).toBeLessThan(40);
  });

  test("100,000 lookups that miss in < 20ms", async () => {
    // The evaluator misses once per line that writes nothing, on every pass, so
    // a fresh Set per miss was garbage proportional to the document.
    const dag = chain(100);
    const r = await benchmarkFn(() => {
      for (let i = 0; i < 100_000; i++) dag.getWrites(999_999);
    }, 20, 3);
    recordSample(results, "missing_lookups_100k", r);
    expect(r.medianMs).toBeLessThan(20);
  });

  test("removes 5,000 lines in < 60ms", async () => {
    const r = await benchmarkFn(() => {
      const dag = chain(5_000);
      for (let line = 1; line <= 5_000; line++) dag.removeLine(line);
    }, 20, 3);
    recordSample(results, "remove_5k_lines", r);
    expect(r.medianMs).toBeLessThan(60);
  });
});
