/**
 * Turns a ```mermaid fenced block into a container the browser can render into.
 *
 * This has to happen in remark rather than later because Expressive Code claims
 * every code block on the site. Left alone it would draw `mermaid` as an
 * unhighlighted source listing inside a code frame, and the diagram source
 * would then be buried in syntax-highlighting markup rather than sitting in one
 * readable string.
 *
 * Emitting a raw HTML node instead means Expressive Code never sees the block
 * at all. The source is kept as the element's text content, which keeps it in
 * the page for search and for readers without JavaScript, and the client script
 * (`scripts/mermaid.ts`) replaces it with an SVG once mermaid has loaded.
 */

import { visit } from "unist-util-visit";

/**
 * Escapes the five characters that would otherwise let diagram source break out
 * of the element it is written into. Mermaid syntax legitimately contains `>`
 * and `-->`, so this is a correctness requirement, not a precaution.
 *
 * @param {string} value - Raw diagram source.
 * @returns {string} The same source, safe to place in HTML text content.
 */
function escapeHtml(value) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Remark plugin. Rewrites every mermaid code block in the tree.
 *
 * @returns {(tree: import("mdast").Root) => void} The transformer.
 */
export function remarkMermaid() {
	return (tree) => {
		visit(tree, "code", (node, index, parent) => {
			if (node.lang !== "mermaid" || !parent || index === undefined) return;

			const caption = typeof node.meta === "string" ? node.meta.trim() : "";

			parent.children[index] = {
				type: "html",
				value: [
					`<figure class="mermaid-figure not-content">`,
					`<pre class="mermaid" data-mermaid>${escapeHtml(node.value)}</pre>`,
					caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : "",
					`</figure>`,
				].join(""),
			};
		});
	};
}
