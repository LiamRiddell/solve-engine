/**
 * The generator that edits a document rather than writing one expression.
 *
 * The other two fuzzers ask whether the engine survives its input. This one
 * asks something the engine can fail while surviving perfectly: whether the
 * incremental evaluator, driven the way an editor drives it, still agrees with
 * a plain pass over the same text.
 *
 * That difference is why the shapes below are not the wildest the grammar
 * allows. A case is only useful here if a settled pass has an opinion about it,
 * so every line is something that evaluates, and the interesting ones are the
 * ones that reach across lines: a name defined on one line and read on
 * another, a running total, a category tag, a unit definition, a line
 * reference. Those are the forms whose answer depends on state the incremental
 * path carries between passes, and carried state is what goes stale.
 *
 * The actions are the four things an editor does: change a line, insert one,
 * delete one, and move the viewport. The last one is not decoration. A viewport
 * decides which lines run at all, so it is the action that produces a document
 * whose answers were computed from a subset of itself, and three of the bugs
 * this found needed one.
 *
 * @module DocumentFuzzer
 */

import { Prng } from "@tools/fuzz/Prng";
import type { DocumentCase, EditAction } from "@tools/fuzz/FuzzCase";

/** Knobs the soak and a targeted investigation differ on. */
export interface DocumentFuzzOptions {
	/** How many lines the starting document has, at most. */
	maxLines?: number;
	/** How many editor actions the session performs. */
	maxActions?: number;
}

/**
 * How many distinct names the generated lines draw from.
 *
 * Small on purpose. The bugs this generator exists to find are about a name
 * being defined twice, or defined and then stopped being defined, and a wide
 * name pool makes both vanishingly rare: every line would define its own name
 * and nothing would ever collide or go missing.
 */
const NAME_COUNT = 4;

/** The same reasoning as {@link NAME_COUNT}, for category tags. */
const TAGS = ["food", "travel"] as const;

/**
 * One line's worth of text, given a source of randomness.
 *
 * Each entry is a shape rather than a fixed string, so a session gets varied
 * numbers and names while staying inside forms that mean something.
 */
type LineShape = (rng: Prng) => string;

/**
 * The forms a generated line can take.
 *
 * Grouped by what they exercise, and weighted by repetition rather than by a
 * weights table: a shape listed twice is drawn twice as often, which keeps the
 * list readable as a list of what the generator can say.
 *
 * Deliberately absent: anything whose answer is not a fixed function of the
 * text. A dice roll, a live rate and a date relative to now would each make a
 * settled pass disagree with itself, and a fuzzer whose oracle is unstable
 * reports nothing but its own noise.
 */
