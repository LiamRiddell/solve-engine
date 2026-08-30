/**
 * Generates `docs/src/content/docs/syntax/unit-reference.md`, the list of every
 * unit spelling a user can actually type.
 *
 * ## Why this probes the engine instead of printing the table
 *
 * The obvious implementation is to dump `UNIT_TABLE`. That would be wrong, and
 * quietly so. Being in the table means the conversion API can resolve a
 * spelling; it does not mean the lexer can tokenize one. Multi-word spellings
 * are the clearest case: `sq ft` and `cu yd` are real table entries and both
 * fail to parse, because the lexer sees an identifier and stops. Some
 * single-word entries fail too, `turn` among them.
 *
 * Worse than failing is nearly working. `1 fl oz` used to parse, but as `1 fl`
 * applied to a unit `oz`, so it evaluated to one fluid-ounce-shaped lie:
 * `1.00 oz`. `1 oz t` did the same and landed on tonnes, a factor of thirty
 * thousand out. A generated page that listed those as supported would have been
 * worse than no page. Both work now, because `uom:multi-word-unit` fuses a pair
 * of unit tokens the table spells with a space between them, and the predicate
 * below is what proves it: they are on the page because they came back carrying
 * themselves, not because anyone decided they ought to.
 *
 * So every spelling is put through a real engine and kept only if it comes back
 * carrying itself as its unit. That predicate rejects all four cases above:
 * the ones that throw, and the ones that parse into a different unit.
 *
 * ## Usage
 *
 *   node scripts/generate-unit-reference.mjs           write the page
 *   node scripts/generate-unit-reference.mjs --check   fail if the page is stale
 *
 * Needs `npm run build` first, since it imports the built engine rather than
 * the TypeScript sources.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLE = path.join(ROOT, "packages/engine/src/uom/generated/UnitTable.generated.ts");
const EXTENDED = path.join(ROOT, "packages/engine/src/uom/ExtendedUnits.ts");
const ENGINE = path.join(ROOT, "packages/engine/dist/index.js");
const TARGET = path.join(ROOT, "docs/src/content/docs/syntax/unit-reference.md");

const checkOnly = process.argv.includes("--check");

/**
 * Reads the unit table out of the generated TypeScript source.
 *
 * Text matching rather than importing, for the reason `check-sidebar.mjs` gives
 * for the same choice: the alternative is a TypeScript toolchain in a script
 * whose whole job is reading a machine-generated file with a fixed shape. The
 * counts are asserted below so a format change fails loudly instead of silently
 * producing an empty page.
 *
 * @returns {{ entries: {spelling: string, kind: number, ratio: number}[], kinds: Record<number, string> }}
 */
function readTable() {
	const source = fs.readFileSync(TABLE, "utf8");

	const entries = [];
	// UNIT_TABLE ships packed as `const PACKED_UNIT_TABLE = "kind|ratio|a1,a2;..."`
	// decoded at load, rather than one `"key": [kind, ratio]` line per spelling.
	// Read and unpack the string the same way the engine does. `JSON.parse` on
	// the string literal handles the escaping (a few spellings contain `"`), so
	// the aliases come out already unescaped.
	const packedMatch = source.match(/const PACKED_UNIT_TABLE\s*=\s*("(?:[^"\\]|\\.)*")/);
	if (packedMatch) {
		const packed = JSON.parse(packedMatch[1]);
		for (const record of packed.split(";")) {
			const firstBar = record.indexOf("|");
			const secondBar = record.indexOf("|", firstBar + 1);
			const kind = Number(record.slice(0, firstBar));
			const ratio = Number(record.slice(firstBar + 1, secondBar));
			for (const spelling of record.slice(secondBar + 1).split(",")) {
				entries.push({ spelling, kind, ratio });
			}
		}
	}

	const differences = {};
	const diffStart = source.indexOf("export const UNIT_DIFFERENCES");
	const diffEnd = source.indexOf("export const BEST_UNITS_METRIC");
	for (const match of source.slice(diffStart, diffEnd).matchAll(/^\s+"([^"]+)":\s*([-\d.e+]+),/gm)) {
		differences[match[1]] = Number(match[2]);
	}

	const kinds = {};
	const kindStart = source.indexOf("export const MEASURE_KIND_NAMES");
	for (const match of source.slice(kindStart).matchAll(/^\s+(\d+):\s*"([^"]+)",/gm)) {
		kinds[Number(match[1])] = match[2];
	}

	if (entries.length < 1000) throw new Error(`Only parsed ${entries.length} unit entries; the table format has changed.`);
	if (Object.keys(kinds).length < 10) throw new Error("Failed to parse the measure kind names.");
	if (Object.keys(differences).length === 0) throw new Error("Failed to parse the temperature offsets.");
	for (const entry of entries) entry.difference = differences[entry.spelling] ?? 0;
	return { entries, kinds };
}

