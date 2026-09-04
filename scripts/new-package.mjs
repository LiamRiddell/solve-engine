/**
 * Scaffolds a new engine package: the source, a spec, a documentation page, and
 * every registration the three of them need.
 *
 * Adding a package is well documented and still a lot to hold at once. Seven
 * author-facing pages describe the extension points, and a package touches at
 * least eight places before it can be judged: the package folder, the entry in
 * `BUILTIN_PACKAGES`, the spec, the docs page, the sidebar, a changeset, and the
 * derived figures. Most of that is the same every time, and copying the nearest
 * existing package carries across whatever that package happened to do (the
 * travel package's first draft had cooking's normalizer rules in it, because it
 * was copied from cooking).
 *
 * What comes out is a package that registers, evaluates something, and passes
 * `npm run verify` before a line is edited. The behaviour it ships is a
 * placeholder to replace: `<name> of 21` answers 42. It is there so the whole
 * chain is wired and green from the first run, phrase to parselet to plugin
 * function to pure operation to spec to a proven documentation example.
 *
 * Usage:
 *   npm run new:package -- <name> [--group "Everyday"]
 *
 * @module new-package
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── The name, in the four shapes the generated files need ────────────────

const args = process.argv.slice(2);
const rawName = args.find((arg) => !arg.startsWith("--"));
const groupFlag = args.indexOf("--group");
const group = groupFlag >= 0 ? args[groupFlag + 1] : "Everyday";

if (rawName === undefined) {
	console.error(
		'Name the package: npm run new:package -- <name> [--group "Everyday"]\n' +
			"The name becomes the folder, the docs slug and the exported constant, so\n" +
			"give it the noun a reader would search for: cooking, travel, timesheets.",
	);
	process.exit(1);
}

/** `fuel economy` and `fuel-economy` both become `fuel-economy`. */
const slug = rawName
	.trim()
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, "-")
	.replace(/^-|-$/g, "");

if (slug === "") {
	console.error(`"${rawName}" has no letters or digits in it, so there is no name to make.`);
	process.exit(1);
}

/** `fuel-economy` becomes `fuelEconomy`, which is the folder and the module names. */
const camel = slug.replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
/** `fuelEconomy` becomes `FuelEconomy`, for the type and file names. */
const pascal = camel[0].toUpperCase() + camel.slice(1);
/** `fuel-economy` becomes `FUEL_ECONOMY`, for the package constant and token type. */
const screaming = slug.replace(/-/g, "_").toUpperCase();
/** The word a reader types, which is the phrase and the docs title. */
const spoken = slug.replace(/-/g, " ");

const dir = path.join(ROOT, "packages/engine/src/packages", camel);
if (fs.existsSync(dir)) {
	console.error(`packages/engine/src/packages/${camel} already exists. Pick another name, or delete it first.`);
	process.exit(1);
}

// ── The files ────────────────────────────────────────────────────────────

/** Write a file, creating its directory, and say so. */
function write(relative, contents) {
	const file = path.join(ROOT, relative);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, contents, "utf8");
	console.log(`  created  ${relative.replace(/\\/g, "/")}`);
}

write(
	`packages/engine/src/packages/${camel}/${pascal}Ops.ts`,
	`/**
 * The arithmetic behind the ${spoken} forms, as pure functions.
 *
 * Kept apart from the package so it can be tested directly and read without
 * the engine in the way: numbers and strings in, numbers and strings out, no
 * Value, no parser, no engine. A form that cannot answer returns null rather
 * than guessing, and the package turns that into a refusal that names what was
 * wrong.
 *
 * @module ${pascal}Ops
 */

/**
 * Placeholder: replace this with what the package actually works out.
 *
 * @param value - The number the line gave.
 * @returns Twice it, or null for a number that cannot be doubled.
 */
export function ${camel}Of(value: number): number | null {
\tif (!Number.isFinite(value)) return null;
\treturn value * 2;
}
`,
);

