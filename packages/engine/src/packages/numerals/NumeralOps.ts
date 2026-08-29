/**
 * Numeral conversions as pure functions: a number to Roman numerals, to an
 * ordinal, or spelled out in words, and Roman numerals back to a number. No
 * engine types, so each is unit-tested on its own.
 *
 * A function returns `null` for an input it cannot represent (a Roman numeral
 * outside 1–3999, a malformed Roman string, a number too large to spell); the
 * package layer turns that into a structured Error.
 */

// ── Roman numerals (classic range 1–3999) ────────────────────────────────────

const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
	[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
	[50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];
const ROMAN_VALUE: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** A whole number 1–3999 as Roman numerals, or null if it is out of that range. */
export function numberToRoman(n: number): string | null {
	if (!Number.isInteger(n) || n < 1 || n > 3999) return null;
	let out = "";
	let rest = n;
	for (const [value, symbol] of ROMAN_TABLE) {
		while (rest >= value) { out += symbol; rest -= value; }
	}
	return out;
}

/**
 * A Roman numeral string back to a number, or null if it is not a valid,
 * canonical Roman numeral. Canonicity is checked by round-tripping: the parsed
 * value must spell back to exactly the input, which rejects `IIII`, `VV`, `IC`
 * and other non-standard forms that a naive subtractive scan would accept.
 */
export function romanToNumber(text: string): number | null {
	const s = text.trim().toUpperCase();
	if (s === "" || !/^[MDCLXVI]+$/.test(s)) return null;
	let total = 0;
	for (let i = 0; i < s.length; i++) {
		const value = ROMAN_VALUE[s[i]];
		const next = i + 1 < s.length ? ROMAN_VALUE[s[i + 1]] : 0;
		total += value < next ? -value : value;
	}
	return numberToRoman(total) === s ? total : null;
}

// ── Ordinals ──────────────────────────────────────────────────────────────────

/** A whole number as its ordinal (`1st`, `2nd`, `3rd`, `11th`, `22nd`), or null if not whole. */
export function numberToOrdinal(n: number): string | null {
	if (!Number.isInteger(n)) return null;
	const abs = Math.abs(n);
	const rem100 = abs % 100;
	const rem10 = abs % 10;
	let suffix = "th";
	if (rem100 < 11 || rem100 > 13) {
		if (rem10 === 1) suffix = "st";
		else if (rem10 === 2) suffix = "nd";
		else if (rem10 === 3) suffix = "rd";
	}
	return `${n}${suffix}`;
}

// ── Words (British English, with "and") ───────────────────────────────────────

const ONES = [
	"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
	"ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
	"seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion"];

/** Words for 1–99. */
function twoDigits(n: number): string {
	if (n < 20) return ONES[n];
	const t = Math.floor(n / 10), u = n % 10;
	return TENS[t] + (u ? `-${ONES[u]}` : "");
}

/** Words for 1–999, with the British "and" (one hundred and five). */
function threeDigits(n: number): string {
	const h = Math.floor(n / 100), r = n % 100;
	const parts: string[] = [];
	if (h) parts.push(`${ONES[h]} hundred`);
	if (r) { if (h) parts.push("and"); parts.push(twoDigits(r)); }
	return parts.join(" ");
}

/** Words for a non-negative whole number. */
function intToWords(n: number): string {
	if (n === 0) return "zero";
	const groups: number[] = [];
	let m = n;
	while (m > 0) { groups.push(m % 1000); m = Math.floor(m / 1000); }

	const parts: { scale: number; group: number; words: string }[] = [];
	for (let i = groups.length - 1; i >= 0; i--) {
		if (groups[i] === 0) continue;
		let w = threeDigits(groups[i]);
		if (i > 0) w += ` ${SCALES[i]}`;
		parts.push({ scale: i, group: groups[i], words: w });
	}

	let result = "";
	for (let k = 0; k < parts.length; k++) {
		if (k > 0) {
			// British "and" before a final units group below one hundred:
			// "one million and one", but "one thousand two hundred and thirty-four".
			const isLast = k === parts.length - 1;
			result += isLast && parts[k].scale === 0 && parts[k].group < 100 ? " and " : " ";
		}
		result += parts[k].words;
	}
	return result;
}

/**
 * A number spelled out in words. Negative numbers are prefixed "minus"; a
 * decimal is read digit by digit after "point" (`3.5` is "three point five").
 * Returns null for a value too large to spell (beyond the safe integer range,
 * where the digits are no longer exact).
 */
export function numberToWords(n: number): string | null {
	if (!Number.isFinite(n)) return null;
	const s = Math.abs(n).toString();
	if (s.includes("e") || s.includes("E")) return null; // exponential: too large to spell exactly
	const [intStr, fracStr] = s.split(".");
	let words = intToWords(parseInt(intStr, 10));
	if (fracStr) {
		words += " point " + [...fracStr].map((d) => ONES[Number(d)]).join(" ");
	}
	return (n < 0 ? "minus " : "") + words;
}
