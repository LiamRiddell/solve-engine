/**
 * The engine's structured error type, the "Rust/Go-style, verbose, easy to
 * tell the issue" half of the error-handling redesign (the other half is
 * `Result.ts`).
 *
 * Historical note: an earlier version of this class (`UnifiedErrorFramework.ts`,
 * still the import path most of the codebase uses. See that file, now a
 * pure re-export barrel) had a much larger field set (`severity`,
 * `recovery`, a 5-value enum, `ErrorRecoveryManager`) that was almost
 * entirely dead: nothing downstream ever read `.severity`/`.recovery`,
 * only `.message` reliably survived to a caller. This version is smaller
 * and deliberately keeps only fields something actually consumes.
 */

import type { ErrorCode } from "@solve-js/errors/ErrorCode";

/** A character-offset (and optional line/col) span into the original expression text, for a future "underline the offending token" UI, not yet wired to one. */
export interface SourceSpan {
  start: number;
  end: number;
  line?: number;
  col?: number;
}

/**
 * Error classification, kept from the original framework, now actually
 * consulted: it's the `format()` header and lets host code group errors
 * by pipeline stage without string-matching `.code`.
 */
export enum ErrorCategory {
  /** Errors during expression parsing. */
  PARSING = "PARSING",
  /** Errors during bytecode execution. */
  EXECUTION = "EXECUTION",
  /** Errors from input validation (safety limits, config). */
  VALIDATION = "VALIDATION",
  /** Errors from external services/APIs (currency rates, weather, stocks). */
  EXTERNAL = "EXTERNAL",
  /** Internal engine invariant violations. See `recoverable`'s doc comment. */
  INTERNAL = "INTERNAL",
  /** Configuration errors. */
  CONFIG = "CONFIG",
}

/** Fields accepted when constructing an {@link EngineError}. */
export interface EngineErrorInit {
  /** Catalog code. See `errors/ErrorCode.ts`. Not a free string: every code used by a BUILT-IN package should be registered there so `ErrorCodeCatalog.spec.ts` can catch collisions/typos. Third-party packages may still use any string here, `EngineError.code`'s runtime type is `string`. */
  code: ErrorCode | (string & {});
  /** Short, single-line, `Error.message`-compatible. Existing `.toThrow(/pattern/)`/`.message` assertions keep working against this field, richer detail goes in `expected`/`found`/`suggestion`, not crammed into this string. */
  message: string;
  /** What the parser/validator/VM expected to see, in plain words, e.g. "a city name", "a 4-digit year", "end of expression". */
  expected?: string;
  /** What was actually found instead, e.g. "end of expression", `NUMBER "5"`, the offending token's literal text. */
  found?: string;
  /** An actionable, worked-example fix, e.g. `e.g. "weather in London"`. Mirrors this codebase's best existing messages (`WEATHER_EXPECTED_CITY`, `AS_CONVERTER_EXPECTED_NAME`). */
  suggestion?: string;
  /**
   * Whether this engine instance is still usable. `true` for everything that
   * went wrong on ONE line, whether the line's fault (bad syntax, an unknown
   * variable, a safety limit exceeded), the environment's (an external API
   * down), or the engine's own (corrupted bytecode, a stack underflow from a
   * buggy plugin). `false` is for the far rarer case where there is no working
   * engine to go on with: a configuration or package-registration failure,
   * which is what `ErrorFactory.config()` is for and the only factory method
   * that still defaults to it.
   *
   * The category answers a different question, and the two used to be answered
   * as one. Category INTERNAL says whose fault this is, the engine's, worth
   * reporting as a bug. `recoverable` says whether the host may carry on, and
   * after an internal slip on one line it may:
   * `__tests__/hardening/RobustnessEngineLifecycle.spec.ts` alternates a
   * throwing line with a good one five hundred times and every answer stays
   * correct. Reporting that as `isFatal()` told a host the opposite, and a host
   * that honours the name would tear a document down over one bad line.
   *
   * This has never gated "does evaluation of the rest of the document
   * continue"; with this engine's per-line containment it always does, even for
   * a `recoverable: false` error (see `ARCHITECTURE.md`'s async-batcher/Tier-2
   * hardening notes). It gates what a host is TOLD. See
   * {@link EngineError.isFatal}.
   */
  recoverable?: boolean;
  /** Character-offset span into the source expression, when available. Not yet threaded through every call site, populate opportunistically, don't block on retrofitting every existing throw site. */
  span?: SourceSpan;
  /** Free-form structured context. The one field the pre-existing framework's real consumer (`ThreeTierEvaluator.ts`'s DAG-preservation-on-compile-error path) actually reads, kept name- and shape-compatible on purpose. */
  context?: Record<string, unknown>;
  /** The underlying error this one wraps, if any, passed straight through to native `Error.cause` (ES2022), so Node's default printer, most loggers, and `instanceof Error` tooling understand the chain for free. */
  cause?: unknown;
}

