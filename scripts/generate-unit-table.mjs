/**
 * Generates `packages/engine/src/uom/generated/UnitTable.generated.ts` from the
 * `convert` npm package's own generated tables.
 *
 * Run by hand, output committed. This is not a build step: the tables change
 * only when `convert` is upgraded, and the whole point of the exercise is that
 * the engine stops depending on `convert` at runtime.
 *
 * Usage:
 *   node scripts/generate-unit-table.mjs            write the file
 *   node scripts/generate-unit-table.mjs --check    verify the committed file is current
 *
 * Why mirror rather than hand-author a smaller table: the reachable unit
 * vocabulary is genuinely unbounded. The cooking package passes its target unit
 * straight through as raw text, so `300g butter in millilitres` works today;
 * best-unit selection emits spellings that are not lexer tokens at all (0.5 l
 * gives "500.00000000000006 mL"); and the `to ?` possibilities list is a
 * separate curated vocabulary that is not a subset of the unit table. A
 * hand-picked subset would silently break all three.
 *
 * Why not derive the ratios from SI definitions: `convert` carries values that
 * are not derivable (psi is 6894.757, not the exact 6894.757293168361; torr is
 * 133.32236842105263) and deliberate calendar simplifications (a month is 30
 * days, a year is 365). Recomputing them would be reverse-engineering someone
 * else's rounding choices and calling it our own work.
 *
 * Float fidelity: every number is emitted with `String(n)`, which produces the
 * shortest decimal that parses back to the identical double. That is what makes
 * the mirror bit-exact without transcribing `Math.PI / 180` as an expression.
 * The round-trip is asserted per value below rather than assumed.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONVERT_ROOT = path.join(REPO_ROOT, "node_modules", "convert");
const OUTPUT_PATH = path.join(
	REPO_ROOT,
	"packages",
	"engine",
	"src",
	"uom",
	"generated",
	"UnitTable.generated.ts"
);

const checkOnly = process.argv.includes("--check");

/**
 * Ratios where `convert` is wrong, corrected on the way through.
 *
 * The generated file is a verbatim mirror by design, so an entry here is a
 * claim that UPSTREAM IS IN ERROR, not that this project prefers a different
 * number. Rounding choices, calendar simplifications and non-derivable
 * constants are upstream's to make and are mirrored unchanged; only an
 * arithmetic mistake belongs in this list.
 *
 * Each entry records the value `convert` currently ships. Applying it asserts
 * that value is still there, so upgrading `convert` past a fix fails the
 * generator loudly and the correction gets DELETED rather than silently
 * re-applied over a value that is already right.
 */
const UPSTREAM_UNIT_CORRECTIONS = [
	{
		units: [
			"square decimeter",
			"square decimetre",
			"square decimeters",
			"square decimetres",
			"dm²",
			"dm2",
		],
		upstream: 0.1,
		corrected: 0.01,
		why:
			"A decimetre is a tenth of a metre and a tenth squared is a hundredth, so a " +
			"square decimetre is 0.01 square metres. Upstream records 0.1, which makes it " +
			"ten times too large and every conversion through it out by a factor of ten. " +
			"Every other metric prefix in the same table squares its length correctly and " +
			"the cubic decimetre is right at 0.001, so this is one mistyped ratio rather " +
			"than a different convention about what a decimetre is.",
	},
];

/**
 * Best-unit lists where `convert` is wrong, corrected on the way through.
 *
 * Same standard as the ratio corrections above: upstream's choice of which
 * units to offer is upstream's to make, and only a list that the selection
 * algorithm cannot walk belongs here.
 */
const UPSTREAM_BEST_UNIT_CORRECTIONS = [
	{
		kind: 6,
		upstream: [["lux", 1], ["µlx", 0.000001], ["nlx", 1e-9], ["klx", 1000]],
		corrected: [["lux", 1], ["klx", 1000]],
		why:
			"convertToBestMetric walks the list forwards and keeps the last entry whose " +
			"threshold the magnitude reaches, so a list that descends does not merely " +
			"pick a poor unit, it runs off the end of the sensible ones: every value at " +
			"or above one lux walked past lux and µlx and settled on NANOLUX, and a lit " +
			"office read as 500,000,000,000 nlx.\n\n" +
			"The two sub-lux entries are dropped rather than moved to the front, because " +
			"the thresholds are expressed in the list's FIRST unit and would have to be " +
			"restated in nanolux if nanolux led the list. Restating them does not " +
			"survive: the algorithm reaches lux by converting the magnitude into the " +
			"leading unit, and one lux in nanolux is 999999999.9999999 rather than 1e9, " +
			"one ulp below its own threshold, so a plain 1 lux would report as 1000 µlx. " +
			"Nothing is lost by dropping them either, because with lux leading the list " +
			"the two were already unreachable: a magnitude under one lux breaks out at " +
			"the first entry, and a magnitude over it clears both thresholds on the way " +
			"past.",
	},
];

