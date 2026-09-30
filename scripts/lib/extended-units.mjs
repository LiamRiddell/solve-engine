/**
 * The units `ExtendedUnits.ts` defines, read from its source for the unit
 * reference.
 *
 * Kept apart from `generate-unit-reference.mjs`, which needs a built engine, so
 * the reading can be tested on its own. It reads two shapes. One entry per line,
 *
 *   kn: { measure: "speed", toBase: 1852 / 3600 },
 *
 * (a spelling with a space is a quoted key, `"US cup": { ... }`), and a list
 * of spellings spread into the table at once, which is how every
 * spelling of miles per imperial gallon shares one definition (#782):
 *
 *   ...Object.fromEntries(
 *     IMPERIAL_MPG_SPELLINGS.map((spelling) => [spelling, { measure: "fuelEconomy", toBase: MILES_PER_IMPERIAL_GALLON_IN_KM_PER_LITRE }]),
 *   ),
 *
 * The page used to read only the first shape, so the five imperial spellings
 * were accepted by the engine and missing from the page that claims to list
 * every one, and so were the quoted spellings (`US cup`, `metric cup`). A spread of any other shape now fails the run rather than being
 * left out, and so does a list or a constant it names that the file does not
 * define.
 *
 * @module extended-units
 */

/**
 * Reads a `toBase` value, which is written as a number or a small expression.
 *
 * `ExtendedUnits.ts` states ratios the way they are defined rather than as a
 * decimal someone worked out: a knot is `1852 / 3600` because a nautical mile
 * is 1852 metres and an hour is 3600 seconds, and that is worth keeping
 * readable in the source.
 *
 * Parsed explicitly rather than evaluated. Handing repository text to `eval`
 * to save a dozen lines is how a documentation generator becomes a way to run
 * code, and an unrecognised shape throws here rather than quietly producing a
 * ratio that is wrong in a table nobody double-checks.
 *
 * @param {string} raw - The expression as written.
 * @param {ReadonlyMap<string, string>} [constants] - Named constants the expression may be, each as written.
 * @returns {number} The ratio.
 */
export function ratioValue(raw, constants = new Map()) {
	// Numeric separators are readability only, and `Number` does not accept
	// them: `1_000_000` parses as NaN rather than as a million.
	const text = raw.trim().replace(/(\d)_(\d)/g, "$1$2").replace(/(\d)_(\d)/g, "$1$2");
	// A constant is read as it is written, and once: one that names itself
	// again would otherwise never finish.
	if (constants.has(text)) {
		const rest = new Map(constants);
		rest.delete(text);
		return ratioValue(constants.get(text), rest);
	}
	const plain = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
	if (plain.test(text)) return Number(text);

	const binary = text.match(/^(-?\d+(?:\.\d+)?)\s*([*/])\s*(-?\d+(?:\.\d+)?)$/);
	if (binary !== null) {
		const [, left, operator, right] = binary;
		return operator === "/" ? Number(left) / Number(right) : Number(left) * Number(right);
	}

	throw new Error(`Cannot read the ratio ${JSON.stringify(text)}. Extend ratioValue rather than guessing at it.`);
}

/**
 * The exported string lists and numeric constants a spread may name:
 * `export const NAME: readonly string[] = ["a", "b"];` and
 * `export const NAME = 1.609344 / 4.54609;`.
 *
 * @param {string} source - The file's text.
 * A constant is kept as written and read only when a spread names it, so an
 * export the reference never uses cannot fail the run.
 *
 * @returns {{ lists: Map<string, string[]>, constants: Map<string, string> }}
 */
export function readNamedValues(source) {
	const lists = new Map();
	for (const match of source.matchAll(/^export const ([A-Z][A-Z0-9_]*)(?::[^=\n]+)?\s*=\s*\[([^\]]*)\];/gm)) {
		const items = JSON.parse(`[${match[2].trim().replace(/,\s*$/, "")}]`);
		if (!items.every((item) => typeof item === "string")) throw new Error(`${match[1]} is not a list of spellings.`);
		lists.set(match[1], items);
	}
	const constants = new Map();
	for (const match of source.matchAll(/^export const ([A-Z][A-Z0-9_]*)\s*=\s*([^;\n[]+);/gm)) {
		constants.set(match[1], match[2]);
	}
	return { lists, constants };
}

/**
 * Every unit the file defines, one entry per spelling, in source order.
 *
 * @param {string} source - The text of `ExtendedUnits.ts`.
 * @returns {{ spelling: string, measure: string, ratio: number }[]}
 */
export function readExtendedEntries(source) {
	const { lists, constants } = readNamedValues(source);
	const found = [];

	// A key is a bare word (`kn`) or, for a spelling with a space, a quoted
	// string (`"US cup"`), which the page also once left out.
	for (const match of source.matchAll(/^\s+(?:([A-Za-z_][A-Za-z0-9_]*)|"([^"\\]+)"):\s*\{\s*measure:\s*"([^"]+)",\s*toBase:\s*([^}]+)\}/gm)) {
		const [, bare, quoted, measure, ratio] = match;
		found.push({ at: match.index, spelling: bare ?? quoted, measure, ratio: ratioValue(ratio.trim().replace(/,$/, ""), constants) });
	}

	// Every spread in the file must be read, or the run fails: counted by the
	// bare `...` so a spread in a shape the pattern does not know is noticed.
	const spreads = [...source.matchAll(/^\s+\.\.\./gm)].length;
	const spreadShape = /^\s+\.\.\.Object\.fromEntries\(\s*([A-Z][A-Z0-9_]*)\.map\(\(\s*(\w+)\s*\)\s*=>\s*\[\s*\2\s*,\s*\{\s*measure:\s*"([^"]+)",\s*toBase:\s*([^}]+?)\s*\}\s*\]\s*\),?\s*\)/gm;
	let read = 0;
	for (const match of source.matchAll(spreadShape)) {
		const [, listName, , measure, ratio] = match;
		const spellings = lists.get(listName);
		if (spellings === undefined) throw new Error(`The spread names ${listName}, which the file does not export as a list of spellings.`);
		const value = ratioValue(ratio, constants);
		for (const spelling of spellings) found.push({ at: match.index, spelling, measure, ratio: value });
		read++;
	}
	if (read !== spreads) {
		throw new Error(`ExtendedUnits.ts spreads ${spreads} lists into the table and ${read} could be read. Extend readExtendedEntries rather than leaving spellings off the page.`);
	}

	return found.sort((a, b) => a.at - b.at).map(({ spelling, measure, ratio }) => ({ spelling, measure, ratio }));
}