const SHAPES: readonly LineShape[] = [
	// Arithmetic, so a document has lines that depend on nothing.
	(rng) => `${rng.range(1, 99)} + ${rng.range(1, 9)}`,
	(rng) => `${rng.range(2, 40)} * ${rng.range(2, 9)}`,

	// A name defined, and a name read. The pair the whole generator is for.
	(rng) => `:v${rng.int(NAME_COUNT)} = ${rng.range(1, 50)}`,
	(rng) => `:v${rng.int(NAME_COUNT)} = ${rng.range(1, 50)}`,
	(rng) => `v${rng.int(NAME_COUNT)} + ${rng.range(1, 9)}`,
	(rng) => `v${rng.int(NAME_COUNT)} * v${rng.int(NAME_COUNT)}`,
	(rng) => `v${rng.int(NAME_COUNT)}`,

	// A running total, whose value is a fold over the lines above it.
	(rng) => `spent += ${rng.range(1, 10)}`,
	(rng) => `spent += ${rng.range(1, 10)}`,
	() => `spent`,

	// The positional aggregates, which read the block above them.
	(rng) => `prev + ${rng.range(1, 5)}`,
	() => `total above`,
	() => `average above`,

	// Category tags, which read every line carrying a name wherever it sits.
	(rng) => `${rng.range(1, 20)} #${TAGS[rng.int(TAGS.length)]}`,
	(rng) => `${rng.range(1, 20)} #${TAGS[rng.int(TAGS.length)]}`,
	(rng) => `total of #${TAGS[rng.int(TAGS.length)]}`,

	// A line reference, which reads one specific position.
	(rng) => `line ${rng.range(1, 6)} + ${rng.range(1, 9)}`,

	// A range, which reads a span of positions at once. The bounds are drawn
	// independently and often the wrong way round, which is the point: a
	// backwards or out-of-range span is a shape a host can ask for.
	(rng) => `sum(line ${rng.range(1, 6)} : line ${rng.range(1, 8)})`,

	// Goal seek, the one form that re-runs another line rather than reading
	// it, and therefore the one whose staleness looks least like the others.
	(rng) => `solve line ${rng.range(1, 8)} for v${rng.int(NAME_COUNT)} = ${rng.range(1, 60)}`,

	// The three lines a markdown table is made of, and a column aggregate to
	// read it. They are emitted independently, so most land alone, which is
	// deliberate: a stray table row is not an expression, and what the engine
	// does with one is worth comparing too. Occasionally they land in order
	// and make a real table.
	() => `| item | cost |`,
	() => `| ---- | ---- |`,
	(rng) => `| ${["rent", "food", "taxi"][rng.int(3)]} | ${rng.range(1, 400)} |`,
	() => `sum of column "cost" above`,

	// A user unit, defined on one line and used on another.
	(rng) => `1 sprint = ${rng.range(1, 4)} weeks`,
	(rng) => `${rng.range(1, 6)} sprints in weeks`,

	// Percentages and conversions, which are ordinary lines that happen to
	// compile to more than arithmetic.
	(rng) => `${rng.range(1, 50)}% of ${rng.range(10, 400)}`,
	(rng) => `${rng.range(1, 40)} km in miles`,
	(rng) => `${rng.range(1, 255)} as hex`,
	// A date literal rather than a date relative to now, so the answer stays a
	// fixed function of the text.
	(rng) => `2020-01-${String(rng.range(1, 28)).padStart(2, "0")} + ${rng.range(1, 60)} days`,

	// The lines that evaluate to nothing. A heading is not filler here: it is
	// the shape a line takes when someone edits an expression away, and it
	// was the last bug this generator found.
	() => ``,
	() => `# a heading`,
	(rng) => `// note ${rng.range(1, 9)}`,
];

/**
 * The text of one generated line.
 *
 * @param rng - The session's random source.
 * @returns A line of document text.
 */
function lineText(rng: Prng): string {
	return SHAPES[rng.int(SHAPES.length)](rng);
}

/**
 * Generate the editing session a seed stands for.
 *
 * The action positions are drawn against a *projected* length rather than the
 * starting one, so a session that inserts ten lines can still act on the lines
 * it created. The projection is only a guess (an action can be skipped at
 * replay when the document turned out shorter), and that is deliberate: the
 * replay clamps rather than the generator, so the same seed means the same
 * session whatever the engine does with it.
 *
 * @param seed - The seed. The same seed always produces the same session.
 * @param options - Size bounds.
 * @returns The case.
 */
export function generateDocumentCase(seed: number, options: DocumentFuzzOptions = {}): DocumentCase {
	const rng = new Prng(seed);
	const maxLines = options.maxLines ?? 14;
	const maxActions = options.maxActions ?? 10;

	const lines: string[] = [];
	const lineCount = rng.range(4, maxLines);
	for (let i = 0; i < lineCount; i++) lines.push(lineText(rng));

	const actions: EditAction[] = [];
	let projected = lineCount;
	for (let step = 0; step < maxActions; step++) {
		const at = rng.range(1, Math.max(1, projected));
		const roll = rng.int(100);
		if (roll < 35) {
			actions.push({ kind: "edit", at, text: lineText(rng) });
		} else if (roll < 55) {
			actions.push({ kind: "insert", at, text: lineText(rng) });
			projected++;
		} else if (roll < 70) {
			actions.push({ kind: "delete", at });
			projected = Math.max(2, projected - 1);
		} else {
			actions.push({ kind: "view", at, end: at + rng.int(6) });
		}
	}

	return { kind: "document", lines, actions };
}
