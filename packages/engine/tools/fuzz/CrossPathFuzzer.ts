/**
 * Documents for the cross-path generator: one text, asked of both public
 * whole-document entry points.
 *
 * The document generator asks whether an editing session ends where a pass over
 * the finished text does. Nothing asked whether the two public entry points
 * agree with each other, `parseDocument` (the batch pass) and `evaluateDocument`
 * (the incremental pass standing up for one call), though the project's rule is
 * that they agree value for value on every form both support. A probe that did
 * ask, once, found two disagreements on its first run (#609 and #613). This
 * generator is the standing version of that probe (#688).
 *
 * It draws its lines from the document generator's shapes, so the two cover the
 * same forms, less the one only the incremental pass supports: goal seek, which
 * `parseDocument` refuses by design (the cross-path spec pins the refusal).
 *
 * @module CrossPathFuzzer
 */

import { Prng } from "@tools/fuzz/Prng";
import { lineText } from "@tools/fuzz/DocumentFuzzer";
import type { CrossPathCase } from "@tools/fuzz/FuzzCase";

/** Size bounds for a generated document. */
export interface CrossPathFuzzOptions {
	/** The most lines a document has. */
	maxLines?: number;
}

/** A form only one of the two passes supports, so it is left out of the comparison. */
const ONE_PATH_ONLY = /^\s*solve line /;

/**
 * Generate the document a seed stands for.
 *
 * Sometimes the text ends in a line break, since a trailing break is a shape a
 * host sends and one the two passes once counted differently (#613).
 *
 * @param seed - The seed. The same seed always produces the same document.
 * @param options - Size bounds.
 * @returns The case.
 */
export function generateCrossPathCase(seed: number, options: CrossPathFuzzOptions = {}): CrossPathCase {
	const rng = new Prng(seed);
	const maxLines = options.maxLines ?? 16;
	const lineCount = rng.range(1, maxLines);
	const lines: string[] = [];
	while (lines.length < lineCount) {
		const text = lineText(rng);
		if (!ONE_PATH_ONLY.test(text)) lines.push(text);
	}
	if (rng.int(100) < 15) lines.push("");
	return { kind: "crosspath", lines };
}
