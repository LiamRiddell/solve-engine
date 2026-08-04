import { DiagnosticEvent } from "./events";
import { DiagnosticReport } from "./events";

/**
 * Interface for collecting diagnostic data during pipeline execution.
 *
 * All methods are implemented as concrete no-ops so subclasses only
 * need to override the ones they care about. This avoids optional
 * method issues with TypeScript's strict mode.
 *
 * The parameters are named `_event` because these base implementations
 * deliberately ignore them. Overrides are free to name theirs `event` and use
 * it; TypeScript does not match parameter names when checking overrides.
 */
export abstract class DiagnosticCollector {
  onPipelineStart(_event: DiagnosticEvent & { type: "pipeline_start" }): void {}
  onTokenEmitted(_event: DiagnosticEvent & { type: "token_emitted" }): void {}
  onNormalizerStart(_event: DiagnosticEvent & { type: "normalizer_start" }): void {}
  onTokenFused(_event: DiagnosticEvent & { type: "token_fused" }): void {}
  onNormalizerEnd(_event: DiagnosticEvent & { type: "normalizer_end" }): void {}
  onParseletMatched(_event: DiagnosticEvent & { type: "parselet_matched" }): void {}
  onBytecodeBuilt(_event: DiagnosticEvent & { type: "bytecode_built" }): void {}
  onVmStep(_event: DiagnosticEvent & { type: "vm_step" }): void {}
  onVmHalt(_event: DiagnosticEvent & { type: "vm_halt" }): void {}
  onCacheHit(_event: DiagnosticEvent & { type: "cache_hit" }): void {}
  onCacheMiss(_event: DiagnosticEvent & { type: "cache_miss" }): void {}
  onPipelineEnd(_event: DiagnosticEvent & { type: "pipeline_end" }): void {}

  abstract getReport(): DiagnosticReport | undefined;
  abstract reset(): void;
}