write(
	`packages/engine/src/packages/${camel}/parselets/${pascal}Parselet.ts`,
	`import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * \`${spoken} of <number>\`: reads the amount after the phrase and calls the
 * plugin function with it.
 *
 * Parsed at \`Lowest\`, so the whole of what follows is the operand: nothing
 * comes after it in this form, which makes taking everything safe. A form with
 * a part after the operand stops at the binding power of whatever separates
 * them instead (see \`TripFuelParselet\` for one that has to).
 */
export class ${pascal}Parselet implements PrefixParselet {
\treadonly category = "${pascal}";

\tparse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
\t\tparser.parseExpression(BindingPower.Lowest, builder);
\t\tbuilder.emitPluginCall("${camel}Of", 1);
\t}
}
`,
);

write(
	`packages/engine/src/packages/${camel}/${pascal}Package.ts`,
	`import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { errorValue, numberValue, Value } from "@solve-js/vm/Value";
import { ${camel}Of } from "./${pascal}Ops";
import { ${pascal}Parselet } from "./parselets/${pascal}Parselet";

/** Error codes this package answers with. Each names something a person can correct. */
export const ${pascal}ErrorCodes = {
\t/** The form was given something it cannot work from. */
\t${screaming}_EXPECTED_NUMBER: "${screaming}_EXPECTED_NUMBER",
} as const;

/** \`${spoken} of <number>\` -> the placeholder answer. Replace with the real one. */
function ${camel}OfHandler(args: Value[]): Value {
\tconst answer = ${camel}Of(args[0].toNumber());
\tif (answer === null) {
\t\treturn errorValue(
\t\t\t${pascal}ErrorCodes.${screaming}_EXPECTED_NUMBER,
\t\t\t'this needs a number, as in "${spoken} of 21"',
\t\t);
\t}
\treturn numberValue(answer);
}

/**
 * ${pascal}: say here what this package is for, in a sentence a reader who
 * does not know the domain can follow.
 *
 * Then say what it deliberately does not cover, and why. Every package in this
 * engine names its boundary, because the answer it refuses to guess at is as
 * much a part of what it does as the answers it gives.
 */
export const ${screaming}_PACKAGE: IEnginePackage = {
\tname: "solve-${slug}",
\tphrases: {
\t\t"${spoken} of": "${screaming}_OF",
\t},
\tprefixParselets: {
\t\t${screaming}_OF: new ${pascal}Parselet(),
\t},
\tpluginFunctions: {
\t\t${camel}Of: ${camel}OfHandler,
\t},
\ttokenCategories: {
\t\t${screaming}_OF: "keyword",
\t},
};
`,
);

write(
	`packages/engine/src/packages/${camel}/index.ts`,
	`export { ${screaming}_PACKAGE, ${pascal}ErrorCodes } from "./${pascal}Package";
export { ${camel}Of } from "./${pascal}Ops";
`,
);

write(
	`packages/engine/__tests__/packages/${pascal}.spec.ts`,
	`/**
 * ${pascal}: say here what the package is for, and what this spec is pinning.
 *
 * The convention the other package specs follow, and the one worth keeping:
 * what it answers, what it refuses and how, and what it deliberately leaves
 * alone. The last block is the one that catches the real mistakes, because a
 * new phrase or a new rule can quietly change what an unrelated line means.
 */

import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ${camel}Of } from "@solve-js/packages/${camel}";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluate a line, returning the display or the message a refusal carries. */
const answer = (expression: string): string => {
\tconst engine = newTrackedEngine();
\ttry {
\t\treturn formatValue(engine.evaluateExpression(expression)).replace(/^=\\s*/, "");
\t} catch (error) {
\t\treturn (error as Error).message;
\t} finally {
\t\tengine.clear();
\t}
};

describe("what it answers", () => {
\ttest("the placeholder form", () => {
\t\texpect(answer("${spoken} of 21")).toBe("42");
\t});
});

describe("the arithmetic, directly", () => {
\ttest("pure functions, without the engine in the way", () => {
\t\texpect(${camel}Of(21)).toBe(42);
\t\texpect(${camel}Of(Number.POSITIVE_INFINITY)).toBeNull();
\t});
});
`,
);

