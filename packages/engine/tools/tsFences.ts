/**
 * The TypeScript examples in the developer guides, read so a spec can run them.
 *
 * The syntax pages' `solve` blocks are proven by `DocExamples.spec.ts`; the
 * guides' `ts` fences were not, and two of the results they stated had drifted
 * from the engine (#779). The convention these helpers read is the one the
 * guides already use: a statement whose line ends in a comment that opens with
 * a quoted string states its result,
 *
 * ```ts
 * formatValue(value); // "= 3,000.00 m"
 * ```
 *
 * and text after the closing quote is commentary. {@link instrumentFence}
 * rewrites each such statement into a call that records what it evaluated to,
 * so the spec can compare the two.
 */

import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

/** One `ts` or `typescript` fence, and where it is. */
export interface TsFence {
	/** The page it is on. */
	file: string;
	/** The one-based line of the opening fence. */
	line: number;
	/** The fence's source, without the fence lines. */
	source: string;
}

/** One statement a fence states the result of. */
export interface FenceAssertion {
	/** The one-based line within the fence the statement ends on. */
	line: number;
	/** The result the comment states, unquoted and unescaped; for a statement that throws, its message. */
	expected: string;
	/** True when the comment says the statement throws (`// throws: <message>`). */
	throws?: boolean;
}

/**
 * Every `ts` and `typescript` fence in the markdown under `dir`, and in each of
 * `extraFiles`. A fence opens on three or more backticks followed by the
 * language (and any meta after a space) and closes on a bare run at least as
 * long; a fence of another language is skipped whole, so a `ts` line quoted
 * inside a `md` block is not read.
 *
 * @param dir - The directory to walk (a missing one yields nothing).
 * @param extraFiles - Markdown files outside it.
 * @returns The fences, in file and line order.
 */
export function collectTsFences(dir: string, extraFiles: readonly string[] = []): TsFence[] {
	const files: string[] = [];
	const walk = (at: string): void => {
		if (!fs.existsSync(at)) return;
		for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const full = path.join(at, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (/\.mdx?$/.test(entry.name)) files.push(full);
		}
	};
	walk(dir);
	files.push(...extraFiles);
	return files.flatMap((file) => fencesIn(file, fs.readFileSync(file, "utf8")));
}

/**
 * The `ts` and `typescript` fences in one page's text.
 *
 * @param file - The page's path, recorded on each fence.
 * @param text - The page's source.
 * @returns The fences.
 */
export function fencesIn(file: string, text: string): TsFence[] {
	const out: TsFence[] = [];
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	let open: { marker: string; lang: string; line: number; body: string[] } | null = null;
	lines.forEach((raw, i) => {
		const fence = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(raw);
		if (open === null) {
			if (fence) open = { marker: fence[1], lang: fence[2].toLowerCase(), line: i + 1, body: [] };
			return;
		}
		if (fence && fence[2] === "" && fence[1][0] === open.marker[0] && fence[1].length >= open.marker.length) {
			if (open.lang === "ts" || open.lang === "typescript") out.push({ file, line: open.line, source: open.body.join("\n") });
			open = null;
			return;
		}
		open.body.push(raw);
	});
	return out;
}

/**
 * The quoted result a line's trailing comment states, or null when it states
 * none. Only a comment that opens with a double-quoted string counts, so an
 * ordinary remark (`// every built-in package`) is not read as a claim.
 *
 * @param line - A line of a fence.
 * @returns The stated result, unescaped.
 */
