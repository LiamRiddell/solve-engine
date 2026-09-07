/**
 * A document of tag aggregates costs its members, not its length.
 *
 * `total of #tag` used to walk the whole document per aggregate, so a document
 * of D aggregates over N lines cost D x N per pass. Measured through
 * `parseDocument` on the machine this was written on, N lines of `<i> #a`
 * followed by N lines of `total of #a`:
 *
 * | total lines | before | now    |
 * | ---         | ---    | ---    |
 * | 2,000       | 1.97 s | 0.04 s |
 * | 5,000       | 11.8 s | 0.25 s |
 * | 10,000      | 49.2 s | 0.87 s |
 * | 20,000      | 250 s  | 3.3 s  |
 *
 * That shape stays quadratic because it *is* quadratic: ten thousand totals
 * over ten thousand members is a hundred million additions however they are
 * found. What this pins is the part that was avoidable, the document walk: with
 * the number of aggregates fixed, a pass is now linear in the document, so
 * adding untagged lines around a total costs their parse and nothing more.
 *
 * The bounds follow the rule set in #364, several times the slowest measured
 * median, so they catch a return to the walk without measuring the runner.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";

/** `n` tagged amounts, then one total over them. */
function membersThenOneTotal(n: number): string {
	const lines: string[] = [];
	for (let i = 1; i <= n; i++) lines.push(`${i} #a`);
	lines.push("total of #a");
	return lines.join("\n");
}

/** The milliseconds a batch pass over `text` takes, after one warm-up pass. */
function passMs(text: string): number {
	const engine = createEngine();
	engine.parseDocument(text);
	const started = process.hrtime.bigint();
	engine.parseDocument(text);
	return Number(process.hrtime.bigint() - started) / 1e6;
}

describe("cost of a pass", () => {
	test("one total over N members is linear in N", () => {
		// 0.08 s and 0.15 s here; before, this shape was already linear, so the
		// point of the pair is that the index did not make it worse.
		const small = passMs(membersThenOneTotal(10_000));
		const large = passMs(membersThenOneTotal(20_000));

		// Twice the document for no more than four times the work: the walk
		// would have been flat here too, an index that regressed it would not.
		expect(large).toBeLessThan(small * 4 + 50);
	});

	test("aggregates over a growing document stay linear in the document", () => {
		// The shape the walk was quadratic on, held to a fixed twenty totals so
		// the aggregate work itself does not grow with the document. Before, ten
		// thousand lines took 2.55 s and five thousand took 0.68 s, four times
		// the work for twice the document. Now it is 0.15 s and 0.06 s.
		const document = (n: number): string => {
			const lines: string[] = [];
			const every = n / 20;
			for (let i = 1; i <= n; i++) {
				lines.push(`${i} #a`);
				if (i % every === 0) lines.push("total of #a");
			}
			return lines.join("\n");
		};

		const small = passMs(document(5_000));
		const large = passMs(document(10_000));

		// Twice the document, and the twenty totals each read twice the members,
		// so four times is the honest ceiling on the arithmetic alone. The walk
		// took a further factor of the document on top of that.
		expect(large).toBeLessThan(small * 6 + 50);
	});

	test("untagged lines around a total cost their parse and nothing more", () => {
		// The clearest statement of what changed: the aggregate no longer looks
		// at a line that has nothing to do with it.
		const withPadding = ["10 #a", "20 #a", ...Array<string>(20_000).fill("1 + 1"), "total of #a"].join("\n");
		const withoutPadding = ["10 #a", "20 #a", "total of #a"].join("\n");

		const padded = passMs(withPadding);
		const bare = passMs(withoutPadding);

		// Twenty thousand plain lines parse in well under half a second; the
		// walk would have had the total look at every one of them.
		expect(padded - bare).toBeLessThan(500);
	});
});
