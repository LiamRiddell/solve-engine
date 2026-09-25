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
 * exists, and not that the line beside the link is right, which is what
 * `DocExamples.spec.ts` proves. Links under `/api/` are skipped, since that
 * reference is generated at build time and is not in the repository.
 *
 * Text matching rather than a markdown parser, for the reason
 * `check-sidebar.mjs` gives for reading the Astro config as text: a lint should
 * not need a working docs install to run.
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

/**
 * Every page slug on disk, in the form a root-relative link names it.
 *
 * Starlight lowercases a file's name into its slug, and a slug is matched
 * exactly, so a link that differs from the page only in case is not taken as
 * reaching it (the published site is served case-sensitively). An `index` page
 * is its directory's slug.
 *
 * @param {string} dir - Directory to walk.
 * @param {string} prefix - Slug prefix accumulated so far.
 * @param {Set<string>} out - The slugs found so far, added to in place.
 * @returns {Set<string>} Slugs.
 */
function pageSlugs(dir, prefix = "", out = new Set()) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			pageSlugs(full, `${prefix}${entry.name.toLowerCase()}/`, out);
			continue;
		}
		if (!/\.mdx?$/i.test(entry.name)) continue;
		const name = entry.name.replace(/\.mdx?$/i, "").toLowerCase();
		out.add(name === "index" ? prefix.replace(/\/$/, "") : prefix + name);
	}
	return out;
}

/**
 * The text of a page as it renders, with everything that is not rendered as a
 * link taken out: the frontmatter, fenced code, inline code spans and HTML
 * comments.
 *
 * A code span is replaced by nothing rather than removed with its brackets, so
 * a link whose text is code (`` [`x`](/syntax/x/) ``) still reads as a link.
 *
 * @param {string} markdown - The page source.
 * @returns {string} The prose.
 */
function prose(markdown) {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	let start = 0;
	if (lines[0] === "---") {
		const end = lines.indexOf("---", 1);
		if (end !== -1) start = end + 1;
	}
	const kept = [];
	let fence = null;
	for (const line of lines.slice(start)) {
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (fence === null && marker) {
			fence = marker[1];
			continue;
		}
		if (fence !== null) {
			// A fence closes on a run of the same character at least as long.
			if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = null;
			continue;
		}
		kept.push(line);
	}
	return withoutCodeSpans(withoutComments(kept.join("\n")));
}

/**
 * Text with its HTML comments removed. A comment left open runs to the end of
 * the page, as an HTML block does in markdown.
 *
 * A scan with `indexOf` rather than a lazy pattern, so that many unclosed
 * `<!--` cost one pass rather than one pass each.
 *
 * @param {string} text - The text.
 * @returns {string} The text, without comments.
 */
function withoutComments(text) {
	let out = "";
	let position = 0;
	for (;;) {
		const open = text.indexOf("<!--", position);
		if (open === -1) return out + text.slice(position);
		out += text.slice(position, open);
		const close = text.indexOf("-->", open + 4);
		if (close === -1) return out;
		position = close + 3;
	}
}

/**
 * Text with its inline code spans removed.
 *
 * A span opens on a run of backticks and closes on the next run of the same
 * length in the same paragraph; a run with no partner is literal text. A
 * paragraph ends at a blank line, so a stray backtick cannot swallow the links
 * of the next one. Each run's partner is found from a table built in one pass
 * from the right, rather than by a pattern with a backreference, which
 * backtracks without bound on a long run of backticks.
 *
 * @param {string} text - The text.
 * @returns {string} The text, without code spans.
 */
function withoutCodeSpans(text) {
	return text
		.split(/(\n[ \t]*\n)/)
		.map((paragraph) => {
			const runs = Array.from(paragraph.matchAll(/`+/g), (match) => ({ start: match.index, end: match.index + match[0].length }));
			const partner = new Array(runs.length).fill(-1);
			const nextOfLength = new Map();
			for (let i = runs.length - 1; i >= 0; i--) {
				const length = runs[i].end - runs[i].start;
				partner[i] = nextOfLength.get(length) ?? -1;
				nextOfLength.set(length, i);
			}
			let out = "";
			let position = 0;
			for (let i = 0; i < runs.length; i++) {
				if (partner[i] === -1) continue;
				out += paragraph.slice(position, runs[i].start);
				position = runs[partner[i]].end;
				i = partner[i];
			}
			return out + paragraph.slice(position);
		})
		.join("");
}

/**
 * Every link target in a page: inline links, reference definitions and HTML
 * anchors. Images are not links, so `![...](...)` is skipped.
 *
 * @param {string} markdown - The page source.
 * @returns {string[]} The targets, as written.
 */
function linkTargets(markdown) {
	const text = prose(markdown);
	const targets = [];
	// Each pattern stops at the next opening bracket, line or tag, so an
	// unclosed `[` or `<a` costs a short scan rather than one to the end of
	// the page for every such character. Link text holding brackets of its
	// own is not a form the docs use.
	for (const match of text.matchAll(/(!?)\[(?:[^[\]\\]|\\.)*\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g)) {
		if (match[1] !== "!") targets.push(match[2]);
	}
	for (const match of text.matchAll(/^ {0,3}\[[^[\]\n]+\]:[ \t]*<?([^\s>]+)>?/gm)) targets.push(match[1]);
	for (const match of text.matchAll(/<a\s[^<>]*?href\s*=\s*["']([^"'<>]+)["']/gi)) targets.push(match[1]);
	return targets;
}

/**
 * The page slug a root-relative link names, or null for any other link: an
 * external address, a protocol-relative one, a relative path, or an anchor on
 * the same page.
 *
 * @param {string} target - The link target.
 * @returns {string | null} The slug, `""` for the site root.
 */
function slugOf(target) {
	if (!target.startsWith("/") || target.startsWith("//")) return null;
	return target.split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
}

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
