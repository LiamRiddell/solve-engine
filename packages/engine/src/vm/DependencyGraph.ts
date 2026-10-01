/**
 * The kinds of thing a line can read from or write to.
 *
 * The graph itself knows nothing about any of them: it indexes edges between a
 * line and a key, and a kind is only a way of keeping those keys from colliding.
 * Adding a kind is adding a prefix, not a mechanism.
 */
export type EdgeKind = "variable" | "global" | "tag" | "datasource" | "line";

/**
 * The prefix each kind takes in the one key space.
 *
 * `variable` is bare, because that is the convention every existing call site
 * already passes and a local name can hold none of the other prefixes: an
 * identifier cannot contain a colon or begin with a hash. `global:` predates
 * this table (see `GlobalVariableStore.globalDagKey`) and is preserved
 * verbatim, so a local `:hello` and a global `:hello` stay distinct.
 */
const KIND_PREFIX: Readonly<Record<EdgeKind, string>> = {
	variable: "",
	global: "global:",
	tag: "#",
	datasource: "ds:",
	line: "line:",
};

/**
 * The key an edge of `kind` takes, in the graph's single key space.
 *
 * Every index in this file is keyed this way, so one mechanism serves variables,
 * tags and data sources rather than each growing its own pair of maps.
 */
export function edgeKey(kind: EdgeKind, name: string): string {
	return KIND_PREFIX[kind] + name;
}

/**
 * The positions and tags one line has already been recorded as reading.
 *
 * A span and a set, rather than a set alone, because the reads that dominate
 * are contiguous: an `above` aggregate walks every line back to its boundary
 * on every pass, so the span answers "already recorded" with two integer
 * comparisons where a set answered it with a hash. Anything outside the span
 * falls into `sparse`, which is allocated only if something does. The span is
 * also the whole of what the graph keeps for such a read: the reverse
 * question, which lines read line k, is answered by an interval index over
 * every entry's span (see {@link buildSpanIndex}), not by a key per position.
 *
 * Kept twice over: what the line has ever been recorded reading, and what it
 * has read since its reads were last reconciled, in the same span-and-set
 * shape. The second is what makes the first honest. A positional read is
 * discovered while the line runs, so a position the line stopped reading
 * cannot be discovered at all: an `above` aggregate whose block shrank under a
 * new heading still had edges to the lines above the heading, and a reader
 * edited to name a different line still had an edge to the old one. Once a
 * run is over, the run half says which of the recorded positions were not
 * read, and those are dropped. See {@link DependencyGraph.reconcilePositionReads}.
 */
interface PositionsRead {
	/** Lowest position recorded in the contiguous span, or -1 while the span is empty. */
	lo: number;
	/** Highest position recorded in the contiguous span, or -1 while the span is empty. */
	hi: number;
	/** Positions recorded outside the span, or null while there are none. */
	sparse: Set<number> | null;
	/** Category tags whose members the line reads (lower-cased, or {@link EVERY_TAG}), or null while there are none. */
	tags: Set<string> | null;
	/** Spans of figures the line reads, as `first, last` pairs, or null while there are none. */
	figures: number[] | null;
	/** Lowest position read since the last reconcile, or -1 while none has been. */
	runLo: number;
	/** Highest position read since the last reconcile. */
	runHi: number;
	/** Positions read since the last reconcile that fall outside that span, or null while there are none. */
	runSparse: Set<number> | null;
	/** Tags read since the last reconcile, or null while none has been. */
	runTags: Set<string> | null;
	/** Spans of figures read since the last reconcile, or null while none has been. */
	runFigures: number[] | null;
}

/**
 * What the dependency graph asks the document about a line, to follow an edge
 * that names a group of lines rather than each line: a tag edge, and a span of
 * figures (see {@link DependencyGraph.setDocumentView}).
 */
export interface DocumentView {
	/** The tags a line carries as a member, lower-cased; empty for a line with none or past the end. */
	memberTags(lineNumber: number): readonly string[];
	/** Whether a line is a summary line (`total above`, a section or tag total), which a span of figures passes over. */
	isSummary(lineNumber: number): boolean;
}

/** Whether a flat list of `first, last` pairs holds this pair. */
function holdsInterval(pairs: readonly number[] | null, first: number, last: number): boolean {
	if (pairs === null) return false;
	for (let i = 0; i < pairs.length; i += 2) if (pairs[i] === first && pairs[i + 1] === last) return true;
	return false;
}

/** Whether two flat pair lists hold the same pairs in the same order, an absent list counting as empty. */
function samePairs(a: readonly number[] | null, b: readonly number[] | null): boolean {
	const la = a === null ? 0 : a.length;
	const lb = b === null ? 0 : b.length;
	if (la !== lb) return false;
	for (let i = 0; i < la; i++) if (a![i] !== b![i]) return false;
	return true;
}

/**
 * The tag edge `total by tag` takes: every tagged line is a member.
 *
 * A tag name is a word, so an asterisk can never be one.
 */
export const EVERY_TAG = "*";

/**
 * Every recorded span, sorted by its low end, with a max tree over the high
 * ends, and the sparse positions by position.
 *
 * Answers "which readers' spans contain line k" without a key per position:
 * the spans whose low end is at or before k are a prefix of the sort, and the
 * tree skips every part of that prefix whose highest high end falls short of
 * k, so a query costs a logarithm per reader it finds. Built from the entries
 * when first asked after one changed; a settled pass changes none. A span of
 * figures sits in the same sort, marked, since it reaches a line only when the
 * line is not a summary.
 */
interface SpanIndex {
	/** Each span's low end, ascending. */
	readonly lo: Int32Array;
	/** Each span's high end, in the same order. */
	readonly hi: Int32Array;
	/** Each span's reader, in the same order. */
	readonly reader: Int32Array;
	/** 1 where the span is a span of figures, which passes over a summary line. */
	readonly figures: Uint8Array;
	/** Leaves from `leafBase`: the highest `hi` under each node, -1 where empty. */
	readonly maxHi: Int32Array;
	/** The first leaf, a power of two at least the number of spans. */
	readonly leafBase: number;
	/** Position to the readers holding it in a sparse set. */
	readonly sparse: Map<number, number[]>;
}

/** Build the interval index over every entry's recorded span, spans of figures and sparse set. */
function buildSpanIndex(entries: ReadonlyMap<number, PositionsRead>): SpanIndex {
	const spans: { lo: number; hi: number; reader: number; figures: number }[] = [];
	const sparse = new Map<number, number[]>();
	for (const [reader, positions] of entries) {
		if (positions.lo !== -1) spans.push({ lo: positions.lo, hi: positions.hi, reader, figures: 0 });
		const figures = positions.figures;
		if (figures !== null) {
			for (let i = 0; i < figures.length; i += 2) spans.push({ lo: figures[i], hi: figures[i + 1], reader, figures: 1 });
		}
		if (positions.sparse !== null) {
			for (const n of positions.sparse) {
				const list = sparse.get(n);
				if (list === undefined) sparse.set(n, [reader]);
				else list.push(reader);
			}
		}
	}
	spans.sort((a, b) => a.lo - b.lo);
	const count = spans.length;
	const lo = new Int32Array(count);
	const hi = new Int32Array(count);
	const reader = new Int32Array(count);
	const figures = new Uint8Array(count);
	for (let i = 0; i < count; i++) {
		lo[i] = spans[i].lo;
		hi[i] = spans[i].hi;
		reader[i] = spans[i].reader;
		figures[i] = spans[i].figures;
	}
	let leafBase = 1;
	while (leafBase < count) leafBase *= 2;
	const maxHi = new Int32Array(2 * leafBase).fill(-1);
	for (let i = 0; i < count; i++) maxHi[leafBase + i] = hi[i];
	for (let node = leafBase - 1; node >= 1; node--) maxHi[node] = Math.max(maxHi[2 * node], maxHi[2 * node + 1]);
	return { lo, hi, reader, figures, maxHi, leafBase, sparse };
}

/**
 * The readers whose recorded span or sparse set holds `position`.
 *
 * @param passesOver - Whether a span of figures passes over the position,
 * asked only when one covers it.
 * @returns The readers, a reader with two spans over the position listed twice.
 */
function stabSpanIndex(index: SpanIndex, position: number, passesOver: () => boolean): number[] {
	return [...spanReaders(index, position, passesOver)];
}

/**
 * {@link stabSpanIndex}, one reader at a time: the same readers in the same
 * order, with no array of them. The walk's own stack is the depth of the tree,
 * so a caller holding many of these at once (the cycle walk, one per line on
 * its path) holds the path and not every reader of every line on it.
 */
