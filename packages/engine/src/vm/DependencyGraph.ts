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
     // Clean up old consumer references if re-registering this line. A pinned
     // read (a data source, discovered at run time rather than from the text)
     // is not this call's to drop.
     const pinned = this.pinnedReads.get(lineNumber);
     const oldReads = this.lineReads.get(lineNumber);
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
     const oldWrites = this.writes.get(lineNumber);
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

     // Add new consumer references
     for (const dep of reads) {
       if (!this.consumers.has(dep)) this.consumers.set(dep, new Set());
       this.consumers.get(dep)!.add(lineNumber);
     }

     // And the reverse direction, which is what makes "who is in this group"
     // a lookup rather than a walk.
     for (const write of writes) {
       if (!this.producers.has(write)) this.producers.set(write, new Set());
       this.producers.get(write)!.add(lineNumber);
     }

     if (writes.length > 0) {
       this.dependencies.set(lineNumber, new Set(reads));
       this.writes.set(lineNumber, new Set(writes));
       for (const write of writes) {
         const prevConsumer = this.consumers.get(write);
         if (prevConsumer) prevConsumer.delete(lineNumber);
       }
     } else {
       // A line that writes nothing must not keep a stale write set, or it
       // stays a producer of a group it has left.
       this.writes.delete(lineNumber);
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
    if (!this.pinnedReads.has(lineNumber)) this.pinnedReads.set(lineNumber, new Set());
    this.pinnedReads.get(lineNumber)!.add(key);

    if (!this.lineReads.has(lineNumber)) this.lineReads.set(lineNumber, new Set());
    this.lineReads.get(lineNumber)!.add(key);

    if (!this.consumers.has(key)) this.consumers.set(key, new Set());
    this.consumers.get(key)!.add(lineNumber);
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
    // Keys are visited once, not once per line that writes them. Without this
    // a key with many producers had its whole consumer set rescanned by each
    // of them, which is quadratic in producers x consumers: exactly the shape a
    // category tag makes, where a column of members and a set of aggregates
    // share one key. Measured on 2,000 members and 2,000 aggregates: 15.5 ms
    // before, and the walk is over the edges once now.
    const seenKeys = new Set<string>([changedVariable]);
    const queue = [changedVariable];
    // A head index rather than pop(), so the walk is breadth-first and the
    // queue is never re-ordered. Depth-first was not wrong, but the order this
    // hands to the caller is now the order the edges were found in.
    for (let head = 0; head < queue.length; head++) {
      const consumers = this.consumers.get(queue[head]);
      if (!consumers) continue;
      for (const line of consumers) {
        if (visited.has(line)) continue;
        visited.add(line);
        const lineWrites = this.writes.get(line);
        if (!lineWrites) continue;
        for (const writtenVar of lineWrites) {
          if (seenKeys.has(writtenVar)) continue;
          seenKeys.add(writtenVar);
          queue.push(writtenVar);
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
    // Line nodes are numbers and key nodes are strings, so one map holds both
    // without them ever colliding.
    type Node = number | string;
    const inDegree = new Map<Node, number>();
    const adjacency = new Map<Node, Node[]>();

    const edge = (from: Node, to: Node): void => {
      const existing = adjacency.get(from);
      if (existing) existing.push(to);
      else adjacency.set(from, [to]);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    };

    for (const line of affected) if (!inDegree.has(line)) inDegree.set(line, 0);

    // A key earns a node only when it is both written and read inside the
    // affected set: anything else adds a node the sort would have to drain for
    // no constraint.
    const writtenKeys = new Set<string>();
    for (const line of affected) {
      const lineWrites = this.writes.get(line);
      if (lineWrites) for (const key of lineWrites) writtenKeys.add(key);
    }

    const hubKeys = new Set<string>();
    for (const line of affected) {
      const reads = this.lineReads.get(line);
      if (!reads) continue;
      for (const key of reads) {
        if (!writtenKeys.has(key)) continue;
        // A line that both writes and reads one key constrains nothing about
        // itself, and an edge each way would be a cycle the sort cannot drain.
        if (this.writes.get(line)?.has(key)) continue;
        hubKeys.add(key);
      }
    }

    for (const key of hubKeys) if (!inDegree.has(key)) inDegree.set(key, 0);

    for (const line of affected) {
      const lineWrites = this.writes.get(line);
      if (lineWrites) for (const key of lineWrites) if (hubKeys.has(key)) edge(line, key);
      const reads = this.lineReads.get(line);
      if (reads) {
        for (const key of reads) {
          if (!hubKeys.has(key)) continue;
          if (lineWrites?.has(key)) continue;
          edge(key, line);
        }
      }
    }

    // Kahn's algorithm: start with zero-indegree nodes, then iteratively remove
    // them, adding newly-freed ones.
    const queue: Node[] = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) queue.push(node);
    }

    // If every node has at least one dependency (a cycle, or a producer outside
    // the affected set), start with the lowest line number as a fallback.
    if (queue.length === 0) {
      const sorted = Array.from(affected).sort((a, b) => a - b);
      queue.push(sorted[0]);
    }

    const ordered: number[] = [];
    // A head index rather than shift(): shift() moves every remaining element,
    // so ordering a value with thousands of consumers cost quadratic time. The
    // queue only ever grows, so the index is safe.
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      // Key nodes are scaffolding for the ordering, not lines to evaluate.
      if (typeof current === "number") ordered.push(current);

      const downstream = adjacency.get(current);
      if (!downstream) continue;
      for (const next of downstream) {
        const newDegree = (inDegree.get(next) ?? 1) - 1;
        inDegree.set(next, newDegree);
        if (newDegree === 0) queue.push(next);
      }
    }

    // Append any remaining lines that couldn't be topologically sorted
    // (cycles or external-only dependencies) in ascending order.
    if (ordered.length < affected.size) {
      const orderedSet = new Set(ordered);
      const remaining = Array.from(affected)
        .filter((l) => !orderedSet.has(l))
        .sort((a, b) => a - b);
      ordered.push(...remaining);
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

     this.dependencies.delete(lineNumber);
     this.writes.delete(lineNumber);
     this.pinnedReads.delete(lineNumber);
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