/**
 * Keeps only the spellings a user can type and get back.
 *
 * @param {{spelling: string, kind: number, ratio: number}[]} entries
 * @returns {Promise<typeof entries>}
 */
async function keepTypable(entries) {
	if (!fs.existsSync(ENGINE)) {
		console.error("packages/engine/dist is missing. Run `npm run build` first.");
		process.exit(1);
	}
	// createEngine registers every built-in (the bare constructor now registers
	// none, so the lexer would recognise no unit and every spelling would be
	// filtered out). The unit vocabulary is what this tokenizability check needs.
	const { createEngine } = await import(pathToFileURL(ENGINE).href);
	const engine = createEngine("en");

	const kept = [];
	for (const entry of entries) {
		try {
			const value = engine.evaluateLine(1, `1 ${entry.spelling}`);
			// The unit has to come back as the same text that went in. A spelling
			// that parses into a *different* unit is the dangerous case, not the
			// harmless one.
			if (value && value.unit === entry.spelling) kept.push(entry);
		} catch {
			// Not tokenizable. Expected for the multi-word spellings.
		}
	}
	engine.clear?.();
	return kept;
}

/** A ratio rendered short enough to read, without pretending to more precision than it has. */
function formatRatio(ratio) {
	if (Number.isInteger(ratio) && Math.abs(ratio) < 1e15) return String(ratio);
	const precise = Number(ratio.toPrecision(6));
	return String(precise);
}

/**
 * The row's headline name: whichever surviving spelling comes first in the
 * table.
 *
 * Upstream lists a unit's canonical name before its aliases, so table order is
 * already the answer. Picking the longest word instead labelled area's base
 * unit "centiares", which is correct and not what anybody calls a square metre.
 */
function headline(spellings) {
	return spellings[0];
}

/** Groups a measure's spellings into one row per distinct unit, largest first. */
function rowsFor(entries) {
	// Keyed on the offset as well as the ratio. Kelvin and Celsius share a
	// ratio and differ only by 273.15, so grouping on the ratio alone merged
	// them into one row and told the reader they were the same unit.
	const byScale = new Map();
	for (const entry of entries) {
		const key = `${entry.ratio}|${entry.difference}`;
		if (!byScale.has(key)) byScale.set(key, { ratio: entry.ratio, difference: entry.difference, spellings: [] });
		byScale.get(key).spellings.push(entry.spelling);
	}
	return [...byScale.values()].sort((a, b) => b.ratio - a.ratio || a.difference - b.difference);
}

/**
 * Escapes a spelling for a code span inside a markdown table cell.
 *
 * The backslash is replaced first. Doing the pipe first would then double the
 * backslash that replacement had just introduced, and escaping one
 * metacharacter while leaving the other is the incomplete-sanitization shape
 * regardless of what the input turns out to hold.
 *
 * No unit spelling contains either character today. The one that comes close is
 * the inch, spelled `"`, which needs no escaping here. This is written to hold
 * anyway, since the table is regenerated whenever the upstream package moves.
 */
function cell(spelling) {
	const escaped = spelling.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
	return `\`${escaped}\``;
}

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
 */
function ratioValue(raw) {
	// Numeric separators are readability only, and `Number` does not accept
	// them: `1_000_000` parses as NaN rather than as a million.
	const text = raw.replace(/(\d)_(\d)/g, "$1$2").replace(/(\d)_(\d)/g, "$1$2");
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
 * The units defined outside the generated table.
 *
 * `ExtendedUnits.ts` carries everything the `convert` package has no concept
 * of, which is two different things: measures it never had (speed, pace,
 * voltage) and units missing from measures it does have (a furlong is a
 * length). Both belong on a page that claims to list every spelling the engine
 * accepts, and leaving them off made that claim false by about thirty units.
 *
 * @returns Entries in the same shape `readTable` produces, keyed to a measure
 * id continuing after the generated table's.
 */
function readExtended(kinds) {
	const source = fs.readFileSync(EXTENDED, "utf8");
	const entries = [];
	const extraKinds = { ...kinds };

	// Measure names arrive as strings here rather than as numeric ids, so each
	// new one is given an id after the generated table's, and a name that
	// already exists reuses its id so the two merge into one section.
	const byName = new Map(Object.entries(kinds).map(([id, name]) => [name, Number(id)]));
	let nextId = Math.max(...Object.keys(kinds).map(Number)) + 1;

	for (const match of source.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*\{\s*measure:\s*"([^"]+)",\s*toBase:\s*([^}]+)\}/gm)) {
		const [, spelling, measure, ratio] = match;
		if (!byName.has(measure)) {
			byName.set(measure, nextId);
			extraKinds[nextId] = measure;
			nextId++;
		}
		entries.push({
			spelling,
			kind: byName.get(measure),
			ratio: ratioValue(ratio.trim().replace(/,$/, "")),
			difference: 0,
		});
	}

	if (entries.length === 0) throw new Error("Parsed no extended units; the file format has changed.");
	return { entries, kinds: extraKinds };
}