function* spanReaders(index: SpanIndex, position: number, passesOver: () => boolean): Generator<number, void, undefined> {
	// How many spans start at or before the position: a prefix of the sort.
	let low = 0;
	let high = index.lo.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (index.lo[mid] <= position) low = mid + 1;
		else high = mid;
	}
	const prefix = low;
	if (prefix > 0) {
		// Down the tree from the root, into the prefix only, and only into a
		// node some span under which reaches the position. Iterative, so a
		// deep tree costs no stack.
		const stack: number[] = [1, 0, index.leafBase];
		while (stack.length > 0) {
			const width = stack.pop()!;
			const start = stack.pop()!;
			const node = stack.pop()!;
			if (start >= prefix || index.maxHi[node] < position) continue;
			if (width === 1) {
				if (index.figures[start] === 0 || !passesOver()) yield index.reader[start];
				continue;
			}
			const half = width >>> 1;
			stack.push(2 * node + 1, start + half, half, 2 * node, start, half);
		}
	}
	const sparse = index.sparse.get(position);
	if (sparse !== undefined) yield* sparse;
}

/** How many of a reader's spans of figures reach below it, which is how the downward count counts them. */
function downwardFigureSpans(pairs: readonly number[] | null, reader: number): number {
	if (pairs === null) return 0;
	let count = 0;
	for (let i = 1; i < pairs.length; i += 2) if (pairs[i] > reader) count++;
	return count;
}

/**
 * Note a position in the run half of an entry.
 *
 * The same span-first discipline the recorded half uses, and for the same
 * reason: an `above` aggregate reads its block one line at a time, downwards,
 * so nearly every call extends the span by one and the set is never touched.
 */
function noteReadThisRun(positions: PositionsRead, position: number): void {
	if (positions.runLo === -1) {
		positions.runLo = position;
		positions.runHi = position;
	} else if (position >= positions.runLo && position <= positions.runHi) {
		return;
	} else if (position === positions.runHi + 1) {
		positions.runHi = position;
		if (positions.runSparse !== null) positions.runSparse.delete(position);
	} else if (position === positions.runLo - 1) {
		positions.runLo = position;
		if (positions.runSparse !== null) positions.runSparse.delete(position);
	} else if (positions.runSparse === null) {
		positions.runSparse = new Set([position]);
	} else {
		positions.runSparse.add(position);
	}
}

/** Whether the run half of an entry read `position`. */
function readThisRun(positions: PositionsRead, position: number): boolean {
	if (position >= positions.runLo && position <= positions.runHi) return true;
	return positions.runSparse !== null && positions.runSparse.has(position);
}

/**
 * Whether two sparse sets hold the same positions, an absent set counting as
 * an empty one.
 */
function sameSparse<T>(a: Set<T> | null, b: Set<T> | null): boolean {
	if (a === null || a.size === 0) return b === null || b.size === 0;
	if (b === null || a.size !== b.size) return false;
	for (const n of a) if (!b.has(n)) return false;
	return true;
}

/**
 * The key a line's position takes, so another line can depend on that position.
 *
 * `prev`, `line 7`, `sum(line 3 : line 9)` and the `above` aggregates all read
 * a position rather than a name. The graph holds such a read as a span in the
 * reader's own entry, not as a key; this is how {@link DependencyGraph.getReads},
 * {@link DependencyGraph.getConsumers} and the snapshot spell one, and what
 * `getConsumers` accepts to ask who reads a position.
 */
export function linePositionEdgeKey(lineNumber: number): string {
	return edgeKey("line", String(lineNumber));
}

/** The position a `line:` key names, or null for any other key. */
function positionOfLineKey(key: string): number | null {
	if (!key.startsWith(KIND_PREFIX.line)) return null;
	const position = Number(key.slice(KIND_PREFIX.line.length));
	return Number.isInteger(position) ? position : null;
}

/**
 * Whether a key belongs to one of the prefixed kinds rather than to a variable.
 *
 * A variable's key is the bare name, so anything carrying a prefix is a
 * category tag, a global, a data source or a line position. A caller acting on
 * a key as though it were a variable name asks this first.
 */
export function isPrefixedEdgeKey(key: string): boolean {
	for (const kind in KIND_PREFIX) {
		const prefix = KIND_PREFIX[kind as EdgeKind];
		if (prefix !== "" && key.startsWith(prefix)) return true;
	}
	return false;
}

/** The key a data source's query takes, so a line can depend on one query rather than a whole source. */
export function dataSourceEdgeKey(dataSourceId: string, queryKey: readonly string[]): string {
	return edgeKey("datasource", `${dataSourceId}:${JSON.stringify(queryKey)}`);
}

/** Serialized snapshot of the dependency graph for diagnostic rendering. */
export interface DagSnapshot {
  consumers: Record<string, number[]>;
  /** key -> the lines that write it, the mirror of `consumers`. */
  producers: Record<string, number[]>;
  writes: Record<number, string[]>;
  reads: Record<number, string[]>;
  dataSourceDeps: Record<number, string[]>;
  dataSourceConsumers: Record<string, number[]>;
}

/**
 * Returned by every lookup that misses, so a miss allocates nothing.
 *
 * The getters already hand back the graph's own sets rather than copies, so a
 * caller has never been free to mutate what it is given; this shares that rule
 * with the empty case. Misses are the common case in the evaluator's per-line
 * loops, where most lines write nothing, and a fresh `new Set()` for each was
 * about 176 nanoseconds of pure garbage per call.
 */
const NO_LINES: ReadonlySet<number> = new Set<number>();

/** The empty key set, for the same reason as {@link NO_LINES}. */
const NO_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * Returned when a registration orphaned nothing, which is nearly every one.
 *
 * A line stops writing a name only when it is edited into something else or
 * deleted, so allocating an array per registration to say "none" would be a
 * per-line cost for a per-session event.
 */
const NO_ORPHANS: readonly string[] = [];

/** The answer to "who recorded a new position" on every line of a settled pass. */
const NO_READERS: readonly number[] = [];

/**
 * Dependency graph for variable and data-source tracking across document lines.
 *
 * Tracks which lines read/write which variables, and propagates changes through
 * the graph when a variable is modified. Supports:
 * - Variable dependency tracking (registerLine, getAffectedLines)
 * - Data-source dependency tracking (registerLineDataSourceDependency)
 * - Topological ordering of affected lines (getAffectedLinesInOrder)
 * - Efficient removal of deleted lines (removeLine)
 */
export class DependencyGraph {
   /** key -> the lines that READ it. Answers "what does an edit to this affect". */
   private consumers: Map<string, Set<number>> = new Map();
   /**
    * key -> the lines that WRITE it. Answers "what is in this group".
    *
    * The half that was missing. `consumers` alone can say which lines ask about
    * `#food`; only this can say which lines are *in* it, which is what a
    * category-tag aggregate needs and why it used to walk the whole document
    * instead of asking.
    */
   private producers: Map<string, Set<number>> = new Map();
   private dependencies: Map<number, Set<string>> = new Map();
   private writes: Map<number, Set<string>> = new Map();
   private lineReads: Map<number, Set<string>> = new Map();
   /**
    * line -> the keys it reads that {@link registerLine} must not replace.
    *
    * Variable and tag edges are recovered from the line's text every time it is
    * registered, so registering replaces them. A data-source edge is discovered
    * at run time, after that registration, so replacing would drop it. Both live
    * in the same {@link consumers} index; only the bookkeeping differs.
    */
   private pinnedReads: Map<number, Set<string>> = new Map();

   /**
    * line -> the positions and tags it has been recorded as reading.
    *
    * The only place a positional edge is held. {@link consumers},
    * {@link lineReads} and {@link pinnedReads} hold no `line:` key: the
    * reverse direction is the interval index {@link spanIndex} and the tag
    * index {@link tagReaders}, and the `line:` keys the getters and the
    * snapshot report are made from these entries when asked. See
    * {@link registerLinePositionDependency}.
    */
   private positionReads: Map<number, PositionsRead> = new Map();

   /**
    * The interval index over {@link positionReads}, or null once an entry has
    * changed since it was built. See {@link getAffectedLinesByPosition}.
    */
   private spanIndex: SpanIndex | null = null;

   /**
    * Tag (lower-cased, or {@link EVERY_TAG}) to the lines reading its members.
    * See {@link registerLineTagDependency}.
    */
   private tagReaders: Map<string, Set<number>> = new Map();

   /** What the graph asks the document about a line; see {@link setDocumentView}. */
   private view: DocumentView | null = null;

   /**
    * The reader whose entry was looked up last, and that entry.
    *
    * An `above` aggregate records every line back to its boundary in one run,
    * so the reader is the same for the whole burst and the map is asked for
    * the same entry hundreds of times. One slot answers all but the first.
    * Cleared wherever the map is, since a stale entry here would record edges
    * against a line that no longer has any.
    */
   private lastPositionReader = -1;
   private lastPositionReads: PositionsRead | null = null;