/**
 * Applies the corrections above to the freshly imported upstream tables.
 *
 * Mutates the imported objects rather than patching the emitted text, so the
 * self-check below still verifies that every number written out parses back to
 * the number it was generated from.
 *
 * @returns the set of unit spellings that were corrected, so the emitter can
 * mark them in the output.
 */
function applyUpstreamCorrections(unitsObject, bestUnits) {
	const correctedUnits = new Map();
	for (const { units, upstream, corrected } of UPSTREAM_UNIT_CORRECTIONS) {
		for (const unit of units) {
			const entry = unitsObject[unit];
			if (entry === undefined) {
				throw new Error(
					`Correction for ${JSON.stringify(unit)} no longer applies: convert has no such unit. ` +
						`Delete it from UPSTREAM_UNIT_CORRECTIONS or repoint it.`
				);
			}
			if (!Object.is(entry[1], upstream)) {
				throw new Error(
					`Correction for ${JSON.stringify(unit)} no longer applies: convert now ships ` +
						`${entry[1]}, not the ${upstream} this correction was written against. ` +
						`If upstream fixed it, delete the correction.`
				);
			}
			unitsObject[unit] = [entry[0], corrected];
			correctedUnits.set(unit, upstream);
		}
	}

	const correctedKinds = new Map();
	for (const { kind, upstream, corrected } of UPSTREAM_BEST_UNIT_CORRECTIONS) {
		const entries = bestUnits[0][kind];
		if (JSON.stringify(entries) !== JSON.stringify(upstream)) {
			throw new Error(
				`Best-unit correction for kind ${kind} no longer applies: convert now ships ` +
					`${JSON.stringify(entries)}, not ${JSON.stringify(upstream)}. ` +
					`If upstream fixed it, delete the correction.`
			);
		}
		bestUnits[0][kind] = corrected;
		correctedKinds.set(kind, upstream);
	}

	return { correctedUnits, correctedKinds };
}

/** Imports one of `convert`'s internal generated modules by file path. */
async function importConvertModule(relativePath) {
	const absolute = path.join(CONVERT_ROOT, relativePath);
	if (!fs.existsSync(absolute)) {
		throw new Error(
			`Cannot find ${absolute}. Install dependencies first, and note this script reads ` +
				`convert's internal dist layout, which its package.json exports map does not expose.`
		);
	}
	return import(pathToFileURL(absolute).href);
}

/**
 * Serializes a number so that reading it back yields the identical double.
 *
 * Throws rather than warning: a silently-lossy constant would surface much
 * later as an off-by-one-ulp conversion result, which is exactly the class of
 * bug this whole port has to rule out.
 */
function emitNumber(value) {
	if (!Number.isFinite(value)) {
		throw new Error(`Refusing to emit non-finite value ${value}`);
	}
	if (Object.is(value, -0)) {
		throw new Error("Refusing to emit negative zero, which changes division sign");
	}
	const text = String(value);
	if (!Object.is(Number(text), value)) {
		throw new Error(`Value ${value} does not round-trip through String() (got ${text})`);
	}
	return text;
}

/** Quotes an object key. JSON.stringify handles quotes, backslashes and control characters. */
function emitKey(key) {
	return JSON.stringify(key);
}

