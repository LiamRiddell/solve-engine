/**
 * Prefixes root-relative links in content with the site's base path.
 *
 * GitHub Pages serves this site from a repository subdirectory, so a link
 * written as `/syntax/cheatsheet/` in a markdown file resolves to
 * `https://liamriddell.github.io/syntax/cheatsheet/` and 404s. Astro rewrites
 * the links its own components emit, but a link an author types into a page is
 * passed through exactly as written.
 *
 * Fixing this per link would mean remembering the base every time anyone adds a
 * cross-reference, and the failure only shows up on the deployed site, never in
 * `astro dev` where the base is `/`. Doing it here means a page can be written
 * the obvious way and still be correct once deployed.
 *
 * Left alone: protocol-relative (`//host`) and absolute URLs, fragments,
 * `mailto:` and friends, and anything already carrying the prefix.
 */

import { visit } from "unist-util-visit";

/** @param {string} base - The configured site base, with or without slashes. */
function normalise(base) {
	if (!base || base === "/") return "";
	return `/${base.replace(/^\/+|\/+$/g, "")}`;
}

/**
 * Rehype plugin factory.
 *
 * @param {{ base?: string }} options - The site's base path.
 * @returns {(tree: import("hast").Root) => void} The transformer.
 */
export function rehypeBaseLinks(options = {}) {
	const prefix = normalise(options.base);

	/** @param {unknown} value @returns {string | null} */
	function prefixed(value) {
		if (typeof value !== "string") return null;
		if (!value.startsWith("/") || value.startsWith("//")) return null;
		if (value === prefix || value.startsWith(`${prefix}/`)) return null;
		return `${prefix}${value}`;
	}

	return (tree) => {
		// A base of "/" means every link is already right, and rewriting would
		// only risk breaking one.
		if (!prefix) return;

		visit(tree, "element", (node) => {
			for (const attr of ["href", "src"]) {
				const next = prefixed(node.properties?.[attr]);
				if (next) node.properties[attr] = next;
			}
		});

		// Raw HTML inside MDX arrives as JSX nodes rather than elements, so the
		// landing page's hand-written anchors need the same treatment.
		visit(tree, ["mdxJsxFlowElement", "mdxJsxTextElement"], (node) => {
			for (const attribute of node.attributes ?? []) {
				if (attribute.type !== "mdxJsxAttribute") continue;
				if (attribute.name !== "href" && attribute.name !== "src") continue;
				const next = prefixed(attribute.value);
				if (next) attribute.value = next;
			}
		});
	};
}
