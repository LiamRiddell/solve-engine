/**
 * Fails when a syntax page is not linked from the cheatsheet.
 *
 * The cheatsheet is the one-page map of the syntax reference: a proven line or
 * two for each area, and a link to the page that explains it. It had drifted
 * into a partial copy instead. It linked 5 of the 95 other syntax pages, so a
 * reader scanning it could not tell that most of the language existed, and
 * three of its blocks were markdown tables nothing evaluated, one of which
 * already disagreed with the engine (#728). The lines are proven by
 * `DocExamples.spec.ts`; this is the other half, that the map stays whole as
 * pages are added.
 *
 * It reads the cheatsheet's links and the pages on disk, and fails on any of:
 *
 * - a page under `syntax/` the cheatsheet does not link, other than the
 *   cheatsheet itself and the pages in {@link NOT_AREAS};
 * - a root-relative link on the cheatsheet that goes to no page, so a renamed
 *   or mistyped page cannot pass by being linked under its old name;
 * - an entry in {@link NOT_AREAS} whose page is gone, or which the cheatsheet
 *   links anyway, so the list of exceptions cannot quietly outlive its reason.
 *
 * A link counts in the form the docs write internal links: root-relative, as
 * `/syntax/<slug>/`, with or without the trailing slash, an anchor or a query
 * (`rehype-base-links.mjs` adds the site's base path at build time). A relative
 * link does not count. A link inside a code fence, an inline code span or an
 * HTML comment is not a link on the rendered page, so it does not count either,
 * and nor does an image.
 *
 * The boundary: it checks that a page is linked, not that the anchor it names
 * exists (`check-doc-links.mjs` does that for every page), and not that the line beside the link is right, which is what
 * `DocExamples.spec.ts` proves. Links under `/api/` are skipped, since that
 * reference is generated at build time and is not in the repository.
 *
 * Text matching rather than a markdown parser, for the reason
 * `check-sidebar.mjs` gives for reading the Astro config as text: a lint should
 * not need a working docs install to run. The reading is shared with
 * `check-doc-links.mjs` through `lib/markdown-links.mjs`, so the two agree on
 * what a link is.
 *
 * Usage:
 *   node scripts/check-cheatsheet.mjs
 *
 * `--root=<dir>` reads another checkout's docs tree instead, which is how the
 * spec runs it over fixture pages.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { linkTargets, pageSlugs, slugOf } from "./lib/markdown-links.mjs";

const rootArgument = process.argv.find((arg) => arg.startsWith("--root="));
const ROOT = rootArgument ? path.resolve(rootArgument.slice("--root=".length)) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "docs", "src", "content", "docs");
const CHEATSHEET = "syntax/cheatsheet";

/**
 * Syntax pages that are references rather than areas of the language, so the
 * cheatsheet gives them no line, each with the reason. A `Map` rather than an
 * object literal, so a page named after an inherited property (`constructor`)
 * is not read as listed.
 */
const NOT_AREAS = new Map([
	[
		"syntax/unit-reference",
		"the generated list of every unit spelling, a lookup rather than an area of syntax; the units pages and the sidebar's Reference group link it",
	],
]);

const pages = pageSlugs(CONTENT);
const syntaxPages = [...pages].filter((slug) => slug.startsWith("syntax/") && slug !== CHEATSHEET).sort();
const cheatsheetFile = ["md", "mdx"].map((ext) => path.join(CONTENT, `${CHEATSHEET}.${ext}`)).find((file) => fs.existsSync(file));

if (cheatsheetFile === undefined) {
	console.error(`There is no cheatsheet at docs/src/content/docs/${CHEATSHEET}.md, so nothing links the syntax pages.`);
	process.exit(1);
}

const linked = new Set();
const broken = [];
for (const target of linkTargets(fs.readFileSync(cheatsheetFile, "utf8"))) {
	const slug = slugOf(target);
	if (slug === null) continue;
	if (slug === "api" || slug.startsWith("api/")) continue;
	// A path with an extension is a file the site serves (an image, a feed),
	// not a page, so it is not a page this check can find on disk.
	if (/\.[a-z0-9]+$/i.test(slug)) continue;
	if (pages.has(slug)) linked.add(slug);
	else broken.push(target);
}

const missing = syntaxPages.filter((slug) => !linked.has(slug) && !NOT_AREAS.has(slug));
const stale = [...NOT_AREAS.keys()]
	.filter((slug) => !pages.has(slug) || linked.has(slug))
	.map((slug) => `${slug} (${pages.has(slug) ? "the cheatsheet links it" : "no such page"})`);

if (missing.length === 0 && broken.length === 0 && stale.length === 0) {
	const set = [...NOT_AREAS.keys()].map((slug) => slug.replace(/^syntax\//, ""));
	console.log(`The cheatsheet links ${syntaxPages.length - NOT_AREAS.size} syntax page(s); ${set.length} set aside as a reference: ${set.join(", ")}.`);
	process.exit(0);
}

if (missing.length > 0) {
	console.error("These syntax pages are not linked from the cheatsheet:");
	for (const slug of missing) console.error(`  ${slug}`);
	console.error(`Give each a proven line and a link in docs/src/content/docs/${CHEATSHEET}.md, under its sidebar group.`);
}

if (broken.length > 0) {
	console.error("These cheatsheet links go to no page:");
	for (const target of broken) console.error(`  ${target}`);
}

if (stale.length > 0) {
	console.error("These entries in NOT_AREAS in scripts/check-cheatsheet.mjs are stale:");
	for (const entry of stale) console.error(`  ${entry}`);
	console.error("Remove an entry once its page is gone, or once the cheatsheet links it.");
}

process.exit(1);