/**
 * The engine's structured error type. Still a real `Error` subclass (so
 * `throw`/`catch`/`instanceof Error` all keep working exactly as before),
 * but now every field except the removed `severity`/`recovery` pair is
 * something real code reads.
 */
export class EngineError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly expected?: string;
  readonly found?: string;
  readonly suggestion?: string;
  readonly recoverable: boolean;
  readonly span?: SourceSpan;
  readonly context?: Record<string, unknown>;
  readonly timestamp: Date;
  /**
   * Set explicitly (not via `super(message, {cause})`). This repo's
   * `tsconfig.json` targets ES6/ES5-ES7 lib, which predates TypeScript's
   * ES2022 `Error` constructor `cause`-option overload. `Error.prototype.cause`
   * is still a real runtime feature in every target this engine actually
   * runs in (Node 16.9+, all evergreen browsers, Electron/Obsidian's
   * bundled Chromium) regardless of the TS lib target used to type-check
   * against it, assigning it directly gets the same Node-printer/logger
   * interop with no build-config change needed.
   */
  readonly cause?: unknown;

  /**
   * Whether a recoverable error captures a JavaScript stack trace.
   *
   * Off, because a recoverable EngineError is a value rather than a fault. A
   * line of prose in a notepad is not an expression, so parsing it fails, and
   * that failure is the answer for that line rather than a bug to debug. The
   * engine builds one such error per non-expression line.
   *
   * Capturing a stack is not cheap, and its cost grows with how deep the stack
   * is when it happens. Measured through `parseDocument`, where the throw site
   * sits about a dozen frames down, each capture cost around 62 microseconds
   * and a 250-line document built 74 of them: a CPU profile put the
   * constructor at 46% of the whole pipeline, more than lexing, normalising,
   * parsing and executing put together.
   *
   * Turn it on to debug where a recoverable error is raised from. Errors that
   * are NOT recoverable always capture, since those are the genuine faults.
   *
   * @example
   * ```ts
   * EngineError.captureRecoverableStacks = true;
   * ```
   */
  static captureRecoverableStacks = false;

  constructor(category: ErrorCategory, init: EngineErrorInit) {
    // Before super(), which is legal as long as `this` is untouched. V8 reads
    // `Error.stackTraceLimit` while constructing the Error, so zeroing it
    // across the super() call is what actually skips the capture; there is no
    // per-instance switch for it.
    const recoverable = init.recoverable ?? true;
    const skipStack = recoverable && !EngineError.captureRecoverableStacks;
    // `stackTraceLimit` is a V8 extension, present in Node and every
    // Chromium-based browser but absent from the DOM lib, so it is reached
    // through a narrow local view rather than by widening the global type.
    // Where it does not exist, reading and writing it are both harmless and
    // the stack is captured as before.
    const errorCtor = Error as unknown as { stackTraceLimit?: number };
    const previousLimit = errorCtor.stackTraceLimit;
    if (skipStack) errorCtor.stackTraceLimit = 0;
    super(init.message);
    if (skipStack) errorCtor.stackTraceLimit = previousLimit;

    this.name = "EngineError";
    this.category = category;
    this.code = init.code;
    this.expected = init.expected;
    this.found = init.found;
    this.suggestion = init.suggestion;
    this.recoverable = recoverable;
    this.span = init.span;
    this.context = init.context;
    this.cause = init.cause;
    this.timestamp = new Date();
    // Only for the faults. super() has already captured a stack for those, and
    // this second call recaptures it purely to drop this constructor's own
    // frame; doing that for every error meant paying the whole cost twice.
    if (!skipStack && Error.captureStackTrace) {
      Error.captureStackTrace(this, EngineError);
    }
  }

  /** `!recoverable`. See `EngineErrorInit.recoverable`'s doc comment for what this actually gates (message framing/telemetry, not whether evaluation continues). */
  isFatal(): boolean {
    return !this.recoverable;
  }

  /** Walk `.cause` repeatedly, collecting the full chain (this error first). */
  causeChain(): unknown[] {
    const chain: unknown[] = [this];
    let current: unknown = this.cause;
    while (current !== undefined && current !== null) {
      chain.push(current);
      current = current instanceof Error ? (current as Error & { cause?: unknown }).cause : undefined;
    }
    return chain;
  }

  /**
   * Rust/Go-style multi-line renderer, the NEW thing a host/CLI/test
   * reaches for when it wants the full, verbose picture, as distinct from
   * `.message` (kept short and stable for existing assertions). Example:
   *
   * ```
   * error[WEATHER_EXPECTED_CITY]: Expected a city name after "weather in"
   *   expected: a city name
   *   found: end of expression
   *   suggestion: e.g. "weather in London"
   * ```
   */
  format(): string {
    const lines = [`error[${this.code}]: ${this.message}`];
    if (this.expected) lines.push(`  expected: ${this.expected}`);
    if (this.found) lines.push(`  found: ${this.found}`);
    if (this.suggestion) lines.push(`  suggestion: ${this.suggestion}`);
    return lines.join("\n");
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      category: this.category,
      code: this.code,
      message: this.message,
      expected: this.expected,
      found: this.found,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      span: this.span,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

/**
 * Factory for creating classified `EngineError`s. Every method accepts
 * EITHER the original, minimal 3-arg shape (`code, message, context?`
 * every existing call site across the codebase keeps compiling unchanged)
 * OR the richer `EngineErrorInit` object (for `expected`/`found`/
 * `suggestion`/`recoverable`/`span`/`cause`), upgrade a call site to the
 * richer form only when you're already touching it, no separate churn
 * pass required.
 */
export class ErrorFactory {
  private static build(
    category: ErrorCategory,
    defaultRecoverable: boolean,
    codeOrInit: string | EngineErrorInit,
    message?: string,
    context?: Record<string, unknown>,
  ): EngineError {
    const init: EngineErrorInit =
      typeof codeOrInit === "string"
        ? { code: codeOrInit, message: message!, context }
        : codeOrInit;
    return new EngineError(category, { recoverable: defaultRecoverable, ...init });
  }

  static validation(code: string, message: string, context?: Record<string, unknown>): EngineError;
  static validation(init: EngineErrorInit): EngineError;
  static validation(codeOrInit: string | EngineErrorInit, message?: string, context?: Record<string, unknown>): EngineError {
    return ErrorFactory.build(ErrorCategory.VALIDATION, true, codeOrInit, message, context);
  }

  static parsing(code: string, message: string, context?: Record<string, unknown>): EngineError;
  static parsing(init: EngineErrorInit): EngineError;
  static parsing(codeOrInit: string | EngineErrorInit, message?: string, context?: Record<string, unknown>): EngineError {
    return ErrorFactory.build(ErrorCategory.PARSING, true, codeOrInit, message, context);
  }

  static execution(code: string, message: string, context?: Record<string, unknown>): EngineError;
  static execution(init: EngineErrorInit): EngineError;
  static execution(codeOrInit: string | EngineErrorInit, message?: string, context?: Record<string, unknown>): EngineError {
    return ErrorFactory.build(ErrorCategory.EXECUTION, true, codeOrInit, message, context);
  }

  static external(code: string, message: string, context?: Record<string, unknown>): EngineError;
  static external(init: EngineErrorInit): EngineError;
  static external(codeOrInit: string | EngineErrorInit, message?: string, context?: Record<string, unknown>): EngineError {
    return ErrorFactory.build(ErrorCategory.EXTERNAL, true, codeOrInit, message, context);
  }

  /**
   * Reserve for genuine engine-internal invariant violations (corrupted
   * bytecode, a stack underflow from a buggy plugin, an "impossible" state),
   * not for user-input errors: the category is a bug report.
   *
   * Defaults `recoverable: true` all the same, because every one of these sites
   * is an invariant that failed on ONE line and none of them leaves the engine
   * unusable. This used to default to `false`, which conflated "the engine's
   * fault" with "the engine is finished" and told a host to tear a document
   * down over a line it could simply have shown an error against. A site that
   * has looked at its own case and concluded the instance really is gone can
   * still pass `recoverable: false` explicitly. See {@link
   * EngineErrorInit.recoverable}.
   */
  static internal(code: string, message: string, context?: Record<string, unknown>): EngineError;
  static internal(init: EngineErrorInit): EngineError;
  static internal(codeOrInit: string | EngineErrorInit, message?: string, context?: Record<string, unknown>): EngineError {
    return ErrorFactory.build(ErrorCategory.INTERNAL, true, codeOrInit, message, context);
  }

  /** Defaults `recoverable: false`, and is now the only method that does: a configuration or package-registration failure is the one class that leaves no working engine to carry on with, rather than one bad line in a document. */
  static config(code: string, message: string, context?: Record<string, unknown>): EngineError;
  static config(init: EngineErrorInit): EngineError;
  static config(codeOrInit: string | EngineErrorInit, message?: string, context?: Record<string, unknown>): EngineError {
    return ErrorFactory.build(ErrorCategory.CONFIG, false, codeOrInit, message, context);
  }
}

/**
 * Normalize any thrown value into an `EngineError`, an `EngineError`
 * passes through as-is; a plain `Error` gets wrapped (message preserved,
 * original attached via `cause`); anything else becomes a generic
 * "unknown error" wrapping the stringified value. Used at every
 * throw-space/Result-space boundary (`Result.tryCatch`'s default
 * `normalize`, the VM's outer execution try/catch, `AsyncResolutionBatcher`'s
 * per-line containment) so a raw `TypeError` from a genuine engine bug
 * still surfaces as a structured, catalogued error instead of an opaque
 * uncaught exception.
 *
 * Both branches state RECOVERABLE explicitly, while keeping the INTERNAL
 * category. The two fields answer different questions and were previously
 * answering the same one:
 *
 *   category INTERNAL  whose fault is this? The engine's. Worth reporting.
 *   recoverable        is this engine instance still usable? Yes.
 *
 * Everything reaching here is by definition something the engine did not
 * anticipate on ONE line, and per-line containment means the next line
 * evaluates normally, which `__tests__/hardening/RobustnessEngineLifecycle`
 * demonstrates over hundreds of alternating failure/success pairs. Reporting
 * that as `isFatal()` told a host the opposite, and a host that honours the
 * name would tear a document down over a single bad line. The "this is an
 * engine bug rather than your syntax" signal a caller wants for telemetry is
 * the CATEGORY, which is unchanged.
 *
 * The flag is written out here rather than inherited from
 * `ErrorFactory.internal()`, which now defaults the same way, so that this
 * function's contract survives a future change to that default.
 */
export function normalizeUnknownError(error: unknown): EngineError {
  if (error instanceof EngineError) return error;
  if (error instanceof Error) {
    return ErrorFactory.internal({
      code: "UNEXPECTED_ERROR",
      message: error.message,
      context: { originalErrorName: error.name },
      cause: error,
      recoverable: true,
    });
  }
  return ErrorFactory.internal({
    code: "UNKNOWN_ERROR",
    message: "An unknown error occurred",
    context: { error: String(error) },
    recoverable: true,
  });
}
