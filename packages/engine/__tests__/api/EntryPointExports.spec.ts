/**
 * What the entry points export matches what the docs tell a reader to import.
 *
 * Every syntax page opens with the package it belongs to and says to register it
 * explicitly for a slimmer engine, so each named package must be importable
 * from `solve-engine/packages`; 21 of the 41 were not (issue #556). The plugin
 * function guide imports `errorValue` from `solve-engine/vm`, which did not
 * export it (issue #557).
 */

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as packages from "@solve-js/packages";
import * as vm from "@solve-js/vm";

const DOCS = path.resolve(__dirname, "../../../../docs/src/content/docs");

describe("solve-engine/packages", () => {
	test("exports every package a syntax page names", () => {
		const named = new Set<string>();
		for (const file of fs.readdirSync(path.join(DOCS, "syntax"))) {
			const text = fs.readFileSync(path.join(DOCS, "syntax", file), "utf8");
			for (const m of text.matchAll(/\*\*Package:\*\* `([A-Z_]+)`/g)) named.add(m[1]);
		}
		expect(named.size).toBeGreaterThan(30);
		const exported = packages as Record<string, unknown>;
		const missing = [...named].filter((name) => exported[name] === undefined).sort();
		expect(missing).toEqual([]);
	});

	test("and every package in BUILTIN_PACKAGES by its own name", () => {
		const exported = packages as Record<string, unknown>;
		const byValue = new Set(Object.values(exported));
		const unexported = packages.BUILTIN_PACKAGES.filter((pkg) => !byValue.has(pkg)).map((pkg) => pkg.name);
		expect(unexported).toEqual([]);
	});
});

describe("solve-engine/vm", () => {
	test("exports the Value constructors the plugin function guide imports", () => {
		expect(typeof vm.numberValue).toBe("function");
		expect(typeof vm.errorValue).toBe("function");
		expect(vm.errorValue("X", "y").isError()).toBe(true);
	});
});