async function main() {
	const { version } = JSON.parse(
		fs.readFileSync(path.join(CONVERT_ROOT, "package.json"), "utf8")
	);
	const { unitsObject, differences } = await importConvertModule("dist/generated/parse-unit.js");
	const { bestUnits } = await importConvertModule("dist/generated/best-units.js");
	const { conversions } = await importConvertModule("dist/generated/conversions.js");
	const { MeasureKind } = await importConvertModule("dist/types/public.js");

	// Numeric enum members reverse-map, so filter to the name-keyed half.
	const kindNames = new Map();
	for (const [name, id] of Object.entries(MeasureKind)) {
		if (typeof id === "number") {
			// "Angle" to "angle", "LuminousIntensity" to "luminousIntensity". Only
			// the first character changes case, which reproduces the exact strings
			// getMeasure() has always returned.
			kindNames.set(id, name[0].toLowerCase() + name.slice(1));
		}
	}

	const { correctedUnits, correctedKinds } = applyUpstreamCorrections(unitsObject, bestUnits);

	const readback = { units: {}, differences: {}, best: {}, symbols: {} };
	const lines = [];

	lines.push(`/**
 * Unit conversion tables, ported from the \`convert\` npm package v${version}.
 *
 * DO NOT EDIT BY HAND. Regenerate with:
 *   node scripts/generate-unit-table.mjs
 *
 * Ported rather than depended on so the engine ships with no runtime
 * dependencies. See scripts/generate-unit-table.mjs for why the tables are
 * mirrored verbatim rather than hand-authored or recomputed from SI
 * definitions, and THIRD-PARTY-NOTICES.md for the upstream licence.
 *
 * Mirrored verbatim EXCEPT where upstream is arithmetically wrong. Those few
 * entries are marked "corrected" below and each one is justified in
 * UPSTREAM_UNIT_CORRECTIONS / UPSTREAM_BEST_UNIT_CORRECTIONS in the generator.
 * They are corrections of an upstream error, never a local preference.
 *
 * Upstream: https://github.com/citycide/convert (MIT, Copyright (c) Jonah Snider)
 */

/** A unit's measure kind and its ratio to that measure's base unit. */
export type UnitEntry = readonly [kind: number, ratio: number];
`);

	// ── UNIT_TABLE, grouped by kind so the file is reviewable ──
	const byKind = new Map();
	for (const [unit, [kind, ratio]] of Object.entries(unitsObject)) {
		if (!byKind.has(kind)) byKind.set(kind, []);
		byKind.get(kind).push([unit, ratio]);
	}

	lines.push(`/**
 * Every unit spelling the engine can resolve, to \`[measureKind, ratioToBase]\`.
 *
 * Keys are case-sensitive and are never normalized or aliased: \`C\` is Celsius
 * and \`c\` is a cup, \`MB\` is megabytes and \`mb\` is millibits. Multi-word
 * spellings are present here and resolve through the conversion API even though
 * the lexer cannot tokenize them.
 */
export const UNIT_TABLE: Readonly<Record<string, UnitEntry>> = {`);

	for (const kind of [...byKind.keys()].sort((a, b) => a - b)) {
		lines.push(`  // ── ${kindNames.get(kind)} (kind ${kind}) ──`);
		for (const [unit, ratio] of byKind.get(kind)) {
			const text = emitNumber(ratio);
			readback.units[unit] = [kind, Number(text)];
			const note = correctedUnits.has(unit)
				? ` // corrected, upstream says ${emitNumber(correctedUnits.get(unit))}`
				: "";
			lines.push(`  ${emitKey(unit)}: [${kind}, ${text}],${note}`);
		}
	}
	lines.push("};\n");

	// ── UNIT_DIFFERENCES ──
	lines.push(`/**
 * Additive offsets applied around the ratio, for measures whose scales do not
 * share an origin. Temperature only.
 */
export const UNIT_DIFFERENCES: Readonly<Record<string, number>> = {`);
	for (const [unit, offset] of Object.entries(differences)) {
		const text = emitNumber(offset);
		readback.differences[unit] = Number(text);
		lines.push(`  ${emitKey(unit)}: ${text},`);
	}
	lines.push("};\n");

	// ── BEST_UNITS_METRIC ──
	lines.push(`/**
 * Ordered \`[symbol, threshold]\` pairs per measure kind, used to pick the most
 * readable unit for a magnitude. Thresholds are expressed in the list's FIRST
 * unit, which is therefore also its smallest, and the last entry whose
 * threshold the absolute value reaches wins.
 *
 * The two properties are load-bearing together: \`convertToBestMetric\` converts
 * the magnitude into the first unit and then walks forwards, breaking at the
 * first threshold it does not reach. A list that does not ascend runs off the
 * end of the sensible units rather than merely picking a poor one, and moving a
 * different unit to the front silently changes what every threshold means.
 *
 * Metric only. The imperial lists exist upstream but nothing here has ever
 * requested them, so they are not ported.
 */
export const BEST_UNITS_METRIC: Readonly<
  Record<number, readonly (readonly [symbol: string, threshold: number])[]>
> = {`);
	bestUnits[0].forEach((entries, kind) => {
		readback.best[kind] = entries.map(([symbol, threshold]) => [symbol, Number(emitNumber(threshold))]);
		const pairs = entries
			.map(([symbol, threshold]) => `[${emitKey(symbol)}, ${emitNumber(threshold)}]`)
			.join(", ");
		const note = correctedKinds.has(kind) ? ", corrected" : "";
		lines.push(`  ${kind}: [${pairs}], // ${kindNames.get(kind)}${note}`);
	});
	lines.push("};\n");

	// ── MEASURE_SYMBOLS ──
	lines.push(`/**
 * The symbols offered for a measure by \`<value> <unit> to ?\`.
 *
 * A separate, curated vocabulary rather than the keys of UNIT_TABLE filtered by
 * kind: upstream publishes a shorter symbols-only list per unit, and the two
 * genuinely differ. Volume's symbols include \`c\`, \`US lc\` and \`pt\` but not
 * \`cup\`/\`cups\`; Time's include \`wk\` and \`mo\` but not \`week\`/\`month\`.
 * Deriving this from UNIT_TABLE would roughly quadruple every list.
 */
export const MEASURE_SYMBOLS: Readonly<Record<number, readonly string[]>> = {`);
	for (const [kind, entry] of conversions) {
		const symbols = entry.units.flatMap((unit) => unit.symbols);
		readback.symbols[kind] = symbols;
		lines.push(`  ${kind}: [${symbols.map(emitKey).join(", ")}], // ${kindNames.get(kind)}`);
	}
	lines.push("};\n");

	// ── MEASURE_KIND_NAMES ──
	lines.push(`/**
 * Measure kind id to the name \`getMeasure()\` reports. Two units are
 * convertible only when these strings match, so a typo here silently breaks
 * conversion for one whole measure.
 */
export const MEASURE_KIND_NAMES: Readonly<Record<number, string>> = {`);
	for (const kind of [...kindNames.keys()].sort((a, b) => a - b)) {
		lines.push(`  ${kind}: ${emitKey(kindNames.get(kind))},`);
	}
	lines.push("};");

	const output = lines.join("\n") + "\n";

	selfCheck({ unitsObject, differences, bestUnits, conversions, readback });

	if (checkOnly) {
		const existing = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";
		if (existing !== output) {
			console.error(`${path.relative(REPO_ROOT, OUTPUT_PATH)} is out of date. Regenerate it.`);
			process.exit(1);
		}
		console.log("Generated unit table is up to date.");
		return;
	}

	fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
	fs.writeFileSync(OUTPUT_PATH, output, "utf8");
	console.log(
		`Wrote ${path.relative(REPO_ROOT, OUTPUT_PATH)}: ` +
			`${Object.keys(unitsObject).length} units, ` +
			`${Object.keys(differences).length} offsets, ` +
			`${bestUnits[0].length} best-unit lists, ` +
			`${conversions.size} symbol lists (from convert v${version}).`
	);
}

