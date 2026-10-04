/**
 * Checks the messages the engine writes for a reader against the house voice.
 *
 * An error message is prose a reader sees, the same as a docs page, and the
 * comment-style lint (`check-comment-style.mjs`) never read it: it skips string
 * literals on purpose, because a diagnostic icon passed as data is not prose.
 * So messages drifted. Twenty-nine literals carried an em-dash, two said
 * "recognized", and one showed the reader `(3 !== 2)` (#775).
 *
 * This reads the source with the TypeScript parser rather than with a line
 * scanner, so it knows which text is a message: the message argument of
 * `errorValue(code, message)`, `lineMessage(text)`, an `ErrorFactory` method
 * (positional `(code, message)`, or the `message`, `suggestion`, `expected` and
 * `found` of an init object), `new EngineError({...})`, and the text of
 * `console.warn` and `console.error`. Every string piece inside that argument is
 * checked, including the literal parts of a template and of a `+` chain. A code
 * sample in a comment is not a string literal, so it is never read. A message
 * assembled at run time from parts held elsewhere is out of reach of a source
 * lint, and is checked by a spec instead.
 *
 * Usage:
 *   node scripts/check-message-style.mjs                 check packages/engine/src
 *   node scripts/check-message-style.mjs --root=<dir>    check <dir>/packages/engine/src
 *   node scripts/check-message-style.mjs --count         report, do not fail
 *
 * @module check-message-style
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * American spellings a message must not use, each with the British form. Whole
 * words only, so an identifier that contains one (`colorize`, `serializeValue`)
 * is not read as prose. Kept to words a message plausibly says; a unit name the
 * reader types (`meter`, `liter`) is deliberately absent, since a message can
 * quote the reader's own spelling back.
 */
export const AMERICAN = {
	recognize: "recognise",
	recognized: "recognised",
	recognizes: "recognises",
	recognizing: "recognising",
	unrecognized: "unrecognised",
	behavior: "behaviour",
	behaviors: "behaviours",
	color: "colour",
	colors: "colours",
	favor: "favour",
	honor: "honour",
	analyze: "analyse",
	analyzed: "analysed",
	normalize: "normalise",
	normalized: "normalised",
	initialize: "initialise",
	initialized: "initialised",
	uninitialized: "uninitialised",
	serialize: "serialise",
	serialized: "serialised",
	organize: "organise",
	summarize: "summarise",
	optimize: "optimise",
	optimized: "optimised",
	minimize: "minimise",
	maximize: "maximise",
	authorize: "authorise",
	authorized: "authorised",
	unauthorized: "unauthorised",
	canceled: "cancelled",
	canceling: "cancelling",
	labeled: "labelled",
	modeled: "modelled",
	center: "centre",
	catalog: "catalogue",
	license: "licence",
	defense: "defence",
	gray: "grey",
};

const EM_DASH = String.fromCodePoint(0x2014);

/**
 * The rules, each a test over one piece of message text. A rule returns the
 * offending fragment, or null. A rule marked `lineOnly` applies only to the
 * messages a line's result shows (`errorValue`, `lineMessage`); the others also
 * apply to the errors and warnings a host receives.
 */
export const RULES = [
	{
		name: "em-dash",
		// Built from its code point, so this file does not itself carry the character.
		test: (text) => (text.includes(EM_DASH) ? EM_DASH : null),
		message: "Em-dash in a message. Use a comma, a colon, parentheses, or a second sentence.",
	},
	{
		name: "american-spelling",
		test: (text) => {
			for (const match of text.matchAll(/[A-Za-z]+/g)) {
				const british = Object.hasOwn(AMERICAN, match[0].toLowerCase()) ? AMERICAN[match[0].toLowerCase()] : null;
				if (british !== null) return `${match[0]} (write "${british}")`;
			}
			return null;
		},
		message: "American spelling in a message. The house voice is British.",
	},
	{
		name: "code-operator",
		// JavaScript's strict comparisons are code, not prose: a reader should be
		// told "the first has 3 columns and the second 2 rows", not `(3 !== 2)`.
		test: (text) => /!==|===/.exec(text)?.[0] ?? null,
		message: "A JavaScript operator in a message. Say it in words.",
	},
	{
		name: "api-name",
		// A host's method named to a reader, `evaluateExpression()` say. The
		// reader of a line's result typed a line rather than calling a method, so
		// the sentence should say what is missing ("needs a document") instead.
		// camelCase with a call's brackets, so a function the reader types
		// (`sqrt()`, `solve()`) is not caught. Line results only: an error a host
		// receives may rightly name the host's own method (`toJSON()`).
		lineOnly: true,
		test: (text) => /\b[a-z]+[A-Z][A-Za-z0-9]*\(\)/.exec(text)?.[0] ?? null,
		message: "A method name in a message. Say what the reader is missing instead.",
	},
];