write(
	`docs/src/content/docs/syntax/${slug}.md`,
	`---
title: "${pascal}"
description: One line saying what this page is for.
---

> **Package:** \`${screaming}_PACKAGE\`. Registered by \`createEngine()\`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Open with the thing itself, in a sentence someone who has never met the idea can
follow. Name the concept plainly, then show the syntax. A reader should not have
to already know the answer to understand the page.

\`\`\`solve
${spoken} of 21 // 42
\`\`\`

Then explain what the form does and when a person would want it, not just that
it exists.

## When it cannot answer

Say what the package refuses, and why refusing is better than guessing. A
refusal that names the part that was wrong belongs here, as a proven example.

## The boundary

Name what this deliberately does not cover. Every page does, because the answer
a package will not guess at is as much a part of what it does as the ones it
gives.
`,
);

write(
	`.changeset/${slug}.md`,
	`---
"solve-engine": minor
---

One line saying what this adds, in the voice the other entries use: declarative,
British, no marketing.

| expression | result |
| --- | --- |
| \`${spoken} of 21\` | \`42\` |

Then the why, and the boundary: what it deliberately does not cover, and what
that leaves for the reader to do instead.
`,
);

// ── The registrations ────────────────────────────────────────────────────

/** Edit a file in place, refusing rather than guessing when the anchor moved. */
function edit(relative, anchor, replacement) {
	const file = path.join(ROOT, relative);
	const source = fs.readFileSync(file, "utf8");
	const seen = source.split(anchor).length - 1;
	if (seen !== 1) {
		console.error(
			`Could not register in ${relative}: expected one "${anchor.split("\n")[0]}", found ${seen}.\n` +
				"The file has moved on. Add the entry by hand, and fix this script's anchor.",
		);
		process.exit(1);
	}
	fs.writeFileSync(file, source.replace(anchor, replacement), "utf8");
	console.log(`  edited   ${relative}`);
}

const builtins = "packages/engine/src/packages/builtins.ts";
const importAnchor = 'import { TRAVEL_PACKAGE } from "./travel";';
edit(builtins, importAnchor, `${importAnchor}\nimport { ${screaming}_PACKAGE } from "./${camel}";`);

// Both lists: the one a bare engine reads and the one createEngine() uses.
const listSource = fs.readFileSync(path.join(ROOT, builtins), "utf8");
const listAnchor = "  TRAVEL_PACKAGE,";
const listCount = listSource.split(listAnchor).length - 1;
if (listCount !== 2) {
	console.error(`Expected TRAVEL_PACKAGE in two package lists in ${builtins}, found ${listCount}. Register by hand.`);
	process.exit(1);
}
fs.writeFileSync(
	path.join(ROOT, builtins),
	listSource.split(listAnchor).join(`${listAnchor}\n  ${screaming}_PACKAGE,`),
	"utf8",
);
console.log(`  edited   ${builtins} (both package lists)`);

const config = "docs/astro.config.mjs";
const groupAnchor = `              label: "${group}",`;
const configSource = fs.readFileSync(path.join(ROOT, config), "utf8");
if (!configSource.includes(groupAnchor)) {
	console.error(
		`No sidebar group labelled "${group}" in ${config}.\n` +
			"Pass --group with one that exists, or add the page to the sidebar by hand.",
	);
	process.exit(1);
}
const groupStart = configSource.indexOf(groupAnchor);
const itemsStart = configSource.indexOf("items: [", groupStart);
const insertAt = configSource.indexOf("\n", itemsStart) + 1;
fs.writeFileSync(
	path.join(ROOT, config),
	`${configSource.slice(0, insertAt)}                { slug: "syntax/${slug}" },\n${configSource.slice(insertAt)}`,
	"utf8",
);
console.log(`  edited   ${config} (the "${group}" group)`);

// ── What to do next ──────────────────────────────────────────────────────

console.log(
	`\nsolve-${slug} is registered and answers "${spoken} of 21".\n\n` +
		"Next:\n" +
		`  1. npm run verify            it should be green before you edit anything\n` +
		`  2. replace the placebo form in ${pascal}Ops.ts and ${pascal}Package.ts with the real one\n` +
		`  3. write the page at docs/src/content/docs/syntax/${slug}.md, every example proven\n` +
		`  4. npm run test:full && npm run stats:tests, and a clean build then npm run stats:size\n\n` +
		"The extension points are documented under docs/packages/, starting with\n" +
		"authoring-a-package.md, which routes each field to its own guide.\n",
);