   /**
    * Readers that recorded a position they had not been recorded reading,
    * since the evaluator last took the list.
    *
    * A positional edge can close a cycle, and the moment it is recorded is the
    * one moment that is knowable: the reader has just run its current text,
    * so the edge is real, and every other edge in the graph describes the
    * last run of the line that holds it. The evaluator takes the list at the
    * end of each pass and looks for a cycle through each reader on it; see
    * `ThreeTierEvaluator.settleCycles`. A line that only
    * re-recorded edges it already had is not on it, which is every line of
    * every pass once a document has settled.
    */
   private readersThatGainedAPosition: number[] = [];

   /**
    * How many recorded positional edges point downwards, from a reader to a
    * line below it.
    *
    * A cycle needs one. Every edge in a document of `prev` and `above` points
    * upwards, positions fall strictly along any path, and no path can come
    * back to where it started. So the evaluator asks this before walking
    * anything, and a document with no forward reference never pays for the
    * walk at all, which is nearly every document and every pass after the one
    * that closed a cycle.
    */
   private downwardPositionReads = 0;

   /**
    * Lines that registered a different edge set since the evaluator last
    * asked, and the keys whose producer set changed.
    *
    * The roots of the end-of-pass cycle walk. A cycle is closed, or a name that
    * pinned one is withdrawn, by a change in the graph; nothing else creates
    * one. A line that re-registers the edges it had is not on the list, which
    * is every line of a settled pass, and it is also a line that is dirty
    * because it threw, which stays dirty and re-runs every pass: rooting the
    * walk on "ran" rather than "changed" made such a line reset its cycle on
    * alternate passes for ever. Taken and cleared by {@link takeEdgeChanges}.
    */
   private edgesChangedThisPass: number[] = [];
   private producersChangedThisPass: Set<string> | null = null;

  /**
   * Whether this line already carries exactly these edges.
   *
   * Reads are compared against the stored set minus its pinned keys, since a
   * pinned key (a data source) is not part of what a caller passes.
   */
  private hasSameEdges(
    storedReads: Set<string> | undefined,
    storedWrites: Set<string> | undefined,
    reads: string[],
    writes: string[],
    pinned: Set<string> | undefined,
  ): boolean {
    if (storedReads === undefined) return false;
    if (storedReads.size !== reads.length + (pinned?.size ?? 0)) return false;

    if (writes.length === 0) {
      if (storedWrites !== undefined) return false;
    } else if (storedWrites === undefined || storedWrites.size !== writes.length) {
      return false;
    }

    for (const read of reads) if (!storedReads.has(read)) return false;
    if (storedWrites !== undefined) {
      for (const write of writes) if (!storedWrites.has(write)) return false;
    }
    return true;
  }

  /**
   * Register a line's variable reads and writes in the dependency graph.
   *
   * If re-registering the same line (e.g., after editing), old consumer
   * references are cleaned up first. Write-variables are removed from
   * the consumer set so that redefinition breaks the old dependency chain.
   *
   * @param lineNumber - 1-based line number in the document
   * @param reads - Variable names this line reads
   * @param writes - Variable names this line writes (assigns to)
   */
   registerLine(lineNumber: number, reads: string[], writes: string[]): readonly string[] {
     // Almost no document reads a data source, and `size` is a field read where
     // `get` is a hash of the line number, so the common case never pays for
     // the lookup at all.
     const pinned = this.pinnedReads.size !== 0 ? this.pinnedReads.get(lineNumber) : undefined;
     // Fetched once and handed to both the comparison and the cleanup below,
     // which used to look each of them up again.
     const oldReads = this.lineReads.get(lineNumber);
     const oldWrites = this.writes.get(lineNumber);

     // A line whose edges have not moved is left alone.
     //
     // Re-registering unhooks every old edge and hooks the same ones back up,
     // and allocates a set or three doing it. That is the editor's ordinary
     // case, not a rare one: a line re-runs because a value it reads changed,
     // and its own text, which is where its edges come from, did not. The
     // check is a size comparison and a membership test per edge, against a
     // delete and an insert per edge plus the allocations.
     //
     // Deliberately conservative. Duplicate names in `reads` make the stored
     // set smaller than the array, and the comparison simply fails and falls
     // through to the full path, which is correct either way.
     if (this.hasSameEdges(oldReads, oldWrites, reads, writes, pinned)) return NO_ORPHANS;
     this.edgesChangedThisPass.push(lineNumber);

     // Clean up old consumer references if re-registering this line. A pinned
     // read (a data source, discovered at run time rather than from the text)
     // is not this call's to drop.
     if (oldReads) {
       for (const oldRead of oldReads) {
         if (pinned?.has(oldRead)) continue;
         const consumers = this.consumers.get(oldRead);
         if (consumers) consumers.delete(lineNumber);
       }
     }

     // Old writes leave the producer index for the same reason: this line may
     // no longer be in the group it was in. Without this a deleted `#food` on
     // an edited line would leave the line a member for ever.
     //
     // A key this line has stopped writing, and that no other line writes, is
     // now defined by nothing, and the caller is told so: the value has to leave
     // the VM too, or a line reading the name goes on answering with it long
     // after the line that defined it stopped saying so.
     let orphaned: string[] | null = null;
     if (oldWrites) {
       for (const oldWrite of oldWrites) {
         const producers = this.producers.get(oldWrite);
         if (producers === undefined) continue;
         producers.delete(lineNumber);
         if (!writes.includes(oldWrite)) (this.producersChangedThisPass ??= new Set()).add(oldWrite);
         if (producers.size === 0 && !writes.includes(oldWrite)) {
           this.producers.delete(oldWrite);
           (orphaned ??= []).push(oldWrite);
         }
       }
     }

     // Track what this line reads, keeping any pinned keys alongside.
     const readSet = new Set(reads);
     if (pinned) for (const key of pinned) readSet.add(key);
     this.lineReads.set(lineNumber, readSet);

     // Add new consumer references.
     //
     // One hash lookup per edge rather than three. `has` then `get` then `add`
     // hashes the key twice before touching the set, and registering a document
     // does this once per edge: at five thousand lines it was measurable against
     // the same loop written as a single `get`.
     for (const dep of reads) {
       const existing = this.consumers.get(dep);
       if (existing !== undefined) existing.add(lineNumber);
       else this.consumers.set(dep, new Set([lineNumber]));
     }

     // And the reverse direction, which is what makes "who is in this group"
     // a lookup rather than a walk.
     for (const write of writes) {
       if (oldWrites === undefined || !oldWrites.has(write)) (this.producersChangedThisPass ??= new Set()).add(write);
       const existing = this.producers.get(write);
       if (existing !== undefined) existing.add(lineNumber);
       else this.producers.set(write, new Set([lineNumber]));
     }

     if (writes.length > 0) {
       // The same set object as `lineReads`, not a copy of it.
       //
       // They hold identical contents whenever the line has no pinned key,
       // which is every line that does not read a data source, so building a
       // second one allocated a set per line for nothing. The one place that
       // can make them differ, {@link registerLineDataSourceDependency}, splits
       // them before it writes, so neither getter can see the other's contents.
       this.dependencies.set(lineNumber, pinned === undefined ? readSet : new Set(reads));
       this.writes.set(lineNumber, new Set(writes));
       for (const write of writes) {
         const prevConsumer = this.consumers.get(write);
         if (prevConsumer) prevConsumer.delete(lineNumber);
       }
     } else {
       // A line that writes nothing must not keep a stale write set, or it
       // stays a producer of a group it has left. Its recorded dependencies go
       // with them: `dependencies` is only ever written alongside `writes`, so
       // leaving it behind kept a set describing a line that no longer defines
       // anything, which is what `getDependencies` would then hand out.
       this.writes.delete(lineNumber);
       this.dependencies.delete(lineNumber);
     }

     return orphaned ?? NO_ORPHANS;
   }

  /**
   * Forget every external data source a line was recorded as reading.
   *
   * A data-source read is pinned (see {@link registerLineDataSourceDependency}):
   * it was discovered while the line ran, so re-registering the line from its
   * text keeps it. That is right for a live line and wrong for a frozen one,
   * which reads its answer from the engine's store and never the source again.
   * Left in place, the pinned read kept the line a consumer of the query, so the
   * batcher re-ran it whenever the value landed and a background refresh kept
   * fetching for it. Only data-source keys are dropped: they are never part of a
   * cycle, so no other edge, and no cycle bookkeeping, changes.
   *
   * @param lineNumber - The 1-based line whose data-source reads to drop.
   * @returns How many were dropped.
   */
  dropDataSourceReads(lineNumber: number): number {
    const pinned = this.pinnedReads.get(lineNumber);
    if (pinned === undefined) return 0;
    const prefix = edgeKey("datasource", "");
    let dropped = 0;
    for (const key of Array.from(pinned)) {
      if (!key.startsWith(prefix)) continue;
      pinned.delete(key);
      this.lineReads.get(lineNumber)?.delete(key);
      const consumers = this.consumers.get(key);
      if (consumers !== undefined) {
        consumers.delete(lineNumber);
        if (consumers.size === 0) this.consumers.delete(key);
      }
      dropped++;
    }
    if (pinned.size === 0) this.pinnedReads.delete(lineNumber);
    return dropped;
  }

