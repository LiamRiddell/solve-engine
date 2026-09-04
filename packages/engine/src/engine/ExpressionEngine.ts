//#region Imports

import { VM, type EquationDef, type ScalarEquationDef } from "@solve-js/vm/OpRegistry";
import { matrixMultiply, inverse } from "@solve-js/vm/MatrixOps";
import { DependencyGraph } from "@solve-js/vm/DependencyGraph";
import { LineCache, LineCacheEntry } from "@solve-js/cache/LineCache";
import { ScopeManager } from "@solve-js/vm/ScopeManager";
import { Lexer } from "@solve-js/lexer/Lexer";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { BytecodeBuilder, type BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { createVM, executeBytecode } from "@solve-js/vm/VM";
import { resolveHolidayPredicate } from "@solve-js/vm/HolidayCalendar";
import type { EvalResult, LineExecutionContext } from "@solve-js/vm/VM";
import type { DocumentModel } from "@solve-js/engine/DocumentModel";
import { BackgroundRefreshManager } from "@solve-js/engine/BackgroundRefreshManager";
import { registerAsConverter, unregisterAsConverter, pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { createEngineContext } from "@solve-js/engine/EngineContext";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import type { EngineContext } from "@solve-js/engine/EngineContext";
import { Value, ValueType, numberValue, stringValue, pendingValue, freezeIfDev, errorValue, type MatrixData } from "@solve-js/vm/Value";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { PackageCompatibilityIndex } from "@solve-js/api/PackageCompatibility";
import { assertEngineVersionCompatible } from "@solve-js/api/EngineVersionCompatibility";
import { ENGINE_VERSION } from "@solve-js/constants/version";
import {
    SNAPSHOT_FORMAT,
    SNAPSHOT_VERSION,
    SnapshotErrorCodes,
    assertRestorable,
    serializeValue,
    deserializeValue,
    serializeBytecode,
    deserializeBytecode,
    serializeUserFunction,
    deserializeUserFunction,
    type EngineSnapshot,
    type SerializedValue,
    type SerializedLineCacheEntry,
} from "@solve-js/engine/EngineSnapshot";
import { registerTokenCategory, unregisterTokenCategory } from "@solve-js/language/TokenCategoryMap";
import type { CompletionItem } from "@solve-js/language/LanguageService";
import type { LexerVocabulary } from "@solve-js/lexer/ExpressionLexer";
import { QueryClient } from "@tanstack/query-core";
import { createQueryClient, setActiveQueryClient, getActiveQueryClient } from "@solve-js/services/DataQueryService";
import { ErrorFactory, EngineError, normalizeUnknownError } from "@solve-js/errors/UnifiedErrorFramework";
import { countLines } from "@solve-js/utilities/Strings";
import {
	ResolverRegistry,
	type AsyncCheckResult,
} from "@solve-js/resolvers/ResolverRegistry";
import {
	AsyncResolutionBatcher,
	type AsyncResolutionEvent,
} from "@solve-js/engine/AsyncResolutionBatcher";
import { AllocationTracker, type PipelineTelemetry, type StageAllocation } from "@solve-js/telemetry";
import {
    ParsingResult,
    ParsedLine,
    InlineSolvePosition,
    UnifiedParsingOptions,
} from "@solve-js/types/ParsingResult";
import { DiagnosticReportJSON } from "@solve-js/diagnostics";
import type { Token, ScanLineResult } from "@solve-js/lexer";
import { DEFAULT_CONFIG, mergeEngineConfig, type EngineConfig, type EngineConfigOverride } from "@solve-js/constants/Configuration";
import {
    DiagnosticPipeline,
    TimelineDiagnosticCollector,
    DiagnosticEventType
} from "@solve-js/diagnostics";
import {
    checkExpressionLength,
    checkExpressionComplexity,
    extractReadsAndWrites,
} from "@solve-js/engine/ExpressionEngineSafety";
import { containsSymbolicCall } from "@solve-js/packages/symbolic";
import { solveEquationValues } from "@solve-js/vm/SymbolicOps";
import { abortLogger } from "@solve-js/utilities/AbortControllerLogger";
import { TokenNormalizer, BUILTIN_PHRASES, implicitMultiplyRule } from "@solve-js/normalizer";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import type { TokenFusion } from "@solve-js/normalizer";
import { UserUnitTable } from "@solve-js/packages/uom/UserUnitTable";
import { userUnitExpansionRule } from "@solve-js/packages/uom/normalizer/UserUnitNormalizerRule";
import { callFusionRule } from "@solve-js/normalizer/CallFusionRule";
import { dateLiteralNormalizerRule } from "@solve-js/packages/datetime/normalizer/DateLiteralNormalizerRule";
import { resolveDateOrderPolicy, type DateReadingPolicy } from "@solve-js/packages/datetime/DateReading";
import { monthNameDateNormalizerRule } from "@solve-js/packages/datetime/normalizer/MonthNameDateNormalizerRule";
import { buildExplanation } from "@solve-js/explain";
import type { Explanation } from "@solve-js/explain";
import {
    type DiagnosticPipelineResult,
    type PipelineStageResult,
    type StageOutput,
    type InlineSolveSpanInfo,
    type CacheSnapshot,
    type BatcherMetrics,
    type CheckpointSnapshot,
    type BytecodeCacheEntry,
    type LineCacheEntryInfo,
    type AsyncCachePackageInfo,
} from "@solve-js/types/DiagnosticPipelineResult";

// Re-export for consumers (playground imports these from ExpressionEngine)
export type { CacheSnapshot, BatcherMetrics, CheckpointSnapshot, BytecodeCacheEntry, LineCacheEntryInfo, AsyncCachePackageInfo };
export type { DagSnapshot } from "@solve-js/vm/DependencyGraph";
// The snapshot/restore surface, re-exported so `toJSON`/`fromJSON` callers can
// import their types from the same module as `ExpressionEngine`.
export {
    SNAPSHOT_FORMAT,
    SNAPSHOT_VERSION,
    SnapshotErrorCodes,
} from "@solve-js/engine/EngineSnapshot";
export type {
    EngineSnapshot,
    SerializedValue,
    SerializedBytecode,
    SerializedUserFunction,
    SerializedAnonymousBody,
    SerializedLineCacheEntry,
    SerializedDecimal,
    SerializedRational,
    SerializedNumber,
} from "@solve-js/engine/EngineSnapshot";

/**
 * Options for {@link ExpressionEngine.fromJSON}, restoring a snapshot onto a
 * fresh engine.
 */
export interface EngineRestoreOptions {
    /**
     * Packages to register on the restored engine. This MUST be the same set
     * the snapshot was taken with: a snapshot carries compiled bytecode whose
     * plugin-function indices and parselet-produced opcodes only line up
     * against the packages that were present when it was written. Registers no
     * packages when omitted, exactly like the constructor's own `packages`
     * parameter, so a host that snapshotted a full engine passes the same
     * `BUILTIN_PACKAGES` here that it constructed with.
     */
    packages?: IEnginePackage[];
    /** Config overrides, merged over `DEFAULT_CONFIG`, as in the constructor. */
    config?: EngineConfigOverride;
    /** Turn on the diagnostic pipeline, as in the constructor's `diagnostics`. */
    diagnostics?: boolean;
    /** The calendar backend for the restored engine, as in the constructor's `calendar`. */
    calendar?: CalendarBackend;
    /**
     * Override the locale the snapshot recorded. Rarely needed: the snapshot's
     * own {@link EngineSnapshot.locale} is used by default, so a restored engine
     * lexes the way the one that produced it did.
     */
    locale?: string;
}

/**
 * Options for constructing an {@link ExpressionEngine}. Every field is optional.
 *
 * An engine registers exactly the {@link EngineOptions.packages} it is given, so
 * a bundler can tree-shake away every built-in a consumer never imports; pass
 * `BUILTIN_PACKAGES` (from `solve-engine/packages`) for the full set, a subset
 * for a slimmer engine, or use {@link createEngine} for the batteries-included
 * convenience.
 */
export interface EngineOptions {
    /** BCP-47 locale. Defaults to `"en"`. */
    locale?: string;
    /** Packages to register. None when omitted, so nothing but what you pass is bundled. */
    packages?: IEnginePackage[];
    /** Config overrides, merged per section over {@link DEFAULT_CONFIG}. */
    config?: EngineConfigOverride;
    /** Turn on the diagnostic pipeline (per-stage timing and detail). Defaults to `false`. */
    diagnostics?: boolean;

    /**
     * The calendar the engine computes dates with: which local day an instant
     * falls on, what a month later is, whether a day is a Saturday, how a date
     * is written out. See {@link CalendarBackend}.
     *
     * Defaults to the built-in `Date` backend, read in the host process's time
     * zone, which is what every engine computed with before this option
     * existed; leaving it unset changes nothing. The `Temporal` backend from
     * `solve-engine/temporal` carries a time zone of its own.
     *
     * Every site the engine owns reads the backend passed here: the VM's date
     * opcodes, the plugin functions and `as` converters through their
     * execution context, the rules that fuse a date literal, and the parser
     * for the forms that read a literal while parsing (`days in <period>`,
     * the stocks and historical-currency date phrases). Two sites sit outside
     * the engine and are told separately: `formatValue` takes the backend on
     * its `FormattingSettings.calendar`, and a worker runtime takes it on
     * `WorkerRuntimeOptions.calendar`, because a backend is an object of
     * functions and does not cross the message boundary. The inline offload
     * worker computes with the `Date` backend.
     */
    calendar?: CalendarBackend;

    /**
     * Run a few throwaway expressions through the pipeline at construction, so
     * the first real one is not the one that pays for JIT warmup.
     *
     * Off by default, because it moves cost rather than removing it: a process
     * that evaluates one expression and exits pays for warming paths it never
     * reuses. Turn it on for anything interactive, where the first keystroke is
     * the one a person notices. See {@link ExpressionEngine.warmUp}.
     *
     * @default false
     */
    warmup?: boolean;
}

//#endregion

/**
 * Core expression evaluation engine, the top-level orchestrator.
 *
 * Owns the full evaluation pipeline: lexing, parsing, bytecode compilation,
 * VM execution, DAG-based dependency tracking, and async resolution.
 *
 * Key responsibilities:
 * - Pipeline orchestration: lex → parse → compile → execute → cache
 * - Bytecode caching for repeated expressions
 * - DAG-based incremental re-evaluation on variable changes
 * - Async resolution via ResolverRegistry + AsyncResolutionBatcher
 * - Package registration (built-in + external plugins)
 * - Safety validation (length, complexity, nesting)
 * - Diagnostic pipeline integration
 * - Keystroke-level AbortSignal management
 *
 * Each engine instance has its own isolated lexer, registry, parser, and
 * LineCache. The VM uses this engine's own opcode registry, and each engine
 * creates its own VM instance with configurable limits.
 *
 * ## Lifecycle
 *
 * Call {@link ExpressionEngine.clear} when you are finished with an engine that
 * has parsed a document. Dropping your last reference is not sufficient: the
 * async batcher is reachable from the module-level data-query service, so a
 * parsed engine stays retained until `clear()` releases it. Measured per engine
 * after a forced collection, with a 40-line document:
 *
 * | Lifecycle | Retained |
 * | --- | --- |
 * | constructed, never parsed | 8.2KB |
 * | constructed and parsed | 46.9KB |
 * | constructed, parsed, cleared | 10.0KB |
 *
 * This matters for hosts that create one engine per document or per tab, which
 * is the intended usage. Reusing a single engine across documents is also fine:
 * `clear()` resets it for the next one rather than consuming it.
 *
 * The constructor registers only the packages it is given, so a consumer's
 * bundler can tree-shake away every built-in they do not use. For the common
 * "I want everything" case, {@link createEngine} registers the full built-in
 * set in one call; pass an explicit package list to the constructor when
 * bundle size matters.
 *
 * @example
 * ```typescript
 * import { createEngine } from "solve-engine";
 * const engine = createEngine(); // every built-in package
 * const value = engine.evaluateExpression("2 + 2 * 10");
 * console.log(value.toNumber()); // 22
 * ```
 * @example
 * ```typescript
 * // A slimmer engine: only arithmetic and units reach the bundle.
 * import { ExpressionEngine } from "solve-engine";
 * import { ARITHMETIC_PACKAGE, UOM_PACKAGE } from "solve-engine/packages";
 * const engine = new ExpressionEngine({ packages: [ARITHMETIC_PACKAGE, UOM_PACKAGE] });
 * ```
 */
//#region Class: ExpressionEngine

export class ExpressionEngine {
    //#region Private Properties
    private dag = new DependencyGraph();
    private lineCache = new LineCache();
    /**
     * Names ever used as a running-total target (`total += 5`). A document is
     * re-parsed top-to-bottom on every keystroke, so each accumulator is reset
     * to undefined at the start of a batch pass and re-seeds from its opening
     * `+=`/`-=` this pass, rather than reading its own previous pass's value
     * (which grew the total without bound). See {@link tryCompoundAssignment}.
     */
    private accumulatorNames = new Set<string>();
    private scopeManager = new ScopeManager();
    private lexer: Lexer;
    private registry: ParseletRegistry;
    private parser: PrecedenceParser;
    private localeCode: string;
    private vm: VM;
    /**
     * Registries this engine owns, rather than shares with every other
     * instance in the process. See {@link EngineContext}.
     */
    private readonly context: EngineContext;
    private config: typeof DEFAULT_CONFIG;
    /**
     * How this engine reads an ambiguous numeric date literal, resolved once
     * from `config.date` at construction. See {@link getDateReading}.
     */
    private readonly dateReading: DateReadingPolicy;
    private diagnosticPipeline: DiagnosticPipeline;
    /**
     * Direct reference to the timeline collector registered above (when
     * diagnosticMode is on), kept alongside the generic `diagnosticPipeline`
     * so `evaluateExpressionWithDiagnostic()` can cheaply read its current
     * `parseletMatchCount` as a "before" baseline without paying for a full
     * `getReport()` build (which copies the whole cumulative parselets
     * array). See that method's use of it for why a baseline is needed at
     * all, `TimelineDiagnosticCollector`'s state is deliberately cumulative
     * across an entire document pass, not reset per line.
     */
    private timelineCollector?: TimelineDiagnosticCollector;
    /** Registry of async resolvers from registered packages. */
    private resolverRegistry = new ResolverRegistry();

    /**
     * Per-package record of contributions made to the engine's registries
     * (plugin functions, resolver namespaces, token categories), so
     * {@link unregisterPackage} can reverse them. Keyed by package name.
     */
    private packageContributions = new Map<string, {
        pluginFunctionIndices: number[];
        pluginFunctionNames: string[];
        resolverNamespaces: string[];
        tokenCategories: string[];
        lexerVocabulary: LexerVocabulary | undefined;
        asConverterNames: string[];
        normalizerRuleNames: string[];
        callFusionNames: string[];
    }>();

    /**
     * The actual `IEnginePackage` descriptor of every package currently
     * registered on this engine instance, keyed by name, separate from
     * {@link packageContributions} (which tracks what was WRITTEN into
     * shared registries, not the original descriptor). Used by
     * {@link registerPackage}'s automatic `checkPackageCompatibility()` call
     *. See `api/PackageCompatibility.ts`'s module doc for why this exists.
     */
    private registeredPackages = new Map<string, IEnginePackage>();

    /**
     * The merged `name -> fused token type` map every package's
     * {@link IEnginePackage.callFusions} feeds, read live by the single
     * {@link callFusionRule}. Kept in step with registration so one rule serves
     * every `name(` call word instead of one rule per package.
     */
    private callFusions = new Map<string, string>();

    /**
     * Which packages claim each call-fusion word, in registration order. The
     * newest claim is the one {@link callFusions} holds; removing a package
     * hands the word back to the previous claimant rather than deleting it
     * for both.
     */
    private callFusionOwners = new Map<string, Array<{ pkg: string; tokenType: string }>>();

    /**
     * Incremental index behind the package-compatibility check. Kept in step
     * with {@link registeredPackages} so each `registerPackage` costs O(that
     * package's fields) rather than a fresh O(all packages) pairwise scan, which
     * turned engine construction into O(packages^2). See PackageCompatibility.ts.
     */
    private compatIndex = new PackageCompatibilityIndex();

    /**
     * The `DocumentModel` this engine is currently evaluating, if any
     * `null` for a bare engine with no document (e.g. anything only ever
     * calling `evaluateExpression()`). `ExpressionEngine` doesn't own its
     * `DocumentModel` (`ThreeTierEvaluator` constructs and owns both as
     * siblings). This is set once, via {@link setDocumentModel}, purely so
     * {@link makeLineContext} can answer "what's line N's cached result"
     * for cross-line features (`prev`/`line<N>`/aggregation. See
     * `packages/lines/`) without the engine needing to own document
     * lifecycle itself.
     */
    private documentModel: DocumentModel | null = null;

    /**
     * How deep goal seek is currently re-entering line evaluation, so a goal
     * seek whose target line is itself a goal seek is refused rather than
     * multiplying the search cost. One goal-seek line already re-runs its
     * target up to `maxGoalSeekIterations` times; allowing a nested one would
     * make that a product. See {@link makeLineContext}'s `evaluateLineWithBinding`.
     */
    private goalSeekDepth = 0;

    /** The most nesting {@link makeLineContext}'s `evaluateLineWithBinding` allows before refusing, so the bisection re-runs can never compound. */
    private static readonly GOAL_SEEK_MAX_NESTING_DEPTH = 1;

    /**
     * Batch cross-line source, set only for the duration of a
     * `parseDocument`/`evaluateLines` pass (see {@link processScanResults}).
     * The incremental path uses {@link documentModel}; the batch path has no
     * such model, so cross-line closures read earlier lines from the scan and
     * the results array the pass is already building. Both are references to
     * arrays that exist regardless, so a document that uses no cross-line
     * feature pays nothing: the closures are simply never called.
     */
    private batchScanResults: ScanLineResult[] | null = null;
    private batchParsedLines: ParsedLine[] | null = null;

    /**
     * Called once by `ThreeTierEvaluator`'s constructor. Not part of the
     * public evaluate-a-document contract, purely internal wiring so
     * {@link makeLineContext} has something to read from.
     */
    setDocumentModel(doc: DocumentModel | null): void {
        this.documentModel = doc;
    }

    /**
     * The `DocumentModel` this engine is currently wired to, or `null` when it
     * is not driving one. Lets a caller that borrows the engine for a one-off
     * incremental pass (see {@link evaluateDocument}) put back whatever a host
     * had set, rather than assuming it was `null`.
     */
    getDocumentModel(): DocumentModel | null {
        return this.documentModel;
    }

    /**
     * A handful of expressions run through the pipeline to warm it, chosen to
     * cover the shapes the hot paths specialise on rather than to be
     * interesting.
     *
     * V8 runs a function interpreted until it has been called enough times to
     * be worth optimising, and it specialises on the types it has actually
     * seen. So the point is breadth, not volume: a number, a unit, a phrase, a
     * function call, a comparison and a string each drive a different branch of
     * the lexer, the normalizer and the VM. Warming only with `1 + 1` would
     * optimise those functions for integers and then deoptimise the moment a
     * real document mentioned kilograms, which is worse than not warming at all.
     */
    private static readonly WARMUP_EXPRESSIONS: readonly string[] = [
        "1 + 2 * 3",
        "10.5 / 2 - 0.25",
        "50% of 200",
        "3 kg + 400 g",
        "sqrt(144) + max(1, 2)",
        "1 < 2 && 3 >= 3",
        "half of 250",
        "\"text\" + \"joined\"",
    ];

    /**
     * Run the pipeline over a few throwaway expressions so the first real one
     * is not the one that pays for JIT warmup.
     *
     * Nothing here reaches the engine's state: no variable is defined, no line
     * is registered, no bytecode is cached and no async resolver is consulted.
     * It lexes, normalises, parses, compiles and executes into a scratch
     * builder and then drops the result, which is enough to move the hot
     * functions past the interpreter and to build the normalizer's rule index.
     *
     * The cost lands on construction instead. That is the right trade for an
     * editor, where the first keystroke is the one a person notices, and the
     * wrong one for a process that evaluates a single expression and exits,
     * which is why {@link EngineOptions.warmup} exists rather than this being
     * unconditional.
     *
     * Failures are swallowed on purpose: a warmup expression that stops parsing
     * because a package changed is a warmup that did less good, not a reason to
     * refuse to construct an engine.
     */
    warmUp(): void {
        const builder = new BytecodeBuilder(this.pluginFunctionIndexByName);
        for (const expression of ExpressionEngine.WARMUP_EXPRESSIONS) {
            try {
                this.lexer.resetExpression(expression);
                const tokens: Token[] = [];
                for (const token of this.lexer) {
                    if (token.type !== "COMMENT") tokens.push(token);
                }
                const normalized = this.normalizer.normalize(tokens);
                builder.reset();
                this.parser.load(normalized);
                this.parser.parseExpression(0, builder);
                const program = builder.build();
                this.vm.reset();
                executeBytecode(program, this.vm);
            } catch {
                // See this method's doc comment: a warmup miss is not an error.
            }
        }
        this.vm.reset();
    }

    /**
     * Build the {@link LineExecutionContext} passed to `executeBytecode()`
     * for a given line. `lineNumber = -1` (the existing sentinel
     * `evaluateExpression()`/`evaluateLine(-1, ...)` already use for "no
     * real document") naturally produces a context with both closures
     * `undefined`, a cross-line plugin function must check for that itself
     * and return a clear error, never assume line 0 exists.
     */
    private makeLineContext(lineNumber: number): LineExecutionContext {
        const doc = this.documentModel;
        const scan = doc ? null : this.batchScanResults;
        const parsed = doc ? null : this.batchParsedLines;
        return {
            lineIndex: lineNumber,
            getLineResult: doc
                ? (n: number) => doc.getLineAt(n)?.result ?? undefined
                : parsed
                  ? (n: number) => parsed[n - 1]?.result ?? undefined
                  : undefined,
            isLineBoundary: doc
                ? (n: number) => {
                      const state = doc.getLineAt(n);
                      if (!state) return true; // out of range counts as a boundary — nothing to aggregate past it
                      return state.isEmpty || /^\s*#/.test(state.text);
                  }
                : scan
                  ? (n: number) => {
                        const sr = scan[n - 1];
                        if (!sr) return true;
                        return sr.classification.skip || /^\s*#/.test(sr.text);
                    }
                  : undefined,
            getLineReads: doc
                ? (n: number) => {
                      const state = doc.getLineAt(n);
                      // A line with no compiled bytecode has nothing to solve
                      // against yet (forward reference, out of range, or
                      // markdown), reported as undefined rather than an empty
                      // read set so goal seek can tell "reads nothing" from
                      // "not ready".
                      if (!state || state.bytecodes.length === 0) return undefined;
                      return state.reads;
                  }
                : undefined,
            evaluateLineWithBinding: doc
                ? (n: number, variable: string, bound: Value, symbolicTolerant: boolean) =>
                      this.evaluateLineWithBinding(n, variable, bound, symbolicTolerant)
                : undefined,
            goalSeekMaxIterations: this.config.vm.maxGoalSeekIterations,
            networkEnabled: this.config.network.enabled,
            calendar: this.context.calendar,
            // Raw source text of a line, for features that read markdown the
            // evaluator skipped (a table's rows). See the tables package. Reads
            // from the document when evaluating incrementally, and from the scan
            // in the batch parseDocument/evaluateLines path, so a table column
            // aggregate resolves the same way through both, matching the other
            // cross-line closures above.
            getLineText: doc
                ? (n: number) => doc.getLineAt(n)?.text
                : scan
                  ? (n: number) => scan[n - 1]?.text
                  : undefined,
        };
    }

    /**
     * Re-evaluate line `targetLine`'s compiled expression with `variable` bound
     * to `bound` for that one run, the primitive goal seek drives while
     * narrowing in on an input. See {@link LineExecutionContext.evaluateLineWithBinding}.
     *
     * The binding is a call frame, so `LOAD_VAR` reads it in preference to the
     * document's own value and the document's value is untouched once the frame
     * is popped, the same shadowing a function parameter gets. The target's
     * bytecode is run as-is, so a line that defines a variable is refused: its
     * `STORE_VAR` would write the probe's candidate into the real variable store
     * as a side effect. The re-entry is bounded three ways, by
     * {@link goalSeekDepth} against nesting, by the VM's own per-run instruction
     * limit, and by the caller's iteration cap.
     *
     * @param targetLine - 1-based line whose expression is re-evaluated.
     * @param variable - The unknown to bind for this run.
     * @param bound - The value to bind it to (a number to probe, a symbolic node to read the relationship in closed form).
     * @param symbolicTolerant - Whether an otherwise-undefined variable reads as a symbolic placeholder, needed for the closed-form read.
     * @returns The line's re-evaluated Value, or an error Value when it cannot be probed.
     */
    private evaluateLineWithBinding(
        targetLine: number,
        variable: string,
        bound: Value,
        symbolicTolerant: boolean,
    ): Value {
        const doc = this.documentModel;
        if (!doc) {
            return errorValue("GOAL_SEEK_NO_DOCUMENT", "Goal seek needs a document to solve against, which the single-expression entry point does not have.");
        }
        if (this.goalSeekDepth >= ExpressionEngine.GOAL_SEEK_MAX_NESTING_DEPTH) {
            return errorValue("GOAL_SEEK_NESTED", `A goal-seek line cannot target another goal-seek line, since each already re-runs its target many times.`);
        }
        const state = doc.getLineAt(targetLine);
        if (!state || state.bytecodes.length === 0) {
            return errorValue("GOAL_SEEK_LINE_NOT_READY", `Line ${targetLine} has no evaluated expression to solve (forward reference, out of range, or not an expression).`);
        }
        if (state.isVariableDef) {
            return errorValue("GOAL_SEEK_TARGET_IS_DEFINITION", `Line ${targetLine} defines a variable, so re-running it would overwrite that variable. Target the line that uses ${variable}, not the one that sets a value.`);
        }

        const program = state.bytecodes[0];
        this.goalSeekDepth++;
        try {
            const frame = new Map<string, Value>([[variable, bound]]);
            const stackBefore = this.vm.getStack().length;
            this.vm.pushCallFrame(frame);
            try {
                const result = executeBytecode(program, this.vm, undefined, undefined, this.makeLineContext(targetLine), symbolicTolerant);
                if (result.type === 'pending') {
                    return errorValue("GOAL_SEEK_ASYNC_UNSUPPORTED", `Line ${targetLine} depends on an async value (weather, stocks, currency, ...), which goal seek cannot re-run.`);
                }
                if (result.type === 'error') {
                    return errorValue(result.error.code ?? "GOAL_SEEK_TARGET_ERROR", result.error.message);
                }
                return result.value;
            } finally {
                this.vm.popCallFrame();
                // Restore the shared stack to exactly what the outer evaluation
                // left, mirroring executeAndStore()'s own post-run cleanup, so a
                // probe leaves nothing behind for the next one.
                while (this.vm.getStack().length > stackBefore) this.vm.pop();
            }
        } catch (e) {
            // A safety-limit throw from the re-run (instruction/stack/recursion
            // limit) surfaces as a structured error Value rather than escaping
            // the search loop.
            return errorValue("GOAL_SEEK_TARGET_ERROR", normalizeUnknownError(e).message);
        } finally {
            this.goalSeekDepth--;
        }
    }

    /**
     * Package-contributed completion candidates (`IEnginePackage.completionItems`),
     * keyed by package name, engine-instance-local, not a shared registry
     * (unlike tokenCategories), so no separate register/unregister module is
     * needed: registerPackage()/unregisterPackage() just set/delete the
     * package's own entry. {@link getPackageCompletionItems} flattens it.
     */
    private packageCompletionItems = new Map<string, CompletionItem[]>();

    /**
     * Keystroke-level AbortSignal, set by the UI layer (MarkdownEditorViewPlugin)
     * before each evaluation. When the user types a new keystroke, the old signal
     * is aborted, causing all in-flight async work (fetches, preflight checks,
     * batcher flushes) to be canceled atomically.
     *
     * executeAndStore() and executeRaw() link their local AbortControllers to
     * this signal so that when the keystroke changes, all per-evaluation controllers
     * are aborted together.
     */
    private keystrokeSignal: AbortSignal | null = null;

    /**
     * Micro-batcher that collapses multiple async resolutions into a single
     * DAG walk + re-evaluation pass. Replaces the old single-callback pattern.
     */
    private batcher: AsyncResolutionBatcher;
    /**
     * Drives proactive background refresh of live values, or `null` when the
     * host has not enabled it (the default). See {@link BackgroundRefreshManager}.
     */
    private readonly backgroundRefresh: BackgroundRefreshManager | null;
    /**
     * The signal a background re-evaluation is dispatched under. Never aborted
     * (a background refetch is not tied to a keystroke), so the batcher treats
     * its results as current; the manager's own timers are what stop the work.
     */
    private readonly backgroundRefreshSignal = new AbortController().signal;
    /** Post-lexer token normalizer for phrase fusion, implicit multiply, etc. */
    private normalizer: TokenNormalizer;
    /**
     * Units defined by the current document (`1 sprint = 2 weeks`). Read by the
     * user-unit normalizer rule to expand a name back to its definition, written
     * by {@link tryDefineUserUnit} on a definition line. Document-scoped: cleared
     * at the start of every {@link parseDocument} pass, so definitions never
     * cross between documents.
     */
    private readonly userUnits = new UserUnitTable();
    /** TanStack Query client, injected into resolvers for cache reads/writes. */
    readonly queryClient: QueryClient;
    // Bytecode cache, avoids re-parsing identical expressions.
    // Bounded by config.performance.defaultCacheSize: when full, the oldest
    // entry (Map insertion order) is evicted so unique expressions across a
    // long session can't grow memory unboundedly.
    private bytecodeCache: Map<string, BytecodeProgram> = new Map();

    /**
     * What the front half of the pipeline produced for a cached program: the
     * normalised tokens the program was compiled from and the reads and
     * writes extracted from them. Keyed like {@link bytecodeCache} and kept
     * in step with it (same eviction, same clears), so a hit here means a hit
     * there.
     *
     * A bytecode-cache hit used to pay for the whole front half anyway: the
     * length check, lexing, normalising, the complexity score, the three
     * effectful-grammar tries and the reads/writes extraction all ran before
     * `bytecodeCache.get`, and on a cache-hit evaluation of an ordinary line
     * lexing and normalising were about two fifths of the cost. Everything
     * the later stages read from the front half is remembered here instead,
     * so a hit skips straight to the async preflight and the VM. Entries
     * restored from a snapshot carry a program but no front half; the first
     * evaluation after a restore runs the full front half once and fills it.
     * The memory is a few hundred bytes per cached expression, bounded by the
     * same `defaultCacheSize` as the programs.
     */
    private compiledFrontHalf: Map<string, { normalizedTokens: Token[]; reads: string[]; writes: string[] }> = new Map();

    /**
     * Expressions whose last parse threw, with what the front half produced
     * for them. A line that does not parse is the ordinary state of a line
     * being typed, and every re-evaluation of the document lexed, normalised
     * and re-parsed it, paying for the throw each time. The entry is used
     * only after the effectful-grammar tries, which still run because they
     * read the VM (a stored equation, a running total), so nothing that
     * depends on document state is skipped: only the pure front half and the
     * parse that is known to fail. The error object is the one first thrown,
     * so its timestamp is the first failure's. Cleared with the compiled
     * caches, because the vocabulary and parselet changes that would change
     * a program can change whether a line parses at all. Bounded by the same
     * `defaultCacheSize` as the programs.
     */
    private failedParses: Map<string, { error: EngineError; normalizedTokens: Token[]; reads: string[]; writes: string[] }> = new Map();

    /** Whether `expression` can be answered without lexing or normalising: both compiled caches hold it, or its parse is known to fail. */
    private frontHalfCached(expression: string): boolean {
        return (this.compiledFrontHalf.has(expression) && this.bytecodeCache.has(expression)) || this.failedParses.has(expression);
    }

    /** Drop every cached program, its front half and every remembered parse failure. Every invalidation goes through here so the three cannot drift. */
    private clearCompiledCache(): void {
        this.bytecodeCache.clear();
        this.compiledFrontHalf.clear();
        this.failedParses.clear();
    }

    /**
     * Insert into the bytecode cache, evicting the oldest entry when full.
     *
     * Bug fix (found during release hardening): this used to check against
     * a hardcoded `BYTECODE_CACHE_MAX_ENTRIES = 2000` constant that never
     * read `config.performance.defaultCacheSize`, despite that field being
     * documented (see `EngineConfig`'s JSDoc example) as exactly this knob.
     * A host raising `defaultCacheSize` for large documents had zero effect;
     * every document beyond ~2000 unique expressions per line silently lost
     * the bytecode-cache benefit on re-evaluation regardless of config.
     */
    private cacheBytecode(expression: string, program: BytecodeProgram, front: { normalizedTokens: Token[]; reads: string[]; writes: string[] }): void {
        const maxEntries = this.config.performance.defaultCacheSize;
        if (this.bytecodeCache.size >= maxEntries) {
            const oldest = this.bytecodeCache.keys().next().value;
            if (oldest !== undefined) {
                this.bytecodeCache.delete(oldest);
                this.compiledFrontHalf.delete(oldest);
            }
        }
        this.bytecodeCache.set(expression, program);
        this.compiledFrontHalf.set(expression, front);
    }

    /** Remember a parse failure, evicting the oldest when full: bounded like the program cache. */
    private rememberFailedParse(expression: string, failure: { error: EngineError; normalizedTokens: Token[]; reads: string[]; writes: string[] }): void {
        if (this.failedParses.size >= this.config.performance.defaultCacheSize) {
            const oldest = this.failedParses.keys().next().value;
            if (oldest !== undefined) this.failedParses.delete(oldest);
        }
        this.failedParses.set(expression, failure);
    }
    // Maps each registered plugin function's name to the index its handler sits
    // at in this engine's context. Populated by registerPackage, shared by
    // reference with every BytecodeBuilder and the parser so a parselet emits a
    // plugin call by name (builder.emitPluginCall) and never sees the index.
    private pluginFunctionIndexByName = new Map<string, number>();
    // Pre-allocated BytecodeBuilder pool
    private builderPool: BytecodeBuilder[] = [
        new BytecodeBuilder(this.pluginFunctionIndexByName),
        new BytecodeBuilder(this.pluginFunctionIndexByName),
        new BytecodeBuilder(this.pluginFunctionIndexByName),
        new BytecodeBuilder(this.pluginFunctionIndexByName),
    ];
    // Index into the builder pool, incremented modulo pool size.
    private builderPoolIndex = 0;
    // Most recent pipeline telemetry, populated when AllocationTracker.isEnabled().
    private lastTelemetry: PipelineTelemetry | null = null;

    //#endregion

    //#region Constructor
    constructor(options: EngineOptions = {}) {
        const { locale = "en", diagnostics = false, config, packages, calendar } = options;
        this.localeCode = locale;
        // Per-section merge, not a top-level shallow spread, overriding one
        // field of a section (e.g. `{ performance: { defaultCacheSize: 500 } }`)
        // used to silently replace the WHOLE section, dropping every other
        // field in it back to `undefined` instead of keeping its default.
        this.config = mergeEngineConfig(DEFAULT_CONFIG, config ?? {});
        // Resolved once, here, and then carried. `date.inputOrder: 'locale'`
        // asks a question of `Intl`, and the date-literal rule runs on every
        // keystroke, so asking per literal would be a per-keystroke cost for an
        // answer that cannot change within a process. `this.config` is assigned
        // exactly here and never reassigned, so the resolved order cannot go
        // stale against the per-expression bytecode cache either. Raises
        // DATE_INPUT_LOCALE_INVALID for a malformed `date.inputLocale`, at the
        // boundary rather than per line.
        this.dateReading = resolveDateOrderPolicy(this.config.date);
        this.lexer = new Lexer(locale);
        this.registry = new ParseletRegistry();
        // Before the package loop below, which registers plugin functions into it.
        // Carries the network switch too, since the VM is where a conversion
        // with no rate and a promise-returning plugin function are first seen,
        // and the calendar backend, since the VM is where a date is stepped.
        this.context = createEngineContext({ networkEnabled: this.config.network.enabled, calendar });

        // Wire the diagnostic pipeline: collect per-stage detail when diagnostics
        // are on, otherwise an empty pipeline whose length check exits with zero
        // overhead in production.
        if (diagnostics) {
            this.diagnosticPipeline = new DiagnosticPipeline();
            this.timelineCollector = new TimelineDiagnosticCollector();
            this.diagnosticPipeline.register(this.timelineCollector);
        } else {
            this.diagnosticPipeline = new DiagnosticPipeline();
        }

        // Register providers via IEnginePackage data.
        // Packages are explicit: an engine registers exactly what the caller
        // passes and nothing more, so a consumer's bundler can tree-shake away
        // every built-in package they do not import. Pass `BUILTIN_PACKAGES`
        // (from `solve-engine/packages`) for the full set, or a subset for a
        // slimmer engine; omitting `packages` registers none.
        // Each package's parselets go into the engine's isolated registry
        // (not sharedParseletRegistry), lexer plugins into the engine's
        // isolated lexer, and opcode/variable handlers into shared registries.

        // ── Create normalizer BEFORE package registration ──
        // Packages may register phrases and normalizer rules, so the normalizer
        // must exist before registerPackage() is called.
        this.normalizer = new TokenNormalizer();

        // Register built-in phrases into the PhraseTrie, single-pass
        // O(depth) matching per position instead of separate rule scans.
        for (const [phrase, tokenType] of Object.entries(BUILTIN_PHRASES)) {
            this.normalizer.addPhrase(phrase, tokenType);
        }

        // Register built-in normalizer rules (implicit multiply, etc.)
        // Pass the trie's canStart predicate so the implicit multiply rule
        // stays in sync with package-registered phrases.
        this.normalizer.register(implicitMultiplyRule(
            50,
            (word) => this.normalizer.canStartPhrase(word),
        ));

        // User-defined units (`1 sprint = 2 weeks`). Registered here rather than
        // through the UOM package descriptor because it closes over this
        // engine's own per-document unit table, and a package descriptor is
        // shared across every engine in the process. Priority is above implicit
        // multiply so a defined name is expanded whole (`6 * 2 weeks`) instead
        // of first split into `6 * sprints` with the name stranded as a variable.
        this.normalizer.register(userUnitExpansionRule(this.userUnits));

        // One rule for every package's `name(` call word. It reads the live
        // callFusions map, which registerPackage fills below, so it is registered
        // here once and needs no per-package rule. See CallFusionRule.ts.
        this.normalizer.register(callFusionRule(this.callFusions));

        const pkgList = packages ?? [];
        for (const pkg of pkgList) {
            // Per-package containment: registerPackage() can throw (a
            // lexerVocabulary keyword/operator/unit colliding with a
            // built-in one, ExpressionLexer.registerVocabulary()'s hard
            // guard, the one sub-registration in registerPackage() that
            // isn't already "warn and proceed"). Unguarded, that throw used
            // to escape the constructor itself: every package after the
            // offender in pkgList never got registered, `new
            // ExpressionEngine(...)` never returned an instance, and
            // whatever THIS package or earlier ones already wrote into
            // shared module-level registries (pluginFunctionRegistry,
            // TokenCategoryMap, asConverterRegistry)
            // had no owning engine instance left to call
            // unregisterPackage() and clean it up. Same containment shape
            // as AsyncResolutionBatcher.reExecuteMainThread()'s fatal-bug
            // fix: one bad package (most likely a third-party one passed via
            // the `packages` constructor param, not a built-in) is skipped
            // with a clear, verbose error instead of taking the whole engine
            // down.
            try {
                this.registerPackage(pkg);
            } catch (e) {
                const engineError = normalizeUnknownError(e);
                console.error(
                    `[ExpressionEngine] Failed to register package "${pkg.name}" — skipping it and continuing ` +
                    `construction with the remaining packages: ${engineError.format()}`
                );
            }
        }

        // Date literals, numeric (`25/12/2023`) and with the month spelled out
        // (`March 9, 2024`). Registered here rather than through the datetime
        // package descriptor because both rules build their literal through
        // this engine's own calendar backend, and the numeric one also reads
        // this engine's resolved date-reading order (DMY/MDY/YMD) to resolve an
        // ambiguous ordering; a descriptor is shared across every engine, the
        // same reason user units are registered above. The RESOLVED order is
        // passed, never `date.inputOrder`, so the word `'locale'` cannot reach
        // a rule that would have to re-infer it. Gated on the datetime
        // package actually being loaded (it owns the DATETIME_LITERAL
        // parselet), so an engine without it does not fuse a date literal it
        // has no way to read. Both token types are checked, because the rule
        // emits either one and a refusal with no parselet behind it would be a
        // parse error where the old behaviour was a number.
        if (this.registry.hasPrefix("DATETIME_LITERAL") && this.registry.hasPrefix("DATETIME_LITERAL_UNREADABLE")) {
            const calendar = () => this.context.calendar;
            this.normalizer.register(dateLiteralNormalizerRule(
                () => this.dateReading.order,
                calendar,
                () => this.config.date.onAmbiguous,
            ));
            this.normalizer.register(monthNameDateNormalizerRule(undefined, calendar, () => this.config.date.onAmbiguous));
        }

        this.parser = new PrecedenceParser(this.registry, this.config.validation.maxNestingDepth, locale, this.pluginFunctionIndexByName, this.context.calendar);
        this.vm = createVM(
            this.context.opRegistry,
            this.config.vm.maxStackDepth,
            this.config.vm.maxInstructions,
            undefined,
            this.config.vm.maxCollectionSize,
            this.config.vm.maxAllocatedElements,
            this.config.vm.maxFunctionCalls,
            this.config.date.maxOffsetYears,
            this.config.date.minOffsetYears,
            this.context,
            // Resolved once here, not per evaluation: a host list becomes a
            // Set lookup the walk can run cheaply. Undefined stays undefined,
            // which the VM reads as weekends-only.
            resolveHolidayPredicate(this.config.date.holidays, this.context.calendar),
        );
        this.queryClient = createQueryClient();
        this.batcher = new AsyncResolutionBatcher(this.dag, this.lineCache, this.vm);
        // Only stand up the background refresher when the host asked for it: a
        // headless or batch host wants no timers. When null, every value stays
        // pull-only, exactly as before. It feeds the same batcher the pull path
        // does, so a resolved background value reaches the host over the existing
        // event stream with no extra wiring.
        this.backgroundRefresh = this.config.backgroundRefresh.enabled
            ? new BackgroundRefreshManager(this.dag, (packageId, queryKey) =>
                  this.batcher.add({ queryKey, packageId, signal: this.backgroundRefreshSignal, isError: false }),
              )
            : null;

        // Last, so the warm-up runs against a fully assembled engine.
        if (options.warmup === true) this.warmUp();
	}

    //#endregion

    //#region Public API, Event stream

    /**
     * Get the native event stream from the batcher for stream-based consumers.
     *
     * Use this instead of `addAsyncListener()` when you need:
     * - **Backpressure**: the stream buffers up to `highWaterMark` events;
     *   when full, `enqueue()` blocks until the consumer reads, preventing
     *   unbounded memory growth.
     * - **Cancellation**: call `reader.cancel()` or pass an `AbortSignal` to
     *   `pipeTo()` to stop receiving events.
     * - **Piping**: use `stream.pipeTo(writable)` or `stream.pipeThrough(transform)`
     *   to build a reactive pipeline.
     * - **Teeing**: use `stream.tee()` to serve multiple independent consumers.
     *
     * @returns A {@link ReadableStream} that emits {@link AsyncResolutionEvent}
     *          items as the batcher processes async resolutions.
     */
    getEventStream(): ReadableStream<AsyncResolutionEvent> {
        return this.batcher.getEventStream();
    }

    /**
     * Get the batcher instance (for test infrastructure).
     *
     * Tests use this to access `batcher._testCaptures` for synchronous
     * event observation without async stream reader timing issues.
     */
    getBatcher(): AsyncResolutionBatcher {
        return this.batcher;
    }

    //#endregion

    //#region Public API, Package registration

    /**
     * Register a package with the engine's isolated registries.
     *
     * Handles all IEnginePackage fields:
     * - `lexerVocabulary` → engine's isolated lexer (via this.lexer.registerVocabulary)
     * - `prefixParselets` → engine's isolated ParseletRegistry
     * - `infixParselets` → engine's isolated ParseletRegistry
     *
     * Built-in packages (ARITHMETIC, FUNCTION, UOM, etc.) are registered
     * via this method during construction. External user packages can also
     * use this method for data-driven registration.
     *
     * @param pkg - The package to register.
     */
    registerPackage(pkg: IEnginePackage): void {
        // Engine-vs-package version gating, checked FIRST, before the
        // duplicate-name guard below. Unlike checkPackageCompatibility()
        // further down (package-vs-package, always advisory, never blocks
        // ARCHITECTURE.md §5.2), an unsatisfied or malformed engineVersion is
        // a hard rejection: throwing here means re-registering an
        // incompatible REPLACEMENT for an already-working package never
        // unregisters the old one first, the engine is never left with
        // neither version registered. See ARCHITECTURE.md §5.3 and
        // api/EngineVersionCompatibility.ts.
        assertEngineVersionCompatible(pkg);

        // Guard against double-registration under the same name: without
        // this, a second registerPackage() call for the same pkg.name would
        // overwrite packageContributions' tracked record for the FIRST
        // registration, permanently orphaning its shared-registry
        // contributions (pluginFunctionRegistry entries, variable sources,
        // resolver namespaces, token categories), unreachable and
        // unreversible for the engine's lifetime, since those are shared
        // module-level registries. Mirrors ResolverRegistry.register()'s
        // existing "destroy old, warn, replace" pattern for the same class
        // of problem at the resolver-namespace level.
        if (this.packageContributions.has(pkg.name)) {
            console.warn(
                `[ExpressionEngine] Package "${pkg.name}" is already registered. ` +
                `Unregistering the previous registration before re-registering.`,
            );
            this.unregisterPackage(pkg.name);
        }

        // Load-up resiliency: statically compare this package's declared
        // fields against every OTHER package already on this engine, before
        // touching any shared registry. See api/PackageCompatibility.ts's
        // module doc for the full reasoning and the real bug that motivated
        // it. Non-fatal (matches this codebase's established "warn and
        // proceed" convention for collisions elsewhere, ParseletRegistry
        // asConverterRegistry) even for "error"-severity conflicts, since a
        // host may have a deliberate reason to accept a collision; the
        // point is making it IMPOSSIBLE to miss, not blocking registration.
        const compatibilityConflicts = this.compatIndex.check(pkg);
        for (const conflict of compatibilityConflicts) {
            const log = conflict.severity === "error" ? console.error : console.warn;
            log(`[ExpressionEngine] Package compatibility ${conflict.severity} (${conflict.kind}): ${conflict.detail}`);
        }

        // Track shared-registry contributions so unregisterPackage() can
        // reverse them. Isolated per-engine registrations (parselets,
        // phrases) die with the engine and don't need tracking. lexerVocabulary
        // IS tracked (unlike before) so its custom keyword/operator token
        // types can be reverted via ExpressionLexer.unregisterVocabulary()
        // previously that method existed and worked correctly but was never
        // called from here, leaving a package's lexer contribution live
        // after "unregistering" it. tokenCategories is tracked the same way.
        //
        // normalizerRuleNames is tracked even though the normalizer is
        // per-engine, because unlike phrases these do NOT die with the engine
        // in any useful sense: a phrase goes into a text-keyed trie and
        // registering it twice is idempotent, whereas a rule is pushed onto an
        // array, so a host re-registering a package on every settings change
        // accumulated one more copy of every rule each time and the normalizer
        // tried all of them at every token position for the rest of the
        // engine's life.
        const contribution = {
            pluginFunctionIndices: [] as number[],
            pluginFunctionNames: [] as string[],
            resolverNamespaces: [] as string[],
            tokenCategories: [] as string[],
            lexerVocabulary: pkg.lexerVocabulary,
            asConverterNames: [] as string[],
            normalizerRuleNames: [] as string[],
            callFusionNames: [] as string[],
        };

        // Only lexerVocabulary can throw here (built-in keyword/operator/unit
        // collision, ExpressionLexer.registerVocabulary()'s hard guard)
        // every other sub-registration below is already "warn and proceed".
        // Deliberately done BEFORE registeredPackages/packageContributions
        // are recorded (see below) so a throw here leaves no phantom
        // entry, the caller's try/catch (registerPackage() itself still
        // throws for a single bad package; ExpressionEngine's constructor
        // catches per-package so one bad package can't take down engine
        // construction, see that loop's own comment) sees a package that
        // registered NOTHING, not a partially-registered one.
        if (pkg.lexerVocabulary) {
            this.lexer.registerVocabulary(pkg.lexerVocabulary);
        }
        if (pkg.prefixParselets) {
            for (const [tokenType, parselet] of Object.entries(pkg.prefixParselets)) {
                this.registry.registerPrefix(tokenType, parselet);
            }
        }
        if (pkg.infixParselets) {
            for (const [tokenType, parselet] of Object.entries(pkg.infixParselets)) {
                this.registry.registerInfix(tokenType, parselet);
            }
        }
        if (pkg.pluginFunctions) {
            for (const [name, handler] of Object.entries(pkg.pluginFunctions)) {
                // The engine assigns the registry index (stable per pkg:name), so
                // the author names the function and the parselet emits by name.
                const index = pluginFunctionIndexFor(`${pkg.name}:${name}`);
                this.context.pluginFunctions[index] = handler;
                this.context.pluginFunctionOwners[index] = pkg.name;
                this.pluginFunctionIndexByName.set(name, index);
                contribution.pluginFunctionIndices.push(index);
                contribution.pluginFunctionNames.push(name);
            }
        }
        if (pkg.asyncResolvers) {
            for (const resolver of pkg.asyncResolvers) {
                this.resolverRegistry.register(resolver);
                contribution.resolverNamespaces.push(resolver.namespace);
            }
        }
        if (pkg.phrases) {
            for (const [phrase, tokenType] of Object.entries(pkg.phrases)) {
                this.normalizer.addPhrase(phrase, tokenType);
            }
        }
        if (pkg.normalizerRules) {
            for (const rule of pkg.normalizerRules) {
                this.normalizer.register(rule);
                contribution.normalizerRuleNames.push(rule.name);
            }
        }
        if (pkg.callFusions) {
            // Merge into the one shared call-fusion map the single callFusionRule
            // reads. Tracked per-name so unregisterPackage removes exactly these.
            for (const [name, tokenType] of Object.entries(pkg.callFusions)) {
                const lower = name.toLowerCase();
                const claims = this.callFusionOwners.get(lower);
                if (claims) claims.push({ pkg: pkg.name, tokenType });
                else this.callFusionOwners.set(lower, [{ pkg: pkg.name, tokenType }]);
                this.callFusions.set(lower, tokenType);
                contribution.callFusionNames.push(lower);
            }
        }
        if (pkg.tokenCategories) {
            for (const [tokenType, category] of Object.entries(pkg.tokenCategories)) {
                registerTokenCategory(tokenType, category);
                contribution.tokenCategories.push(tokenType);
            }
        }
        if (pkg.completionItems) {
            this.packageCompletionItems.set(pkg.name, pkg.completionItems);
        }
        if (pkg.asConverters) {
            for (const [name, handler] of Object.entries(pkg.asConverters)) {
                registerAsConverter(name, handler);
                contribution.asConverterNames.push(name);
            }
        }

        this.packageContributions.set(pkg.name, contribution);
        // Recorded LAST, only once every sub-registration above actually
        // succeeded. If this ran up front (as it used to), a mid-function
        // throw from lexerVocabulary would leave a phantom entry: callers
        // checking registeredPackages.has(pkg.name) would see "registered"
        // for a package that contributed nothing.
        this.registeredPackages.set(pkg.name, pkg);
        // Mirror the registration into the compatibility index (kept in step so
        // the next package's check stays O(its own fields)).
        this.compatIndex.add(pkg);

        // A package can add a parselet, a keyword or a normaliser rule, which
        // changes what a line means or whether it parses at all: a program
        // compiled before it, and a parse failure remembered before it, are
        // both stale.
        this.clearCompiledCache();
    }

    /**
     * Unregister a package previously registered via {@link registerPackage}.
     *
     * Reverses the package's contributions to the SHARED registries, plugin
     * functions (pluginFunctionRegistry), variable sources
     * (this engine's variable resolver), async resolvers, and now
     * token highlight categories (TokenCategoryMap), which registerPackage
     * wrote into process-wide state. Also reverts
     * the package's lexer plugin (custom keyword/operator token types
     * revert to generic IDENT/ERROR, matching ExpressionLexer.unregisterVocabulary()'s
     * own contract). This engine-instance-local registration is reversed
     * here too, even though it isn't a "shared" registry, so a package's
     * lexer and highlighting contributions clean up together rather than
     * only half-reversing on unregister. Normalizer rules are reversed here
     * for the same reason: they are per-engine, but they live in an ARRAY the
     * normalizer walks at every token position, so re-registering a package
     * appended a second copy of every rule and lexing got slower with every
     * register/unregister cycle.
     *
     * Per-engine parselets and phrases are still left in place: a parselet
     * lives in this engine's isolated registry and a phrase goes into a
     * text-keyed trie where registering the same phrase twice is the same as
     * registering it once, so neither accumulates and both are discarded with
     * the engine instance.
     *
     * Clears the bytecode cache, removing handlers changes what compiled
     * bytecode is valid.
     *
     * @param packageName - The `name` the package was registered under.
     * @returns true if the package was found and unregistered.
     */
    unregisterPackage(packageName: string): boolean {
        const contribution = this.packageContributions.get(packageName);
        if (!contribution) return false;

        for (const index of contribution.pluginFunctionIndices) {
            delete this.context.pluginFunctions[index];
            delete this.context.pluginFunctionOwners[index];
        }
        for (const name of contribution.pluginFunctionNames) {
            this.pluginFunctionIndexByName.delete(name);
        }
        for (const namespace of contribution.resolverNamespaces) {
            this.resolverRegistry.unregister(namespace);
        }
        for (const tokenType of contribution.tokenCategories) {
            unregisterTokenCategory(tokenType);
        }
        if (contribution.lexerVocabulary) {
            this.lexer.unregisterVocabulary(contribution.lexerVocabulary);
        }
        for (const name of contribution.asConverterNames) {
            unregisterAsConverter(name);
        }
        for (const ruleName of contribution.normalizerRuleNames) {
            this.normalizer.unregister(ruleName);
        }
        for (const name of contribution.callFusionNames) {
            // Two packages may claim one word (the compatibility index warns).
            // Removing one hands the word back to the other.
            const remaining = (this.callFusionOwners.get(name) ?? []).filter((claim) => claim.pkg !== packageName);
            if (remaining.length === 0) {
                this.callFusionOwners.delete(name);
                this.callFusions.delete(name);
            } else {
                this.callFusionOwners.set(name, remaining);
                this.callFusions.set(name, remaining[remaining.length - 1].tokenType);
            }
        }
        this.packageCompletionItems.delete(packageName);

        this.packageContributions.delete(packageName);
        this.registeredPackages.delete(packageName);
        // Rebuild the compatibility index from the survivors. Unregistration is
        // rare (a re-registered duplicate name, or an explicit host call), so an
        // O(remaining) rebuild here is far cheaper than tracking per-key removal.
        this.compatIndex.rebuild(this.registeredPackages.values());
        this.clearCompiledCache();
        return true;
    }

    //#endregion

    //#region Public API, Configuration & accessors

    /**
     * Get the effective engine configuration currently in use.
     * Includes all defaults merged with any constructor overrides.
     * Useful for introspection, lets consumers see what values are actually
     * in effect after merging with DEFAULT_CONFIG.
     */
    getConfig(): EngineConfig {
        return { ...this.config };
    }

    /**
     * How this engine reads an ambiguous numeric date literal, and where that
     * reading came from.
     *
     * A settings panel renders this ("Dates are read day first, from your
     * system locale en-GB"), and a bug report should paste it: "why did
     * `03/04/2026` render as 4 March" is answerable from one line of it and
     * unanswerable without. `orderSource: 'fallback'` is the visible signal
     * that an inference was asked for and could not be made, which is the
     * difference between a decision and a guess, and the case where a host
     * should offer the reader a manual choice.
     *
     * Resolved once at construction from `config.date`, so this is a read of a
     * settled fact rather than a fresh inference, and two calls on one engine
     * cannot disagree.
     *
     * @returns The frozen policy: the order, its source, and the locale tag it
     * was inferred from where it was inferred from one.
     */
    getDateReading(): DateReadingPolicy {
        return this.dateReading;
    }

    /**
     * Get the underlying diagnostic pipeline for advanced usage.
     */
    getDiagnosticPipeline(): DiagnosticPipeline {
        return this.diagnosticPipeline;
    }

    //#endregion

    //#region Internal, Execution helpers

    /**
     * Store a result in the line cache (with DAG registration).
     * Extracted common pattern from 8 call sites.
     */
    private storeLineResult(
        lineNumber: number,
        result: Value,
        program: BytecodeProgram,
        reads: string[],
        writes: string[],
        expression: string,
    ): void {
        this.lineCache.set(lineNumber, new LineCacheEntry(
            result,
            program,
            reads,
            writes.length > 0 ? writes[0] : null
        ), expression);
    }

    /**
     * Execute bytecode and handle the result.
     *
     * Replaces ALL 5 try/catch blocks that previously caught AsyncSuspenseError.
     * Now that executeBytecode returns an EvalResult discriminated union,
     * we simply check result.type instead of catching errors.
     *
     * Sets up AbortController → VM for stale-data prevention.
     * Cleans up the VM stack after execution (success or pending).
     * Fires async resolution via fire-and-forget for pending results.
     *
     * `tracePipeline`/`traceExpression`, when given, are passed straight
     * through to `executeBytecode()`'s own optional VM-step-tracing
     * parameters, used ONLY by {@link evaluateExpressionWithDiagnostic}
     * when `vmTraceEnabled` is on. Omitted by every other caller, with zero
     * behavior change (identical to today's hardcoded `undefined, undefined`).
     */
    private executeAndStore(
        program: BytecodeProgram,
        lineNumber: number,
        expression: string,
        reads: string[],
        writes: string[],
        packageId: string,
        tracePipeline?: DiagnosticPipeline,
        traceExpression?: string,
    ): Value {
        const stackBefore = this.vm.getStack().length;

        // Set up AbortController for this evaluation.
        // When the user edits the line before resolution, the old controller
        // is aborted, preventing stale data from surfacing.
        const controller = new AbortController();
        // ── Link to keystroke signal (One AbortController Per Keystroke) ──
        // When the user types a new keystroke, the keystrokeController is aborted,
        // which in turn aborts this local controller, canceling all in-flight
        // async work for this specific evaluation.
        const abortLocal = () => controller.abort();
        this.keystrokeSignal?.addEventListener('abort', abortLocal, { once: true });

        abortLogger.localControllerCreated("executeAndStore");
        if (this.keystrokeSignal) {
            abortLogger.signalLinked("executeAndStore");
        }

        this.vm.activeSignal = controller.signal;
        this.vm.abortCurrent = () => {
            abortLogger.signalUnlinked("executeAndStore");
            this.keystrokeSignal?.removeEventListener('abort', abortLocal);
            controller.abort();
        };

        setActiveQueryClient(this.queryClient);
        const result = executeBytecode(program, this.vm, tracePipeline, traceExpression, this.makeLineContext(lineNumber));

        // Single stack cleanup (replaces 10 occurrences)
        while (this.vm.getStack().length > stackBefore) {
            this.vm.pop();
        }

        if (result.type === 'pending') {
            // Fire-and-forget async resolution.
            // The keystroke listener stays attached while the async work is
            // in flight so a new keystroke can still cancel it.
            void this.resolveAsync(result);

            // Register data source dependency in DAG for re-evaluation tracking
            this.dag.registerLineDataSourceDependency(
                lineNumber,
                result.packageId || packageId,
                [result.queryKey]
            );

            const pending = pendingValue(result.queryKey);
            this.storeLineResult(lineNumber, pending, program, reads, writes, expression);
            return pending;
        }

        if (result.type === 'error') {
            this.keystrokeSignal?.removeEventListener('abort', abortLocal);
            throw result.error;
        }

        // Success path, execution finished synchronously, so unhook the
        // keystroke listener now. Without this, one listener per evaluated
        // line accumulates on the keystroke signal for large documents.
        this.keystrokeSignal?.removeEventListener('abort', abortLocal);

        this.dag.registerLine(lineNumber, reads, writes);
        this.storeLineResult(lineNumber, result.value, program, reads, writes, expression);
        return result.value;
    }

    /**
     * Execute bytecode and return the raw EvalResult without DAG/LineCache updates.
     * Used by reEvaluateLine, executeCached, and evaluateIncremental which
     * manage their own cache state differently.
     *
     * @param lineNumber - 1-based line this bytecode belongs to, for
     * cross-line features (`prev`/`line<N>`/aggregation. See
     * `makeLineContext()`). Defaults to -1 (the existing "no real
     * document" sentinel) for any caller that doesn't have a real line
     * number to pass.
     */
    private executeRaw(program: BytecodeProgram, lineNumber: number = -1): EvalResult {
        const stackBefore = this.vm.getStack().length;

        const controller = new AbortController();
        // ── Link to keystroke signal (One AbortController Per Keystroke) ──
        const abortLocal = () => controller.abort();
        this.keystrokeSignal?.addEventListener('abort', abortLocal, { once: true });

        abortLogger.localControllerCreated("executeRaw");
        if (this.keystrokeSignal) {
            abortLogger.signalLinked("executeRaw");
        }

        this.vm.activeSignal = controller.signal;
        this.vm.abortCurrent = () => {
            abortLogger.signalUnlinked("executeRaw");
            this.keystrokeSignal?.removeEventListener('abort', abortLocal);
            controller.abort();
        };

        setActiveQueryClient(this.queryClient);
        const result = executeBytecode(program, this.vm, undefined, undefined, this.makeLineContext(lineNumber));

        // Stack cleanup
        while (this.vm.getStack().length > stackBefore) {
            this.vm.pop();
        }

        // Sync completion, unhook the keystroke listener to prevent
        // per-evaluation listener accumulation. Pending results keep the
        // listener so in-flight async work stays cancellable.
        if (result.type !== 'pending') {
            this.keystrokeSignal?.removeEventListener('abort', abortLocal);
        }

        return result;
    }

    /**
     * Fire-and-forget async resolution using async/await.
     *
     * On resolution or error:
     * 1. Checks AbortSignal, if aborted, stale data is discarded.
     * 2. Stores result/error in AsyncResultCache (per-package scoped).
     * 3. Defers re-evaluation to AsyncResolutionBatcher which collapses
     *    multiple resolutions into a single DAG walk + re-execution pass
     *    and fires typed events to all listeners.
     */
    private async resolveAsync(pending: Extract<EvalResult, { type: 'pending' }>): Promise<void> {
        const { queryKey, resolver, packageId, signal } = pending;
        const effectivePackageId = packageId || '_engine';

        // TanStack Query handles dedup + caching automatically via fetchQuery().
        // We just await the resolver and dispatch to the batcher on completion.

        try {
            // The resolved value is not needed here, only the fact that it
            // settled: the batcher re-reads it from the cache on re-evaluation.
            await resolver;
            if (signal.aborted) {
                abortLogger.staleDataDiscarded(queryKey, "signal aborted after resolve");
                return;
            }
            // Defer re-evaluation to batcher (collapsed across microtask).
            this.batcher.add({
                queryKey,
                packageId: effectivePackageId,
                signal,
                isError: false,
            });
        } catch (err) {
            if (signal.aborted) {
                abortLogger.staleDataDiscarded(queryKey, "signal aborted after error");
                return;
            }
            const error = err instanceof Error ? err : new Error(String(err));
            this.batcher.add({
                queryKey,
                packageId: effectivePackageId,
                signal,
                isError: true,
                error,
            });
        }
    }

    /**
     * Start refreshing a value in the background if it declared a cadence and the
     * host enabled background refresh. A no-op otherwise, so the pull path is
     * unchanged for a headless host or a value that never wants it.
     */
    private registerBackgroundRefresh(asyncCheck: AsyncCheckResult): void {
        if (!this.backgroundRefresh) return;
        if (asyncCheck.refetchIntervalMs === undefined || !asyncCheck.refetch) return;
        this.backgroundRefresh.register({
            packageId: asyncCheck.packageId || '_engine',
            queryKey: asyncCheck.queryKey,
            intervalMs: asyncCheck.refetchIntervalMs,
            refetch: asyncCheck.refetch,
        });
    }

    /**
     * How many live values are currently being refreshed in the background.
     * Zero when the host has not enabled background refresh. For hosts that want
     * to surface it, and for tests.
     */
    getBackgroundRefreshCount(): number {
        return this.backgroundRefresh?.size ?? 0;
    }

    //#endregion

    //#region Public API, Document parsing

    /**
     * Unified parsing method that handles different input types and returns comprehensive results
     * with precise coordinate mapping for inline solves.
     */
    parseDocument(input: string, options: UnifiedParsingOptions = { inputType: 'markdown' }): ParsingResult {
        // Refused before the scan rather than during it. Every limit above this
        // one bounds what a single LINE may ask for, and a document's cost is
        // its line count whatever the lines say: two hundred thousand lines of
        // `1 + 1` exhausted the heap on the per-line records alone, which is a
        // process abort no host can catch. See
        // `constants/Configuration.ts`'s `performance.maxDocumentLines`.
        const maxLines = this.config.performance.maxDocumentLines;
        if (countLines(input, maxLines) > maxLines) {
            throw ErrorFactory.execution(
                "DOCUMENT_TOO_LARGE",
                `This document has more than ${maxLines.toLocaleString("en-US")} lines, which is the most the engine will process in one pass`,
                { maxLines },
            );
        }
        // Fresh unit definitions for this pass. A host re-parses the whole
        // document on each keystroke, so rebuilding the table top-to-bottom is
        // what keeps a renamed or deleted definition from lingering. Only drop
        // the bytecode cache when the previous pass actually defined a unit,
        // since its cached programs may have expanded one, a document that never
        // uses the feature keeps its cache and pays nothing here.
        if (!this.userUnits.isEmpty) this.clearCompiledCache();
        this.userUnits.clear();
        // Reset running-total accumulators for the same reason units are
        // rebuilt top-to-bottom: a full re-parse must reproduce the first
        // parse. `total += 5` seeds 0 only while the name is undefined, so
        // without this the total reads its own previous pass's value and
        // grows on every keystroke. Cleared here, re-seeded by the line's
        // own `+=`/`-=` as the pass replays it. See resetAccumulators.
        this.resetAccumulators();
        // Scan the entire document in a single pass, bypasses the old
        // split('\n') → evaluateLines() → join('\n') → scanDocument()
        // roundtrip. scanDocument() classifies and tokenizes all lines
        // character-by-character with a single Lexer.reset().
        const scanResults = this.lexer.scanDocument(input);
        const processedLines = this.processScanResults(scanResults);

        const result: ParsingResult = {
            lines: processedLines,
            totalLines: processedLines.length,
            errors: [],
        };

        // Collect errors from processed lines
        for (const line of processedLines) {
            if (line.error) {
                result.errors.push(`Line ${line.lineNumber}: ${line.error}`);
            }
            for (const solve of line.inlineSolves) {
                if (solve.error) {
                    result.errors.push(`Line ${line.lineNumber}: ${solve.error}`);
                }
            }
        }

        const includeDiagnostics = options.includeDiagnostics ?? false;
        if (includeDiagnostics) {
            const reports = this.diagnosticPipeline.collectReports();
            if (reports.length > 0) {
                result.diagnostics = reports[0].toJSON();
            }
        }

        return result;
    }

    /**
     * Batch-evaluate an array of lines in a single pass.
     *
     * Uses scanDocument() to classify and tokenize all lines in a single
     * character-by-character walk through the re-joined document text.
     * This eliminates the per-line Lexer.reset() + classifyLine() +
     * findInlineSolvesInLine() overhead from the old three-pass approach.
     *
     * Tokenization results from scanDocument() are passed directly to the
     * parser via evaluateLineWithPreTokenized(), skipping re-lexing.
     */
    /**
     * Batch-evaluate an array of lines in a single pass.
     *
     * Primarily used by tests. For production, prefer parseDocument()
     * which calls scanDocument() directly on the raw document string,
     * bypassing the split→join roundtrip that this method performs.
     */
    evaluateLines(lines: string[]): ParsedLine[] {
        // A whole-document pass, so definitions start empty (see parseDocument).
        if (!this.userUnits.isEmpty) this.clearCompiledCache();
        this.userUnits.clear();
        // Reset running-total accumulators for the same reason units are
        // rebuilt top-to-bottom: a full re-parse must reproduce the first
        // parse. `total += 5` seeds 0 only while the name is undefined, so
        // without this the total reads its own previous pass's value and
        // grows on every keystroke. Cleared here, re-seeded by the line's
        // own `+=`/`-=` as the pass replays it. See resetAccumulators.
        this.resetAccumulators();
        // Rejoin lines and scan in a single pass, scanDocument() handles
        // classification + tokenization for all lines in one character walk.
        const documentText = lines.join('\n');
        const scanResults = this.lexer.scanDocument(documentText);
        return this.processScanResults(scanResults);
    }

    /**
     * Process pre-scanned line results into ParsedLine objects.
     *
     * Shared by parseDocument() (which scanDocuments the raw input) and
     * evaluateLines() (which scanDocuments joined line arrays). Handles
     * inline solve extraction, variable assignment detection, and
     * expression evaluation for each non-skipped line.
     */
    private processScanResults(scanResults: ScanLineResult[]): ParsedLine[] {
        const result: ParsedLine[] = [];

        // Cross-line features (line references, table columns) read earlier
        // lines' text and results. The incremental `ThreeTierEvaluator` path
        // reads them from `this.documentModel`; the batch path has none, so it
        // reported a no-document error for `total above`, `line N` and
        // `sum of column`. Point the batch cross-line source at the scan and
        // the results array this pass is already building, for the length of
        // the pass, and restore whatever a host had set afterwards. This is
        // reference assignment, not allocation, so a document with no
        // cross-line feature pays nothing (an earlier version built a whole
        // `DocumentModel` per pass and grew the heap measurably).
        const previousBatchScanResults = this.batchScanResults;
        const previousBatchParsedLines = this.batchParsedLines;
        this.batchScanResults = scanResults;
        this.batchParsedLines = result;

        try {
        for (const scanResult of scanResults) {
            const lineText = scanResult.text;
            const lineNumber = scanResult.lineNumber;
            const startPosition = scanResult.startOffset;
            const endPosition = scanResult.endOffset;
            const isEmpty = scanResult.classification.skip;
            const inlineSolves: InlineSolvePosition[] = scanResult.inlineSolves.map(s => ({
                start: s.start,
                end: s.end,
                expression: s.expression,
                lineNumber,
                columnNumber: s.columnNumber,
            }));
            const hasInlineSolves = inlineSolves.length > 0;

            const parsedLine: ParsedLine = {
                lineNumber,
                text: lineText,
                startPosition,
                endPosition,
                isEmpty,
                hasInlineSolves,
                inlineSolves,
                expression: null,
                result: null,
                error: null,
            };

            if (scanResult.error) {
                // The tokeniser refused this line (an unterminated string). It
                // is reported the way a parse error is, and nothing is
                // evaluated from it: there are no tokens to evaluate.
                parsedLine.error = scanResult.error.message;
            } else if (!isEmpty) {
                const isVariableAssignment = lineText.trim().startsWith(':');

                if (hasInlineSolves && !isVariableAssignment) {
                    for (const solve of inlineSolves) {
                        try {
                            solve.result = this.evaluateLine(lineNumber, solve.expression);
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            solve.error = errorMessage;
                        }
                    }
                } else {
                    // Sliced from the same offset the tokens were, or the text
                    // and the token stream describe different lines.
                    const contentOffset = scanResult.classification.contentOffset;
                    const evaluable = contentOffset === undefined ? lineText : lineText.slice(contentOffset - startPosition);
                    const expression = evaluable.trim();
                    if (expression) {
                        // Pass pre-tokenized tokens from scanDocument to avoid re-lexing
                        try {
                            const values = this.evaluateLineWithPreTokenized(
                                lineNumber,
                                expression,
                                scanResult.tokens
                            );
                            parsedLine.expression = expression;
                            parsedLine.result = values[0];
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            parsedLine.error = errorMessage;
                        }
                    }
                }
            }

            // A later line referencing this one reads its result straight from
            // the `result` array above, which already holds it, so nothing more
            // needs recording here.
            result.push(parsedLine);
        }
        } finally {
            this.batchScanResults = previousBatchScanResults;
            this.batchParsedLines = previousBatchParsedLines;
        }

        return result;
    }

    /**
     * Evaluate a line using pre-tokenized tokens from scanDocument().
     *
     * Skips the lexing step entirely, the tokens are already available
     * from the document-level scan. Only parsing, compilation, and
     * execution are performed.
     *
     * This is the production fast path for evaluateLines(). Note: this
     * path intentionally bypasses the diagnostic pipeline. For diagnostic
     * events, use evaluateExpressionWithDiagnostic() directly.
     */
    private evaluateLineWithPreTokenized(
        lineNumber: number,
        expression: string,
        preTokenized: Token[]
    ): Value[] {
        // Filter markdown tokens as a defensive safety net.
        // ExpressionLexer never produces MD_* tokens, but this guard
        // prevents accidental breakage if the lexer mode changes.
        const tokens: Token[] = [];
        let hasParens = false;
        for (const t of preTokenized) {
            if (t.type === "LPAREN" || t.type === "RPAREN") hasParens = true;
            tokens.push(t);
        }

        // Directly invoke evaluateWithTokens, no lexing needed
        return [this.evaluateWithTokens(lineNumber, expression, tokens, hasParens)];
    }

    //#endregion

    //#region Internal, Parsing & compilation

    /**
     * Route parse+compile to the active parser (PrecedenceParser or Recursive Descent).
     *
     * Sets up the builder on the active parser, loads tokens, and calls
     * parseExpression(). Abstracts the API difference between the two parsers:
     * - PrecedenceParser:  parser.setBuilder(builder); parser.parseExpression(0)
     * - RD:                parser.builder = builder; parser.parseExpression(0)
     *
     * @param allowLabelFallback - Whether a line that does not parse whole may
     * be retried as "&lt;label&gt;: &lt;expression&gt;". True for a real line, false for
     * the retries that fallback makes itself, which is what stops it costing
     * exponential time; see the loop below, and the comment on its recursive
     * call for the measurement.
     */
    private parseExpression(builder: BytecodeBuilder, tokens: Token[], hasParens?: boolean, allowLabelFallback = true): void {
        this.parser.setBuilder(builder);
        // When autoBalanceParens is disabled, skip the O(n) paren-count scan
        // by always passing false, the parser will fail naturally on unmatched
        // parens instead of silently inserting missing closing/opening tokens.
        this.parser.load(tokens, this.config.validation.autoBalanceParens ? hasParens : false);
        this.parser.parseExpression(0);

        // parseExpression() stops as soon as it has one complete top-level
        // expression, it never checked whether that consumed the WHOLE
        // token list. Any leftover tokens (a stray trailing number, an
        // unconsumed comma-and-digits from a malformed "thousands"-looking
        // literal, a typo'd second operand with a missing operator, ...)
        // were silently discarded rather than surfaced: "5 3" evaluated to
        // a confident "5", "1,2345" to a confident "1", with no indication
        // anything was wrong. Requiring full consumption turns every one
        // of those into a real, visible parse error instead.
        const leftover = this.parser.peek();
        if (leftover) {
            // A single trailing bare "=" with nothing after it (e.g.
            // "355/113=") is tolerated rather than treated as an error.
            // EQUALS is never registered as an infix operator anywhere in
            // this grammar (confirmed, nothing consumes it after a
            // complete expression), so it can't be a legitimate second
            // operand or a typo'd continuation the way a stray number or
            // identifier could be; it's an unambiguous "show the result"
            // marker familiar from pocket calculators and other apps in
            // this category (see GitHub issue #65). This is deliberately
            // narrower than tolerating arbitrary trailing tokens, which
            // would reopen the exact silently-wrong-answer bug this same
            // check was added to close (see this function's own doc
            // comment above).
            if (leftover.type === "EQUALS" && !this.parser.peekAt(1)) {
                return;
            }

            // Labeled-line fallback: "<label>: <expression>", e.g. "pi
            // approximation: 355/113" (see GitHub issue #65). Only
            // attempted once the whole-line parse has ALREADY failed, so
            // it can never change behavior for a line that already
            // worked. VALID clock times ("9:30"), lap times ("03:04:05"),
            // and ":name = value" variable definitions all consume their
            // colon(s) internally during lexing and never produce a real
            // COLON token, confirmed directly against the token stream
            // not assumed, so this can't misfire on any of them. Only a
            // genuine COLON token past position 0 counts (position 0 is
            // reserved for the existing leading-colon variable syntax).
            //
            // The word VALID is load-bearing, and used not to be here. An
            // out-of-range clock time does leave a real COLON token behind,
            // which landed it in this fallback and had it answered with
            // whatever stood to the right of the colon: "24:00" answered 0,
            // "9:60" answered 60, "100:5" answered 5. Those are ordinary
            // things to type ("24:00" is a normal way to write the end of a
            // day, "9:60" is a normal typo) and every one of them came back
            // as a confident number with no hint that the time had been
            // thrown away, so the numeric case is now refused outright, see
            // the guard in the loop below.
            //
            // Tries every colon position from rightmost to leftmost, not
            // just the last one: a label can itself precede a
            // ":name = value" definition ("input value: :x = 5"), whose
            // OWN leading colon would otherwise be the rightmost colon in
            // the line, slicing right after it strips the colon
            // VariableParselet needs to recognize a definition at all,
            // leaving a bare "x = 5" that fails to parse. Falling back to
            // the next colon to the left ("value:") keeps ":x = 5" intact.
            for (let i = allowLabelFallback ? tokens.length - 1 : 0; i >= 1; i--) {
                if (tokens[i].type !== "COLON") continue;
                if (i + 1 >= tokens.length) continue;

                // Nothing but numbers to the left of the colon means this is
                // not a label at all: it is a time, a lap time or a timecode
                // that the normalizer refused to fuse because one of its
                // fields is out of range. A label is prose ("pi
                // approximation:", "total:"), and the labelled lines this
                // fallback exists for all have a word in front of the colon.
                // Reading "24:00" as the label "24" and the expression "00"
                // is never what was meant, so it is an error rather than an
                // answer.
                let labelIsAllNumeric = true;
                for (let j = 0; j < i; j++) {
                    const type = tokens[j].type;
                    if (type !== "NUMBER" && type !== "COLON") {
                        labelIsAllNumeric = false;
                        break;
                    }
                }
                if (labelIsAllNumeric) {
                    // Rebuilt from the tokens rather than sliced out of the
                    // source, which this level does not have. Everything up
                    // to and including the field after the colon, so
                    // "24:00 + 1" names "24:00" and not the whole line.
                    const literal = tokens.slice(0, i + 2).map((t) => t.value).join("");
                    throw ErrorFactory.parsing(
                        "INVALID_TIME_LITERAL",
                        `"${literal}" is not a valid time`,
                        { tokenType: tokens[i].type, tokenValue: literal }
                    );
                }

                builder.reset();
                try {
                    // `false`: the retry gets a plain parse, with no fallback
                    // of its own. It used to get the full one, and that made
                    // this loop cost exponential time for no extra coverage.
                    //
                    // A retry on `tokens.slice(i + 1)` that ran its own
                    // fallback would try the suffix after each colon j > i,
                    // which is `tokens.slice(j + 1)`, which is a slice THIS
                    // loop already tried on an earlier iteration, since it
                    // walks rightmost-first and j > i. So every level below
                    // the first re-attempted parses that had already failed,
                    // and each of those levels re-attempted them again: a line
                    // with k colons compiled 2^k times. Measured on a
                    // 723-character fuzz case with 19 colons: 524,288 parse
                    // attempts, 18 seconds, and then the line was REJECTED. A
                    // host evaluating per keystroke froze for that long.
                    //
                    // Nothing is lost by cutting it. The suffixes the deeper
                    // levels reached are exactly the ones this loop visits
                    // itself, in the same rightmost-first order.
                    this.parseExpression(builder, tokens.slice(i + 1), hasParens, false);
                    return;
                } catch {
                    // This colon's fragment didn't parse cleanly either
                    // try the next one to the left before giving up.
                }
            }

            throw ErrorFactory.parsing({
                code: "UNEXPECTED_TRAILING_TOKEN",
                message: `Unexpected token after expression: "${leftover.value}"`,
                context: { tokenType: leftover.type, tokenValue: leftover.value },
                span: { start: leftover.offset, end: leftover.sourceEnd ?? leftover.offset + leftover.text.length, line: leftover.line, col: leftover.col },
            });
        }
    }

    //#region Symbolic algebra, `=>` and bare equation-statement grammar

    /**
     * Compiles a standalone token list into a fresh, independent
     * `BytecodeProgram`, used for a `=>`-triggered expression and for a
     * bare equation's own right-hand side. Reuses {@link parseExpression}
     * (the SAME "compile a token list into a builder, then check for
     * leftover trailing tokens" logic every ordinary line already goes
     * through), just with a throwaway builder instead of the pooled one
     * (this grammar is rare, a per-call allocation here is a non-issue).
     */
    private compileAdHoc(tokens: Token[]): BytecodeProgram {
        const builder = new BytecodeBuilder(this.pluginFunctionIndexByName);
        this.parseExpression(builder, tokens);
        return builder.build();
    }

    /**
     * Executes an already-compiled program in symbolic-tolerant mode (an
     * undefined variable becomes a `Symbolic` placeholder instead of
     * throwing `UNDEFINED_VARIABLE`. See `vm/VM.ts`'s `executeBytecode()`
     * doc comment on its own `symbolicTolerant` parameter). Used by both
     * the "just simplify this" `=>` mode and bare equation evaluation
     * (a bare assignment's RHS, and an equation's own RHS at solve time)
     *, every one of these needs forward-tolerant reads of not-yet-defined
     * names, which ordinary evaluation deliberately never allows.
     *
     * `lineNumber` is the 1-based document line this program belongs to, so
     * the RHS still receives a {@link makeLineContext}, a bare assignment's
     * right-hand side (`total = prev`, `x = line2`) can therefore read
     * cross-line results exactly as a bare expression line does. Defaults to
     * `-1` (the "no real document" sentinel) for the expression-level and
     * `=>`-without-a-document callers, which naturally yields the same
     * `LINE_REF_NO_DOCUMENT` a single-expression eval already returns.
     */
    private executeSymbolicTolerant(program: BytecodeProgram, lineNumber: number = -1): Value {
        const result = executeBytecode(program, this.vm, undefined, undefined, this.makeLineContext(lineNumber), true);
        if (result.type === 'error') throw result.error;
        if (result.type === 'pending') {
            throw ErrorFactory.execution(
                'THEREFORE_ASYNC_UNSUPPORTED',
                `"=>" doesn't support expressions that call an async operation (weather/stocks/currency).`,
            );
        }
        return result.value;
    }

    /** Compiles and executes `tokens` in symbolic-tolerant mode, the "just simplify this" `=>` fallback when there's no stored equation to solve. `lineNumber` (1-based, `-1` outside a document) is forwarded so a bare assignment's RHS can resolve cross-line references. */
    private simplifySymbolically(tokens: Token[], lineNumber: number = -1): Value {
        return this.executeSymbolicTolerant(this.compileAdHoc(tokens), lineNumber);
    }

    /**
     * Parses a bare (colon-less) equation's left-hand side, `factor1 *
     * factor2 * ... * variable`, into an ordered list of bare names, or
     * `null` if `tokens` isn't EXACTLY that shape (an alternating
     * `IDENT/UNIT`, `STAR`, `IDENT/UNIT`, `STAR`, ... sequence with no
     * other token types). Returning `null` means "don't intercept this
     * line at all", it falls through to whatever the ordinary expression
     * grammar already does with a bare `=` in it (today: a clear parse
     * error), so this pattern-match can only ever ADD a new capability,
     * never take one away.
     *
     * Requiring `IDENT`/`UNIT` at every name position is what keeps this
     * safe from the reserved-keyword collision risk `VariableParselet.ts`
     * guards against for the colon-prefixed form: a genuinely reserved
     * word (`clamp`, `global`, ...) always lexes as ITS OWN token type,
     * never `IDENT`/`UNIT`, so it can never satisfy this pattern, the
     * same protection, for free, without a duplicated keyword list.
     */
    private parseFactorChain(tokens: Token[]): string[] | null {
        if (tokens.length === 0 || tokens.length % 2 === 0) return null;
        const names: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
            if (i % 2 === 0) {
                if (tokens[i].type !== 'IDENT' && tokens[i].type !== 'UNIT') return null;
                names.push(tokens[i].value);
            } else {
                if (tokens[i].type !== 'STAR') return null;
            }
        }
        return names;
    }

    /**
     * Solves a stored equation, `variable = inv(factor1*factor2*...) *
     * rhs`. Every step is symbolic-aware (`vm/MatrixOps.ts`'s
     * `matrixMultiply()`/`inverse()`), so a factor whose OWN cells are
     * still-unassigned free variables (`s = [sx,0,0;...]`) solves
     * correctly, producing a Matrix whose cells are algebraic formulas
     * rather than plain numbers. Errors (a missing factor, a non-Matrix
     * factor/RHS, a singular combined matrix) are returned as `Error`-typed
     * Values, not thrown, matching this engine's established "matrix
     * errors propagate as values" convention (DIMENSION_MISMATCH,
     * SINGULAR_MATRIX, ...).
     */
    private solveEquation(equation: EquationDef, lineNumber: number = -1): Value {
        const factorValues: Value[] = [];
        for (const name of equation.factorNames) {
            const v = this.vm.getVar(name);
            if (v === undefined) {
                return errorValue(
                    'EQUATION_FACTOR_UNDEFINED',
                    `Cannot solve for "${equation.variable}": "${name}" is not yet defined.`,
                );
            }
            if (v.type !== ValueType.Matrix) {
                return errorValue(
                    'EQUATION_FACTOR_NOT_MATRIX',
                    `Cannot solve for "${equation.variable}": "${name}" must be a Matrix (got a different value type).`,
                );
            }
            factorValues.push(v);
        }

        let combined = factorValues[0].value as MatrixData;
        for (let i = 1; i < factorValues.length; i++) {
            const product = matrixMultiply(combined, factorValues[i].value as MatrixData);
            if (product.type === ValueType.Error) return product;
            combined = product.value as MatrixData;
        }

        const inv = inverse(combined);
        if (inv.type === ValueType.Error) return inv;

        const rhsValue = this.executeSymbolicTolerant(equation.rhsProgram, lineNumber);
        if (rhsValue.type !== ValueType.Matrix) {
            return errorValue(
                'EQUATION_RHS_NOT_MATRIX',
                `Cannot solve for "${equation.variable}": the right-hand side must be a Matrix.`,
            );
        }

        return matrixMultiply(inv.value as MatrixData, rhsValue.value as MatrixData);
    }

    /**
     * Detects and handles this session's two new symbolic-algebra grammar
     * shapes on `normalizedTokens`, returning the computed result directly
     * (bypassing ordinary bytecode compilation/caching entirely, since
     * BOTH shapes have effects, a stored equation, a direct variable
     * assignment, that a cached bytecode program can't represent) or
     * `null` if neither shape matches (meaning ordinary processing should
     * proceed exactly as it did before this feature existed):
     *
     * 1. `<bareIdent> =>` or `<expr> =>`, trailing `THEREFORE`. A bare
     *    identifier with a STORED equation solves it (see
     *    {@link solveEquation}); anything else (including a bare
     *    identifier with NO stored equation) runs in symbolic-tolerant
     *    mode and simplifies (see {@link simplifySymbolically}), a
     *    near-free "just simplify this" mode.
     * 2. `factor1*factor2*...*variable = rhs`, a bare (colon-less), NOT
     *    already colon/global-prefixed, top-level `EQUALS` whose LHS
     *    matches {@link parseFactorChain}'s narrow pattern. A single bare
     *    name (`s = [sx,0,0;...]`) is an ORDINARY (colon-less) assignment
     *, its RHS is ALWAYS evaluated symbolic-tolerantly (so a matrix
     *    literal with still-unassigned entries assigns successfully,
     *    carrying those free variables as real symbolic cells) and stored
     *    via `vm.setVar()`. Two or more names (`s*t*v = rhs`) stores a
     *    genuine equation keyed by the LAST name (`v`), solved later via
     *    shape 1 above.
     *
     * This is a deliberately narrow pattern match, not a general equation
     * solver. See `OpRegistry.ts`'s `EquationDef` doc comment and this
     * session's own Phase H.2 scope decision (full symbolic MATRICES, not
     * a general CAS).
     */
    /**
     * Registers a document-scoped user unit from a `1 <name> = <n> <unit>` line
     * and returns the `<name> defined` confirmation, or `null` when the line is
     * not a unit definition (so ordinary processing continues unchanged).
     *
     * Like the symbolic-grammar shapes it sits beside, this has an effect (a
     * stored definition) that no cached bytecode program could represent, so it
     * short-circuits compilation the same way. See {@link UserUnitTable}.
     *
     * The pattern is kept deliberately narrow so it cannot swallow an equation:
     *
     * - The coefficient must be exactly `1`. `2 x = 10` stays a scalar equation
     *   (`x =>` solves it); only the natural `1 sprint = 2 weeks` shape is a
     *   definition.
     * - The name is one or more identifiers, never a built-in unit (those lex as
     *   UNIT, not IDENT), so a built-in unit cannot be redefined.
     * - The base must be a recognized unit (a UNIT token). A non-unit right side
     *   declines here and is left to whatever handled it before, so a defined
     *   unit is always dimensioned, never free-standing.
     *
     * `tokens` are already normalized, so the implicit-multiply pass has usually
     * inserted a STAR between the coefficient and the name (`1 * sprint`); it is
     * tolerated and skipped.
     */
    private tryDefineUserUnit(tokens: Token[]): Value | null {
        // Shortest definition is NUMBER IDENT EQUALS NUMBER UNIT.
        if (tokens.length < 5) return null;
        if (tokens[0].type !== 'NUMBER' || Number(tokens[0].value) !== 1) return null;

        let i = 1;
        // The implicit-multiply STAR between the coefficient and the name.
        if (tokens[i].type === 'STAR') i++;

        const nameWords: string[] = [];
        while (i < tokens.length && tokens[i].type === 'IDENT') {
            nameWords.push(tokens[i].value);
            i++;
        }
        if (nameWords.length === 0) return null;

        if (tokens[i]?.type !== 'EQUALS') return null;
        i++;
        if (tokens[i]?.type !== 'NUMBER') return null;
        const ratioToken = tokens[i];
        i++;
        if (tokens[i]?.type !== 'UNIT') return null;
        const baseToken = tokens[i];
        i++;
        // A definition is the whole line: anything trailing means this is some
        // other construct that merely starts the same way.
        if (i !== tokens.length) return null;

        this.userUnits.define(nameWords, ratioToken.value, baseToken.value);
        // A user unit is expanded at parse time, so the compiled bytecode for
        // any line using one depends on the definitions in scope, which the
        // cache key (the raw expression text) does not capture. A new or changed
        // definition therefore invalidates every cached program, so a later
        // `6 sprints` recompiles against this definition rather than a stale one.
        // Definition lines are rare, so this clear is not on any hot path.
        this.clearCompiledCache();
        return stringValue(`${nameWords.join(' ')} defined`);
    }

    /**
     * `name += expr` / `name -= expr`, a running total. The accumulator reads
     * its current value, adds or subtracts the right-hand side, stores the
     * result, and answers with the new value, so a note becomes a live ledger
     * where each line adjusts a balance in place. Returns null to decline
     * anything that is not the compound shape.
     *
     * Handled here, in the same effectful, cache-bypassing channel as
     * {@link tryDefineUserUnit} and the bare `count = 10` assignment (see
     * {@link trySymbolicGrammar}), rather than as a parselet: a bare identifier
     * is a Tier-1 prefix that emits `LOAD_VAR name` before any infix parselet on
     * `+=` could run, and that pre-emitted load throws UNDEFINED_VARIABLE for a
     * first-use accumulator. Seeding 0 for a first `+=`/`-=` is a one-line
     * `getVar`/`setVar` here where it cannot be from a parselet, a deliberate
     * departure from a plain reference, which still reports the undefined name.
     *
     * The right-hand side is parenthesised and run through the ORDINARY (not
     * symbolic-tolerant) path, so `bal += 3 * 4` is `bal + 12`, a genuine typo in
     * it (`total += nope`) is a real UNDEFINED_VARIABLE, and the accumulation
     * goes through the VM's own ADD/SUB: money stays money, a unit stays its
     * unit, and the seed 0 added to a typed right-hand side takes that type on
     * first use. The colon (`:name`) and `global :name` grammars are untouched:
     * they lex their own leading token, never IDENT/UNIT, so they decline here.
     */
    private tryCompoundAssignment(tokens: Token[], lineNumber: number = -1): Value | null {
        if (tokens.length < 2) return null;
        const nameTok = tokens[0];
        const opTok = tokens[1];
        const isName = nameTok.type === 'IDENT' || nameTok.type === 'UNIT';
        const isCompound = opTok.type === 'PLUS_EQUALS' || opTok.type === 'MINUS_EQUALS';
        if (!isName || !isCompound) return null;

        const rhs = tokens.slice(2);
        if (rhs.length === 0) {
            throw ErrorFactory.parsing(
                'COMPOUND_ASSIGN_REQUIRES_EXPRESSION',
                `"${nameTok.value} ${opTok.value}" needs an expression on the right, e.g. "${nameTok.value} ${opTok.value} 10".`,
            );
        }

        const name = nameTok.value;
        // Remember this name is an accumulator, so a batch document pass can
        // reset it before re-evaluating (see parseDocument): the seed below
        // only fires when the name is undefined, which after the first pass it
        // no longer is, so without the reset the total would read its own
        // previous pass's value and double-count on every keystroke.
        this.accumulatorNames.add(name);
        // A first `+=`/`-=` on an unknown name seeds 0, so a ledger can open
        // straight into `spent += 10` without an UNDEFINED_VARIABLE.
        if (this.vm.getVar(name) === undefined) this.vm.setVar(name, numberValue(0));

        const op = opTok.type === 'PLUS_EQUALS' ? { type: 'PLUS', text: '+' } : { type: 'MINUS', text: '-' };
        // `name <op> ( rhs )`: the accumulator is read as an ordinary IDENT so a
        // unit-letter name (`b`, `s`) loads its variable rather than a unit, and
        // the parentheses give the right-hand side its own precedence (`bal += 3
        // * 4` is bal + 12, `bal -= 1 + 2` is bal - 3).
        const accTokens: Token[] = [
            createFusedToken('IDENT', name, [nameTok]),
            createFusedToken(op.type, op.text, [opTok]),
            createFusedToken('LPAREN', '(', [opTok]),
            ...rhs,
            createFusedToken('RPAREN', ')', [opTok]),
        ];

        const result = executeBytecode(
            this.compileAdHoc(accTokens), this.vm, undefined, undefined, this.makeLineContext(lineNumber), false,
        );
        if (result.type === 'error') throw result.error;
        if (result.type === 'pending') {
            throw ErrorFactory.execution(
                'COMPOUND_ASSIGN_ASYNC_UNSUPPORTED',
                `A running total (+= / -=) cannot use an async operation (weather/stocks/currency) on its right-hand side.`,
            );
        }
        this.vm.setVar(name, result.value);
        return result.value;
    }

    /**
     * Reset every running-total accumulator (`total += 5`) to undefined, and
     * return their names.
     *
     * An accumulator seeds 0 only while its name is undefined, then reads that
     * value on each `+=`/`-=`. A document is re-evaluated top-to-bottom on
     * every keystroke, so unless the name is cleared first the total reads its
     * own previous evaluation's value and grows without bound. The batch
     * document pass (`parseDocument`/`evaluateLines`) calls this at the start
     * of each pass; the incremental {@link ThreeTierEvaluator} calls it and
     * then marks the lines that touch each name dirty, since it re-runs lines
     * selectively rather than replaying the whole document.
     */
    resetAccumulators(): ReadonlySet<string> {
        for (const name of this.accumulatorNames) this.vm.deleteVar(name);
        return this.accumulatorNames;
    }

    private trySymbolicGrammar(normalizedTokens: Token[], lineNumber: number = -1): Value | null {
        if (normalizedTokens.length === 0) return null;

        const last = normalizedTokens[normalizedTokens.length - 1];
        if (last.type === 'THEREFORE') {
            const beforeTokens = normalizedTokens.slice(0, -1);
            if (beforeTokens.length === 0) {
                throw ErrorFactory.parsing('THEREFORE_REQUIRES_EXPRESSION', `"=>" needs an expression or variable name before it.`);
            }
            if (beforeTokens.length === 1 && (beforeTokens[0].type === 'IDENT' || beforeTokens[0].type === 'UNIT')) {
                // The matrix product-chain equation is checked FIRST and its
                // behaviour is unchanged. The scalar kind is only consulted when
                // that finds nothing, so the older path can never be diverted.
                const name = beforeTokens[0].value;
                const equation = this.vm.getEquation(name);
                const scalar = this.vm.getScalarEquation(name);
                if (equation) {
                    const solved = this.solveEquation(equation, lineNumber);
                    // A product chain of names is stored as a matrix equation
                    // on sight, since whether the factors are matrices is only
                    // knowable at solve time. When they turn out not to be,
                    // `a*n = 10` with a plain numeric `a` is an ordinary scalar
                    // equation, so fall through to that rather than leaving the
                    // user with "must be a Matrix" for a line that has a
                    // perfectly good answer. Every other failure (a missing
                    // factor, a singular matrix) still surfaces unchanged.
                    const isNotMatrix = solved.type === ValueType.Error && solved.value === 'EQUATION_FACTOR_NOT_MATRIX';
                    if (!isNotMatrix || !scalar) return solved;
                }
                if (scalar) {
                    return this.solveScalarEquation(scalar, lineNumber);
                }
            }
            return this.simplifySymbolically(beforeTokens, lineNumber);
        }

        // An algebra verb (`expand(...)`, and the later phases' `factor`/
        // `solve`) is itself a request to work symbolically, so it does not also
        // need a trailing `=>`. Without this, `expand((x+1)*(x+2))` on its own
        // line would hard-throw UNDEFINED_VARIABLE on `x` before ever reaching
        // the builtin. Placed after the THEREFORE branch so an explicit `=>`
        // still wins, and before the COLON/GLOBAL guard so the existing
        // assignment grammars stay untouched.
        if (containsSymbolicCall(normalizedTokens)) {
            return this.simplifySymbolically(normalizedTokens, lineNumber);
        }

        // Already the colon-prefixed (`:name = value`) or `global :name`
        // grammar, completely untouched, don't even attempt to match.
        if (normalizedTokens[0].type === 'COLON' || normalizedTokens[0].type === 'GLOBAL') return null;

        // A goal-seek line (`solve line N for <var> = <target>`) owns its own
        // `=`: the `= <target>` is part of that grammar, not an equation to
        // store. Declining here lets GoalSeekParselet parse the whole line,
        // rather than the scalar-equation detector below splitting on the `=`
        // and handing `solve line N for <var>` to a parselet that expects the
        // `=` to follow.
        if (normalizedTokens[0].type === 'GOAL_SEEK') return null;

        const eqIdx = normalizedTokens.findIndex(t => t.type === 'EQUALS');
        if (eqIdx === -1) return null;

        const names = this.parseFactorChain(normalizedTokens.slice(0, eqIdx));
        if (names === null) {
            // Not a product chain. It may still be a general scalar equation
            // (`x^2-4 = 0`), which is a strictly narrower attempt made only
            // after every existing shape has declined. See
            // {@link tryStoreScalarEquation} for what it refuses to swallow.
            return this.tryStoreScalarEquation(normalizedTokens, eqIdx);
        }

        const rhsTokens = normalizedTokens.slice(eqIdx + 1);

        if (names.length === 1) {
            const result = this.simplifySymbolically(rhsTokens, lineNumber);
            this.vm.setVar(names[0], result);
            return result;
        }

        const freeVar = names[names.length - 1];
        const factorNames = names.slice(0, -1);
        this.vm.defineEquation(freeVar, factorNames, this.compileAdHoc(rhsTokens));
        // Also stored as a scalar equation, so that `a*n = 10` with a numeric
        // `a` still has an answer. Which of the two kinds applies depends on
        // whether the factors are matrices, and that is not known until solve
        // time; storing both costs one extra compile of a line the user is
        // about to ask about anyway. The matrix kind is always tried first, so
        // this cannot change what an existing document does.
        this.vm.defineScalarEquation(freeVar, this.compileAdHoc(normalizedTokens.slice(0, eqIdx)), this.compileAdHoc(rhsTokens));
        return stringValue(`${freeVar} stored as an equation — solve with "${freeVar} =>"`);
    }

    /**
     * Stores a general scalar equation (`x^2 - 4 = 0`) keyed by its unknown, or
     * returns `null` to let ordinary processing continue.
     *
     * This is the riskiest pattern match in the file, because a bare `=` is
     * already claimed by three shipped grammars, and swallowing any of them
     * would break a working feature silently. Each is excluded deliberately:
     *
     * - **A user-defined function definition** (`f(x) = 2*x`). Its left side is
     *   a name followed by `(`, which no equation ever is, so a `LPAREN` in
     *   second position declines outright. This is the exclusion that matters
     *   most: `parseFactorChain` already returns `null` for it, so without this
     *   guard the definition grammar would be intercepted before the parser
     *   ever saw it.
     * - **A bare assignment** (`a = [1,2;3,4]`) and **a product-chain matrix
     *   equation** (`a*x = [60;70]`). Both are handled by `parseFactorChain`
     *   above and never reach here.
     * - **A colon-prefixed or global assignment**. Excluded earlier still.
     *
     * Two further conditions narrow it to genuine equations. There must be
     * exactly one top-level `=` (an `==` comparison lexes as `EQUALITY`, a
     * different token, so it cannot collide), and at least one side must carry
     * an unknown. Without that last check `2+2 = 4` would become an equation
     * with no variable and report an identity, where today it is a parse error;
     * changing an unrelated line's behaviour is not this feature's business.
     *
     * @param normalizedTokens - The whole line's normalized tokens.
     * @param eqIdx - Index of the first `EQUALS` token.
     * @returns A confirmation value when stored, or `null` to decline.
     */
    private tryStoreScalarEquation(normalizedTokens: Token[], eqIdx: number): Value | null {
        if (normalizedTokens[1]?.type === 'LPAREN') return null;
        if (eqIdx === 0 || eqIdx === normalizedTokens.length - 1) return null;

        const lhsTokens = normalizedTokens.slice(0, eqIdx);
        const rhsTokens = normalizedTokens.slice(eqIdx + 1);
        if (rhsTokens.some(t => t.type === 'EQUALS')) return null;

        const unknowns = this.equationUnknowns(lhsTokens, rhsTokens);
        if (unknowns.length !== 1) return null;

        const variable = unknowns[0];
        this.vm.defineScalarEquation(variable, this.compileAdHoc(lhsTokens), this.compileAdHoc(rhsTokens));
        return stringValue(`${variable} stored as an equation — solve with "${variable} =>"`);
    }

    /**
     * The names in an equation that have no value yet, which is what makes them
     * the thing to solve for.
     *
     * A name that already holds a value is not an unknown: in `y = 2` followed
     * by `x + y = 5`, only `x` is being solved for. A name that is a defined
     * function is likewise excluded, so a call to one never looks like an
     * unknown.
     *
     * @param lhsTokens - Left-hand side tokens.
     * @param rhsTokens - Right-hand side tokens.
     * @returns The distinct unassigned names, in first-seen order.
     */
    private equationUnknowns(lhsTokens: Token[], rhsTokens: Token[]): string[] {
        const unknowns: string[] = [];
        for (const token of [...lhsTokens, ...rhsTokens]) {
            if (token.type !== 'IDENT' && token.type !== 'UNIT') continue;
            if (this.vm.getVar(token.value) !== undefined) continue;
            if (this.vm.hasUserFunction(token.value)) continue;
            if (!unknowns.includes(token.value)) unknowns.push(token.value);
        }
        return unknowns;
    }

    /**
     * Solves a stored scalar equation via `symbolic/Solve.ts`.
     *
     * Both sides are evaluated symbolic-tolerantly first, so the unknown
     * survives as a `Symbolic` value rather than throwing, and a side that
     * reduces to a plain number is lifted into the symbolic domain to match.
     *
     * @param equation - The stored equation.
     * @returns The solution, rendered by the same helper `solve()` uses, so the
     * two surfaces cannot disagree about how an outcome reads.
     */
    private solveScalarEquation(equation: ScalarEquationDef, lineNumber: number = -1): Value {
        const lhs = this.executeSymbolicTolerant(equation.lhsProgram, lineNumber);
        const rhs = this.executeSymbolicTolerant(equation.rhsProgram, lineNumber);
        return solveEquationValues(lhs, rhs, equation.variable);
    }

    //#endregion

    /**
     * Lex an expression via `resetExpression` (skips `classifyLine`
     * callers already know this is an expression), filtering out COMMENT
     * tokens (they have no parselet) and tracking whether any paren was
     * seen. Shared by every lex-then-{@link prepareExpression} call site:
     * {@link compileExpression}, {@link tryCompileExpression}, and
     * {@link evaluateExpressionWithDiagnostic}. `onToken`, when given, is
     * called once per emitted (already-filtered) token, used ONLY by the
     * diagnostic path to fire its per-token `TokenEmitted` events; every
     * other caller omits it.
     */
    private lexToTokens(expression: string, onToken?: (t: Token) => void, skipWhenCompiled = true): { tokens: Token[]; hasParens: boolean; compiled: boolean } {
        const tokens: Token[] = [];
        let hasParens = false;
        // An expression whose program and front half are both cached, or whose
        // parse is known to fail, is not lexed again: prepareExpression()
        // answers from the cache before it looks at the tokens, so producing
        // them would be pure cost. Skipped
        // only when nobody is listening for the tokens themselves, which is a
        // diagnostic collector (`onToken`) or explainLine (`skipWhenCompiled`
        // false), both of which want the real stream. `compiled` tells the
        // caller the empty array is a skip, not an empty line.
        if (skipWhenCompiled && !onToken && this.frontHalfCached(expression)) {
            return { tokens, hasParens, compiled: true };
        }
        this.lexer.resetExpression(expression);
        for (const t of this.lexer) {
            if (t.type === 'COMMENT') continue;
            if (t.type === "LPAREN" || t.type === "RPAREN") hasParens = true;
            tokens.push(t);
            onToken?.(t);
        }
        return { tokens, hasParens, compiled: false };
    }

    /**
     * Shared pipeline front-half: safety checks → COMMENT filter →
     * normalize → complexity → read/write extraction → bytecode cache
     * lookup or parse+compile.
     *
     * Used by {@link evaluateWithTokens} (which continues into preflight +
     * execution) and {@link compileExpression} (compile-only). Previously
     * both carried their own copy of this sequence, which had already
     * drifted. Returns a discriminated union instead of throwing so each
     * caller decides whether/how to re-throw.
     *
     * The `'error'` variant carries the actual `EngineError` each safety
     * check or `parseExpression()` itself already constructed, not just
     * its flattened `.message` (the previous shape). A parse failure in
     * particular can be any of dozens of specific codes (UNDEFINED_VARIABLE,
     * NO_PREFIX_PARSELET, FUNCTION_ARITY_MISMATCH, ...), each with its own
     * `expected`/`found`/`suggestion` detail, callers used to discard all
     * of that and reconstruct a generic EVALUATION_ERROR/PARSE_ERROR wrapper
     * around just the message, which directly worked against this session's
     * "errors are verbose and easy to understand" goal. Callers should
     * generally just `throw prep.error` (see {@link evaluateWithTokens},
     * {@link compileExpression}) rather than wrapping it again.
     *
     * `onFusion`, when given, is passed straight through to the normalizer's
     * own optional per-fusion callback, used ONLY by
     * {@link evaluateExpressionWithDiagnostic} to observe individual token
     * fusions for its `normalizer` diagnostic stage. Omitted by every other
     * caller, with zero behavior change (identical to not passing a 2nd
     * argument to `normalizer.normalize()` at all).
     *
     * The `'error'` variant's `normalizedTokens` is populated whenever
     * normalization already ran before the failure (`'complexity'`/`'parse'`
     * stages), `undefined` when it failed before tokens were even considered
     * (`'length'` stage), lets {@link evaluateExpressionWithDiagnostic}
     * reconstruct its own diagnostic-stage payloads (which need the
     * normalized tokens to recompute a display-only complexity score) without
     * re-deriving them by hand.
     *
     * The `'ready'` (uncached) variant's `parserAlloc` is the
     * `AllocationTracker.track('parser', ...)` result for JUST the actual
     * parse+build call (`null` whenever `AllocationTracker.isEnabled()` is
     * false, or on a cache hit, no parsing happened). This has to be
     * measured HERE, not reconstructed by a caller after the fact: unlike
     * every other diagnostic field, a heap-delta measurement only means
     * anything over the EXACT span it's wrapped around, wrapping the
     * whole `prepareExpression()` call from the outside (as
     * {@link evaluateExpressionWithDiagnostic} briefly did) widens that span
     * to also cover normalize/complexity-check/cache-lookup, which measurably
     * produced negative-allocation readings (a GC sweep landing inside the
     * wider window) in `AllocationTracker.spec.ts` well over half the time.
     */
    private prepareExpression(
        expression: string,
        tokens: Token[],
        hasParens: boolean | undefined,
        onFusion?: (fusion: TokenFusion) => void,
        lineNumber: number = -1,
    ):
        | { kind: 'empty' }
        | { kind: 'error'; stage: 'length' | 'complexity' | 'parse'; error: EngineError; reads?: string[]; writes?: string[]; normalizedTokens?: Token[] }
        | { kind: 'ready'; normalizedTokens: Token[]; reads: string[]; writes: string[]; program: BytecodeProgram; cached: boolean; parserAlloc?: StageAllocation | null }
        | { kind: 'symbolic-solve'; normalizedTokens: Token[]; value: Value; reads?: string[]; writes?: string[] } {
        // ══ COMPILED BEFORE: skip the whole front half ══
        // A program in the cache was compiled from exactly this string, so it
        // passed the length and complexity checks, was not one of the
        // effectful shapes (those never reach the cache), and its normalised
        // tokens and reads/writes are what the front half would produce
        // again. See `compiledFrontHalf` for why this sits first. Not taken
        // when a diagnostics collector is listening for fusion events, which
        // only the real normaliser pass can fire.
        const compiledProgram = this.bytecodeCache.get(expression);
        if (compiledProgram && !onFusion) {
            const front = this.compiledFrontHalf.get(expression);
            if (front) {
                return { kind: 'ready', normalizedTokens: front.normalizedTokens, reads: front.reads, writes: front.writes, program: compiledProgram, cached: true };
            }
        }

        // ══ FAILED BEFORE: skip to the effectful tries ══
        // See `failedParses`: the front half is known and the parse is known
        // to throw, but the effectful tries below read the VM and run again.
        const failed = onFusion ? undefined : this.failedParses.get(expression);

        let normalizedTokens: Token[];
        if (failed) {
            normalizedTokens = failed.normalizedTokens;
        } else {
            // ══ SAFETY CHECK 1: Expression length limit ══
            const lengthCheck = checkExpressionLength(expression, this.config.validation);
            if (!lengthCheck.passed) {
                return { kind: 'error', stage: 'length', error: lengthCheck.error!.engineError! };
            }

            // Filter COMMENT tokens, they have no parselet.
            const exprTokens = tokens.filter(t => t.type !== 'COMMENT');
            if (exprTokens.length === 0) {
                return { kind: 'empty' };
            }

            // ══ NORMALIZER ══
            // Phrase fusion, implicit multiply, domain token merging.
            normalizedTokens = this.normalizer.normalize(exprTokens, onFusion);

            // ══ SAFETY CHECK 2: Complexity scoring ══
            const complexityCheck = checkExpressionComplexity(normalizedTokens, this.config.validation);
            if (!complexityCheck.passed) {
                return { kind: 'error', stage: 'complexity', error: complexityCheck.engineError!, normalizedTokens };
            }
        }

        // ══ SYMBOLIC ALGEBRA: `=>` / bare equation-statement grammar ══
        // Bypasses bytecode caching entirely, both shapes have effects
        // (a stored equation, a direct vm.setVar()) a cached program can't
        // represent. See trySymbolicGrammar()'s own doc comment.
        // The symbolic grammar parses its own operand sub-ranges (see
        // simplifySymbolically/compileAdHoc), so it can throw the parser's
        // errors from here, ahead of the try/catch guarding the main parse
        // below. Caught into the same 'parse' result every other failure in
        // this method returns, because a throw escaping prepareExpression
        // reaches tryCompileExpression(), which is documented as a
        // non-throwing boolean and is called by LanguageService on every
        // visible line on every keystroke. `total =` is a line half-typed on
        // the way to `total = 5`, and it took the editor down.
        let symbolicResult: Value | null;
        // A compound assignment (`total += 5`) reads and writes its own name,
        // unlike the other symbolic shapes whose effect the DAG deliberately
        // cannot track. It MUST surface those reads/writes: without a write
        // registered, the incremental evaluator never checkpoints the line, so
        // its own value is never reset before a re-run and the running total
        // double-counts on every edit; and dependent lines never re-evaluate.
        let compoundReadsWrites: { reads: string[]; writes: string[] } | null = null;
        try {
            // A user-unit definition (`1 sprint = 2 weeks`) is an effectful line
            // like the symbolic shapes below, so it rides the same non-bytecode
            // channel. Checked first, so it claims its narrow pattern before the
            // scalar-equation grammar sees the bare `=`.
            symbolicResult = this.tryDefineUserUnit(normalizedTokens);
            if (symbolicResult === null) {
                const compound = this.tryCompoundAssignment(normalizedTokens, lineNumber);
                if (compound !== null) {
                    symbolicResult = compound;
                    compoundReadsWrites = extractReadsAndWrites(normalizedTokens);
                }
            }
            if (symbolicResult === null) {
                symbolicResult = this.trySymbolicGrammar(normalizedTokens, lineNumber);
            }
        } catch (e) {
            // reads/writes supplied for the same reason the main parse's catch
            // supplies them: the line names variables even though it does not
            // yet parse, so a caller tracking dependencies can re-evaluate it
            // once the user finishes typing.
            const { reads, writes } = extractReadsAndWrites(normalizedTokens);
            return { kind: 'error', stage: 'parse', error: normalizeUnknownError(e), reads, writes, normalizedTokens };
        }
        if (symbolicResult !== null) {
            return { kind: 'symbolic-solve', normalizedTokens, value: symbolicResult, reads: compoundReadsWrites?.reads, writes: compoundReadsWrites?.writes };
        }
        if (failed) {
            return { kind: 'error', stage: 'parse', error: failed.error, reads: failed.reads, writes: failed.writes, normalizedTokens };
        }

        const { reads, writes } = extractReadsAndWrites(normalizedTokens);

        // ══ BYTECODE CACHE / PARSE+COMPILE ══
        // Reached with a cached program only when its front half is missing
        // (an entry restored from a snapshot); remember it now, so the next
        // evaluation takes the early return above.
        if (compiledProgram) {
            this.compiledFrontHalf.set(expression, { normalizedTokens, reads, writes });
            return { kind: 'ready', normalizedTokens, reads, writes, program: compiledProgram, cached: true };
        }

        // Get a pooled builder, avoids 4 heap allocations per expression
        const builder = this.builderPool[this.builderPoolIndex++ % this.builderPool.length];
        builder.reset();
        let program: BytecodeProgram;
        let parserAlloc: StageAllocation | null = null;
        try {
            // build() allocates TypedArrays directly from builder arrays
            // a single copy (builder → TypedArray). Wrapped together with
            // parseExpression() under one 'parser' allocation measurement,
            // matching the exact span this file's diagnostic path has always
            // measured (see this method's own doc comment on `parserAlloc`).
            const parseResult = AllocationTracker.track('parser', () => {
                this.parseExpression(builder, normalizedTokens, hasParens);
                return builder.build();
            });
            program = parseResult.result;
            parserAlloc = parseResult.alloc;
        } catch (e) {
            // reads/writes were already extracted above from the full token
            // list (independent of whether parsing succeeds), returned
            // alongside the error (not merged into its context here, since
            // EngineError.context is readonly) so callers that track
            // dependencies (ThreeTierEvaluator's compile-fallback DAG
            // registration, via compileExpression()'s merge below) still
            // learn what this line references and can re-evaluate it once
            // those variables become defined.
            const error = normalizeUnknownError(e);
            this.rememberFailedParse(expression, { error, normalizedTokens, reads, writes });
            return { kind: 'error', stage: 'parse', error, reads, writes, normalizedTokens };
        }

        this.cacheBytecode(expression, program, { normalizedTokens, reads, writes });
        return { kind: 'ready', normalizedTokens, reads, writes, program, cached: false, parserAlloc };
    }

    /**
     * Shared async-resolver preflight check, run before VM execution.
     *
     * O(1) guard: skips the O(n) resolver scan when the bytecode has no
     * async opcodes AND no resolvers are registered. Either condition alone
     * is enough to warrant a preflight scan:
     *   - program.hasAsync: bytecode contains CALL_PLUGIN (async VM path)
     *   - resolverRegistry.size > 0: resolvers may intercept any expression
     * For purely sync expressions (e.g., `2 + 2`) with no resolvers, this is
     * an O(1) fast-path that bypasses the resolver scan entirely.
     *
     * If any registered resolver says "data not ready", registers a DAG
     * data-source dependency, stores a Pending result, and fires async
     * resolution (fire-and-forget, resolves later, re-evaluates on
     * completion), the caller should skip VM execution entirely and return
     * the pending Value as-is. Otherwise the caller should proceed to
     * {@link executeAndStore}.
     *
     * Used by both {@link evaluateWithTokens} and
     * {@link evaluateExpressionWithDiagnostic}, previously each carried its
     * own copy of this exact sequence (differing only in a cosmetic
     * abortLogger label), which is how the `=>` grammar shipped silently
     * dead on the diagnostic path earlier this session: a future top-level
     * grammar addition can no longer be wired into only one of the two.
     */
    private preflightAsync(
        normalizedTokens: Token[],
        program: BytecodeProgram,
        lineNumber: number,
        expression: string,
        reads: string[],
        writes: string[],
    ): { kind: 'pending'; value: Value } | { kind: 'proceed' } {
        if (!(program.hasAsync || this.resolverRegistry.size > 0)) {
            return { kind: 'proceed' };
        }

        // Check all registered async resolvers BEFORE VM execution.
        // If any resolver says "data not ready", skip VM and return Pending.
        // Link the preflight AbortController to the keystroke signal so
        // that in-flight preflight checks are canceled on new keystrokes.
        const preflightController = new AbortController();
        const abortPreflight = () => preflightController.abort();
        this.keystrokeSignal?.addEventListener('abort', abortPreflight, { once: true });

        abortLogger.localControllerCreated("preflightAsync");
        if (this.keystrokeSignal) {
            abortLogger.signalLinked("preflightAsync");
        }

        const preflightSignal = preflightController.signal;
        const asyncCheck = this.resolverRegistry.preflightAll(
            normalizedTokens, program, '_engine', preflightSignal, this.queryClient, this.config.network.enabled
        );
        if (asyncCheck) {
            // Fire-and-forget, resolves asynchronously, re-evaluates on completion
            void this.resolveAsync({
                type: 'pending',
                queryKey: asyncCheck.queryKey,
                resolver: asyncCheck.resolver,
                packageId: asyncCheck.packageId || '_engine',
                signal: asyncCheck.signal,
            });

            // Register data source dependency for DAG re-evaluation tracking
            this.dag.registerLineDataSourceDependency(
                lineNumber,
                asyncCheck.packageId || '_engine',
                [asyncCheck.queryKey]
            );

            this.registerBackgroundRefresh(asyncCheck);

            const pending = pendingValue(asyncCheck.queryKey);
            this.storeLineResult(lineNumber, pending, program, reads, writes, expression);
            return { kind: 'pending', value: pending };
        }
        // Sync path, no async resolution started, so the preflight
        // controller is inert. Unhook its keystroke listener.
        this.keystrokeSignal?.removeEventListener('abort', abortPreflight);
        return { kind: 'proceed' };
    }

    /**
     * Evaluate an expression using already-lexed tokens.
     *
     * The lean, non-diagnostic-instrumented path, used by
     * {@link evaluateLineWithPreTokenized} (tokens from `scanDocument()`)
     * and, via {@link compileExpression}/{@link tryCompileExpression},
     * compile-only callers. NOT used by `evaluateLine()`/
     * `evaluateExpression()`, those route through
     * {@link evaluateExpressionWithDiagnostic} instead (evaluateLine ->
     * evaluateLineWithDebug -> evaluateExpressionWithDiagnostic), which does
     * its own lexing and its
     * own diagnostic-instrumented front-half, delegating to the SAME
     * {@link prepareExpression} this method calls. Delegates the front-half
     * to {@link prepareExpression}, then runs async preflight (via
     * {@link preflightAsync}) + VM execution (via {@link executeAndStore}).
     */
    private evaluateWithTokens(
        lineNumber: number,
        expression: string,
        tokens: Token[],
        hasParens?: boolean
    ): Value {
        const prep = this.prepareExpression(expression, tokens, hasParens, undefined, lineNumber);

        if (prep.kind === 'empty') {
            const v = numberValue(0);
            this.lineCache.set(lineNumber, new LineCacheEntry(v, { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false }, [], null), expression);
            return v;
        }
        if (prep.kind === 'error') {
            // Re-throw the original error as-is, its own code/category
            // (EXPRESSION_TOO_LONG/EXPRESSION_TOO_COMPLEX/whatever the
            // parser actually threw) and expected/found/suggestion detail
            // are more specific and useful than the generic EVALUATION_ERROR
            // wrapper this used to construct around just the message.
            throw prep.error;
        }
        if (prep.kind === 'symbolic-solve') {
            // Most symbolic shapes carry no DAG registration: a stored
            // equation/bare-assignment's effect (vm.equations, vm.setVar) isn't
            // reads/writes-trackable the same way ordinary bytecode is, so the
            // line won't auto-re-evaluate if some unrelated line later changes
            // one of its factor variables. A disclosed limitation of that
            // narrow grammar (see trySymbolicGrammar()'s own doc comment). The
            // exception is a compound assignment, which surfaces real
            // reads/writes (see prepareExpression) so its running total is
            // checkpointed and its dependents re-evaluate.
            this.storeLineResult(lineNumber, prep.value, { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false }, prep.reads ?? [], prep.writes ?? [], expression);
            return prep.value;
        }

        const { normalizedTokens, reads, writes, program } = prep;

        // ══ PRE-FLIGHT ASYNC CHECK ══
        const preflight = this.preflightAsync(normalizedTokens, program, lineNumber, expression, reads, writes);
        if (preflight.kind === 'pending') {
            return preflight.value;
        }

        // Execute and handle result, no try/catch needed.
        // executeBytecode now returns EvalResult (discriminated union).
        return this.executeAndStore(program, lineNumber, expression, reads, writes, '_engine');
    }

    //#endregion

    //#region Public API, Line-level evaluation

	/**
	 * Evaluate a single expression line with full DAG and LineCache integration.
	 *
	 * @param lineNumber - 1-based line position in the document.
	 * @param lineText - The raw line text.
	 * @returns The evaluated {@link Value}.
	 * @throws {EngineError} On evaluation failure.
	 */
	evaluateLine(
        lineNumber: number,
        lineText: string
    ): Value {
        const result = this.evaluateLineWithDebug(lineNumber, lineText);
        if (result.error) {
            // Re-throw the original error (its own specific code/category/
            // expected/found/suggestion, e.g. CLAMP_EXPECTED_BETWEEN_OR_FROM
            // or UNDEFINED_VARIABLE) rather than the generic EVALUATION_ERROR
            // wrapper this used to always construct around just the message
            //, engineError is only absent if some future failure path in
            // the diagnostic pipeline sets `error` without it, which the
            // fallback below still handles.
            if (result.engineError) {
                throw result.engineError;
            }
            throw ErrorFactory.execution(
                'EVALUATION_ERROR',
                result.error,
                { lineNumber }
            );
        }
        return freezeIfDev(result.value);
    }

    /**
     * Evaluate a line with diagnostic information, supporting both regular expressions and inline solves.
     *
     * This is the primary entry point for the playground's debug/DIagnostic mode.
     * It delegates to {@link evaluateExpressionWithDiagnostic} for all actual evaluation,
     * but first checks for inline solve syntax (`s`expression``) and wraps the result
     * with inline solve position metadata when found.
     *
     * @param lineNumber - 1-based line number in the document.
     * @param lineText - Raw line text, which may be a regular expression or an inline solve.
     * @param inputType - Optional input type hint passed through to the diagnostic pipeline.
     * @returns An object containing the evaluated `value`, the raw `tokens`, the compiled
     *          `program`, optional `error` message, optional `debug` report JSON, and optional
     *          structured `diagnostic` pipeline result with all 15 pipeline stages.
     */
    evaluateLineWithDebug(
        lineNumber: number,
        lineText: string,
        inputType: string = "expression"
    ): { value: Value; tokens: Token[]; program: BytecodeProgram; error?: string; engineError?: EngineError; inlineSolve?: InlineSolvePosition; debug?: DiagnosticReportJSON; diagnostic?: DiagnosticPipelineResult } {
        const inlineSolveMatch = lineText.match(/^s`([^`]*)`$/);
        if (inlineSolveMatch) {
            const expression = inlineSolveMatch[1];
            const result = this.evaluateExpressionWithDiagnostic(expression, lineNumber, inputType);
            return {
                ...result,
                inlineSolve: {
                    start: 0,
                    end: lineText.length,
                    expression,
                    lineNumber,
                    columnNumber: 1
                }
            };
        }
        return this.evaluateExpressionWithDiagnostic(lineText, lineNumber, inputType);
    }

    //#endregion

    //#region Diagnostic Pipeline, Structured stage recording

    /**
     * Build a single pipeline stage result for the structured diagnostic output.
     *
     * Appends a `PipelineStageResult` to the given `stages` array with the provided
     * metadata. This runs in parallel with the existing event-based diagnostic system
     * (via `DiagnosticPipeline.fire*` methods). Both paths are enabled by the same
     * `hasCollectors` guard so there is no performance impact when `diagnosticMode`
     * is `false`, the stages array stays empty because this method is never called.
     *
     * Each stage captures:
     * - **Identity**: `stage` name (e.g., `"lexer"`), display `label`, `icon`, `colorClass`
     * - **Position**: `stepNumber` in the pipeline (0-15)
     * - **Timing**: `elapsedNs` wall-time (overridden by TimelineDiagnosticCollector)
     * - **State**: `skipped` flag for stages bypassed by cache hits or guard conditions
     * - **Payload**: `output`, a discriminated union typed per stage
     *
     * @param stages - Mutable array being accumulated for the final DiagnosticPipelineResult.
     * @param stage - Canonical stage identifier (kebab-case, e.g. `"async_preflight"`).
     * @param label - Human-readable stage name for the dashboard.
     * @param icon - Single emoji/character icon for visual identification.
     * @param colorClass - CSS class name for color-coding the stage in the UI.
     * @param stepNumber - Ordinal position in the 15-stage pipeline.
     * @param elapsedNs - Wall-clock time in nanoseconds (0 placeholder; timeline overrides).
     * @param skipped - Whether this stage was bypassed (e.g., cache hit, guard short-circuit).
     * @param output - Stage-specific data payload typed via the StageOutput discriminated union.
     */
    private addDiagnosticStage(
        stages: PipelineStageResult[],
        stage: string,
        label: string,
        icon: string,
        colorClass: string,
        stepNumber: number,
        elapsedNs: number,
        skipped: boolean,
        output: StageOutput,
    ): void {
        stages.push({ stage, label, icon, colorClass, stepNumber, elapsedNs, skipped, output });
    }

    /**
     * Core expression evaluation logic with diagnostic pipeline integration.
     *
     * Executes the full 15-stage evaluation pipeline while simultaneously
     * populating two diagnostic data structures:
     *
     * 1. **Event-based**, fires typed events to registered `DiagnosticCollector`
     *    instances via `DiagnosticPipeline.fire*()` methods. Supports streaming
     *    diagnostics via `TimelineDiagnosticCollector`.
     * 2. **Structured stages**, accumulates a `PipelineStageResult[]` array
     *    with per-stage typed payloads (see `DiagnosticPipelineResult.ts`).
     *    This is returned as the `diagnostic` field for declarative rendering.
     *
     * The 15 stages, in order:
     * ```
     *  1  pipeline_start, Pipeline initialization + metadata
     *  2  safety_length, Expression length validation
     *  3  lexer, Tokenization via ExpressionLexer
     *  4  normalizer, Token fusion (phrase, implicit multiply)
     *  5  safety_complexity, Token-count & nesting-depth check
     *  6  readwrite, Variable read/write extraction for DAG
     *  7  cache_check, Bytecode cache hit/miss
     *  8  parser, AST construction via PrecedenceParser
     *  9  compiler, Bytecode generation + constant table
     * 10  async_preflight, Async resolver pre-flight check
     * 11  vm_execute, Bytecode execution on the VM
     * 12  dag_registration, DAG node registration for incremental eval
     * 13  linecache, Result stored in LineCache
     * 14  result, Final value + formatting
     * 15  pipeline_end, Completion summary + statistics
     * ```
     *
     * Early-exit paths are taken for safety violations, empty expressions,
     * parse failures, and async pending results. Each early exit still
     * fires relevant pipeline events and records partial stages.
     *
     * When `AllocationTracker.isEnabled()`, each pipeline stage is wrapped
     * with `AllocationTracker.track()` to capture wall-time and heap delta.
     * When disabled (production), `track()` is a zero-overhead passthrough
     * that returns the result directly.
     *
     * The stages above describe OBSERVABLE shape, not a second implementation
     * of the underlying work: normalize/complexity-check/symbolic-grammar/
     * readwrite/cache-lookup/parse/compile are delegated to
     * {@link prepareExpression} (the SAME method the lean
     * {@link evaluateWithTokens} path calls), async preflight to
     * {@link preflightAsync}, and VM execution to {@link executeAndStore}
     * every stage/event below is reconstructed from what those shared
     * methods return, not fired from inside a second hand-duplicated copy
     * of their logic. This matters: a new top-level grammar shape wired
     * into `prepareExpression()` is automatically reachable from BOTH
     * `evaluateLine()`/`evaluateExpression()` (this method) and the lean
     * path, previously they were two independent implementations that had
     * already drifted once (the `=>`/equation-statement grammar shipped
     * dead on this, the real path, until a dedicated test caught it).
     *
     * @param expression - The raw expression string to evaluate.
     * @param lineNumber - 1-based line number for DAG and LineCache entries.
     * @param inputType - Input type hint (default `"expression"`), passed to
     *                    the diagnostic pipeline for metadata.
     * @returns An object with `value`, `tokens`, `program`, optional `error`,
     *          optional `debug` report JSON, and optional `diagnostic` containing
     *          the full structured pipeline stages array when collectors are active.
     */
    private evaluateExpressionWithDiagnostic(expression: string, lineNumber: number, inputType: string = "expression"): { value: Value; tokens: Token[]; program: BytecodeProgram; error?: string; engineError?: EngineError; debug?: DiagnosticReportJSON; diagnostic?: DiagnosticPipelineResult } {
        const pipeline = this.diagnosticPipeline;
        const hasCollectors = pipeline.hasCollectors;
        // Baseline for slicing THIS line's own parselet_matched events out of
        // the timeline collector's cumulative-across-the-document array below
        //. See debug.parselets' construction at the end of this method.
        const parseletsBefore = this.timelineCollector?.parseletMatchCount ?? 0;
        const trackEnabled = AllocationTracker.isEnabled();
        const stageAllocs: StageAllocation[] = [];
        const stages: PipelineStageResult[] = [];
        const zeroElapsed = 0; // Placeholder — timeline collector overrides with real ns

        // === SAFETY CHECK 1: Expression length limit ===
        const lengthCheck = checkExpressionLength(expression, this.config.validation);
        if (!lengthCheck.passed) {
            if (hasCollectors) {
                this.addDiagnosticStage(stages, 'safety_length', 'Safety: Length', '🛡️', 'validate', 2, zeroElapsed, false, {
                    type: 'safety_length',
                    passed: false,
                    expressionLength: expression.length,
                    maxLength: this.config.validation.maxExpressionLength,
                    errorMessage: lengthCheck.error!.error,
                });
            }
            return { ...lengthCheck.error!, debug: undefined, diagnostic: undefined };
        }

        // Pipeline event: start + structured stage
        if (hasCollectors) {
            pipeline.firePipelineStart({
                type: DiagnosticEventType.PipelineStart,
                elapsedNs: 0,
                expression,
                inputType,
             });
            this.addDiagnosticStage(stages, 'pipeline_start', 'Pipeline Start', '▶', 'pipeline', 1, zeroElapsed, false, {
                type: 'pipeline_start', expression, inputType,
            });
            this.addDiagnosticStage(stages, 'safety_length', 'Safety: Length', '🛡️', 'validate', 2, zeroElapsed, false, {
                type: 'safety_length',
                passed: true,
                expressionLength: expression.length,
                maxLength: this.config.validation.maxExpressionLength,
            });
        }

        // ══ LEXER STAGE ══
        // Lexing with token emission events. This file's shared
        // lexToTokens() (also used by compileExpression/
        // tryCompileExpression) skips redundant classifyLine (caller
        // already knows this is an expression) and filters COMMENT tokens
        // (they have no parselet and would cause "No prefix parselet
        // found" errors at the parser); `onToken` fires the per-token
        // TokenEmitted diagnostic event, genuinely specific to this path.
        const onToken = hasCollectors ? (t: Token) => {
            pipeline.fireTokenEmitted({
                type: DiagnosticEventType.TokenEmitted,
                elapsedNs: 0, // zero-cost placeholder (timeline collector overrides)
                expression,
                token: {
                    type: t.type,
                    value: t.value,
                    offset: t.offset || 0,
                    line: t.line || lineNumber,
                    col: t.col || 0,
                },
            });
        } : undefined;
        const lexResult = AllocationTracker.track('lexer', () => this.lexToTokens(expression, onToken));
        let tokens = lexResult.result.tokens;
        const hasParens = lexResult.result.hasParens;
        // True when lexing was skipped because the program is cached; the
        // empty token array is then a skip, not an empty line.
        const compiled = lexResult.result.compiled;
        if (trackEnabled && lexResult.alloc) stageAllocs.push(lexResult.alloc);

        // Structured: lexer stage output
        if (hasCollectors) {
            const tokenTypes: Record<string, number> = {};
            for (const t of tokens) {
                tokenTypes[t.type] = (tokenTypes[t.type] || 0) + 1;
            }
            this.addDiagnosticStage(stages, 'lexer', 'Lexer', '🔤', 'lexer', 3, zeroElapsed, false, {
                type: 'lexer',
                tokenCount: tokens.length,
                tokenTypes,
                hasParens,
                locale: this.localeCode,
                tokens: [...tokens],
            });

            // Structured: line classification, detect inline solve spans from token stream
            const inlineSolveSpans: InlineSolveSpanInfo[] = [];
            for (let i = 0; i < tokens.length; i++) {
                const t = tokens[i];
                if (t.type === 'INLINE_SOLVE_START') {
                    // Find closing backtick
                    let endIdx = -1;
                    for (let j = i + 1; j < tokens.length; j++) {
                        if (tokens[j].type === 'BACKTICK_OPEN') {
                            endIdx = j;
                            break;
                        }
                    }
                    if (endIdx > i) {
                        const exprTokens = tokens.slice(i + 1, endIdx);
                        const expression = exprTokens.map(et => et.value).join('');
                        inlineSolveSpans.push({
                            startTokenIndex: i,
                            endTokenIndex: endIdx,
                            expression,
                            columnNumber: t.col || 1,
                        });
                        i = endIdx;  // skip past this span
                    }
                }
            }
            this.addDiagnosticStage(stages, 'line_classification', 'Line Classification', '📋', 'classify', 3.5, zeroElapsed, false, {
                type: 'line_classification',
                classification: 'expression',
                skip: false,
                hasInlineSolve: inlineSolveSpans.length > 0,
                inlineSolveSpans,
            });
        }

        if (!compiled && tokens.length === 0) {
            const v = numberValue(0);
            this.lineCache.set(lineNumber, new LineCacheEntry(v, { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false }, [], null), expression);

            if (hasCollectors) {
                pipeline.firePipelineEnd({
                    type: DiagnosticEventType.PipelineEnd,
                    elapsedNs: 0,
                    expression,
                    success: true,
                    totalTokens: 0,
                    totalOpcodes: 0,
                });
            }

            return { value: v, tokens, program: { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false }, debug: undefined, diagnostic: undefined };
        }

        // ══ FRONT-HALF DELEGATION ══
        // normalize -> complexity -> symbolic-grammar -> readwrite -> cache
        // lookup/parse/compile, all via the SAME prepareExpression() the
        // lean path (evaluateWithTokens/compileExpression/
        // tryCompileExpression) already calls. This is the actual fix for
        // the bug found earlier this session (a new top-level grammar
        // shape silently dead on THIS, the real evaluateLine()/
        // evaluateExpression() path): a future addition wired into
        // prepareExpression() now automatically covers both paths, since
        // there is only one implementation left of "what does this line
        // mean." Every stage below is reconstructed from
        // prepareExpression()'s return value, plus a couple of cheap
        // pure, side-effect-free recomputations for display-only fields it
        // doesn't itself carry (the complexity score), instead of being
        // fired from inside a second, hand-duplicated copy of its logic.
        let fusionCount = 0;
        const normalizerFusions: TokenFusion[] = [];
        const normalizerRuleCounts = new Map<string, number>();
        const onFusion = hasCollectors ? (fusion: TokenFusion) => {
            fusionCount++;
            normalizerFusions.push(fusion);
            normalizerRuleCounts.set(fusion.rule, (normalizerRuleCounts.get(fusion.rule) || 0) + 1);
            pipeline.fireTokenFused({
                type: DiagnosticEventType.TokenFused,
                elapsedNs: 0,
                expression,
                ruleName: fusion.rule,
                sourceTokenCount: fusion.sourceTokens.length,
                fusedTokenType: fusion.fusedToken.type,
                fusedTokenValue: fusion.fusedToken.value,
            });
        } : undefined;

        if (hasCollectors && this.normalizer.ruleCount > 0) {
            pipeline.fireNormalizerStart({
                type: DiagnosticEventType.NormalizerStart,
                elapsedNs: 0,
                expression,
                inputTokenCount: tokens.length,
            });
        }

        // Peeked BEFORE calling prepareExpression() so hit/miss is already
        // known for the stage/event construction below, and so the
        // parser's diagnostic-pipeline reference is only linked when a real
        // parse attempt is actually about to happen, a cache hit never
        // reaches parseExpression() at all, matching the original's own
        // cache-miss-only gating of this same call.
        const cachedBefore = this.bytecodeCache.get(expression);
        if (hasCollectors && !cachedBefore) {
            this.parser.setDiagnosticPipeline(pipeline, expression);
        }

        // NOT wrapped in AllocationTracker.track('parser', ...) here
        // prepareExpression() already measures its OWN internal parse+build
        // call under that exact label internally (see its own doc comment
        // on `parserAlloc`) and reports the result back on its 'ready'
        // variant below. Wrapping the whole call from out here would widen
        // the measured span to also cover normalize/complexity-check/cache-
        // lookup, which measurably produced negative-allocation readings (a
        // GC sweep landing inside the wider window) well over half the time.
        const prep = this.prepareExpression(expression, tokens, hasParens, onFusion, lineNumber);
        // The tokens this result reports are the ones the program was compiled
        // from; on a skipped lex those are the cached normalised tokens.
        if (compiled && prep.kind === 'ready') tokens = prep.normalizedTokens;
        if (trackEnabled && prep.kind === 'ready' && prep.parserAlloc) {
            stageAllocs.push(prep.parserAlloc);
        }

        if (hasCollectors && !cachedBefore) {
            this.parser.setDiagnosticPipeline(undefined, "");
        }

        // From here on, `prep.normalizedTokens` is always defined, the two
        // variants that lack it ('empty', and 'error' at the 'length'
        // stage) are provably unreachable from this call site: the
        // safety-length check and the raw-tokens-empty check above already
        // handled both cases before prepareExpression() was ever invoked.
        const normalizedTokens: Token[] = prep.kind === 'empty' ? tokens : (prep.normalizedTokens ?? tokens);

        if (hasCollectors) {
            if (this.normalizer.ruleCount > 0) {
                pipeline.fireNormalizerEnd({
                    type: DiagnosticEventType.NormalizerEnd,
                    elapsedNs: 0,
                    expression,
                    outputTokenCount: normalizedTokens.length,
                    fusionsCount: fusionCount,
                });
                this.addDiagnosticStage(stages, 'normalizer', 'Normalizer', '🔄', 'normalizer', 4, zeroElapsed, false, {
                    type: 'normalizer',
                    inputTokenCount: tokens.length,
                    outputTokenCount: normalizedTokens.length,
                    fusions: normalizerFusions,
                    rulesApplied: [...normalizerRuleCounts.entries()].map(([rule, count]) => ({ rule, count })),
                    tokens: [...normalizedTokens],
                    phrases: this.normalizer.getPhrases(),
                    ruleShapes: this.normalizer.getRuleShapes(),
                    candidatesPerPosition: this.normalizer.getCandidateCounts(normalizedTokens),
                });
            } else {
                this.addDiagnosticStage(stages, 'normalizer', 'Normalizer', '🔄', 'normalizer', 4, zeroElapsed, true, {
                    type: 'normalizer',
                    inputTokenCount: tokens.length,
                    outputTokenCount: tokens.length,
                    fusions: [],
                    rulesApplied: [],
                    tokens: [...tokens],
                    phrases: this.normalizer.getPhrases(),
                    ruleShapes: this.normalizer.getRuleShapes(),
                    candidatesPerPosition: this.normalizer.getCandidateCounts(tokens),
                });
            }
        }

        // ══ 'empty' / 'error'-at-'length' outcomes ══
        // Provably unreachable from this call site (see comment above)
        // handled only so the discriminated union stays exhaustively
        // covered.
        if (prep.kind === 'empty' || (prep.kind === 'error' && prep.stage === 'length')) {
            if (hasCollectors) {
                pipeline.firePipelineEnd({
                    type: DiagnosticEventType.PipelineEnd,
                    elapsedNs: 0,
                    expression,
                    success: prep.kind === 'empty',
                    totalTokens: tokens.length,
                    totalOpcodes: 0,
                });
            }
            if (prep.kind === 'empty') {
                const v = numberValue(0);
                this.lineCache.set(lineNumber, new LineCacheEntry(v, { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false }, [], null), expression);
                return { value: v, tokens, program: { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false }, debug: undefined, diagnostic: undefined };
            }
            return {
                value: numberValue(0),
                tokens: [],
                program: { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false },
                error: prep.error.message,
                engineError: prep.error,
                debug: undefined,
                diagnostic: undefined,
            };
        }

        // Recompute the complexity score for display, cheap, pure
        // side-effect-free; prepareExpression() already made the actual
        // pass/fail DECISION, this is purely for the diagnostic stage's own
        // display fields it doesn't itself return.
        const complexityCheck = checkExpressionComplexity(normalizedTokens, this.config.validation);

        if (prep.kind === 'error' && prep.stage === 'complexity') {
            if (hasCollectors) {
                this.addDiagnosticStage(stages, 'safety_complexity', 'Safety: Complexity', '🛡️', 'validate', 5, zeroElapsed, false, {
                    type: 'safety_complexity',
                    passed: false,
                    complexityScore: complexityCheck.complexityScore ?? 0,
                    maxComplexity: this.config.validation.maxComplexity,
                    breakdown: {
                        tokenCount: normalizedTokens.length,
                        functionCalls: 0,
                        nestingDepth: 0,
                    },
                    errorMessage: complexityCheck.errorMessage!,
                });
                pipeline.firePipelineEnd({
                    type: DiagnosticEventType.PipelineEnd,
                    elapsedNs: 0,
                    expression,
                    success: false,
                    totalTokens: tokens.length,
                    totalOpcodes: 0,
                });
            }
            return {
                value: numberValue(0),
                tokens: [],
                program: { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false },
                error: complexityCheck.errorMessage!,
                engineError: complexityCheck.engineError,
                debug: undefined,
                diagnostic: undefined,
            };
        }

        if (hasCollectors) {
            this.addDiagnosticStage(stages, 'safety_complexity', 'Safety: Complexity', '🛡️', 'validate', 5, zeroElapsed, false, {
                type: 'safety_complexity',
                passed: true,
                complexityScore: complexityCheck.complexityScore ?? normalizedTokens.length,
                maxComplexity: this.config.validation.maxComplexity,
                breakdown: {
                    tokenCount: normalizedTokens.length,
                    functionCalls: 0,
                    nestingDepth: 0,
                },
            });
        }

        if (prep.kind === 'symbolic-solve') {
            if (hasCollectors) {
                pipeline.firePipelineEnd({
                    type: DiagnosticEventType.PipelineEnd,
                    elapsedNs: 0,
                    expression,
                    success: true,
                    totalTokens: tokens.length,
                    totalOpcodes: 0,
                });
            }
            const emptyProgram: BytecodeProgram = { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false };
            this.storeLineResult(lineNumber, prep.value, emptyProgram, prep.reads ?? [], prep.writes ?? [], expression);
            return {
                value: prep.value,
                tokens: normalizedTokens,
                program: emptyProgram,
                debug: undefined,
                diagnostic: undefined,
            };
        }

        // From here, prep.kind is 'ready' or 'error' at the 'parse' stage
        // both carry `reads`/`writes` (extracted before the cache lookup/
        // parse attempt).
        const reads = prep.reads ?? [];
        const writes = prep.writes ?? [];

        if (hasCollectors) {
            this.addDiagnosticStage(stages, 'readwrite', 'Read/Write', '📋', 'readwrite', 6, zeroElapsed, false, {
                type: 'readwrite',
                reads,
                writes,
                isAssignment: writes.length > 0,
            });
            this.addDiagnosticStage(stages, 'cache_check', 'Cache Check', '💾', 'cache', 7, zeroElapsed, false, {
                type: 'cache_check',
                hit: !!cachedBefore,
                cacheSize: this.bytecodeCache.size,
                cacheKey: expression,
            });
            if (cachedBefore) {
                pipeline.fireCacheHit({ type: DiagnosticEventType.CacheHit, elapsedNs: 0, expression, cache: "bytecode", key: expression });
            } else {
                pipeline.fireCacheMiss({ type: DiagnosticEventType.CacheMiss, elapsedNs: 0, expression, cache: "bytecode", key: expression });
            }
        }

        if (prep.kind === 'error' && prep.stage === 'parse') {
            // No 'parser'/'compiler' stage, the parse attempt itself is
            // where this failed, matching the original's exact shape (it
            // only ever got as far as the cache_check stage above before
            // the parse threw).
            if (hasCollectors) {
                pipeline.firePipelineEnd({
                    type: DiagnosticEventType.PipelineEnd,
                    elapsedNs: 0,
                    expression,
                    success: false,
                    totalTokens: tokens.length,
                    totalOpcodes: 0,
                });
            }
            return {
                value: numberValue(0),
                tokens: normalizedTokens,
                program: { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false },
                error: prep.error.message,
                engineError: prep.error,
                debug: undefined,
                diagnostic: undefined,
            };
        }

        if (prep.kind !== 'ready') {
            // Unreachable: every other variant ('empty', 'error' at any
            // stage, 'symbolic-solve') was already returned above. Kept
            // only so TypeScript's discriminated-union narrowing (which
            // doesn't always simplify a chain of `kind === X || (kind ===
            // Y && stage === Z)` guards perfectly) treats `prep.program`
            // below as definitely accessible, without an `as` cast.
            throw ErrorFactory.internal({
                code: "UNEXPECTED_ERROR",
                message: "Internal error: prepareExpression() returned an unexpected variant after all other cases were handled",
            });
        }
        const program = prep.program;

        if (hasCollectors) {
            this.addDiagnosticStage(stages, 'parser', 'Parser', '🌳', 'parser', 8, zeroElapsed, !!cachedBefore, {
                type: 'parser',
                parselets: [],
                uniqueParseletTypes: [],
                astDepth: 0,
            });
            this.addDiagnosticStage(stages, 'compiler', 'Compiler', '⚙️', 'compiler', 9, zeroElapsed, !!cachedBefore, {
                type: 'compiler',
                opcodeCount: program.opcodes.length,
                numberConstants: program.numbers.length,
                stringConstants: program.strings.length,
                hasAsync: program.hasAsync,
                cached: !!cachedBefore,
            });
            pipeline.fireBytecodeBuilt({
                type: DiagnosticEventType.BytecodeBuilt,
                elapsedNs: 0,
                expression,
                opcodesLength: program.opcodes.length,
                numbersLength: program.numbers.length,
                stringsLength: program.strings.length,
                isCached: !!cachedBefore,
            });
        }

        // ══ PRE-FLIGHT ASYNC CHECK ══
        const hasAsyncGuard = program.hasAsync || this.resolverRegistry.size > 0;
        const preflight = this.preflightAsync(normalizedTokens, program, lineNumber, expression, reads, writes);

        if (hasCollectors) {
            if (preflight.kind === 'pending') {
                this.addDiagnosticStage(stages, 'async_preflight', 'Async Preflight', '🔮', 'async', 10, zeroElapsed, false, {
                    type: 'async_preflight',
                    path: 'pending',
                    pendingQueryKey: preflight.value.value as string,
                    resolverCount: this.resolverRegistry.size,
                    skippedGuard: true,
                });
            } else if (hasAsyncGuard) {
                this.addDiagnosticStage(stages, 'async_preflight', 'Async Preflight', '🔮', 'async', 10, zeroElapsed, false, {
                    type: 'async_preflight',
                    path: 'sync',
                    resolverCount: this.resolverRegistry.size,
                    skippedGuard: false,
                });
            } else {
                this.addDiagnosticStage(stages, 'async_preflight', 'Async Preflight', '🔮', 'async', 10, zeroElapsed, true, {
                    type: 'async_preflight',
                    path: 'sync',
                    resolverCount: 0,
                    skippedGuard: true,
                });
            }
        }

        if (preflight.kind === 'pending') {
            if (hasCollectors) {
                pipeline.firePipelineEnd({
                    type: DiagnosticEventType.PipelineEnd,
                    elapsedNs: 0,
                    expression,
                    success: true,
                    totalTokens: tokens.length,
                    totalOpcodes: program.opcodes.length,
                });
            }
            return {
                value: preflight.value,
                tokens: normalizedTokens,
                program,
                debug: undefined,
                diagnostic: hasCollectors ? this.buildDiagnosticResult(stages, preflight.value, normalizedTokens, program, null) : undefined,
            };
        }

        // ══ VM STAGE ══
        // Delegates to executeAndStore(), the SAME method the lean path
        // calls, which already handles the AbortController/keystroke-
        // signal linking, stack cleanup, and resolveAsync/DAG-registration/
        // storeLineResult side effects internally. executeAndStore()
        // throws on a VM runtime error (matching the lean path's own
        // contract); caught here and converted to a soft `error` return,
        // exactly as this method's own inline VM-execution block used to
        // do directly, so a caller evaluating a whole multi-line document
        // one line at a time still doesn't have one bad line abort every
        // subsequent line.
        const emitVmTrace = hasCollectors && this.config.diagnostic.vmTraceEnabled === true;
        let result: Value;
        try {
            const vmResult = AllocationTracker.track('vm', () => {
                return this.executeAndStore(program, lineNumber, expression, reads, writes, '_engine', emitVmTrace ? pipeline : undefined, expression);
            }, { cacheHit: !!cachedBefore });
            result = vmResult.result;
            if (trackEnabled && vmResult.alloc) stageAllocs.push(vmResult.alloc);
        } catch (e) {
            const engineError = normalizeUnknownError(e);
            if (hasCollectors) {
                pipeline.firePipelineEnd({
                    type: DiagnosticEventType.PipelineEnd,
                    elapsedNs: 0,
                    expression,
                    success: false,
                    totalTokens: tokens.length,
                    totalOpcodes: program.opcodes.length,
                });
            }
            return {
                value: numberValue(0),
                tokens: normalizedTokens,
                program,
                error: engineError.message,
                engineError,
                debug: undefined,
                diagnostic: undefined,
            };
        }

        const isPending = result.type === ValueType.Pending;

        if (hasCollectors) {
            const resultValue = isPending ? 'pending' : String(result.value ?? '');
            const resultType = isPending ? 'Pending' : (result.unit ? 'Uom' : 'Number');
            this.addDiagnosticStage(stages, 'vm_execute', 'VM Execute', '⚡', 'vm', 11, zeroElapsed, false, {
                type: 'vm_execute',
                totalInstructions: program.opcodes.length,
                stackDepth: this.vm.getStack().length,
                resultType,
                resultValue,
                isPending,
            });
        }

        if (isPending) {
            if (hasCollectors) {
                pipeline.firePipelineEnd({
                    type: DiagnosticEventType.PipelineEnd,
                    elapsedNs: 0,
                    expression,
                    success: true,
                    totalTokens: tokens.length,
                    totalOpcodes: program.opcodes.length,
                });
            }
            return {
                value: result,
                tokens: normalizedTokens,
                program,
                debug: undefined,
                diagnostic: hasCollectors ? this.buildDiagnosticResult(stages, result, normalizedTokens, program, null) : undefined,
            };
        }

        // ══ BUILD TELEMETRY ══
        if (trackEnabled && stageAllocs.length > 0) {
            this.lastTelemetry = AllocationTracker.createTelemetry(
                expression,
                stageAllocs,
                !!cachedBefore
            );
        }

        // Structured: DAG Registration + LineCache + Result + PipelineEnd
        if (hasCollectors) {
            this.addDiagnosticStage(stages, 'dag_registration', 'DAG Registration', '🔗', 'dag', 12, zeroElapsed, false, {
                type: 'dag_registration',
                readsRegistered: reads,
                writesRegistered: writes,
                dataSourcesRegistered: [],
            });
            this.addDiagnosticStage(stages, 'linecache', 'Line Cache', '📦', 'cache', 13, zeroElapsed, false, {
                type: 'linecache',
                lineNumber,
                expression,
                stored: true,
            });
            this.addDiagnosticStage(stages, 'result', 'Result', '✓', 'result', 14, zeroElapsed, false, {
                type: 'result',
                rawValue: String(result.value),
                formattedValue: String(result.value),
                valueType: result.type === 0 ? 'Number' : 'Value',
                unit: result.unit,
            });

            pipeline.fireVmHalt({
                type: DiagnosticEventType.VmHalt,
                elapsedNs: 0,
                expression,
                result: result ? {
                    type: result.type,
                    value: result.value,
                    unit: result.unit,
                } : undefined,
            });

            this.addDiagnosticStage(stages, 'pipeline_end', 'Pipeline End', '⏹', 'pipeline', 15, zeroElapsed, false, {
                type: 'pipeline_end',
                success: true,
                totalTokens: tokens.length,
                totalOpcodes: program.opcodes.length,
                cacheHit: !!cachedBefore,
            });

            pipeline.firePipelineEnd({
                type: DiagnosticEventType.PipelineEnd,
                elapsedNs: 0,
                expression,
                success: true,
                totalTokens: tokens.length,
                totalOpcodes: program.opcodes.length,
            });
        }

        // Build debug info, structured diagnostic report
        if (hasCollectors) {
            const reports = pipeline.collectReports();
            const rawDebug = reports[0]?.toJSON();
            // `rawDebug.parselets` as returned by TimelineDiagnosticCollector
            // is cumulative across the WHOLE document pass (deliberately
            // see onPipelineStart's doc comment), not scoped to this one
            // line. Without this slice, every line after the first reports
            // whichever parselet fired FIRST in the entire session
            // (typically NumberParselet, from the document's very first
            // token) as if it were this line's own, a real, confusing
            // display bug, not evidence that NumberParselet does all the
            // parsing work. Slicing from the pre-parse baseline gives just
            // the events this line's own parse actually fired.
            let debug = rawDebug;
            if (rawDebug) {
                const lineParselets = rawDebug.parselets.slice(parseletsBefore);
                // summary.totalParselets/parseCategories are recomputed from
                // the SAME per-line slice above, for the same reason
                // TimelineDiagnosticCollector's parseCategories Map is
                // cumulative across the whole document pass, so reusing it
                // as-is would report "distinct categories seen all session"
                // instead of "categories this line's own parse used" (e.g.
                // a document that touches arithmetic/datetime/finance
                // packages across many lines would show totalParselets: 3
                // on EVERY line once all three had been seen once,
                // regardless of what that specific line actually parsed).
                // summary.totalTokens/totalOpcodes/cacheHit/elapsedNs are
                // deliberately left as the collector's session-cumulative
                // values, none of them currently has a UI consumer to
                // validate a per-line reinterpretation against, and
                // equivalent, already-correct per-line values exist
                // elsewhere for tokens/opcodes/cache-hit (see LineResult's
                // own token/opcodeCount/wasCached fields in
                // packages/playground-bridge/src/engine.ts).
                const lineParseCategories: Record<string, number> = {};
                for (const p of lineParselets) {
                    lineParseCategories[p.parseletCategory] = (lineParseCategories[p.parseletCategory] ?? 0) + 1;
                }
                debug = {
                    ...rawDebug,
                    parselets: lineParselets,
                    summary: {
                        ...rawDebug.summary,
                        totalParselets: Object.keys(lineParseCategories).length,
                        parseCategories: lineParseCategories,
                    },
                };
            }
            return {
                value: result,
                tokens: normalizedTokens,
                program,
                debug,
                diagnostic: this.buildDiagnosticResult(stages, result, normalizedTokens, program, null),
            };
        }

        return {
            value: result,
            tokens: normalizedTokens,
            program,
        };
    }

    //#endregion

    //#region Diagnostic Result, Snapshot population

    /**
     * Build a complete DiagnosticPipelineResult with engine-wide snapshot data.
     *
     * Populates dagSnapshot, cacheSnapshot, batcherMetrics, and checkpoints
     * alongside the per-line pipeline stages, value, tokens, and program.
     * Previously the playground made separate engine method calls for each.
     */
    private buildDiagnosticResult(
        stages: PipelineStageResult[],
        value: Value,
        tokens: Token[],
        program: BytecodeProgram,
        error: string | null,
    ): DiagnosticPipelineResult {
        return {
            stages,
            value,
            tokens,
            program,
            error,
            dagSnapshot: this.dag.getSnapshot(),
            cacheSnapshot: this.getCacheSnapshot(),
            batcherMetrics: this.getBatcherMetrics(),
            checkpoints: this.getCheckpoints(),
        };
    }

    //#endregion

    //#region Incremental Evaluation, DAG-driven re-execution

    /**
     * Re-evaluate a cached line without reparsing.
     *
     * Used when a variable referenced by this line has changed. Skips
     * lexing, parsing, and compilation, performs only a pre-flight async
     * check and VM execution against the cached bytecode.
     *
     * Returns `undefined` if the line is not in cache.
     *
     * @param lineNumber - The line to re-evaluate.
     * @param expression - The original expression string (used for cache lookup).
     * @returns The updated `Value`, or `undefined` if uncached.
     */
    reEvaluateLine(lineNumber: number, expression: string): Value | undefined {
        const entry = this.lineCache.get(lineNumber, expression);
        if (!entry) return undefined;

        const program = this.bytecodeCache.get(expression);
        if (!program) return undefined;

        // ══ PRE-FLIGHT ASYNC CHECK ══
        // O(1) guard: skip the O(n) resolver scan when the bytecode has no
        // async opcodes AND no resolvers are registered.
        if (entry.bytecode.hasAsync || this.resolverRegistry.size > 0) {
        // Pre-flight async check, run before VM even for cached bytecode
        // ── Link to keystroke signal ──
        const preflightController = new AbortController();
        const abortPreflight = () => preflightController.abort();
        this.keystrokeSignal?.addEventListener('abort', abortPreflight, { once: true });

        abortLogger.localControllerCreated("reEvaluateLine preflight");
        if (this.keystrokeSignal) {
            abortLogger.signalLinked("reEvaluateLine preflight");
        }

        const preflightSignal = preflightController.signal;
        const asyncCheck = this.resolverRegistry.preflightAll(
            [], entry.bytecode, '_engine', preflightSignal, this.queryClient, this.config.network.enabled
        );
        if (asyncCheck) {
            void this.resolveAsync({
                type: 'pending',
                queryKey: asyncCheck.queryKey,
                resolver: asyncCheck.resolver,
                packageId: asyncCheck.packageId || '_engine',
                signal: asyncCheck.signal,
            });
            this.registerBackgroundRefresh(asyncCheck);
            return pendingValue(asyncCheck.queryKey);
        }
        // Sync path, unhook the inert preflight controller's keystroke listener.
        this.keystrokeSignal?.removeEventListener('abort', abortPreflight);
        } // end hasAsync guard

        // No vm.reset() here: reset() clears the variable table, which would
        // wipe variables defined by other lines that this line's bytecode may
        // read. executeRaw() already snapshots and restores the stack depth.
        const evalResult = this.executeRaw(program, lineNumber);

        if (evalResult.type === 'pending') {
            void this.resolveAsync(evalResult);
            return pendingValue(evalResult.queryKey);
        }
        if (evalResult.type === 'error') {
            throw evalResult.error;
        }

        const result = evalResult.value;
        entry.result = result;

        return result;
    }

    getDag(): DependencyGraph {
        return this.dag;
    }

    getLineCache(): LineCache {
        return this.lineCache;
    }

    getBytecodeCache(): Map<string, BytecodeProgram> {
        return this.bytecodeCache;
    }

    /**
     * Get the shared VM instance.
     * Used by VMCheckpointer to create/restore checkpoints.
     */
    getVM(): VM {
        return this.vm;
    }

    /**
     * This engine's registries.
     *
     * For introspection: checking what a package registered, or asserting that
     * unregistering removed it. These used to be module-level singletons a
     * caller could import directly, which is exactly the coupling
     * {@link EngineContext} removes, so reaching them now goes through the
     * engine that owns them.
     *
     * @returns The context created for this engine. Mutating what it holds
     * affects this engine's behaviour, so treat it as read-only unless you are
     * deliberately registering something.
     */
    getContext(): EngineContext {
        return this.context;
    }

    getScopeManager(): ScopeManager {
        return this.scopeManager;
    }

    getLexer(): Lexer {
        return this.lexer;
    }

    /**
     * This engine's token normalizer, with every phrase and rule its packages
     * registered.
     *
     * Exposed for the highlighting path. `LanguageService` classifies tokens
     * after the lexer but can only see phrase-fused types (a date literal, a
     * timecode, a package's own fused token) by running the same normalizer
     * evaluation runs. Sharing this instance rather than building a second one
     * is what keeps the two from disagreeing.
     */
    getNormalizer(): TokenNormalizer {
        return this.normalizer;
    }

    /**
     * Every completion candidate contributed by currently-registered
     * packages (`IEnginePackage.completionItems`), flattened across all of
     * them. Used by `LanguageService.getCompletions()`.
     */
    getPackageCompletionItems(): CompletionItem[] {
        const items: CompletionItem[] = [];
        for (const pkgItems of this.packageCompletionItems.values()) {
            items.push(...pkgItems);
        }
        return items;
    }

    getParseletRegistry(): { prefix: Array<{ tokenType: string; bindingPower: number; category?: string }>; infix: Array<{ tokenType: string; leftBindingPower: number; rightBindingPower: number; category?: string }> } {
        return {
            prefix: this.registry.getAllPrefix(),
            infix: this.registry.getAllInfix(),
        };
    }

    /**
     * Lex + normalize (phrase fusion, implicit multiply, domain token
     * merging) `text` WITHOUT parsing or executing it, a cheap way for a
     * host to inspect what token stream a line would actually produce,
     * without paying for a full parse/compile/VM pass.
     *
     * Built for line-classification heuristics like "does this look like a
     * real expression, or is it prose I shouldn't bother evaluating", a
     * host that only checks for digits/operators/symbols before deciding
     * whether to evaluate a line will incorrectly skip genuine all-word
     * expressions (`weather in Tokyo`, `time in Paris`, `average of X, Y,
     * Z`), since none of those contain a digit or symbol. Checking whether
     * `tokenizeForClassification(text)[0]?.type` is anything OTHER than the
     * generic `IDENT` fallback is a reliable signal that the lexer/normalizer
     * actually recognized a specific keyword or fused multi-word phrase
     * i.e., this is real, registered vocabulary, not an arbitrary word that
     * merely happens to be lexable (every word lexes as IDENT if nothing
     * more specific claims it, so IDENT alone proves nothing about intent).
     *
     * Assumes the caller has already ruled out markdown-structural lines
     * (headings, code fences, etc.) via `getLexer().classifyLine()`. This
     * always tokenizes as a plain expression line, mirroring
     * `Lexer.resetExpression()`'s own "caller already knows this is
     * evaluable" contract.
     */
    tokenizeForClassification(text: string): Token[] {
        this.lexer.resetExpression(text);
        const rawTokens = Array.from(this.lexer);
        const exprTokens = rawTokens.filter(t => t.type !== 'COMMENT');
        if (exprTokens.length === 0) return [];
        return this.normalizer.normalize(exprTokens);
    }

    getParser(): PrecedenceParser {
        return this.parser;
    }

    isDiagnosticMode(): boolean {
        return this.diagnosticPipeline.hasCollectors;
    }

    //#endregion

    //#region Public API, Keystroke signal

    /**
     * Set the keystroke-level AbortSignal for the current evaluation cycle.
     *
     * Called by the UI layer (via ThreeTierEvaluator) before evaluate() or
     * evaluateAll(). All per-evaluation AbortControllers created during this
     * cycle link to this signal so that when the user types a new keystroke,
     * all in-flight async work is canceled atomically.
     *
     * @param signal The keystroke's AbortSignal, or null to clear.
     */
    setKeystrokeSignal(signal: AbortSignal | null): void {
        if (signal) {
            abortLogger.keystrokeSignalSet(signal.aborted);
        } else {
            abortLogger.keystrokeSignalCleared();
        }
        this.keystrokeSignal = signal;
    }

    /**
     * Get a serializable cache snapshot for diagnostic rendering.
     *
     * Returns bytecode cache entries, line cache entries, and async cache
     * packages, all as plain objects with no internal references. Previously
     * the playground accessed this via `(engine as any).getCacheSnapshot?.()`.
     */
    getCacheSnapshot(): CacheSnapshot {
        const bytecode: BytecodeCacheEntry[] = [];
        for (const [expression, program] of this.bytecodeCache) {
            bytecode.push({
                expression,
                opcodesLength: program.opcodes.length,
                numbersLength: program.numbers.length,
                stringsLength: program.strings.length,
                hasAsync: program.hasAsync,
            });
        }

        const lineCacheEntries: LineCacheEntryInfo[] = [];
        for (const key of this.lineCache.keys()) {
            // Keys are "lineNumber" or "lineNumber:expression", parse out both parts.
            const colonIdx = key.indexOf(':');
            const lineNumber = colonIdx > 0
                ? (parseInt(key.slice(0, colonIdx), 10) || 0)
                : (parseInt(key, 10) || 0);
            const expressionPart = colonIdx > 0 ? key.slice(colonIdx + 1) : undefined;

            const entry = expressionPart !== undefined
                ? this.lineCache.get(lineNumber, expressionPart)
                : this.lineCache.getEntryForLine(lineNumber);
            if (!entry) continue;

            lineCacheEntries.push({
                key,
                lineNumber,
                resultType: String(entry.result?.type ?? ''),
                resultValue: String(entry.result?.value ?? ''),
                reads: entry.readVariables ?? [],
                writeVar: entry.writeVariable ?? null,
            });
        }

        // Build async cache snapshot from TanStack Query cache
        const queryCache = this.queryClient.getQueryCache();
        const allQueries = queryCache.getAll();
        const asyncCache = allQueries.map(q => {
            const status = q.state.status === 'success' ? 'resolved' as const
                : q.state.status === 'error' ? 'error' as const
                : 'in_flight' as const;
            return {
                packageId: (q.queryKey[0] as string) ?? 'unknown',
                resolvedCount: q.state.status === 'success' ? 1 : 0,
                inFlightCount: q.state.status !== 'success' && q.state.status !== 'error' ? 1 : 0,
                errorCount: q.state.status === 'error' ? 1 : 0,
                entries: [{ key: q.queryKey.join(':'), status }],
            };
        });

        return { bytecode, lineCache: lineCacheEntries, asyncCache };
    }

    /**
     * Get serializable batcher metrics for the Workers diagnostic tab.
     *
     * Reads the typed read-only accessors on {@link AsyncResolutionBatcher}
     * (`pendingCount`/`dedupCount`/`workerOffloadCount`/`listenerCount`)
     * instead of reaching into its private fields via `(this.batcher as any)`.
     */
    getBatcherMetrics(): BatcherMetrics {
        return {
            pendingCount: this.batcher.pendingCount,
            dedupCount: this.batcher.dedupCount,
            workerOffloadCount: this.batcher.workerOffloadCount,
            listenerCount: this.batcher.listenerCount,
        };
    }

    /**
     * Get a serializable snapshot of VM checkpoints for diagnostics.
     *
     * The checkpointer lives on the ThreeTierEvaluator (not the engine),
     * so this returns an empty array when no checkpointer is available.
     * Previously accessed via `(vm as any).checkpointer.getAllCheckpoints?.()`.
     */
    getCheckpoints(): CheckpointSnapshot[] {
        // ThreeTierEvaluator attaches the checkpointer to the VM at runtime, so
        // it is not on the VM's declared surface. Describing the shape being
        // read, rather than reaching through `any`, keeps the expectation
        // checkable: if getAllCheckpoints' signature moves, this stops
        // compiling instead of failing at the call.
        const vmWithCheckpointer = this.vm as {
            checkpointer?: {
                getAllCheckpoints(): readonly { lineNumber: number; variables: Record<string, unknown> }[];
            };
        };
        const checkpointer = vmWithCheckpointer.checkpointer;
        if (!checkpointer) return [];

        const raw = checkpointer.getAllCheckpoints();
        return raw.map(cp => ({
            lineNumber: cp.lineNumber,
            variables: Object.keys(cp.variables),
            variableCount: Object.keys(cp.variables).length,
        }));
    }

    /**
     * Get the most recent pipeline telemetry from AllocationTracker.
     *
     * Returns null when AllocationTracker.isEnabled() is false (production
     * zero overhead), or when no expression has been evaluated via
     * evaluateExpressionWithDiagnostic() since the last clear().
     *
     * Use this in test/benchmark suites to inspect per-stage wall-time and
     * heap allocation data without enabling the full diagnostic pipeline.
     */
    getLastTelemetry(): PipelineTelemetry | null {
        return this.lastTelemetry;
    }

    //#endregion

    //#region Public API, Evaluation

    /**
     * Evaluate a raw expression string without line-number context.
     * Returns the {@link Value} result. Throws on error.
     */
    evaluateExpression(expression: string): Value {
        return this.evaluateLine(-1, expression);
    }

    /**
     * Explain how a line reached its answer, as a readable derivation.
     *
     * This is a companion to {@link evaluateExpression}, not a replacement:
     * `explainLine` is for the person reading the note, whereas the diagnostic
     * pipeline (`evaluateLineWithDiagnostic`) is for the developer and reports
     * stages, opcodes and timings. A host puts a derivation behind a hover or a
     * disclosure, so this is an API rather than an `explain` keyword: it never
     * consumes a word that a prose line might use, and it annotates a line the
     * host has already chosen to explain.
     *
     * The returned {@link Explanation} walks the line's operations in evaluation
     * order, each with the value it arrives at, and its `result` is identical to
     * what {@link evaluateExpression} returns for the same line. Every value in
     * the derivation is the engine's own, the operations are re-evaluated rather
     * than re-derived, so a step can never disagree with the answer.
     *
     * A line with nothing to break down (a bare literal), or one built from a
     * construct this slice does not derive yet (matrices, dates, function
     * calls), comes back with an empty `steps` array and the answer in
     * `result`, rather than an error.
     *
     * @param expression - The raw line to explain.
     * @returns The ordered derivation and final value.
     * @throws {EngineError} When the line does not evaluate at all, or resolves
     * data asynchronously (a derivation has no meaning for either).
     */
    explainLine(expression: string): Explanation {
        const { tokens } = this.lexToTokens(expression, undefined, false);
        // Normalize exactly as the evaluation path does (COMMENT tokens have no
        // parselet, phrase fusion turns "off"/"of" into their real operators),
        // so the derivation reads the same token stream the answer came from.
        const exprTokens = tokens.filter((t) => t.type !== "COMMENT");
        const normalized = this.normalizer.normalize(exprTokens);
        return buildExplanation({
            expression,
            tokens: normalized,
            evaluate: (source) => this.evaluateIsolated(source),
            locale: this.localeCode,
        });
    }

    /**
     * Evaluate a self-contained sub-expression without touching document state.
     *
     * Used only by {@link explainLine}. Unlike `evaluateExpression`, this never
     * writes to the line cache or the dependency graph: it is handed the spans
     * of a single line's own sub-expressions, and evaluating those to build a
     * derivation must not disturb the document the line belongs to. An async
     * (pending) result is rejected, a derivation cannot represent one.
     */
    private evaluateIsolated(expression: string): Value {
        const { tokens, hasParens } = this.lexToTokens(expression);
        const prep = this.prepareExpression(expression, tokens, hasParens, undefined, -1);
        if (prep.kind === "empty") return numberValue(0);
        if (prep.kind === "error") throw prep.error;
        if (prep.kind === "symbolic-solve") return prep.value;

        const result = this.executeRaw(prep.program, -1);
        if (result.type === "error") throw result.error;
        if (result.type === "pending") {
            throw ErrorFactory.execution(
                "EXPLAIN_ASYNC_UNSUPPORTED",
                `A derivation cannot be built for a line that resolves data asynchronously: "${expression}"`,
                { expression },
            );
        }
        return result.value;
    }

//#endregion

//#region Compilation, Bytecode-only path

    /**
     * Compile-only path: lex → parse → bytecode, without execution.
     *
     * Used by Tier 3 (background) evaluation to discover reads/writes
     * for the dependency graph without running display-only expressions.
     *
     * Uses the bytecode cache, repeated compilations of the same expression
     * return the cached program with zero allocation.
     *
     * @param expression - The raw expression string to compile.
     * @returns Object with compiled `program`, lexed `tokens`, and extracted `reads`/`writes`.
     * @throws ErrorFactory on parse failure or safety check failure.
     */
	compileExpression(expression: string): {
		program: BytecodeProgram;
		tokens: Token[];
		reads: string[];
		writes: string[];
	} {
		const lexed = this.lexToTokens(expression);
		const { hasParens } = lexed;

		// Shared front-half: safety → normalize → complexity → cache/compile.
		const prep = this.prepareExpression(expression, lexed.tokens, hasParens);
		// On a cache hit nothing was lexed, so the tokens reported are the
		// normalised ones the cached program was compiled from.
		const tokens = lexed.compiled && prep.kind === 'ready' ? prep.normalizedTokens : lexed.tokens;

		if (prep.kind === 'empty') {
			return {
				program: { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false },
				tokens: [],
				reads: [],
				writes: [],
			};
		}
		if (prep.kind === 'error') {
			if (prep.stage === 'parse' && (prep.reads?.length || prep.writes?.length)) {
				// Preserve the original error's own code/category/expected/
				// found/suggestion (whatever the parser actually threw
				// UNDEFINED_VARIABLE, FUNCTION_ARITY_MISMATCH, ...) rather
				// than the generic PARSE_ERROR wrapper this used to
				// construct, but still attach the already-extracted
				// reads/writes as context so DAG-registering callers (e.g.
				// ThreeTierEvaluator's compile fallback) can track this
				// line's dependencies even though it failed to compile.
				// EngineError.context is readonly, so this constructs a new
				// error carrying every other field through unchanged rather
				// than mutating prep.error in place.
				throw new EngineError(prep.error.category, {
					code: prep.error.code,
					message: prep.error.message,
					expected: prep.error.expected,
					found: prep.error.found,
					suggestion: prep.error.suggestion,
					recoverable: prep.error.recoverable,
					span: prep.error.span,
					cause: prep.error.cause,
					context: { ...prep.error.context, reads: prep.reads ?? [], writes: prep.writes ?? [] },
				});
			}
			throw prep.error;
		}
		if (prep.kind === 'symbolic-solve') {
			// No real bytecode representation for a `=>`/bare-equation line
			// (its effect, a stored equation, a direct vm.setVar(), was
			// already fully computed inside prepareExpression() itself)
			// same "nothing to compile" shape as the 'empty' case above.
			// External tooling asking for the compiled program of a `=>`
			// line gets an empty one; a disclosed limitation of this
			// narrow grammar, not an oversight. A compound assignment is the
			// exception: it carries real reads/writes so the incremental
			// evaluator checkpoints its running total and re-runs dependents.
			return {
				program: { opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false },
				tokens: prep.normalizedTokens,
				reads: prep.reads ?? [],
				writes: prep.writes ?? [],
			};
		}

		return { program: prep.program, tokens, reads: prep.reads, writes: prep.writes };
	}

	/**
	 * Non-throwing "does this compile" check. Same lex → prepare pipeline as
	 * {@link compileExpression}, but returns a boolean instead of throwing on
	 * failure.
	 *
	 * compileExpression()'s failure path constructs a EngineError via
	 * ErrorFactory, which calls Error.captureStackTrace(), one of V8's more
	 * expensive operations. That's fine for genuine execution/compile errors
	 * (rare, and the caller needs the message), but LanguageService's
	 * syntax-highlighting gate calls compileExpression() purely to ask "does
	 * this parse", on every visible line, every keystroke, and the common
	 * case for a real markdown document is prose lines that DON'T parse, not
	 * the rare case. Benchmarked: constructing-and-throwing that exception on
	 * every non-matching line was responsible for highlighting an
	 * unrecognized-prose line costing roughly an order of magnitude more than
	 * a recognized expression. This skips that construction entirely, still
	 * reuses the bytecode cache and prepareExpression()'s normal work, just
	 * never builds an Error object for the "no" answer.
	 *
	 * Note: this only avoids the outer exception compileExpression() itself
	 * would construct. A genuinely deep parse failure (an unmatched token
	 * mid-expression, not just "stopped early with leftover tokens") still
	 * goes through the parser's own throw/catch inside prepareExpression()
	 * unavoidable without restructuring the parser's failure signaling, which
	 * is out of scope here.
	 *
	 * The "non-throwing" in the first line is a contract callers rely on, not
	 * a description of the happy path, so it is enforced here rather than left
	 * to every stage below agreeing to return its errors. It had been left to
	 * them, and they did not all agree: the lexer throws on an unterminated
	 * string (`"`), and the symbolic grammar threw on an assignment whose
	 * right-hand side is still empty (`total =`). LanguageService calls this
	 * per visible line per keystroke, so both reached CodeMirror's transaction
	 * dispatch and broke the editor on input that is merely half-typed.
	 *
	 * A catch costs nothing on the path that does not throw, so the "no" answer
	 * this method exists to make cheap stays cheap. Anything that does throw
	 * was already paying for the Error it constructed.
	 */
	tryCompileExpression(expression: string): boolean {
		try {
			return this.tryCompileExpressionUnguarded(expression);
		} catch {
			// "Does this compile" has a truthful answer for every one of these:
			// no. Swallowing is safe precisely because the answer is a boolean
			// with no detail to lose; callers wanting the reason call
			// compileExpression(), which still throws.
			return false;
		}
	}

	/** The body of {@link tryCompileExpression}, which owns the contract. */
	private tryCompileExpressionUnguarded(expression: string): boolean {
		const { tokens, hasParens } = this.lexToTokens(expression);
		const prep = this.prepareExpression(expression, tokens, hasParens);
		return prep.kind !== 'error';
	}

	/**
	 * Execute pre-compiled bytecode against the engine's shared VM.
	 * Used by Tier 2 (scroll into view) to re-execute cached bytecode
	 * without re-lexing, re-parsing, or re-compiling.
	 *
	 * Preserves the VM stack, pops any leftover items after execution.
	 * Does NOT update DAG or LineCache (caller is responsible for state
	 * management via DocumentModel).
	 *
	 * @returns The execution result, or undefined if bytecode is empty.
	 * @param lineNumber - 1-based line this bytecode belongs to, for
	 * cross-line features (see `makeLineContext()`). Defaults to -1.
	 */
	executeCached(program: BytecodeProgram, lineNumber: number = -1): Value {
		if (program.opcodes.length === 0) {
			return numberValue(0);
		}
		const evalResult = this.executeRaw(program, lineNumber);

		if (evalResult.type === 'pending') {
			void this.resolveAsync(evalResult);
			return pendingValue(evalResult.queryKey);
		}
		if (evalResult.type === 'error') {
			// This is exactly the Tier-2/LOAD_GLOBAL_VAR bypass path
			// ARCHITECTURE.md's P0 item describes, executeCached() never
			// calls preflightAll(), so a global-variable read that should
			// have been guaranteed-resolved by preflight can now surface
			// here as a controlled GLOBAL_VARIABLE_NOT_RESOLVED error
			// (see VM.ts's LOAD_GLOBAL_VAR case) instead of a raw
			// uncaught TypeError. Re-throw so the caller's existing
			// error handling (ThreeTierEvaluator's own per-tier try/catch)
			// handles it exactly like any other executeCached() failure.
			throw evalResult.error;
		}

		return evalResult.value;
	}

    /**
     * Fast path: evaluate an expression and return a number directly.
     *
     * Skips Value object allocation when only a numeric result is needed.
     * Returns NaN whenever the expression has no numeric answer: a thrown
     * error, a bare undefined variable reference, or a faulted result (an
     * Error or a Pending value).
     *
     * Performs a pre-check for bare identifiers (single-token variable
     * references). If the identifier is not a known variable, returns NaN
     * immediately without attempting evaluation, avoids the ambiguity of
     * "result === 0" when a variable might legitimately store the value 0.
     *
     * A faulted result is treated the same way, and for the same reason: an
     * Error or Pending reads as 0 through {@link Value.toNumber}, so returning
     * that 0 would be indistinguishable from a real zero. NaN is this fast
     * path's established "no value" signal, so `evaluateNumber("5 kg to m")`
     * (an impossible conversion) is NaN rather than a silent `0`. A caller that
     * needs the fault's detail should use {@link evaluateExpression} and read
     * {@link Value.errorCode}/{@link Value.isPending} off the result.
     *
     * @param expression - The raw expression string to evaluate.
     * @returns The numeric result, or NaN on error / undefined variable / fault.
     */
    evaluateNumber(expression: string): number {
         const trimmed = expression.trim();

         // Pre-check: bare identifiers that aren't known variables → NaN.
         // Doing this before evaluation avoids the ambiguity of "result === 0"
         // when a variable might legitimately store the value 0.
         if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
             if (this.vm.getVar(trimmed) === undefined) {
                 return NaN;
             }
         }

         try {
             const value = this.evaluateLine(-1, expression);
             // A faulted result has no numeric meaning: toNumber() would read it
             // as 0, indistinguishable from a real zero. Surface it as NaN, the
             // same signal the bare-undefined-variable pre-check above returns.
             if (value.isFault()) return NaN;
             return value.toNumber();
         } catch {
             return NaN;
         }
    }

    //#endregion

    //#region State management, Clear / reset

    clear(): void {
        // Cancel pending batcher flushes and clear listeners to prevent
        // stale re-evaluations from in-flight promises that resolve after clear.
		// This call is what actually releases per-document state. The batcher is
		// reachable from the module-level data-query service, so an engine that
		// goes out of scope without clear() stays retained: on the order of
		// 200KB per engine against 8.2KB for one that never parsed, a figure
		// that grows with the registered package set. See the class doc.
		this.batcher.clearAll();

		// Stop every background-refresh timer before the query cache is emptied
		// below, so no in-flight tick refetches into a cache that is about to be
		// cleared. The manager itself outlives clear() and is reused for the next
		// document.
		this.backgroundRefresh?.clearAll();

		// The query cache holds a garbage-collection timer per cached query,
		// armed for `gcTime` (ten minutes). Those timers keep a Node process
		// alive on their own, so an engine cleared but not emptied here leaves
		// the host unable to exit for up to ten minutes after its last live
		// lookup. That is what it was doing to the test suite: every spec
		// passed, then Jest sat waiting on timers belonging to engines whose
		// documents were long gone.
		//
		// It also belongs here on its own terms. This method is documented as
		// the call that releases per-document state, and cached query results
		// are per-document state.
		this.queryClient.clear();

		// The active client is a module-level hand-off for synchronous VM
		// plugin functions. Leaving ours published after clear() would let a
		// later execution read a cache this engine no longer owns.
		if (getActiveQueryClient() === this.queryClient) setActiveQueryClient(null);

         this.dag.clear();
         this.lineCache.clear();
         this.scopeManager.clear();
         this.clearCompiledCache();
         this.vm.reset();
         this.userUnits.clear();
         this.accumulatorNames.clear();
         this.lastTelemetry = null;
     }

    //#endregion

    //#region Public API, Snapshot / restore

    /**
     * Serialise this engine's session state into a plain, JSON-safe snapshot.
     *
     * Carries the three things a session accumulates in memory: named
     * {@link ExpressionEngine} variables, user-defined functions, and the
     * per-line result/bytecode cache (plus the expression-keyed bytecode cache).
     * Restore it with {@link ExpressionEngine.fromJSON} onto a fresh engine, and
     * later expressions resolve exactly as they would have on the engine that
     * evaluated the document.
     *
     * What is deliberately NOT carried:
     * - **Resolved async values.** Weather, stocks, currency, any package that
     *   fetches: those results are point-in-time and must be re-fetched, not
     *   restored stale. Every line backed by an async resolver (a DAG
     *   data-source dependency, or an async plugin call in its bytecode) is
     *   dropped from the line cache, and any variable whose most-recent
     *   definition was such a line is dropped too. An in-flight (Pending) value
     *   is likewise never written.
     * - **Package-contributed state.** Core state only for v1; a package opt-in
     *   is a follow-up.
     * - **Symbolic (algebra) values.** Deferred: a variable holding one makes
     *   this method throw {@link SnapshotErrorCodes.SNAPSHOT_UNSUPPORTED_VALUE}
     *   (refused by name rather than dropped silently), and a cached line whose
     *   result is symbolic is skipped (it re-evaluates on restore, algebra is
     *   synchronous).
     *
     * The result survives `JSON.stringify` then `JSON.parse` unchanged.
     *
     * @returns A snapshot safe to store and hand back to `fromJSON`.
     * @throws {@link SnapshotErrorCodes.SNAPSHOT_UNSUPPORTED_VALUE} if a variable
     *   holds a value this v1 format cannot represent (a symbolic value).
     */
    toJSON(): EngineSnapshot {
        // Async-backed lines: a line carries a DAG data-source dependency the
        // moment it first goes pending (see executeAndStore's
        // registerLineDataSourceDependency), and an async plugin call sets its
        // bytecode's hasAsync. Either way its result is point-in-time and must
        // be re-fetched rather than restored, so the line and any variable it
        // defines are excluded below.
        const dagSnapshot = this.dag.getSnapshot();
        const asyncLines = new Set<number>();
        for (const key of Object.keys(dagSnapshot.dataSourceDeps)) {
            const line = Number(key);
            if (!Number.isNaN(line)) asyncLines.add(line);
        }

        // Only the LAST definition of a variable decides its current value, so a
        // variable is excluded only when its most-recent writer line is async.
        // An earlier async definition later overwritten by a plain one is still
        // carried, matching the value the live VM actually holds.
        const lineEntries = this.lineCache.snapshotEntries();
        const latestWriter = new Map<string, { line: number; async: boolean }>();
        for (const { line, entry } of lineEntries) {
            const isAsync = asyncLines.has(line) || entry.bytecode.hasAsync;
            if (isAsync) asyncLines.add(line);
            const writeVar = entry.writeVariable;
            if (writeVar) {
                const prev = latestWriter.get(writeVar);
                if (!prev || line >= prev.line) latestWriter.set(writeVar, { line, async: isAsync });
            }
        }

        const variables: Record<string, SerializedValue> = {};
        for (const [name, value] of this.vm.getVariableEntries()) {
            if (value.type === ValueType.Pending) continue; // in-flight async, not restorable
            if (latestWriter.get(name)?.async) continue; // most recently written by an async line
            try {
                variables[name] = serializeValue(value, `variable "${name}"`);
            } catch (e) {
                // A value kind this v1 format defers (a symbolic result, or a
                // split/colour value held in a variable) is skipped rather than
                // aborting the whole snapshot, exactly as the line cache below
                // does. The variable re-establishes when its line re-evaluates
                // on restore; only that one binding is left out of the snapshot.
                if (e instanceof EngineError && e.code === SnapshotErrorCodes.SNAPSHOT_UNSUPPORTED_VALUE) continue;
                throw e;
            }
        }

        // A user-defined function body that calls an async plugin is refused at
        // definition time (FUNCTION_BODY_MUST_BE_SYNCHRONOUS), so every stored
        // function is pure compiled bytecode and safe to carry.
        const userFunctions = this.vm.getUserFunctionDefs().map(serializeUserFunction);

        const lineCache: SerializedLineCacheEntry[] = [];
        for (const { line, expression, entry } of lineEntries) {
            if (asyncLines.has(line)) continue; // async result, re-fetch on restore
            if (entry.result.type === ValueType.Pending) continue; // still in flight
            let result: SerializedValue;
            try {
                result = serializeValue(entry.result, `line ${line}`);
            } catch (e) {
                // A symbolic (algebra) result is the one value kind this v1 format
                // defers. Skip the cached line rather than aborting the whole
                // snapshot: the line re-evaluates on restore, and algebra is
                // synchronous, so nothing is lost but the cache hit. Any other
                // error is a real problem and propagates.
                if (e instanceof EngineError && e.code === SnapshotErrorCodes.SNAPSHOT_UNSUPPORTED_VALUE) continue;
                throw e;
            }
            lineCache.push({
                line,
                expression,
                result,
                bytecode: serializeBytecode(entry.bytecode),
                reads: entry.readVariables.slice(),
                writeVar: entry.writeVariable,
            });
        }

        const bytecodeCache = Array.from(this.bytecodeCache.entries()).map(([expression, program]) => ({
            expression,
            program: serializeBytecode(program),
        }));

        return {
            format: SNAPSHOT_FORMAT,
            version: SNAPSHOT_VERSION,
            engineVersion: ENGINE_VERSION,
            locale: this.localeCode,
            variables,
            userFunctions,
            lineCache,
            bytecodeCache,
        };
    }

    /**
     * Restore a snapshot produced by {@link ExpressionEngine.toJSON} onto a
     * fresh engine.
     *
     * The version gate runs first: a snapshot whose {@link EngineSnapshot.format}
     * or {@link EngineSnapshot.version} does not match this engine's reader is
     * refused with {@link SnapshotErrorCodes.SNAPSHOT_VERSION_MISMATCH} rather
     * than restored wrongly. The engine is then built with the snapshot's locale
     * (unless overridden) and the given `packages`, and its variable table,
     * user-function registry, line cache, dependency graph, and bytecode cache
     * are rehydrated from the snapshot.
     *
     * @param snapshot - A snapshot object, typically straight from `JSON.parse`.
     * @param options - Packages (must match those the snapshot was taken with),
     *   plus optional config, diagnostic mode, and locale override. See
     *   {@link EngineRestoreOptions}.
     * @returns A ready engine that behaves as though it had evaluated the
     *   original document.
     * @throws {@link SnapshotErrorCodes.SNAPSHOT_VERSION_MISMATCH} for a missing
     *   or mismatched envelope, and
     *   {@link SnapshotErrorCodes.SNAPSHOT_MALFORMED} for internally
     *   inconsistent contents.
     */
    static fromJSON(snapshot: EngineSnapshot, options: EngineRestoreOptions = {}): ExpressionEngine {
        // Refuse an incompatible or non-snapshot object before building anything.
        assertRestorable(snapshot);
        const locale = options.locale ?? snapshot.locale ?? "en";
        const engine = new ExpressionEngine({ locale, diagnostics: options.diagnostics ?? false, config: options.config, packages: options.packages, calendar: options.calendar });
        engine.restoreSnapshot(snapshot);
        return engine;
    }

    /**
     * Rehydrate this engine's state from a snapshot whose envelope has already
     * been validated by {@link assertRestorable}. Instance-private, the public
     * entry point is the static {@link ExpressionEngine.fromJSON}.
     */
    private restoreSnapshot(snapshot: EngineSnapshot): void {
        for (const [name, sv] of Object.entries(snapshot.variables)) {
            this.vm.setVar(name, deserializeValue(sv));
        }
        for (const fn of snapshot.userFunctions) {
            const def = deserializeUserFunction(fn);
            this.vm.defineUserFunction(def.name, def.params, def.program);
        }
        for (const e of snapshot.lineCache) {
            const entry = new LineCacheEntry(
                deserializeValue(e.result),
                deserializeBytecode(e.bytecode),
                e.reads.slice(),
                e.writeVar,
            );
            // The empty-string expression key round-trips to the same
            // expressionless slot LineCache stores it under; a non-empty key
            // restores the same line/expression pairing it was written with.
            this.lineCache.set(e.line, entry, e.expression);
            // Rebuild the dependency graph so incremental re-evaluation
            // (evaluateIncremental) still walks producers before consumers,
            // exactly as it would have on the engine that evaluated the document.
            this.dag.registerLine(e.line, e.reads, e.writeVar ? [e.writeVar] : []);
        }
        for (const { expression, program } of snapshot.bytecodeCache) {
            this.bytecodeCache.set(expression, deserializeBytecode(program));
        }
    }

    //#endregion

    //#region Public API, Incremental evaluation

    /**
     * Incrementally re-evaluate lines affected by a variable change.
     * Walks the DAG from the changed variable to find exactly which lines
     * need re-execution, no dirty-set indirection, no sorting guesswork.
     * Uses Kahn's algorithm for topological ordering: producers always
     * execute before consumers, regardless of document line order.
     */
    evaluateIncremental(variable: string, newValue: number): Map<number, Value> {
        // Phase 1.4 DAG-walk: get affected lines in topological order.
        // This replaces the old approach of markDirtyFromVariable() →
        // getDirtyLines() → ascending sort, which (a) double-iterated,
        // (b) picked up unrelated dirty lines, and (c) failed for
        // non-ascending dependency chains.
        const affectedLines = this.dag.getAffectedLinesInOrder(variable);

        // Preserve existing VM state while overriding the changed variable.
        this.vm.setVar(variable, numberValue(newValue));

        const updated = new Map<number, Value>();

        for (const lineNumber of affectedLines) {
            const entry = this.lineCache.getEntryForLine(lineNumber);
            if (!entry || entry.bytecode.opcodes.length === 0) continue;
            const evalResult = this.executeRaw(entry.bytecode, lineNumber);

            if (evalResult.type === 'pending') {
                void this.resolveAsync(evalResult);
                // Don't block, continue processing other affected lines.
                // The pending result will trigger re-evaluation when resolved.
                continue;
            }
            if (evalResult.type === 'error') {
                // Same per-line-containment shape as
                // AsyncResolutionBatcher.reExecuteMainThread()'s fatal-bug
                // fix: this loop re-executes potentially many DAG-affected
                // lines in one pass, a throw here would abort every
                // remaining affected line even though nothing was wrong
                // with them. Record this one line's failure as an Error
                // Value and continue, rather than letting one bad line take
                // out the whole incremental-update batch.
                const value = errorValue(evalResult.error.code, evalResult.error.message);
                updated.set(lineNumber, value);
                entry.result = value;
                continue;
            }

            const result = evalResult.value;
            updated.set(lineNumber, result);
            entry.result = result;
        }
        return updated;
    }

    //#endregion
}

//#endregion