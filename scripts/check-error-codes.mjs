/**
 * Fails when a code the engine can answer with is in no catalogue, and keeps
 * the error code reference page in step with the catalogues.
 *
 * An error code is the name a host branches on when a line fails, and the
 * versioning guide promises that a code a host can receive keeps its name. A
 * promise about a set nobody can list is not one a host can use: before this,
 * 221 of the 251 codes the source passed to `errorValue` or `ErrorFactory`
 * were in no exported list, `INCOMPATIBLE_UNITS` among them, which the quick
 * start teaches a host to read (#769).
 *
 * It reads every `export const <Name>ErrorCodes = { ... } as const` object
 * under `packages/engine/src`, and every call to `errorValue(...)` or
 * `ErrorFactory.<method>(...)` whose code is written in the call, and fails on
 * any of:
 *
 * - a code written at a call site that no catalogue lists;
 * - a code written as a template (`${namespace.toUpperCase()}_QUERY_FAILED`)
 *   that matches no declared pattern, the values of an
 *   `<Name>ErrorCodePatterns` object, where `<NAMESPACE>` stands for the part
 *   worked out at run time;
 * - a catalogue entry with no doc comment, since the reference page gives
 *   each code the sentence its comment holds;
 * - a reference page that is not what the catalogues generate now.
 *
 * The boundary: a code passed through a variable or a helper of a package's
 * own (`errorValue(code, ...)`) is not seen, and does not need to be when the
 * variable is a catalogue's member (`CoreErrorCodes.X`), since that can only
 * name a catalogued code. Messages are not checked: they are prose, and may be
 * reworded in any release. That a code is still catalogued once a host can
 * receive it, rather than renamed or removed, is what the snapshot in
 * `__tests__/errors/ErrorCodeCatalogueSnapshot.spec.ts` holds.
 *
 * Text matching rather than the TypeScript compiler, for the reason
 * `check-sidebar.mjs` gives: a lint should not need a build to run, and the
 * catalogues have one fixed shape, which the checks above keep them to.
 *
 * Usage:
 *   node scripts/check-error-codes.mjs           check the codes and the page
 *   node scripts/check-error-codes.mjs --write   write the reference page
 *
 * `--root=<dir>` reads another checkout instead, which is how the spec runs it
 * over fixture sources.
 *
 * @module check-error-codes
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const rootArgument = process.argv.find((arg) => arg.startsWith("--root="));
const ROOT = rootArgument ? path.resolve(rootArgument.slice("--root=".length)) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "packages", "engine", "src");
const PAGE = path.join(ROOT, "docs", "src", "content", "docs", "guide", "error-codes.md");
const write = process.argv.includes("--write");

/** A package's directory name as the reference page titles it, where the name alone does not read as words. */
const PACKAGE_TITLES = new Map([
	["conditionals", "Conditionals and checks"],
	["converters", "Converters and rounding"],
	["datetime", "Dates"],
	["derived", "Derived units"],
	["finance", "Finance"],
	["geo", "Places"],
	["goalseek", "Goal seek"],
	["ip", "Networking"],
	["lines", "Lines, ranges and sections"],
	["mapreduce", "Map and reduce"],
	["mathphrases", "Maths phrases"],
	["tags", "Category tags"],
	["text", "Text"],
	["time", "Times and time zones"],
	["uom", "Units"],
	["variables", "Variables"],
	["web", "Screen and image sizes"],
	["whatif", "What-if and sweeps"],
]);

/**
 * Every TypeScript file under a directory, in a stable order.
 *
 * @param {string} dir - The directory.
 * @returns {string[]} Absolute paths.
 */
function sourceFiles(dir) {
	if (!fs.existsSync(dir)) return [];
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (entry.name.endsWith(".ts")) out.push(full);
	}
	return out;
}

/** The line a character offset falls on, one-based. */
function lineAt(text, offset) {
	let line = 1;
	for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
	return line;
}

/**
 * A doc comment's text as one paragraph: the stars and the margin taken off,
 * `{@link X}` written as `X`, and the lines joined.
 *
 * @param {string} comment - The comment, `/** ... *\/` included.
 * @returns {string} The prose.
 */
function commentText(comment) {
	return comment
		.replace(/^\/\*\*/, "")
		.replace(/\*\/$/, "")
		.split("\n")
		.map((line) => line.replace(/^\s*\*\s?/, "").trim())
		.filter((line) => line !== "")
		.join(" ")
		.replace(/\{@link\s+([^}\s]+)\s*\}/g, "`$1`")
		.trim();
}

/**
 * Every exported object of string constants in the sources, by name, so an
 * entry written as another object's member can be read as the code it is.
 *
 * @param {string[]} files - The source files.
 * @returns {Map<string, Map<string, string>>} Each object's members and values.
 */