/**
 * Messages known to break a rule whose rewording belongs to another change.
 * Each names the file, a fragment of the message and the issue that owns the
 * fix. An entry that no longer matches anything fails the run, so the list
 * cannot outlive the fixes it waits for: delete the entry once the message is
 * reworded.
 */
export const PENDING = [
	{ file: "packages/engine/src/engine/ExpressionEngine.ts", includes: "stored as an equation", owner: "#836" },
	{ file: "packages/engine/src/packages/matrix/parselets/MatrixLiteralParselet.ts", includes: "cannot be empty", owner: "#836" },
	{ file: "packages/engine/src/vm/MatrixOps.ts", includes: "inner dimensions must match", owner: "#836" },
	{ file: "packages/engine/src/vm/LineReads.ts", includes: "Cross-line references require a real document", owner: "#836" },
	{ file: "packages/engine/src/packages/uom/parselets/CookingPluginFunctions.ts", includes: "is not a recognized", owner: "#736" },
];

/** The names `ErrorFactory` exposes, one per error category. */
const FACTORY_METHODS = new Set(["parsing", "validation", "execution", "external", "internal", "config"]);

/** Init-object properties that hold reader-facing prose. `code` and `context` are data. */
const PROSE_PROPERTIES = new Set(["message", "suggestion", "expected", "found"]);

/** Every .ts file under a directory, declarations excluded. */
function walk(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
	}
	return out;
}

/**
 * The message arguments of a call or construction, or an empty list when the
 * call is not one that writes a message.
 *
 * @param node - A call or `new` expression.
 * @returns Each argument expression that holds prose, with `onLine` true when
 * it is a message a line's result shows.
 */
export function messageArguments(node) {
	const args = node.arguments ? [...node.arguments] : [];
	const callee = node.expression;
	const nameOf = (p) => (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null);
	const proseOf = (arg, onLine) => {
		if (arg === undefined) return [];
		if (ts.isObjectLiteralExpression(arg)) {
			return arg.properties
				.filter((p) => ts.isPropertyAssignment(p) && PROSE_PROPERTIES.has(nameOf(p)))
				.map((p) => ({ expr: p.initializer, onLine }));
		}
		return [{ expr: arg, onLine }];
	};

	if (ts.isNewExpression(node)) {
		return ts.isIdentifier(callee) && callee.text === "EngineError" ? proseOf(args[0], false) : [];
	}
	if (ts.isIdentifier(callee)) {
		if (callee.text === "errorValue") return proseOf(args[1], true);
		if (callee.text === "lineMessage") return proseOf(args[0], true);
		return [];
	}
	if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
		const owner = callee.expression.text;
		const method = callee.name.text;
		if (owner === "ErrorFactory" && FACTORY_METHODS.has(method)) {
			return args[0] !== undefined && ts.isObjectLiteralExpression(args[0]) ? proseOf(args[0], false) : proseOf(args[1], false);
		}
		if (owner === "console" && (method === "warn" || method === "error")) {
			return args.map((expr) => ({ expr, onLine: false }));
		}
	}
	return [];
}

