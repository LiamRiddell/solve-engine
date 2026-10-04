import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * #788: the playground's result and error chips and the docs notepad's answers
 * are reachable without a pointer. Neither component has a test harness of its
 * own (the playground and the docs site have their own installs, outside this
 * suite), so this reads their source and holds each fix the issue asks for, so
 * that removing one fails here: the error popover opens on focus and closes on
 * Escape and is named by `aria-describedby`; the result chip is a button that
 * answers Enter and Space; each pending marker has words; a long notepad answer
 * is focusable and shows its full text on focus.
 */

const ROOT = path.resolve(__dirname, "../../../..");
const EDITOR = fs.readFileSync(path.join(ROOT, "playground/src/components/EditorPane.tsx"), "utf8");
const PLAYGROUND_CSS = fs.readFileSync(path.join(ROOT, "playground/src/index.css"), "utf8");
const NOTEPAD = fs.readFileSync(path.join(ROOT, "docs/src/components/SolveNotepad.tsx"), "utf8");
const NOTEPAD_CSS = fs.readFileSync(path.join(ROOT, "docs/src/styles/notepad.css"), "utf8");

/** The source of the playground's `ResultWidget.toDOM`. */
const toDOM = EDITOR.slice(EDITOR.indexOf("  toDOM() {"), EDITOR.indexOf("  ignoreEvent() {"));

describe("the playground's error chip", () => {
	test("opens its popover on focus as well as hover, and closes on blur and Escape", () => {
		expect(toDOM).toContain('addEventListener("mouseenter"');
		expect(toDOM).toContain('addEventListener("focus", () => this.showPopover(chip))');
		expect(toDOM).toContain('addEventListener("blur", () => this.hidePopover(chip))');
		expect(toDOM).toMatch(/e\.key !== "Escape"[\s\S]*?this\.hidePopover\(chip\)/);
	});

	test("is focusable and names its popover with aria-describedby", () => {
		expect(toDOM).toContain('this.chip("os-result-inline os-result-error")');
		expect(toDOM).toContain('chip.setAttribute("aria-describedby", this.popover.id)');
		expect(EDITOR).toContain('popover.id = `os-error-popover-${++nextPopoverId}`');
		expect(EDITOR).toContain('popover.setAttribute("role", "tooltip")');
	});

	test("says the error in words, with the warning sign hidden as decoration", () => {
		expect(toDOM).toContain('chip.setAttribute("aria-label", `Error: ${this.errorDetail.message}`)');
		expect(toDOM).toMatch(/warning\.setAttribute\("aria-hidden", "true"\)/);
	});
});

describe("the playground's result chip", () => {
	test("is a button, and Enter and Space toggle the line's detail", () => {
		expect(EDITOR).toContain('const button = document.createElement("button")');
		expect(EDITOR).toContain('button.type = "button"');
		expect(EDITOR).toMatch(/e\.key !== "Enter" && e\.key !== " "[\s\S]*?toggleLineExpanded\(line\)/);
		expect(toDOM).toContain('this.lineNumber === undefined ? document.createElement("span") : this.chip("")');
	});

	test("keeps its look as a button, and shows a focus ring", () => {
		expect(PLAYGROUND_CSS).toMatch(/button\.os-result-inline \{[^}]*border: 0;/);
		expect(PLAYGROUND_CSS).toContain(".os-result-inline:focus-visible");
	});
});

describe("the pending markers", () => {
	test("the playground's spinner and dots are decoration, and the words are said", () => {
		expect(toDOM).toContain('words.textContent = "waiting for live data"');
		expect(toDOM).toMatch(/spinner\.setAttribute\("aria-hidden", "true"\)/);
		expect(toDOM).toMatch(/label\.setAttribute\("aria-hidden", "true"\)/);
		expect(PLAYGROUND_CSS).toContain(".os-visually-hidden {");
	});

	test("the notepad's ellipsis is decoration, and the live region announces the words", () => {
		expect(NOTEPAD).toContain('const PENDING_WORDS = "waiting for live data";');
		expect(NOTEPAD).toContain('<span aria-hidden="true">{answer.text}</span>');
		expect(NOTEPAD).toContain('<span className="notepad__visually-hidden">{PENDING_WORDS}</span>');
		expect(NOTEPAD_CSS).toContain(".notepad__visually-hidden {");
	});
});

describe("a long notepad answer", () => {
	test("is focusable and shows its full text on focus, not only through title", () => {
		expect(NOTEPAD).toContain("tabIndex={long ? 0 : undefined}");
		expect(NOTEPAD).toContain('<span className="notepad__full" aria-hidden="true">');
		expect(NOTEPAD_CSS).toMatch(/\.notepad__answer:focus \.notepad__full \{[^}]*display: block;/);
		// The full copy is positioned against the column, so the row's own
		// overflow: hidden does not clip it.
		expect(NOTEPAD_CSS).toMatch(/\.notepad__answers \{[^}]*position: relative;/);
	});

	test("the threshold is a small positive length, so a short answer adds no tab stop", () => {
		const threshold = Number(/const MAY_TRUNCATE = (\d+);/.exec(NOTEPAD)?.[1]);
		expect(threshold).toBeGreaterThan(0);
		expect(threshold).toBeLessThan(80);
	});
});