function readCodeObjects(files) {
	const objects = new Map();
	for (const file of files) {
		const text = fs.readFileSync(file, "utf8");
		for (const match of text.matchAll(/export const (\w+) = \{\n([\s\S]*?)\n\} as const;/g)) {
			const members = new Map();
			for (const member of match[2].matchAll(/^\s*([A-Za-z_]\w*):\s*"([^"]*)",?\s*$/gm)) members.set(member[1], member[2]);
			objects.set(match[1], members);
		}
	}
	return objects;
}

/**
 * Every catalogue in the sources: its name, where it is, and its entries in
 * order, each with its code, its doc comment and the section heading above
 * it, if any.
 *
 * @param {string[]} files - The source files.
 * @returns {{ name: string, file: string, doc: string, patterns: boolean, entries: { key: string, code: string, doc: string, section: string | null, literal: boolean, line: number }[] }[]} Catalogues.
 */
function readCatalogues(files) {
	const references = readCodeObjects(files);
	const catalogues = [];
	for (const file of files) {
		const text = fs.readFileSync(file, "utf8");
		const pattern = /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?export const (\w+ErrorCode(?:s|Patterns)) = \{\n([\s\S]*?)\n\} as const;/g;
		let match;
		while ((match = pattern.exec(text)) !== null) {
			const bodyStart = match.index + match[0].indexOf("{\n") + 2;
			const entries = [];
			let section = null;
			let pendingDoc = "";
			const lines = match[3].split("\n");
			let offset = bodyStart;
			for (const raw of lines) {
				const line = raw.trim();
				const heading = /^\/\/\s*──\s*(.+?)\s*──\s*$/.exec(line);
				if (heading) {
					// The file list in brackets says where the codes are raised,
					// which is for the source, not the page.
					section = heading[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
				} else if (line.startsWith("/**")) {
					pendingDoc = line;
					if (!line.endsWith("*/")) pendingDoc += "\n";
				} else if (pendingDoc !== "" && !pendingDoc.endsWith("*/")) {
					pendingDoc += `${line}\n`;
					if (line.endsWith("*/")) pendingDoc = pendingDoc.trimEnd();
				} else {
					const entry = /^([A-Za-z_][A-Za-z0-9_]*):\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z_][\w.]*))\s*,?$/.exec(line);
					if (entry) {
						const literal = entry[2] ?? entry[3];
						// A member of another code object (`PATTERN_FAULT_CODES.INVALID`)
						// is that object's value, which is the code a host receives.
						const [object, member] = (entry[4] ?? "").split(".");
						const referenced = member === undefined ? undefined : references.get(object)?.get(member);
						entries.push({
							key: entry[1],
							code: literal ?? referenced ?? entry[1],
							doc: pendingDoc === "" ? "" : commentText(pendingDoc),
							section,
							literal: literal !== undefined,
							line: lineAt(text, offset),
						});
					}
					if (!line.startsWith("//")) pendingDoc = "";
				}
				offset += raw.length + 1;
			}
			catalogues.push({
				name: match[2],
				file: path.relative(SOURCE, file).split(path.sep).join("/"),
				doc: match[1] ? commentText(match[1].trim()) : "",
				patterns: match[2].endsWith("Patterns"),
				entries,
			});
		}
	}
	return catalogues;
}

/**
 * Every code written at an `errorValue` or `ErrorFactory` call, with where it
 * is and how it reaches a host: thrown as an `EngineError`, or returned as an
 * error value.
 *
 * @param {string[]} files - The source files.
 * @returns {{ code: string, template: boolean, member: boolean, arrives: "thrown" | "value", at: string }[]} Uses.
 */
