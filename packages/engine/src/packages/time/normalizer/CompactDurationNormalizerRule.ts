import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const NUMBER_ID = tokenTypeId("NUMBER");
const UNIT_ID = tokenTypeId("UNIT");

/**
 * The duration units this spelling admits, largest first.
 *
 * An allow-list rather than a measure lookup, because `m` is the problem this
 * has to solve rather than one it can defer: on its own `m` is metres, and it
 * is minutes only inside a duration written this way. Ranking them is what
 * makes that safe, since a compact duration always runs from the larger unit
 * to the smaller.
 */
const RANK: Record<string, number> = {
	w: 0, wk: 0, wks: 0, week: 0, weeks: 0,
	d: 1, day: 1, days: 1,
	h: 2, hr: 2, hrs: 2, hour: 2, hours: 2,
	m: 3, min: 3, mins: 3, minute: 3, minutes: 3,
	s: 4, sec: 4, secs: 4, second: 4, seconds: 4,
	ms: 5,
};

/**
 * The unit each rank is written back out as.
 *
 * Written out rather than passed through, because `m` is the whole difficulty:
 * downstream it is metres, and `45m30s` would come back as forty-five metres
 * and thirty seconds, which is not a quantity. By the time a part has a rank
 * this rule knows it is a duration, so it says which duration it means.
 */
const CANONICAL = ["weeks", "days", "hours", "minutes", "seconds", "ms"];

/** A number and the unit written against it, in the order the line wrote them. */
interface Part {
	readonly amount: string;
	readonly unit: string;
}

/**
 * Split `h30m15s` into the units and amounts it spells, or null.
 *
 * The identifier the lexer leaves after a number alternates letters and
 * digits: the first letters belong to the number already parsed, and each
 * later pair is a part of its own. Anything that does not alternate cleanly,
 * or names a unit this spelling does not admit, or repeats or goes back up the
 * scale, is not a duration and is left alone.
 */
function partsOf(leadingAmount: string, identifier: string): Part[] | null {
	const pieces = identifier.match(/[a-z]+|\d+(?:\.\d+)?/g);
	if (pieces === null || pieces.length % 2 === 0) return null;

	const parts: Part[] = [{ amount: leadingAmount, unit: pieces[0] }];
	for (let i = 1; i < pieces.length; i += 2) {
		const amount = pieces[i];
		const unit = pieces[i + 1];
		if (!/^\d/.test(amount) || !/^[a-z]/.test(unit)) return null;
		parts.push({ amount, unit });
	}

	let previous = -1;
	const canonical: Part[] = [];
	for (const part of parts) {
		const rank = RANK[part.unit];
		if (rank === undefined || rank <= previous) return null;
		previous = rank;
		canonical.push({ amount: part.amount, unit: CANONICAL[rank] });
	}
	return canonical;
}

/**
 * `2h30m`: a duration written the way a stopwatch prints one, with no spaces.
 *
 * `2h 30m` already reads as 150 minutes; the same duration typed without the
 * space did not, because the lexer leaves `h30m` as one identifier and the line
 * became two hours times a variable nobody declared. This splits that
 * identifier back into the parts it spells and hands them on, so the existing
 * compound-quantity rule adds them up exactly as it does for the spaced form.
 *
 * Two things keep the claim narrow. Every part must name a unit from the small
 * list above, so `2x3` and `100m50cm` are untouched. And the units must run
 * strictly from larger to smaller, which is what a compact duration is:
 * `2m30h` is not one, and neither is `1m2m`.
 *
 * The boundary this does not cross: `90m` on its own is still 90 metres. `m` is
 * metres in SI and reads as minutes only beside a larger time unit, which is
 * the only place this rule looks at it.
 *
 * @module CompactDurationNormalizerRule
 */

/** The rule: see the module comment for the two guards that keep it narrow. */
export function compactDurationNormalizerRule(priority = 77): NormalizerRule {
	const RULE = "time:compact-duration";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["NUMBER"] }, { types: ["IDENT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const head = tokens[pos];
			if (head?.type !== "NUMBER") return null;
			const rest = tokens[pos + 1];
			if (rest?.type !== "IDENT") return null;

			const parts = partsOf(head.value ?? "", (rest.value ?? "").toLowerCase());
			if (parts === null || parts.length < 2) return null;

			const replacement: Token[] = [];
			for (const part of parts) {
				replacement.push(
					new LexerToken("NUMBER", NUMBER_ID, part.amount, part.amount, head.offset, 0, head.line, head.col),
					new LexerToken("UNIT", UNIT_ID, part.unit, part.unit, head.offset, 0, head.line, head.col),
				);
			}
			return { consumed: 2, replacement, ruleName: RULE };
		},
	};
}