const base = readTable();
const extra = readExtended(base.kinds);
const entries = [...base.entries, ...extra.entries];
const kinds = extra.kinds;
const typable = await keepTypable(entries);

const byKind = new Map();
for (const entry of typable) {
	if (!byKind.has(entry.kind)) byKind.set(entry.kind, []);
	byKind.get(entry.kind).push(entry);
}

const sections = [];
for (const kind of [...byKind.keys()].sort((a, b) => a - b)) {
	const rows = rowsFor(byKind.get(kind));
	const base = rows.find(r => r.ratio === 1);
	const baseName = base ? headline(base.spellings) : null;

	const lines = [];
	lines.push(`## ${kinds[kind][0].toUpperCase()}${kinds[kind].slice(1).replace(/([A-Z])/g, " $1").toLowerCase()}`);
	lines.push("");
	lines.push(baseName
		? `Measured against **${baseName}**.`
		: "");
	lines.push("");
	lines.push("| Unit | Spellings | Relative size |");
	lines.push("| --- | --- | --- |");
	for (const row of rows) {
		const name = headline(row.spellings);
		const others = row.spellings.filter(s => s !== name);
		lines.push(`| ${name} | ${others.length ? others.map(cell).join(", ") : cell(name)} | ${formatRatio(row.ratio)} |`);
	}
	// A measure whose scales do not share an origin needs saying so, or the table
	// reads as though Celsius and kelvin were the same unit: they have the same
	// degree size, and the column only shows the ratio.
	if (rows.some(row => row.difference !== 0)) {
		lines.push("");
		lines.push(
			"Some of these share a degree size but not a zero point, which the column above "
			+ "cannot show. Celsius and kelvin step alike and start 273.15 apart, and "
			+ "Fahrenheit and Rankine do the same.",
		);
	}
	sections.push(lines.join("\n"));
}

const skipped = entries.length - typable.length;
const page = `---
title: Unit reference
description: Every unit spelling the engine accepts, grouped by what it measures.
---

<!-- Generated by scripts/generate-unit-reference.mjs. Do not edit by hand. -->

Every spelling below is checked against a real engine when this page is built,
so anything listed here parses and carries the unit it names. Units are
case-sensitive throughout: \`m\` is metres and \`M\` is the millions suffix, \`MB\`
is megabytes and \`Mb\` is megabits.

\`\`\`solve
100 cm + 2 m // 300.00 cm
5 km to miles // 3.11 miles
1 KiB in bytes // 1024.00 bytes
\`\`\`

See [converting units](/syntax/converting-units/) for how conversion
and unit arithmetic work. This page is only the vocabulary.

The **relative size** column is each unit measured against the measure's base
unit, shown to six significant figures for readability. The engine itself uses
the full stored value.

${sections.join("\n\n")}

## Spellings that are not listed

The conversion tables carry ${entries.length} spellings in total, and ${skipped} of
them are missing above. Most are multi-word forms like \`sq ft\` and \`cu yd\`,
which the tables can resolve but the lexer cannot tokenize, so they are
unavailable when typing an expression. They are excluded here rather than listed
and quietly broken.
`;

const next = page.replace(/\r\n/g, "\n");

/** The committed copy, or "" when there is not one yet. */
function readCommitted() {
	try {
		return fs.readFileSync(TARGET, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return "";
		throw error;
	}
}

if (checkOnly) {
	if (readCommitted() !== next) {
		console.error(
			"docs/src/content/docs/syntax/unit-reference.md is out of date.\n" +
				"Run `npm run stats:units` and commit the result.",
		);
		process.exit(1);
	}
	console.log(`Unit reference is current: ${typable.length} spellings across ${byKind.size} measures.`);
} else {
	fs.writeFileSync(TARGET, next);
	console.log(`Wrote ${path.relative(ROOT, TARGET)}: ${typable.length} spellings across ${byKind.size} measures.`);
}