export function statedResult(line: string): string | null {
	const match = /\/\/\s*"((?:[^"\\\n]|\\.)*)"/.exec(line);
	if (!match) return null;
	// Only when the `//` is a comment, not inside a string on the line.
	const before = line.slice(0, match.index);
	const quotes = (before.match(/(?<!\\)"/g) ?? []).length + (before.match(/(?<!\\)'/g) ?? []).length;
	if (quotes % 2 !== 0) return null;
	try {
		return JSON.parse(`"${match[1]}"`) as string;
	} catch {
		return match[1];
	}
}

/**
 * The message a line's trailing comment says its statement throws with, or null
 * when it says no such thing. `// throws: <message>` states it; the message runs
 * to the end of the line.
 *
 * @param line - A line of a fence.
 * @returns The stated message.
 */
export function statedThrow(line: string): string | null {
	const match = /\/\/\s*throws:\s*(.*\S)\s*$/.exec(line);
	if (!match) return null;
	const before = line.slice(0, match.index);
	const quotes = (before.match(/(?<!\\)"/g) ?? []).length + (before.match(/(?<!\\)'/g) ?? []).length;
	return quotes % 2 === 0 ? match[1] : null;
}

/**
 * The statements a fence states the result of: each expression statement whose
 * last line carries a {@link statedResult} or a {@link statedThrow}.
 *
 * @param source - The fence's source.
 * @returns The assertions, in order.
 */
export function fenceAssertions(source: string): FenceAssertion[] {
	return instrumentFence(source).assertions;
}


/** A text edit on a fence's source: replace `[start, end)` with `text`. */
interface Edit {
	start: number;
	end: number;
	text: string;
}

/**
 * Whether a fence parses as TypeScript with no syntax error and is a program
 * rather than a fragment of a function body: a `return` outside any function
 * (the body of a handler shown on its own) would end the whole page's run.
 */
export function parsesCleanly(source: string): boolean {
	const file = ts.createSourceFile("fence.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
	if (((file as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length > 0) return false;
	let strayReturn = false;
	const visit = (node: ts.Node): void => {
		if (strayReturn || ts.isFunctionLike(node) || ts.isClassLike(node)) return;
		if (ts.isReturnStatement(node)) strayReturn = true;
		else ts.forEachChild(node, visit);
	};
	visit(file);
	return !strayReturn;
}

/**
 * The statements a fence states the result of, and the edits that make each
 * record its value: `expr; // "= 4"` becomes `__check(0, (expr));`, the index
 * naming the assertion.
 */
function checkEdits(file: ts.SourceFile, source: string): { edits: Edit[]; assertions: FenceAssertion[] } {
	const lines = source.split("\n");
	const edits: Edit[] = [];
	const assertions: FenceAssertion[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isExpressionStatement(node)) {
			const endLine = file.getLineAndCharacterOfPosition(node.getEnd()).line;
			const expected = statedResult(lines[endLine] ?? "");
			if (expected !== null) {
				edits.push({ start: node.getStart(file), end: node.getEnd(), text: `__check(${assertions.length}, (${node.expression.getText(file)}));` });
				assertions.push({ line: endLine + 1, expected });
				return;
			}
			const thrown = statedThrow(lines[endLine] ?? "");
			if (thrown !== null) {
				const index = assertions.length;
				edits.push({
					start: node.getStart(file),
					end: node.getEnd(),
					text: `try { ${node.expression.getText(file)}; __check(${index}, undefined); } catch (__error) { __check(${index}, __error); }`,
				});
				assertions.push({ line: endLine + 1, expected: thrown, throws: true });
				return;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return { edits, assertions };
}

/**
 * The edits that let a page's fences share one scope, as a reader takes them:
 * each import becomes a `var` bound from `require`, and each top-level `const`,
 * `let`, function and class becomes a `var`, so a name a later fence declares
 * again (a second `const engine`) replaces the first rather than failing to
 * compile. Type-only imports and declarations are left to the transpiler, which
 * removes them.
 */
function scopeEdits(file: ts.SourceFile): Edit[] {
	const edits: Edit[] = [];
	for (const statement of file.statements) {
		if (ts.isImportDeclaration(statement)) {
			const clause = statement.importClause;
			const from = (statement.moduleSpecifier as ts.StringLiteral).text;
			const parts: string[] = [];
			if (clause && !clause.isTypeOnly) {
				if (clause.name) parts.push(`var ${clause.name.text} = __default(require(${JSON.stringify(from)}));`);
				const bindings = clause.namedBindings;
				if (bindings && ts.isNamespaceImport(bindings)) parts.push(`var ${bindings.name.text} = require(${JSON.stringify(from)});`);
				if (bindings && ts.isNamedImports(bindings)) {
					const names = bindings.elements
						.filter((element) => !element.isTypeOnly)
						.map((element) => (element.propertyName ? `${element.propertyName.text}: ${element.name.text}` : element.name.text));
					if (names.length > 0) parts.push(`var { ${names.join(", ")} } = require(${JSON.stringify(from)});`);
				}
			}
			edits.push({ start: statement.getStart(file), end: statement.getEnd(), text: parts.join(" ") });
			continue;
		}
		if (ts.isVariableStatement(statement)) {
			const list = statement.declarationList;
			const keyword = list.getFirstToken(file);
			if (keyword && (keyword.kind === ts.SyntaxKind.ConstKeyword || keyword.kind === ts.SyntaxKind.LetKeyword)) {
				edits.push({ start: keyword.getStart(file), end: keyword.getEnd(), text: "var" });
			}
			continue;
		}
		// A function signature with no body (an overload) is a type, not a value.
		const hasValue = ts.isClassDeclaration(statement) || (ts.isFunctionDeclaration(statement) && statement.body !== undefined);
		if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name && hasValue) {
			edits.push({ start: statement.getStart(file), end: statement.getStart(file), text: `var ${statement.name.text} = ` });
			edits.push({ start: statement.getEnd(), end: statement.getEnd(), text: ";" });
		}
	}
	return edits;
}

/** A source with its edits applied, latest first so earlier offsets hold. */
function applyEdits(source: string, edits: readonly Edit[]): string {
	let out = source;
	for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
	return out;
}

/**
 * A fence's source rewritten so each statement with a stated result records
 * its value, and nothing else changed.
 *
 * @param source - The fence's source.
 * @returns The rewritten TypeScript and the assertions it records.
 */
export function instrumentFence(source: string): { code: string; assertions: FenceAssertion[] } {
	const file = ts.createSourceFile("fence.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
	const { edits, assertions } = checkEdits(file, source);
	return { code: applyEdits(source, edits), assertions };
}

/**
 * One page's fences up to and including a target, as a CommonJS module the
 * spec can run. A page's fences build on each other (the quick start defines
 * `engine` once and uses it below), so the program is every earlier fence and
 * then the target, in one shared scope, inside an exported async `__run` so a
 * fence may `await` at its top level. An earlier fence that does not parse (a
 * signature, an options object on its own) is left out, and each earlier
 * fence's statements run inside a `try`, since a fragment that needs a host
 * object the page only describes must not stop the fence that states a result.
 * The target is not wrapped: its failure is the spec's.
 *
 * `require` is whatever the caller passes; `__default` reads a default import.
 *
 * @param fences - The page's fences, in order.
 * @param target - The index of the fence whose assertions are recorded.
 * @param prelude - Code run first, for what the page takes as given (the
 *   quick start's `engine`); a page's own declarations replace it.
 * @returns JavaScript that assigns `exports.__run`, and the target's assertions.
 */
export function pageProgram(fences: readonly TsFence[], target: number, prelude = ""): { js: string; assertions: FenceAssertion[] } {
	const parts: string[] = prelude === "" ? [] : [prelude];
	let assertions: FenceAssertion[] = [];
	fences.slice(0, target + 1).forEach((fence, i) => {
		// `import.meta` is a syntax error outside a module, and a fence that
		// uses it (a worker URL) cannot run here, so an earlier one is left out.
		if (i < target && (!parsesCleanly(fence.source) || fence.source.includes("import.meta"))) return;
		const file = ts.createSourceFile("fence.ts", fence.source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
		const edits = scopeEdits(file);
		if (i === target) {
			const checks = checkEdits(file, fence.source);
			assertions = checks.assertions;
			parts.push(applyEdits(fence.source, [...edits, ...checks.edits]));
		} else {
			parts.push(`try {\n${applyEdits(fence.source, edits)}\n} catch {}`);
		}
	});
	const js = ts.transpileModule(`export const __run = async (): Promise<void> => {\n${parts.join("\n")}\n};\n`, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	return { js, assertions };
}
