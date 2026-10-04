/**
 * Reading the docs' markdown as text: which pages exist, which links a page
 * makes, and which headings it has. Shared by `check-cheatsheet.mjs` and
 * `check-doc-links.mjs`, so the two gates agree on what counts as a link.
 *
 * Text matching rather than a markdown parser, for the reason
 * `check-sidebar.mjs` gives for reading the Astro config as text: a lint should
 * not need a working docs install to run.
 *
 * @module markdown-links
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Every page on disk, keyed by the slug a root-relative link names it by.
 *
 * Starlight lowercases a file's name into its slug, and a slug is matched
 * exactly, so a link that differs from the page only in case is not taken as
 * reaching it (the published site is served case-sensitively). An `index` page
 * is its directory's slug, and the site's own `index` is `""`.
 *
 * @param {string} dir - Directory to walk.
 * @param {string} prefix - Slug prefix accumulated so far.
 * @param {Map<string, string>} out - The pages found so far, added to in place.
 * @returns {Map<string, string>} Slug to file path.
 */
export function pageFiles(dir, prefix = "", out = new Map()) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			pageFiles(full, `${prefix}${entry.name.toLowerCase()}/`, out);
			continue;
		}
		if (!/\.mdx?$/i.test(entry.name)) continue;
		const name = entry.name.replace(/\.mdx?$/i, "").toLowerCase();
		out.set(name === "index" ? prefix.replace(/\/$/, "") : prefix + name, full);
	}
	return out;
}

/**
 * Every page slug on disk (the keys of {@link pageFiles}).
 *
 * @param {string} dir - Directory to walk.
 * @returns {Set<string>} Slugs.
 */
export function pageSlugs(dir) {
	return new Set(pageFiles(dir).keys());
}

/**
 * A page's lines with the frontmatter and fenced code taken out, since neither
 * renders as prose: a link or a heading inside a fence is not one on the page.
 *
 * @param {string} markdown - The page source.
 * @returns {string[]} The lines outside frontmatter and fences.
 */
function proseLines(markdown) {
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
	return kept;
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
export function prose(markdown) {
	return withoutCodeSpans(withoutComments(proseLines(markdown).join("\n")));
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
export function withoutComments(text) {
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
export function withoutCodeSpans(text) {
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
export function linkTargets(markdown) {
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
export function slugOf(target) {
	if (!target.startsWith("/") || target.startsWith("//")) return null;
	return target.split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
}

/**
 * The fragment a link names, without its `#`, or null when it names none.
 * A percent-encoded fragment is decoded, since the browser compares the
 * decoded form with the heading's id; one that does not decode is kept as
 * written, so it fails to match rather than throwing.
 *
 * @param {string} target - The link target.
 * @returns {string | null} The fragment.
 */
export function fragmentOf(target) {
	const hash = target.indexOf("#");
	if (hash === -1) return null;
	const raw = target.slice(hash + 1);
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

/**
 * A heading's id, by the rule Astro applies to markdown headings (the
 * `github-slugger` algorithm): the text lowercased, every character that is
 * not a letter, a mark, a digit, a connector, a hyphen or a space removed, and
 * each space turned into a hyphen. A repeated id on the same page takes `-1`,
 * `-2` and so on, which {@link headingIds} applies.
 *
 * @param {string} text - The heading's rendered text.
 * @returns {string} The id.
 */
export function slugifyHeading(text) {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
		.replace(/ /g, "-");
}

/**
 * A heading's text as it renders: code spans keep their content, a link keeps
 * its text, emphasis and inline HTML tags go, and an escaped character is
 * itself. Any angle bracket left after that goes too, so a nested or escaped
 * tag (`<<b>b>`, `\<b>`) cannot rebuild one; the id drops them either way.
 *
 * @param {string} source - The heading's markdown, after the `#` marks.
 * @returns {string} The text.
 */
function headingText(source) {
	return source
		.replace(/\s+#+\s*$/, "")
		.replace(/!?\[((?:[^[\]\\]|\\.)*)\]\([^)]*\)/g, "$1")
		.replace(/<[^<>]+>/g, "")
		.replace(/`+/g, "")
		.replace(/(\*\*|__|\*|_)(?=\S)([^*_]*?\S)\1/g, "$2")
		.replace(/\\(.)/g, "$1")
		.replace(/[<>]/g, "")
		.trim();
}

/**
 * Every id a page's anchors can land on: `_top` (which Starlight gives the page
 * title), one per ATX heading (`## Heading`) by {@link slugifyHeading} with
 * repeats numbered, and any `id="..."` written as HTML on the page.
 *
 * Setext headings (text underlined with `===` or `---`) are not a form the docs
 * use, so they are not read.
 *
 * @param {string} markdown - The page source.
 * @returns {Set<string>} The ids.
 */
export function headingIds(markdown) {
	const ids = new Set(["_top"]);
	const seen = new Map();
	const lines = proseLines(markdown);
	for (const line of lines) {
		const match = /^ {0,3}#{1,6}[ \t]+(.+)$/.exec(line);
		if (!match) continue;
		const base = slugifyHeading(headingText(match[1]));
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		ids.add(count === 0 ? base : `${base}-${count}`);
	}
	for (const match of withoutComments(lines.join("\n")).matchAll(/<[a-z][^<>]*?\sid\s*=\s*["']([^"'<>]+)["']/gi)) ids.add(match[1]);
	return ids;
}