/**
 * Every literal piece of text inside an expression: string literals, the fixed
 * parts of template literals, and those inside `+` chains, conditionals and
 * parentheses. A nested call's arguments are not read, since they are that
 * call's data rather than this message's words.
 *
 * @param node - The message expression.
 * @returns Each piece with the node it came from.
 */
export function textPieces(node, out = []) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		out.push({ text: node.text, node });
	} else if (ts.isTemplateExpression(node)) {
		out.push({ text: node.head.text, node: node.head });
		for (const span of node.templateSpans) {
			textPieces(span.expression, out);
			out.push({ text: span.literal.text, node: span.literal });
		}
	} else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		textPieces(node.left, out);
		textPieces(node.right, out);
	} else if (ts.isConditionalExpression(node)) {
		textPieces(node.whenTrue, out);
		textPieces(node.whenFalse, out);
	} else if (ts.isParenthesizedExpression(node)) {
		textPieces(node.expression, out);
	}
	return out;
}

/**
 * Every rule a source file's messages break.
 *
 * @param fileName - Used for the parser's diagnostics and the report.
 * @param source - The file's text.
 * @returns One finding per rule broken per piece, with its line, the piece's
 * text and the whole message it belongs to.
 */
export function findViolations(fileName, source) {
	const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found = [];
	const visit = (node) => {
		if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
			for (const { expr, onLine } of messageArguments(node)) {
				const pieces = textPieces(expr);
				// The message as a reader would see it, with each interpolation
				// elided, so a PENDING entry can name it by any fragment.
				const whole = pieces.map((p) => p.text).join("...");
				for (const piece of pieces) {
					for (const rule of RULES) {
						if (rule.lineOnly && !onLine) continue;
						const hit = rule.test(piece.text);
						if (hit === null) continue;
						const { line } = sf.getLineAndCharacterOfPosition(piece.node.getStart(sf));
						found.push({ rule: rule.name, message: rule.message, hit, line: line + 1, text: piece.text, whole });
					}
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return found;
}

function main() {
	const args = process.argv.slice(2);
	const countOnly = args.includes("--count");
	const rootArg = args.find((a) => a.startsWith("--root="));
	const root = rootArg ? path.resolve(rootArg.slice("--root=".length)) : REPO;
	const srcDir = path.join(root, "packages/engine/src");
	if (!fs.existsSync(srcDir)) {
		console.error(`No engine source at ${srcDir}.`);
		process.exit(1);
	}

	const files = walk(srcDir);
	const used = new Set();
	const violations = [];
	for (const file of files) {
		const relative = path.relative(root, file).split(path.sep).join("/");
		for (const v of findViolations(relative, fs.readFileSync(file, "utf8"))) {
			const pending = PENDING.findIndex((p) => p.file === relative && v.whole.includes(p.includes));
			if (pending !== -1) {
				used.add(pending);
				continue;
			}
			violations.push({ file: relative, ...v });
		}
	}

	for (const v of violations) {
		console.log(`${v.file}:${v.line}: ${v.message} Found: ${v.hit}`);
		console.log(`  ${JSON.stringify(v.text.slice(0, 120))}`);
	}

	// An entry is stale when its file is there and no message in it matches. A
	// file that is not there at all (a fixture tree) says nothing either way.
	const stale = PENDING.filter((p, i) => !used.has(i) && fs.existsSync(path.join(root, p.file)));
	for (const p of stale) {
		console.log(`PENDING entry for ${p.file} ("${p.includes}", ${p.owner}) matches no message any more. Delete it from scripts/check-message-style.mjs.`);
	}

	if (countOnly) {
		console.log(`\n${violations.length} message-style violation(s) across ${files.length} file(s).`);
		process.exit(0);
	}
	if (violations.length > 0 || stale.length > 0) {
		console.error(`\n${violations.length} message-style violation(s), ${stale.length} stale pending entr${stale.length === 1 ? "y" : "ies"}.`);
		process.exit(1);
	}
	const waiting = PENDING.length - stale.length;
	console.log(`Messages follow the house voice across ${files.length} file(s)${waiting > 0 ? ` (${waiting} pending another change)` : ""}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