  /**
   * Register a line's dependency on an external data source (e.g., currency rate, OSRS GE price).
   *
   * When the data source updates, {@link getAffectedLinesByDataSource} returns all lines
   * that depend on this data, enabling targeted re-evaluation.
   *
   * @param lineNumber - 1-based line number in the document
   * @param dataSourceId - Unique identifier for the data source (e.g., "currency", "osrs-ge")
   * @param queryKey - Query key array identifying the specific data (e.g., ["USD", "EUR"])
   */
  registerLineDataSourceDependency(lineNumber: number, dataSourceId: string, queryKey: string[]): void {
    const key = dataSourceEdgeKey(dataSourceId, queryKey);

    // The same consumer index every other read uses. What differs is that this
    // one is pinned: it was discovered while the line ran, so the next
    // registration of that line, which recovers edges from its text, must not
    // drop it.
    const existingPinned = this.pinnedReads.get(lineNumber);
    if (existingPinned !== undefined) existingPinned.add(key);
    else this.pinnedReads.set(lineNumber, new Set([key]));

    // `registerLine` stores one set under both `lineReads` and `dependencies`
    // when a line has no pinned key. This is the call that gives it one, so the
    // two part company here: a data-source key is a read of the line, and it is
    // not one of the dependencies a line declares by writing something.
    const existingReads = this.lineReads.get(lineNumber);
    if (existingReads === undefined) {
      this.lineReads.set(lineNumber, new Set([key]));
    } else {
      if (existingReads === this.dependencies.get(lineNumber)) {
        this.dependencies.set(lineNumber, new Set(existingReads));
      }
      existingReads.add(key);
    }

    const existingConsumers = this.consumers.get(key);
    if (existingConsumers !== undefined) existingConsumers.add(lineNumber);
    else this.consumers.set(key, new Set([lineNumber]));
  }

  /**
   * Find all lines affected by a changed variable via BFS through the consumer graph.
   *
   * When a variable is modified (e.g., `:x = 5` changes to `:x = 10`), this returns
   * all lines that transitively depend on it, lines that read `x`, lines that read
   * variables written by those lines, and so on.
   *
   * @param changedVariable - The variable name that changed
   * @returns Set of line numbers that need re-evaluation
   */
  getAffectedLines(changedVariable: string): Set<number> {
    const visited = new Set<number>();
    const first = this.consumers.get(changedVariable);
    if (first === undefined) return visited;

    // Keys are visited once, not once per line that writes them. Without this
    // a key with many producers had its whole consumer set rescanned by each
    // of them, which is quadratic in producers x consumers: exactly the shape a
    // category tag makes, where a column of members and a set of aggregates
    // share one key. Measured on 2,000 members and 2,000 aggregates: 15.5 ms
    // before, and the walk is over the edges once now.
    const seenKeys = new Set<string>([changedVariable]);
    // The queue holds each key's consumer set rather than the key itself.
    //
    // A key is looked up once either way, so what this saves is the queue entry
    // for a key nobody reads, which is most of them: in a document where every
    // line defines its own name, the old queue grew to the size of the document
    // and every entry but the first turned out to lead nowhere.
    const queue: Set<number>[] = [first];
    // A head index rather than pop(), so the walk is breadth-first and the
    // queue is never re-ordered. Depth-first was not wrong, but the order this
    // hands to the caller is now the order the edges were found in.
    for (let head = 0; head < queue.length; head++) {
      for (const line of queue[head]) {
        if (visited.has(line)) continue;
        visited.add(line);
        const lineWrites = this.writes.get(line);
        if (lineWrites === undefined) continue;
        for (const writtenVar of lineWrites) {
          if (seenKeys.has(writtenVar)) continue;
          seenKeys.add(writtenVar);
          const next = this.consumers.get(writtenVar);
          if (next !== undefined) queue.push(next);
        }
      }
    }
    return visited;
  }

  /**
   * Phase 1.4 DAG-walk optimization: return affected lines in dependency-safe
   * topological order. Uses Kahn's algorithm (BFS-based) to ensure every line
   * is evaluated AFTER all lines it depends on have been processed.
   *
   * This is more correct than ascending line-number sort, which fails when
   * variable definitions and their consumers are not in document order.
   *
   * @returns Line numbers in topological order (producers before consumers).
   */
  getAffectedLinesInOrder(startVariable: string): number[] {
    const affected = this.getAffectedLines(startVariable);
    if (affected.size === 0) return [];

    // The sort runs over lines AND the keys between them, rather than over
    // lines alone.
    //
    // Ordering a line after everything it depends on means, for a key, ordering
    // every reader after every writer. Written as edges between lines that is
    // one edge per pair: a tagged column of m members with n aggregates over it
    // costs m x n, which measured 150 ms at two thousand of each. Routing
    // through the key as a node in its own right says the same thing in m + n:
    // every writer points at the key, and the key points at every reader.
    //
    // Lines and keys are numbered into one dense range, lines first, so every
    // structure below is a typed array indexed by node rather than a map keyed
    // by one. The map this replaced held number keys for lines and string keys
    // for hubs, which is the shape that costs the most to look up: a mixed key
    // type gives up the fast path for both.
    const lineCount = affected.size;
    const lines = new Array<number>(lineCount);
    // Each line's two edge sets, fetched once and held by node index.
    //
    // Three of the passes below want them again: the one that collects what the
    // set writes, the one that finds the keys it reads back, and the one that
    // records the writes as edges. Reading them from the maps each time meant a
    // line was hashed into both indexes on every pass rather than once.
    const writesOf = new Array<Set<string> | undefined>(lineCount);
    const readsOf = new Array<Set<string> | undefined>(lineCount);
    {
      let i = 0;
      for (const line of affected) {
        lines[i] = line;
        writesOf[i] = this.writes.get(line);
        readsOf[i] = this.lineReads.get(line);
        i++;
      }
    }

    // A key earns a node only when it is both written and read inside the
    // affected set: anything else adds a node the sort would have to drain for
    // no constraint.
    const writtenKeys = new Set<string>();
    for (let i = 0; i < lineCount; i++) {
      const lineWrites = writesOf[i];
      if (lineWrites !== undefined) for (const key of lineWrites) writtenKeys.add(key);
    }

    // Hub discovery and the edges out of each hub, in one pass.
    //
    // A key becomes a hub the first time an affected line reads it, and that is
    // the same moment the edge from it to that line is known, so both come out
    // of one walk over the read sets. What this avoids is hashing every key
    // again: the passes that follow work from these two integer arrays, and the
    // only hash left in the whole sort is one lookup per written key below.
    const hubIndex = new Map<string, number>();
    const readEdgeFrom: number[] = [];
    const readEdgeTo: number[] = [];
    for (let i = 0; i < lineCount; i++) {
      const reads = readsOf[i];
      if (reads === undefined) continue;
      const lineWrites = writesOf[i];
      for (const key of reads) {
        if (!writtenKeys.has(key)) continue;
        // A line that both writes and reads one key constrains nothing about
        // itself, and an edge each way would be a cycle the sort cannot drain.
        if (lineWrites !== undefined && lineWrites.has(key)) continue;
        let hub = hubIndex.get(key);
        if (hub === undefined) {
          hub = lineCount + hubIndex.size;
          hubIndex.set(key, hub);
        }
        readEdgeFrom.push(hub);
        readEdgeTo.push(i);
      }
    }

    const nodeCount = lineCount + hubIndex.size;

    // Nothing an affected line writes is read by another one, so there is no
    // constraint to sort by and the lines come back in the order the walk found
    // them. This is the ordinary case for a document of independent lines, and
    // it now allocates nothing beyond the answer.
    if (hubIndex.size === 0) return lines;

    // The other direction: a line that writes a key the set also reads.
    const writeEdgeFrom: number[] = [];
    const writeEdgeTo: number[] = [];
    for (let i = 0; i < lineCount; i++) {
      const lineWrites = writesOf[i];
      if (lineWrites === undefined) continue;
      for (const key of lineWrites) {
        const hub = hubIndex.get(key);
        if (hub === undefined) continue;
        writeEdgeFrom.push(i);
        writeEdgeTo.push(hub);
      }
    }

    // Counted first, then filled, so the edge lists are two flat arrays rather
    // than an array per node. `offsets[n]` to `offsets[n + 1]` is node n's
    // slice of `targets`, the shape a compressed sparse row takes.
    const writeEdgeCount = writeEdgeFrom.length;
    const readEdgeCount = readEdgeFrom.length;
    const outDegree = new Int32Array(nodeCount);
    const inDegree = new Int32Array(nodeCount);
    for (let e = 0; e < writeEdgeCount; e++) {
      outDegree[writeEdgeFrom[e]]++;
      inDegree[writeEdgeTo[e]]++;
    }
    for (let e = 0; e < readEdgeCount; e++) {
      outDegree[readEdgeFrom[e]]++;
      inDegree[readEdgeTo[e]]++;
    }

    const offsets = new Int32Array(nodeCount + 1);
    for (let n = 0; n < nodeCount; n++) offsets[n + 1] = offsets[n] + outDegree[n];
    const targets = new Int32Array(offsets[nodeCount]);
    // Reused as the write cursor, one per node, so the fill needs no second
    // allocation: after it, `cursor[n]` has advanced to the end of n's slice.
    const cursor = outDegree;
    cursor.set(offsets.subarray(0, nodeCount));
    // Write edges before read edges, per node, which is the order the edges
    // were discovered in and so the order the drain below emits lines in.
    for (let e = 0; e < writeEdgeCount; e++) targets[cursor[writeEdgeFrom[e]]++] = writeEdgeTo[e];
    for (let e = 0; e < readEdgeCount; e++) targets[cursor[readEdgeFrom[e]]++] = readEdgeTo[e];

    // Kahn's algorithm: start with zero-indegree nodes, then iteratively remove
    // them, adding newly-freed ones.
    const queue = new Int32Array(nodeCount);
    // A node reaches zero in-degree once, so it is enqueued once, except for
    // the cycle fallback below which enqueues a node that has not. The flag
    // makes that the only difference rather than a node emitted twice, and
    // keeps the queue inside the length it was sized to.
    const queued = new Uint8Array(nodeCount);
    let tail = 0;
    for (let n = 0; n < nodeCount; n++) {
      if (inDegree[n] === 0) { queue[tail++] = n; queued[n] = 1; }
    }

    // If every node has at least one dependency (a cycle, or a producer outside
    // the affected set), start with the lowest line number as a fallback.
    if (tail === 0) {
      let lowest = 0;
      for (let i = 1; i < lineCount; i++) if (lines[i] < lines[lowest]) lowest = i;
      queue[tail++] = lowest;
      queued[lowest] = 1;
    }

    const ordered: number[] = [];
    for (let head = 0; head < tail; head++) {
      const current = queue[head];
      // Key nodes are scaffolding for the ordering, not lines to evaluate.
      if (current < lineCount) ordered.push(lines[current]);
      const end = offsets[current + 1];
      for (let e = offsets[current]; e < end; e++) {
        const next = targets[e];
        if (--inDegree[next] === 0 && queued[next] === 0) { queue[tail++] = next; queued[next] = 1; }
      }
    }

    // Append any remaining lines that couldn't be topologically sorted
    // (cycles or external-only dependencies) in ascending order.
    if (ordered.length < lineCount) {
      const remaining: number[] = [];
      for (let i = 0; i < lineCount; i++) if (queued[i] === 0) remaining.push(lines[i]);
      remaining.sort((a, b) => a - b);
      for (let i = 0; i < remaining.length; i++) ordered.push(remaining[i]);
    }

    return ordered;
  }

