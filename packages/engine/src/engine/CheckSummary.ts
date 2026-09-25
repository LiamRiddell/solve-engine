import type { ParsedLine } from "@solve-js/types/ParsingResult";
import { isCheckLine, isWrittenAsCheck } from "@solve-js/packages/conditionals/CheckFunctions";

/**
 * How many of a document's `check` lines passed and failed, or undefined when
 * it has none (#506).
 *
 * A host reads this to protect a template: a note with a `check` that a later
 * edit breaks can say so in its title bar or refuse to publish, without the host
 * parsing any error text. A passed check answers "✓"; a failed one is a
 * CHECK_FAILED error, which a batch pass reports as the line's error text and
 * the incremental pass as an error value, so both shapes are counted. Only a
 * line written with the `check` keyword counts, so a piece of text that begins
 * with a tick is not a passed check (#594); see {@link isCheckLine}.
 */
export function summariseChecks(lines: readonly ParsedLine[]): { passed: number; failed: number } | undefined {
	let passed = 0;
	let failed = 0;
	for (const line of lines) {
		const result = line.result;
		if (result != null && isCheckLine(line.text, result)) {
			if (result.isError()) failed++;
			else passed++;
		} else if (result == null && line.error?.startsWith("check failed") && isWrittenAsCheck(line.text)) {
			failed++;
		}
	}
	return passed + failed === 0 ? undefined : { passed, failed };
}
