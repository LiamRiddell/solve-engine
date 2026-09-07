/**
 * The kinds of thing a line can read from or write to.
 *
 * The graph itself knows nothing about any of them: it indexes edges between a
 * line and a key, and a kind is only a way of keeping those keys from colliding.
 * Adding a kind is adding a prefix, not a mechanism.
 */
export type EdgeKind = "variable" | "global" | "tag" | "datasource";

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
   registerLine(lineNumber: number, reads: string[], writes: string[]): void {
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
     if (this.hasSameEdges(oldReads, oldWrites, reads, writes, pinned)) return;

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
     if (oldWrites) {
       for (const oldWrite of oldWrites) {
         const producers = this.producers.get(oldWrite);
         if (producers) producers.delete(lineNumber);
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
  removeLine(lineNumber: number): void {
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
     const writes = this.writes.get(lineNumber);
     if (writes) {
       for (const key of writes) {
         this.producers.get(key)?.delete(lineNumber);
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
   }

  /**
   * Get all line numbers that consume (read) a given variable.
   *
   * @param variable - The variable name
   * @returns Set of line numbers that read this variable, or empty set if none
   */
  getConsumers(variable: string): ReadonlySet<number> {
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
  getProducers(key: string): ReadonlySet<number> {
    return this.producers.get(key) ?? NO_LINES;
  }

  /**
   * Get all variables that a line depends on (reads).
   *
   * @param lineNumber - The line number to query
   * @returns Set of variable names this line reads, or empty set if none
   */
  getDependencies(lineNumber: number): ReadonlySet<string> {
    return this.dependencies.get(lineNumber) ?? NO_KEYS;
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

    const writes: Record<number, string[]> = {};
    for (const [line, vars] of this.writes) {
      writes[line] = Array.from(vars);
    }

    const reads: Record<number, string[]> = {};
    for (const [line, vars] of this.lineReads) {
      reads[line] = Array.from(vars);
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
  }
}
