export {
	ExpressionEngine,
	SNAPSHOT_FORMAT,
	SNAPSHOT_VERSION,
	SnapshotErrorCodes,
} from "./ExpressionEngine";
export type {
	CacheSnapshot,
	BatcherMetrics,
	CheckpointSnapshot,
	BytecodeCacheEntry,
	LineCacheEntryInfo,
	AsyncCachePackageInfo,
	DagSnapshot,
	EngineOptions,
	EngineRestoreOptions,
	EngineSnapshot,
	ExpressionTokens,
	SerializedValue,
	SerializedBytecode,
	SerializedUserFunction,
	SerializedAnonymousBody,
	SerializedLineCacheEntry,
	SerializedDecimal,
	SerializedRational,
	SerializedNumber,
	WhatIfOverrides,
	SerializedValueSidecars,
	SerializedFrozenRecord,
	FrozenRecord,
	ValueSource,
	SourceKind,
	FrozenMark,
} from "./ExpressionEngine";

export type { Explanation, ExplanationStep, ExplainCall, ExplainContext, ExplainHook, LineTrace } from "@solve-js/explain";
// A trace as the one line of text `inputs of line N` answers with.
export { formatLineTrace } from "@solve-js/explain";

// A unit a note defines, as `ExpressionEngine.readExpressionTokens` takes and
// reports it.
export type { DocumentUnit } from "@solve-js/packages/uom/UserUnitTable";

// The calendar the engine computes dates with, the `calendar` option's type,
// and the `Date` backend that option defaults to.
export type { CalendarBackend, CalendarFields, ZonedFields } from "@solve-js/calendar/CalendarBackend";
export { DateCalendar, DATE_CALENDAR, calendarOf, dateCalendarInZone } from "@solve-js/calendar/DateCalendar";

// What `ExpressionEngine.getDateReading()` answers with: the order this engine
// reads an ambiguous numeric date literal in, and where that order came from.
export type {
	DateReading,
	DateReadingPolicy,
	DateOrderSource,
	ResolvedDateOrder,
} from "@solve-js/packages/datetime/DateReading";

export { DocumentModel } from "./DocumentModel";
export type {
	LineState,
	ViewportRange,
	LineChange,
	ApplyChangesResult,
} from "./DocumentModel";

export { ThreeTierEvaluator, EvalTier } from "./ThreeTierEvaluator";
export type { EvalLineResult, EvalResult } from "./ThreeTierEvaluator";

export { AsyncResolutionBatcher } from "./AsyncResolutionBatcher";
export type {
	LinesUpdatedEvent,
	AsyncErrorEvent,
	AsyncResolutionEvent,
} from "./AsyncResolutionBatcher";

export { evaluateDocument } from "./evaluateDocument";
// The return shape of evaluateDocument() above, and of ExpressionEngine's own
// parseDocument(), so a host can type either result.
export type { ParsedLine, ParsingResult, UnifiedParsingOptions } from "@solve-js/types/ParsingResult";

export {
	checkExpressionLength,
	checkExpressionComplexity,
	extractReadsAndWrites,
	isEmptyLine,
	findInlineSolvesInLine,
} from "./ExpressionEngineSafety";
export type { ValidationConfig, SafetyCheckResult } from "./ExpressionEngineSafety";
// Re-exported here (not from `types/`, which is internal-only) because it's
// the return type of the public findInlineSolvesInLine() above.
export type { InlineSolvePosition } from "@solve-js/types/ParsingResult";

// Off-thread compile and execute: how a host says what to start a worker
// from. Exported here beside ThreeTierEvaluator, which is what uses it.
export { setEngineWorkerFactory } from "@solve-js/workers/WorkerFactory";
export type { EngineWorkerFactory } from "@solve-js/workers/WorkerFactory";