  /**
   * Record that `lineNumber` read the result of line `dependsOnLine`.
   *
   * A positional read is discovered while the line runs, the same way a data
   * source is, and for the same reason it outlives the next registration of
   * this line, which recovers its edges from the text, where a position it
   * reached for at run time does not appear.
   *
   * The edge is held as a number in the reader's own entry, a contiguous span
   * and a sparse set, and nowhere else: "which lines read line k" is answered
   * by an interval index over those spans (see {@link getAffectedLinesByPosition}),
   * so an `above` aggregate over a thousand lines costs one entry, not a
   * thousand keys in three indexes (#733).
   *
   * A line depending on itself is dropped rather than recorded, since it would
   * be a cycle the ordering has to break and says nothing.
   *
   * @param lineNumber - 1-based line doing the reading
   * @param dependsOnLine - 1-based line whose result it read
   */
  registerLinePositionDependency(lineNumber: number, dependsOnLine: number): void {
    if (lineNumber === dependsOnLine) return;
    const positions = this.positionEntry(lineNumber);
    // The run half is told about every read, repeat or not: it is what
    // {@link reconcilePositionReads} compares the recorded half against once
    // the run is over.
    noteReadThisRun(positions, dependsOnLine);
    // The repeat is the common case: an `above` aggregate reads every line
    // back to its boundary on every pass, and almost every call describes an
    // edge that already exists. Two integer comparisons answer it.
    if (dependsOnLine >= positions.lo && dependsOnLine <= positions.hi) return;

    // Whether the edge is new, rather than a position the entry already held
    // in its sparse set and the span has now grown over.
    let gained = true;
    if (positions.lo === -1) {
      positions.lo = dependsOnLine;
      positions.hi = dependsOnLine;
    } else if (dependsOnLine === positions.hi + 1) {
      positions.hi = dependsOnLine;
      // A position the span has grown over is no longer sparse, or the entry
      // would list it twice.
      if (positions.sparse !== null && positions.sparse.delete(dependsOnLine)) gained = false;
    } else if (dependsOnLine === positions.lo - 1) {
      positions.lo = dependsOnLine;
      if (positions.sparse !== null && positions.sparse.delete(dependsOnLine)) gained = false;
    } else if (positions.sparse === null) {
      positions.sparse = new Set([dependsOnLine]);
    } else if (positions.sparse.has(dependsOnLine)) {
      return;
    } else {
      positions.sparse.add(dependsOnLine);
    }
    // The entry's shape moved, so the interval index no longer describes it.
    this.spanIndex = null;
    if (!gained) return;

    if (dependsOnLine > lineNumber) this.downwardPositionReads++;
    this.noteGained(lineNumber);
  }

  /**
   * Record that `lineNumber` read the members of the category tag `tag`, or of
   * every tag when `tag` is {@link EVERY_TAG}.
   *
   * One edge on the tag, however many lines carry it. `total of #food` reads
   * every line tagged `#food`, and recording a position per member made a
   * ledger with a running tag total after each entry cost the square of its
   * length in the graph. Which lines the edge reaches is answered when asked,
   * from the tags each line carries now (see {@link setDocumentView}), so a
   * member joining or leaving the group is seen without the reader recording
   * anything. The same run half as a position keeps it exact: a tag the last
   * run did not read is dropped by {@link reconcilePositionReads}.
   *
   * @param lineNumber - 1-based line doing the reading
   * @param tag - The tag's name without its `#`, in any case, or {@link EVERY_TAG}
   */
  registerLineTagDependency(lineNumber: number, tag: string): void {
    const key = tag === EVERY_TAG ? EVERY_TAG : tag.toLowerCase();
    const positions = this.positionEntry(lineNumber);
    if (positions.runTags === null) positions.runTags = new Set([key]);
    else positions.runTags.add(key);
    if (positions.tags !== null && positions.tags.has(key)) return;
    if (positions.tags === null) positions.tags = new Set([key]);
    else positions.tags.add(key);
    const readers = this.tagReaders.get(key);
    if (readers !== undefined) readers.add(lineNumber);
    else this.tagReaders.set(key, new Set([lineNumber]));
    this.noteGained(lineNumber);
  }