function readUses(files) {
	const uses = [];
	const call = /\b(errorValue|ErrorFactory\.(?:validation|parsing|execution|external|internal|config))\(\s*(?:\{\s*code:\s*)?(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`|([A-Za-z_]\w*)\.([A-Z][A-Z0-9_]*)\b|([A-Z][A-Z0-9_]*[A-Z0-9])\s*[,)])/g;
	for (const file of files) {
		const text = fs.readFileSync(file, "utf8");
		const rel = path.relative(SOURCE, file).split(path.sep).join("/");
		let match;
		while ((match = call.exec(text)) !== null) {
			const arrives = match[1] === "errorValue" ? "value" : "thrown";
			const at = `${rel}:${lineAt(text, match.index)}`;
			// A catalogue's member, or a constant named for the code it holds
			// (`PASS_WORK_BUDGET_EXCEEDED`): either names a catalogued key.
			if (match[6] !== undefined || match[7] !== undefined) {
				uses.push({ code: match[6] ?? match[7], template: false, member: true, arrives, at });
				continue;
			}
			const template = match[4];
			if (template !== undefined) {
				uses.push({ code: template, template: template.includes("${"), member: false, arrives, at });
				continue;
			}
			uses.push({ code: match[2] ?? match[3], template: false, member: false, arrives, at });
		}
	}
	return uses;
}

/** A template or a pattern with its run-time part written one way, so the two compare equal. */
function shape(text) {
	return text.replace(/\$\{[^}]*\}/g, "<*>").replace(/<[A-Z]+>/g, "<*>");
}

/**
 * The engine's own catalogues in the order the page lists them: the core
 * first, then the layers a host meets more rarely. A package's catalogues
 * follow in alphabetical order, after all of these.
 */
const ENGINE_ORDER = [
	"CoreErrorCodes",
	"DatetimeZoneErrorCodes",
	"CurrencyErrorCodes",
	"HistoricalCurrencyErrorCodes",
	"QueryResolverErrorCodePatterns",
	"SnapshotErrorCodes",
	"DefineFunctionErrorCodes",
	"WorkerErrorCodes",
];

/** Where a catalogue sits among its group's, by {@link ENGINE_ORDER}. */
function rank(name) {
	const at = ENGINE_ORDER.indexOf(name);
	return at === -1 ? ENGINE_ORDER.length : at;
}

/** A cell of a markdown table: its pipes escaped, so the text cannot end the cell. */
function cell(text) {
	return text.replace(/\|/g, "\\|");
}

/**
 * The group a catalogue is listed under on the page: the package it belongs
 * to, or the engine's own layers.
 *
 * @param {string} file - The catalogue's file, relative to the sources.
 * @returns {{ key: string, title: string }} The group.
 */
function groupOf(file) {
	const pkg = /^packages\/([^/]+)\//.exec(file);
	if (!pkg) return { key: "", title: "The engine" };
	const name = pkg[1];
	return { key: name, title: PACKAGE_TITLES.get(name) ?? `${name.charAt(0).toUpperCase()}${name.slice(1)}` };
}

/**
 * The reference page, generated from the catalogues.
 *
 * @param {ReturnType<typeof readCatalogues>} catalogues - The catalogues.
 * @param {Map<string, Set<string>>} arrivals - How each code reaches a host.
 * @returns {string} The page.
 */
function page(catalogues, arrivals) {
	const total = new Set(catalogues.filter((c) => !c.patterns).flatMap((c) => c.entries.map((e) => e.code))).size;
	const out = [
		"---",
		"title: Error codes",
		"description: Every code the engine and its built-in packages answer with when a line fails, and when each one arises.",
		"---",
		"",
		"<!-- Generated by `npm run docs:error-codes` from the catalogues in packages/engine/src. Edit the doc comment beside a code, not this page: `npm run lint:error-codes` fails when the two differ. -->",
		"",
		"When a line fails, the engine says two things about it. The **message** is a",
		"sentence for the person reading the note, such as `mass and length cannot be",
		"added`. The **code** is a short fixed name for the kind of failure, such as",
		"`INCOMPATIBLE_UNITS`, for the program showing the note: it is what a host",
		"branches on to underline a line, offer a fix or count failures, without reading",
		"the sentence.",
		"",
		"The two change on different terms. A message may be reworded in any release. A",
		"code a host can receive keeps its name (see",
		"[versioning and support](/guide/versioning-and-support/)), so this page only",
		"grows.",
		"",
		"A code reaches a host in one of three places:",
		"",
		"- `error.code` on the `EngineError` that `evaluateExpression` or `evaluateLine`",
		"  **throws**, for a line the engine cannot read or run at all;",
		"- `value.errorCode` on the error **value** a line returns, for a line the engine",
		"  ran but could not answer;",
		"- `errorCode` on a document line or inline solve from `parseDocument` or",
		"  `evaluateDocument`, for a line that threw, beside its `error` message, and on",
		"  the error value in its `result` for one that returned. See",
		"  [using the engine from TypeScript](/guide/typescript-usage/#when-a-line-fails).",
		"",
		"The **Arrives** column says which way each code comes: thrown, as a value, or",
		"either. Either means the engine raises it both ways in different places, or",
		"through a helper whose choice depends on the line, so a host should be ready",
		"for both.",
		"",
		"The same list is in the package, for a program that wants to check a code it",
		"has met:",
		"",
		"```ts",
		'import { ERROR_CODE_CATALOGUES, isCataloguedErrorCode } from "solve-engine/packages";',
		"",
		'ERROR_CODE_CATALOGUES.CoreErrorCodes.INCOMPATIBLE_UNITS; // "INCOMPATIBLE_UNITS"',
		'isCataloguedErrorCode("INCOMPATIBLE_UNITS");             // true',
		'isCataloguedErrorCode("CRYPTO_QUERY_FAILED");            // true: a run-time pattern',
		'isCataloguedErrorCode("NOT_A_CODE");                     // false',
		"```",
		"",
		"A package outside this repository can answer with codes of its own, so a code",
		"missing from this page is not necessarily a fault: it is one the engine does not",
		`ship. The engine and its built-in packages ship ${total.toLocaleString("en-US")} codes, grouped below by the part`,
		"of the engine that raises them.",
		"",
	];
	const groups = new Map();
	for (const catalogue of catalogues) {
		const group = groupOf(catalogue.file);
		if (!groups.has(group.key)) groups.set(group.key, { title: group.title, catalogues: [] });
		groups.get(group.key).catalogues.push(catalogue);
	}
	const ordered = [...groups.entries()].sort(([a, ga], [b, gb]) => (a === "" ? -1 : b === "" ? 1 : ga.title.localeCompare(gb.title)));
	for (const [, group] of ordered) {
		out.push(`## ${group.title}`, "");
		for (const catalogue of group.catalogues.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))) {
			out.push(`### ${catalogue.name}`, "");
			// The catalogue's own doc comment is for its source file; the page
			// says where a host reads it instead.
			out.push(`In the package as \`ERROR_CODE_CATALOGUES.${catalogue.name}\`.`, "");
			let section;
			let open = false;
			for (const entry of catalogue.entries) {
				if (entry.section !== section) {
					if (open) out.push("");
					section = entry.section;
					if (section !== null) out.push(`**${section}**`, "");
					open = false;
				}
				if (!open) {
					out.push("| Code | Arrives | When it arises |", "| --- | --- | --- |");
					open = true;
				}
				const ways = arrivals.get(entry.code) ?? new Set();
				const arrives = catalogue.patterns ? "as a value" : ways.size === 2 ? "either" : ways.has("thrown") ? "thrown" : ways.has("value") ? "as a value" : "either";
				out.push(`| \`${entry.code}\` | ${arrives} | ${cell(entry.doc)} |`);
			}
			out.push("");
		}
	}
	return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

const files = sourceFiles(SOURCE);
const catalogues = readCatalogues(files);
const uses = readUses(files);
const problems = [];

const owner = new Map();
const patterns = [];
for (const catalogue of catalogues) {
	for (const entry of catalogue.entries) {
		const where = `${catalogue.file}:${entry.line}`;
		if (entry.doc === "") problems.push(`${where}: ${catalogue.name}.${entry.key} has no doc comment, so the reference page has nothing to say about it`);
		if (catalogue.patterns) {
			patterns.push(entry.code);
			continue;
		}
		// A code may sit in two catalogues: the snapshot codes are in the core
		// catalogue too, so its orphan check sees them. The first is its home.
		if (!owner.has(entry.code)) owner.set(entry.code, catalogue.name);
	}
}
// A member reference at a call site names a key, which may differ from the
// code it stands for (`CurrencyErrorCodes.API_ERROR` is `CURRENCY_API_ERROR`).
const codeOfKey = new Map(catalogues.flatMap((c) => c.entries.map((e) => [e.key, e.code])));
const shapes = new Set(patterns.map(shape));
const arrivals = new Map();
for (const use of uses) {
	const code = use.code;
	if (use.template) {
		if (!shapes.has(shape(use.code))) problems.push(`${use.at}: the code \`${use.code}\` is built at run time and matches no declared pattern`);
		for (const pattern of patterns) if (shape(pattern) === shape(use.code)) arrivals.set(pattern, new Set([...(arrivals.get(pattern) ?? []), use.arrives]));
		continue;
	}
	if (use.member) {
		// A catalogue member, or a member of a code object a catalogue draws
		// from; either way it names a catalogued key.
		const named = codeOfKey.get(code);
		if (named !== undefined) arrivals.set(named, new Set([...(arrivals.get(named) ?? []), use.arrives]));
		continue;
	}
	if (!owner.has(code)) problems.push(`${use.at}: ${code} is in no catalogue`);
	arrivals.set(code, new Set([...(arrivals.get(code) ?? []), use.arrives]));
}

const generated = page(catalogues, arrivals);
if (write) {
	fs.mkdirSync(path.dirname(PAGE), { recursive: true });
	fs.writeFileSync(PAGE, generated);
	console.log(`Wrote ${path.relative(ROOT, PAGE)}: ${owner.size} codes in ${catalogues.length} catalogues.`);
} else if (!fs.existsSync(PAGE) || fs.readFileSync(PAGE, "utf8") !== generated) {
	problems.push(`${path.relative(ROOT, PAGE)} is not what the catalogues generate; run \`npm run docs:error-codes\``);
}

if (problems.length > 0) {
	console.error(`${problems.length} error code problem(s):\n${problems.map((p) => `  ${p}`).join("\n")}`);
	process.exit(1);
}
console.log(`Every code passed to errorValue or ErrorFactory is catalogued: ${owner.size} codes in ${catalogues.length} catalogues, ${patterns.length} run-time pattern(s).`);