/**
 * Asserts the values about to be written parse back to the originals.
 *
 * The key-count assertions are the important half. Around forty keys contain
 * spaces, quotes or non-ASCII characters ("minutes of arc", "'", '"', the
 * degree sign, and both U+00B5 and U+03BC as distinct keys), so an emitter
 * quoting bug drops entries silently rather than producing invalid syntax.
 */
function selfCheck({ unitsObject, differences, bestUnits, conversions, readback }) {
	const failures = [];

	const sourceUnitCount = Object.keys(unitsObject).length;
	const emittedUnitCount = Object.keys(readback.units).length;
	if (sourceUnitCount !== emittedUnitCount) {
		failures.push(`unit count: source ${sourceUnitCount}, emitted ${emittedUnitCount}`);
	}
	for (const [unit, [kind, ratio]] of Object.entries(unitsObject)) {
		const emitted = readback.units[unit];
		if (!emitted) {
			failures.push(`unit missing after emit: ${JSON.stringify(unit)}`);
			continue;
		}
		if (emitted[0] !== kind || !Object.is(emitted[1], ratio)) {
			failures.push(`unit mismatch ${JSON.stringify(unit)}: ${emitted} vs ${[kind, ratio]}`);
		}
	}

	const sourceOffsetCount = Object.keys(differences).length;
	const emittedOffsetCount = Object.keys(readback.differences).length;
	if (sourceOffsetCount !== emittedOffsetCount) {
		failures.push(`offset count: source ${sourceOffsetCount}, emitted ${emittedOffsetCount}`);
	}
	for (const [unit, offset] of Object.entries(differences)) {
		if (!Object.is(readback.differences[unit], offset)) {
			failures.push(`offset mismatch ${JSON.stringify(unit)}`);
		}
	}

	bestUnits[0].forEach((entries, kind) => {
		const emitted = readback.best[kind] ?? [];
		if (emitted.length !== entries.length) {
			failures.push(`best-unit count for kind ${kind}: ${entries.length} vs ${emitted.length}`);
			return;
		}
		entries.forEach(([symbol, threshold], index) => {
			if (emitted[index][0] !== symbol || !Object.is(emitted[index][1], threshold)) {
				failures.push(`best-unit mismatch kind ${kind} index ${index}`);
			}
		});
	});

	for (const [kind, entry] of conversions) {
		const expected = entry.units.flatMap((unit) => unit.symbols);
		const emitted = readback.symbols[kind] ?? [];
		if (expected.length !== emitted.length || expected.some((s, i) => s !== emitted[i])) {
			failures.push(`symbol list mismatch for kind ${kind}`);
		}
	}

	if (failures.length > 0) {
		console.error("Generated table does not match its source:");
		for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`);
		if (failures.length > 20) console.error(`  ...and ${failures.length - 20} more`);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