  /**
   * Record that `lineNumber` reads the figures on lines `first` to `last`: every
   * line there except a summary line, which a span of figures passes over.
   *
   * One interval however long the span, for the same reason as
   * {@link registerLinePositionDependency}. What a section total reads is its
   * block less the totals inside it, which is every other line of a ledger, so
   * recording the members one by one was a sparse set the length of the block
   * for every total in it. Whether a line in the span is a summary is asked of
   * the document when the edge is followed back (see {@link setDocumentView}),
   * so two totals of one section do not read each other, and a cycle is only
   * found where there is one.
   *
   * @param lineNumber - 1-based line doing the reading
   * @param first - First line of the span, 1-based
   * @param last - Last line of the span, inclusive; a span with `last < first` reads nothing
   */
  registerLineFigureSpan(lineNumber: number, first: number, last: number): void {
    if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) return;
    const positions = this.positionEntry(lineNumber);
    if (!holdsInterval(positions.runFigures, first, last)) (positions.runFigures ??= []).push(first, last);
    if (holdsInterval(positions.figures, first, last)) return;
    (positions.figures ??= []).push(first, last);
    this.spanIndex = null;
    if (last > lineNumber) this.downwardPositionReads++;
    this.noteGained(lineNumber);
  }

  /**
   * Tell the graph what it needs to know about the document's lines to follow
   * a tag edge or a span of figures back to the lines it reaches.
   *
   * The document model knows a line's text and the graph does not, so the
   * path that owns the model hands this over; the incremental pass does so
   * whenever it builds a line context. Kept across {@link clear}, which a
   * structural edit calls, since the view reads the model as it is now.
   *
   * @param view - How to read a line, by 1-based position; null when no
   * document backs the graph, and then a tag edge reaches no line and a span
   * of figures reaches every line in it.
   */
  setDocumentView(view: DocumentView | null): void {
    this.view = view;
  }

  /** The reader's entry, created empty on its first read. */
  private positionEntry(lineNumber: number): PositionsRead {
    // An `above` aggregate records every line back to its boundary in one
    // run, so the reader is the same for the whole burst and one slot answers
    // all but the first lookup.
    if (this.lastPositionReader === lineNumber && this.lastPositionReads !== null) return this.lastPositionReads;
    let positions = this.positionReads.get(lineNumber);
    if (positions === undefined) {
      positions = { lo: -1, hi: -1, sparse: null, tags: null, figures: null, runLo: -1, runHi: -1, runSparse: null, runTags: null, runFigures: null };
      this.positionReads.set(lineNumber, positions);
    }
    this.lastPositionReader = lineNumber;
    this.lastPositionReads = positions;
    return positions;
  }

  /** Put a reader on the list {@link takeReadersThatGainedAPosition} hands out. */
  private noteGained(lineNumber: number): void {
    // Reached only for an edge this reader did not have, so the common repeat
    // never touches the list. An `above` aggregate recording its whole block
    // on its first run lands here once per line of it, and the last-entry
    // check keeps that to one entry.
    const gained = this.readersThatGainedAPosition;
    if (gained.length === 0 || gained[gained.length - 1] !== lineNumber) gained.push(lineNumber);
  }

  /**
   * Cut a line's recorded positions back to the ones its last run read.
   *
   * For the evaluator to call once a line has executed. A positional read is
   * discovered while the line runs, and a position the line has stopped
   * reading cannot be discovered that way, so without this the recorded set
   * only ever grew: `prev + 1` edited to `7` went on reading line 1 in the
   * graph for the rest of the session, and `total above` kept its edges to
   * the lines above a heading that had cut its block short. Anything asking
   * the graph what a line reads was told what it used to read, and a cycle
   * that the heading had broken was still a cycle to the graph, while a cycle
   * that its removal re-closed was not new to it and so was never noticed.
   * Tag edges are cut back the same way.
   *
   * A run that read no position at all leaves the line with none. A line
   * that did not execute (compiled only, or skipped) must not be reconciled,
   * since it read nothing for a reason that says nothing about its text.
   *
   * @param lineNumber - 1-based line that has just executed
   */
  reconcilePositionReads(lineNumber: number): void {
    const positions = this.positionReads.get(lineNumber);
    if (positions === undefined) return;
    if (positions.runLo === -1 && positions.runTags === null && positions.runFigures === null) {
      this.forgetPositionReads(lineNumber);
      return;
    }
    const sameShape =
      positions.lo === positions.runLo &&
      positions.hi === positions.runHi &&
      sameSparse(positions.sparse, positions.runSparse);
    if (!sameShape) {
      // A line on a cycle is no exception. Its run stops reading forward the
      // moment it reaches a line below it, by design, which is why every
      // aggregate declares its whole span before reading any of it. Keeping
      // a member's forward edges regardless, as this once did, kept an edge
      // to a line the member had stopped reading, and that phantom cycle
      // outlived the real one.
      let dropped = false;
      for (const n of this.positionsReadFrom(positions)) {
        if (readThisRun(positions, n)) continue;
        if (n > lineNumber) this.downwardPositionReads--;
        dropped = true;
      }
      if (dropped) this.noteEdgeChange(lineNumber);
      positions.lo = positions.runLo;
      positions.hi = positions.runHi;
      positions.sparse = positions.runSparse;
      this.spanIndex = null;
    }
    if (!sameSparse(positions.tags, positions.runTags)) {
      if (positions.tags !== null) {
        for (const tag of positions.tags) {
          if (positions.runTags === null || !positions.runTags.has(tag)) this.dropTagReader(tag, lineNumber);
        }
      }
      positions.tags = positions.runTags;
      this.noteEdgeChange(lineNumber);
    }
    if (!samePairs(positions.figures, positions.runFigures)) {
      this.downwardPositionReads -= downwardFigureSpans(positions.figures, lineNumber);
      this.downwardPositionReads += downwardFigureSpans(positions.runFigures, lineNumber);
      positions.figures = positions.runFigures;
      this.spanIndex = null;
      this.noteEdgeChange(lineNumber);
    }
    positions.runLo = -1;
    positions.runHi = -1;
    positions.runSparse = null;
    positions.runTags = null;
    positions.runFigures = null;
  }

  /**
   * Forget every position and tag this line was recorded reading.
   *
   * For a line whose text has just changed, before it runs: whatever the old
   * text read is not evidence about the new one, and a rule consulting the
   * graph between the edit and the run would otherwise be told the old
   * edges. The next run records what the new text reads. A data-source pin is
   * discovered the same way but is not about the text, and stays until the
   * line is removed.
   *
   * @param lineNumber - 1-based line whose positions are to go
   */
  forgetPositionReads(lineNumber: number): void {
    const positions = this.positionReads.get(lineNumber);
    if (positions === undefined) return;
    this.positionReads.delete(lineNumber);
    if (this.lastPositionReader === lineNumber) {
      this.lastPositionReader = -1;
      this.lastPositionReads = null;
    }
    const recorded = this.positionsReadFrom(positions);
    for (const n of recorded) if (n > lineNumber) this.downwardPositionReads--;
    this.downwardPositionReads -= downwardFigureSpans(positions.figures, lineNumber);
    if (positions.tags !== null) for (const tag of positions.tags) this.dropTagReader(tag, lineNumber);
    if (recorded.length > 0 || positions.figures !== null) this.spanIndex = null;
    // A dropped edge is a change to the graph as much as a gained one: it is
    // how a cycle is broken, and the walk that keeps cycle membership honest
    // has to hear about it.
    if (recorded.length > 0 || positions.tags !== null || positions.figures !== null) this.noteEdgeChange(lineNumber);
  }

  /**
   * The positions a line has been recorded reading, as line numbers.
   *
   * The forward direction of {@link getAffectedLinesByPosition}: that answers
   * "who reads this position", this answers "which positions does this line
   * read". Both directions are what finding a cycle takes. A tag edge is not a
   * position and is not listed; {@link readsAnyPosition} says whether a line
   * holds either kind.
   *
   * @param lineNumber - 1-based line doing the reading
   * @returns The positions it has read, in no particular order; empty if none
   */
  positionsReadBy(lineNumber: number): number[] {
    const positions = this.positionReads.get(lineNumber);
    if (positions === undefined) return [];
    const out = this.positionsReadFrom(positions);
    const figures = positions.figures;
    if (figures !== null) {
      const listed = new Set(out);
      for (let i = 0; i < figures.length; i += 2) {
        for (let n = figures[i]; n <= figures[i + 1]; n++) {
          if (n === lineNumber || listed.has(n)) continue;
          if (this.view !== null && this.view.isSummary(n)) continue;
          listed.add(n);
          out.push(n);
        }
      }
    }
    return out;
  }

  /**
   * Whether a line has been recorded reading another line's result, by
   * position or through a category tag.
   *
   * @param lineNumber - 1-based line doing the reading
   * @returns True while it holds at least one such edge
   */
  readsAnyPosition(lineNumber: number): boolean {
    const positions = this.positionReads.get(lineNumber);
    if (positions === undefined) return false;
    return positions.lo !== -1 || (positions.sparse !== null && positions.sparse.size > 0) || (positions.tags !== null && positions.tags.size > 0) || positions.figures !== null;
  }

   /**
    * What changed in the graph since this was last called: the lines whose
    * edge set changed, and the keys whose producer set changed. Taking it
    * clears it. See {@link edgesChangedThisPass}.
    *
    * @returns The changed lines and keys, each possibly empty.
    */
   takeEdgeChanges(): { lines: readonly number[]; keys: readonly string[] } {
     const lines = this.edgesChangedThisPass;
     const keys = this.producersChangedThisPass === null ? NO_ORPHANS : [...this.producersChangedThisPass];
     if (lines.length !== 0) this.edgesChangedThisPass = [];
     this.producersChangedThisPass = null;
     return { lines, keys };
   }

  /**
   * The readers that recorded a new position since this was last called, and
   * an empty list until one does.
   *
   * Taking the list clears it. See {@link readersThatGainedAPosition}.
   *
   * @returns The 1-based readers, in the order they recorded
   */
  takeReadersThatGainedAPosition(): readonly number[] {
    if (this.readersThatGainedAPosition.length === 0) return NO_READERS;
    const gained = this.readersThatGainedAPosition;
    this.readersThatGainedAPosition = [];
    return gained;
  }

  /**
   * Whether any recorded positional edge points from a reader to a line
   * below it.
   *
   * The precondition for a positional cycle, and so for the walk that looks
   * for one; see {@link downwardPositionReads}. A tag edge can reach a line
   * below its reader, and which lines it reaches is decided when asked, so
   * any tag edge counts.
   *
   * @returns True while at least one such edge is recorded
   */
  hasDownwardPositionRead(): boolean {
    return this.downwardPositionReads > 0 || this.tagReaders.size > 0;
  }

  /** {@link positionsReadBy}, without the lookup when the line has no entry. */
  private positionReadsIfAny(lineNumber: number): readonly number[] {
    return this.positionReads.has(lineNumber) ? this.positionsReadBy(lineNumber) : NO_READERS;
  }

  /** The exact positions an entry records, its span and sparse set, in the recorded half. */
  private positionsReadFrom(positions: PositionsRead): number[] {
    const out: number[] = [];
    if (positions.lo !== -1) for (let n = positions.lo; n <= positions.hi; n++) out.push(n);
    if (positions.sparse !== null) for (const n of positions.sparse) out.push(n);
    return out;
  }

  /** Drop one reader from a tag's readers. */
  private dropTagReader(tag: string, lineNumber: number): void {
    const readers = this.tagReaders.get(tag);
    if (readers === undefined) return;
    readers.delete(lineNumber);
    if (readers.size === 0) this.tagReaders.delete(tag);
  }

  /** Put a line on the list of lines whose edges changed this pass, once. */
  private noteEdgeChange(lineNumber: number): void {
    const changed = this.edgesChangedThisPass;
    if (changed.length === 0 || changed[changed.length - 1] !== lineNumber) changed.push(lineNumber);
  }

  /**
   * Every line that read some position's result, whichever position it was.
   *
   * For a structural edit, which changes what a position *means* rather than
   * what any line says. Inserting a line moves everything below it, so `line 5`
   * now names different text, `prev` names a different neighbour, and an
   * `above` aggregate covers a different block, all without a character
   * changing on the line that reads them.
   *
   * Deliberately not filtered by which positions moved. A reader whose target
   * shifted has to re-run, and so does one that shifted past its own target and
   * became a self-reference, and the second is not visible from the target
   * alone. Positional readers are a small minority of a document's lines, so
   * re-running all of them costs almost nothing and cannot be wrong.
   *
   * @returns The 1-based line numbers doing the reading, valid until the next
   * structural change.
   */
  linesReadingAPosition(): Iterable<number> {
    return this.positionReads.keys();
  }

  /**
   * The lines that read the result of line `lineNumber`.
   *
   * What an edit to that line, or a value arriving on it, has to re-run beyond
   * the readers of the names it defines. Three kinds of reader: a span that
   * covers the line (an `above` aggregate, a section, a range), a position read
   * on its own (`line 7`, `prev`), and a tag edge on a tag the line carries.
   * The first two come from an interval index built from the readers' entries
   * the first time it is asked after they changed, so a settled document asks
   * in logarithmic time plus the answer; the third from the line's tags as
   * they are now.
   *
   * @param lineNumber - 1-based line whose readers are wanted
   * @returns The lines reading that position, or an empty set if none. A new
   * set each call, the caller's to keep.
   */
  /**
   * The lines reading `lineNumber`'s position, one at a time, as
   * {@link getAffectedLinesByPosition} finds them but without collecting them:
   * a reader can come more than once (through a span and through a tag), the
   * line itself never does. For a walk that holds many of these at once, so it
   * holds no set of readers per line; the cycle walk is one, and a running
   * total after every line of a ledger has as many readers as lines above it.
   *
   * The graph must not change while one is being read.
   *
   * @param lineNumber - 1-based line whose readers are wanted.
   */
  *positionReadersOf(lineNumber: number): Generator<number, void, undefined> {
    if (this.positionReads.size === 0) return;
    const index = this.spanIndex ?? (this.spanIndex = buildSpanIndex(this.positionReads));
    const view = this.view;
    let summary: boolean | undefined;
    const passesOver = (): boolean => (summary ??= view !== null && view.isSummary(lineNumber));
    for (const reader of spanReaders(index, lineNumber, passesOver)) {
      if (reader !== lineNumber) yield reader;
    }
    if (this.tagReaders.size === 0 || view === null) return;
    const tags = view.memberTags(lineNumber);
    if (tags.length === 0) return;
    const every = this.tagReaders.get(EVERY_TAG);
    if (every !== undefined) for (const reader of every) if (reader !== lineNumber) yield reader;
    for (const tag of tags) {
      const readers = this.tagReaders.get(tag);
      if (readers !== undefined) for (const reader of readers) if (reader !== lineNumber) yield reader;
    }
  }

  getAffectedLinesByPosition(lineNumber: number): ReadonlySet<number> {
    if (this.positionReads.size === 0) return NO_LINES;
    let out: Set<number> | null = null;
    const index = this.spanIndex ?? (this.spanIndex = buildSpanIndex(this.positionReads));
    const view = this.view;
    // Asked at most once, and only when a span of figures covers the line.
    let summary: boolean | undefined;
    const passesOver = (): boolean => (summary ??= view !== null && view.isSummary(lineNumber));
    for (const reader of stabSpanIndex(index, lineNumber, passesOver)) {
      if (reader !== lineNumber) (out ??= new Set()).add(reader);
    }
    if (this.tagReaders.size !== 0 && this.view !== null) {
      const tags = this.view.memberTags(lineNumber);
      if (tags.length > 0) {
        const every = this.tagReaders.get(EVERY_TAG);
        if (every !== undefined) for (const reader of every) if (reader !== lineNumber) (out ??= new Set()).add(reader);
        for (const tag of tags) {
          const readers = this.tagReaders.get(tag);
          if (readers !== undefined) for (const reader of readers) if (reader !== lineNumber) (out ??= new Set()).add(reader);
        }
      }
    }
    return out ?? NO_LINES;
  }

  /**
   * Find all lines affected by a data source update.
   *
   * When an async data source resolves (e.g., currency rate fetch completes),
   * this returns all lines that depend on that specific data query.
   *
   * @param dataSourceId - The data source identifier
   * @param queryKey - The query key that was updated
   * @returns Set of line numbers that need re-evaluation
   */
  getAffectedLinesByDataSource(dataSourceId: string, queryKey: string[]): ReadonlySet<number> {
    return this.consumers.get(dataSourceEdgeKey(dataSourceId, queryKey)) ?? NO_LINES;
  }

  /**
   * Remove a line from the dependency graph (e.g., when a line is deleted from the document).
   *
   * Cleans up all consumer references, write registrations, and data source dependencies
   * for the removed line. O(k) where k is the number of variables the line reads.
   *
   * @param lineNumber - The line number being removed
   */
  removeLine(lineNumber: number): readonly string[] {
     // Its positions and tags first, through the one path that keeps the
     // downward edge count in step.
     this.forgetPositionReads(lineNumber);
     // And what it produced, for the cycle walk: a deleted definition can
     // withdraw the one name that pinned a cycle's value.
     for (const key of this.writes.get(lineNumber) ?? []) (this.producersChangedThisPass ??= new Set()).add(key);

     // Remove from consumers of variables this line read, O(k) not O(V)
     const reads = this.lineReads.get(lineNumber);
     if (reads) {
       for (const readVar of reads) {
         const consumers = this.consumers.get(readVar);
         if (consumers) consumers.delete(lineNumber);
       }
       this.lineReads.delete(lineNumber);
     }

     // Remove from the producers of everything this line wrote, so a deleted
     // line stops being a member of its groups. O(k) via the line's own write
     // set, the same shape as the read cleanup above.
     // Every key this line wrote loses a writer, and a key with none left is
     // defined by nothing: the caller is told, so the value can leave the VM.
     let orphaned: string[] | null = null;
     const writes = this.writes.get(lineNumber);
     if (writes) {
       for (const key of writes) {
         const producers = this.producers.get(key);
         if (producers === undefined) continue;
         producers.delete(lineNumber);
         if (producers.size === 0) {
           this.producers.delete(key);
           (orphaned ??= []).push(key);
         }
       }
     }

     // `dependencies` is only ever written alongside `writes`, so a line with
     // no write set has no entry there either, and `pinnedReads` is empty for
     // any document that reads no data source. Both deletes were a hash of the
     // line number that could only ever miss.
     if (writes !== undefined) {
       this.dependencies.delete(lineNumber);
       this.writes.delete(lineNumber);
     }
     if (this.pinnedReads.size !== 0) this.pinnedReads.delete(lineNumber);

     return orphaned ?? NO_ORPHANS;
   }

  /**
   * Get all line numbers that consume (read) a given variable.
   *
   * A position's key ({@link linePositionEdgeKey}) is answered as
   * {@link getAffectedLinesByPosition} answers the position.
   *
   * @param variable - The variable name, or any other edge key
   * @returns Set of line numbers that read this variable, or empty set if none
   */
  getConsumers(variable: string): ReadonlySet<number> {
    const position = positionOfLineKey(variable);
    if (position !== null) return this.getAffectedLinesByPosition(position);
    return this.consumers.get(variable) ?? NO_LINES;
  }

  /**
   * Get all line numbers that produce (write) a given key.
   *
   * The mirror of {@link getConsumers}, and the reason the producer index
   * exists: for a category tag it is the group's membership, so an aggregate
   * over `#food` costs the size of the group rather than the size of the
   * document.
   *
   * @param key - The key, from {@link edgeKey}
   * @returns Set of line numbers that write this key, or empty set if none
   */
  /**
   * The lines that read `key`, one edge away.
   *
   * The consumer index, which {@link registerLine} keeps clear of the line
   * that writes the key: a definition's read of its own name is a convention
   * for the graph's benefit, not a dependency, and `x += 1` reads its total
   * to step it, not to depend on another line. That is what makes this index
   * the right one for finding a cycle, where the raw reads would make every
   * definition a self-loop and every twice-defined name a two-cycle.
   *
   * @param key - An edge key.
   * @returns The 1-based readers, or an empty set.
   */
  directConsumersOf(key: string): ReadonlySet<number> {
    const position = positionOfLineKey(key);
    if (position !== null) return this.getAffectedLinesByPosition(position);
    return this.consumers.get(key) ?? NO_LINES;
  }

  getProducers(key: string): ReadonlySet<number> {
    return this.producers.get(key) ?? NO_LINES;
  }

  /**
   * The keys a line that WRITES something reads.
   *
   * The qualifier is the whole of it, and the reason this doc is longer than
   * the method. The map behind this is filled in {@link registerLine} only on
   * the branch that stores a write set, so a line that reads a name and defines
   * nothing answers with an empty set rather than with what it reads. It is not
   * "the variables a line depends on"; it is the dependencies recorded
   * alongside a definition.
   *
   * That is deliberate, and pinned by a test: it is what lets a redefinition
   * break the old chain rather than depend on itself. It is also a trap, and it
   * has been walked into. The async batcher ordered the lines it was about to
   * re-run by asking this what each one read, so a line defining nothing
   * answered with nothing and got no ordering constraint at all: `rate * 2` was
   * run before the line that fetched `rate` and read the value from before the
   * fetch.
   *
   * {@link getReads} is the question that was meant there, and is almost always
   * the one wanted: every key a line reads, whether or not it writes anything.
   *
   * @param lineNumber - The line number to query
   * @returns The keys recorded alongside this line's write set, or an empty set
   * if it writes nothing
   */
  getDependencies(lineNumber: number): ReadonlySet<string> {
    return this.dependencies.get(lineNumber) ?? NO_KEYS;
  }

  /**
   * Every key a line reads, whether or not it writes anything.
   *
   * {@link getDependencies} answers this only for a line that writes, because
   * the map behind it is filled alongside the write set. That makes it the
   * wrong question to ask when ordering a set of lines: a line that reads a
   * name and defines nothing is exactly the line whose reads say where it has
   * to come, and it answered with nothing. The batcher ordered such a line
   * before the line producing what it read for that reason.
   *
   * Includes any data-source key the line was pinned to, since that is a read
   * of the line like any other, and a `line:` key (see
   * {@link linePositionEdgeKey}) for each position it was recorded reading.
   * Those are made from the line's entry when asked, since the graph holds a
   * span rather than a key per position.
   *
   * @param lineNumber - The line number to query
   * @returns The keys this line reads, or an empty set if none. A new set
   * when the line reads a position, the caller's to keep.
   */
  getReads(lineNumber: number): ReadonlySet<string> {
    const keys = this.lineReads.get(lineNumber);
    const positions = this.positionReadsIfAny(lineNumber);
    if (positions.length === 0) return keys ?? NO_KEYS;
    const out = new Set<string>(keys);
    for (const n of positions) out.add(linePositionEdgeKey(n));
    return out;
  }

  /**
   * Every key some line reads or writes: the names, tags, globals and data
   * sources the graph indexes. No `line:` key is among them.
   *
   * What a caller wanting the document's vocabulary asks for, rather than
   * building a {@link getSnapshot}, which also spells out every positional
   * edge.
   *
   * @returns The keys, each once.
   */
  keysInUse(): Set<string> {
    const out = new Set<string>(this.consumers.keys());
    for (const key of this.producers.keys()) out.add(key);
    return out;
  }

  /**
   * The lines that read an external data source.
   *
   * @returns Their 1-based numbers, ascending.
   */
  linesReadingADataSource(): number[] {
    const prefix = edgeKey("datasource", "");
    const out: number[] = [];
    for (const [line, keys] of this.pinnedReads) {
      for (const key of keys) {
        if (key.startsWith(prefix)) { out.push(line); break; }
      }
    }
    return out.sort((a, b) => a - b);
  }

  /**
   * Get all variables that a line writes (assigns to).
   *
   * @param lineNumber - The line number to query
   * @returns Set of variable names this line writes, or empty set if none
   */
  getWrites(lineNumber: number): ReadonlySet<string> {
    return this.writes.get(lineNumber) ?? NO_KEYS;
  }

  /**
   * Get a serializable snapshot of the entire dependency graph for diagnostics.
   *
   * Returns plain objects (not Maps/Sets) so consumers don't need to reach
   * into private fields. Used by playground diagnostic tabs for DAG visualization.
   */
  getSnapshot(): DagSnapshot {
    const consumers: Record<string, number[]> = {};
    for (const [variable, lines] of this.consumers) {
      consumers[variable] = Array.from(lines);
    }
    // Positional edges are held as spans, and spelt out here as the `line:`
    // keys a diagnostic view has always shown. A diagnostic is asked for
    // once, where the graph is consulted on every pass.
    for (const line of this.positionReads.keys()) {
      for (const n of this.positionsReadBy(line)) (consumers[linePositionEdgeKey(n)] ??= []).push(line);
    }

    const writes: Record<number, string[]> = {};
    for (const [line, vars] of this.writes) {
      writes[line] = Array.from(vars);
    }

    const reads: Record<number, string[]> = {};
    for (const [line, vars] of this.lineReads) {
      reads[line] = Array.from(vars);
    }
    for (const line of this.positionReads.keys()) {
      const keys = this.positionsReadBy(line).map(linePositionEdgeKey);
      if (keys.length > 0) reads[line] = [...(reads[line] ?? []), ...keys];
    }

    const producers: Record<string, number[]> = {};
    for (const [key, lines] of this.producers) {
      producers[key] = Array.from(lines);
    }

    // Data-source edges live in the same indexes as everything else now, so the
    // two views this snapshot has always exposed are read back out of them by
    // their prefix rather than kept in maps of their own. The shape a
    // diagnostic renderer sees is unchanged, minus the `ds:` prefix it never
    // used to carry.
    const prefix = edgeKey("datasource", "");
    const dataSourceDeps: Record<number, string[]> = {};
    for (const [line, keys] of this.lineReads) {
      const dataSourceKeys = Array.from(keys).filter(key => key.startsWith(prefix));
      if (dataSourceKeys.length > 0) dataSourceDeps[line] = dataSourceKeys.map(key => key.slice(prefix.length));
    }

    const dataSourceConsumers: Record<string, number[]> = {};
    for (const [key, lines] of this.consumers) {
      if (key.startsWith(prefix)) dataSourceConsumers[key.slice(prefix.length)] = Array.from(lines);
    }

    return { consumers, producers, writes, reads, dataSourceDeps, dataSourceConsumers };
  }

  /** Clear all dependency graph state. Called on document switch or engine reset. */
  clear(): void {
    this.consumers.clear();
    this.producers.clear();
    this.dependencies.clear();
    this.writes.clear();
    this.lineReads.clear();
    this.pinnedReads.clear();
    this.positionReads.clear();
    this.spanIndex = null;
    this.tagReaders.clear();
    this.lastPositionReader = -1;
    this.lastPositionReads = null;
    this.readersThatGainedAPosition = [];
    this.downwardPositionReads = 0;
    this.edgesChangedThisPass = [];
    this.producersChangedThisPass = null;
  }
}
