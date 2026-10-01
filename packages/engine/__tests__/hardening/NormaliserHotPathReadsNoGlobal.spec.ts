/**
 * The normaliser's hot path reads no global and builds nothing it throws away.
 *
 * The benchmark gate confirmed the normaliser suite at 1.26 times its merge
 * base, with every case slower, the no-op ones included. Four helpers that run
 * at many tokens of a line had each gained a per-call cost:
 *
 * - `resolveCurrencyAlias`, read by the rate-target rule at every `in` and
 *   `to`, guarded four tables with `Object.prototype.hasOwnProperty.call`,
 *   which reads the global `Object` on each call (`120 km/h to m/s` at 1.6
 *   times). The tables are now `Map`s built once.
 * - The IPv6 rule, tried at every word, number and colon, tested each token
 *   against a pattern, split its text to count colons and joined the run
 *   before its two-colon reject (`:v42 = 43` at 1.6 times, and every line of
 *   the 500-line document). It now counts in place, joins only a run that
 *   passes, and turns a lone colon (`:v42`, which no address opens with) away
 *   before measuring the run at all.
 * - The zone-after-name rule, tried at every word of prose, looked the next
 *   word up in the zone table before it checked for the `in` it needs, and the
 *   salary flourish lower-cased the next word before it checked for the
 *   take-home form after it. The cheap test now comes first in both.
 * - A date literal's local midnight and UTC instant read `Math.trunc` for every
 *   year, where only a year from 0 to 99 needs it.
 *
 * Inside a `vm` context, the harness the benchmarks run in, each global read
 * costs hundreds of nanoseconds. Every change is behaviour-neutral, and each is
 * proven here against the implementation it replaced, kept below as an oracle.
 */

import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import {
	CURRENCY_LETTER_SYMBOLS,
	CURRENCY_LOWERCASE_CODES,
	CURRENCY_SYMBOL_ALIASES,
	CURRENCY_WORD_ALIASES,
	resolveCurrencyAlias,
} from "@solve-js/uom/CurrencyAliases";
import { colonsIn, ipv6NormalizerRule, isRunText, readAddress, secondCharacterIsColon } from "@solve-js/packages/ip/normalizer/Ipv6NormalizerRule";
import { MAX_IPV6_TEXT } from "@solve-js/packages/ip/Ipv6Shape";
import { endsNamedTime, namesListedZone, zoneAfterNameAt, zoneAfterNameNormalizerRule } from "@solve-js/packages/time/normalizer/ZoneAfterNameNormalizerRule";
import { startsZoneReference } from "@solve-js/packages/time/parselets/shared/ZoneReference";
import { salaryFlourishAt } from "@solve-js/packages/payroll/normalizer/SalaryWordNormalizerRule";
import { rateTargetNumerator } from "@solve-js/packages/uom/normalizer/RateTargetNormalizerRule";
import { localDate } from "@solve-js/calendar/DateCalendar";
import { dayNumber, daysInMonth, utcMs } from "@solve-js/calendar/Gregorian";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";

const SRC = path.resolve(__dirname, "../../src");

/** The body of the function whose signature matches, up to its closing brace at the margin. */
function bodyOf(file: string, signature: RegExp): string {
	const source = fs.readFileSync(path.join(SRC, file), "utf8");
	const start = source.search(signature);
	expect(start).toBeGreaterThanOrEqual(0);
	return source.slice(start, source.indexOf("\n}", start));
}

/** The line's tokens as the normaliser receives them. */
function lex(text: string): Token[] {
	const lexer = newTrackedEngine().getLexer();
	lexer.resetExpression(text);
	const out: Token[] = [];
	for (const t of lexer) if (t.type !== "COMMENT") out.push(t);
	return out;
}

/** Each line of a document as the reader sees it. */
function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text).lines.map((l) =>
		l.result == null ? `ERROR ${l.error}` : l.result.isError() ? `ERROR ${l.result.errorMessage}` : formatValue(l.result));
}

// ── resolveCurrencyAlias ─────────────────────────────────────────────────────

/** The lookup as it was: four own-key guards over the exported tables. */
function oldResolveCurrencyAlias(text: string): string | undefined {
	const own = (table: Record<string, string>, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);
	const lower = text.toLowerCase();
	if (own(CURRENCY_SYMBOL_ALIASES, text)) return CURRENCY_SYMBOL_ALIASES[text];
	if (own(CURRENCY_LETTER_SYMBOLS, text)) return CURRENCY_LETTER_SYMBOLS[text];
	if (own(CURRENCY_LOWERCASE_CODES, text)) return CURRENCY_LOWERCASE_CODES[text];
	if (own(CURRENCY_WORD_ALIASES, lower)) return CURRENCY_WORD_ALIASES[lower];
	return undefined;
}

describe("resolveCurrencyAlias", () => {
	test("reads no global per call", () => {
		const body = bodyOf("uom/CurrencyAliases.ts", /export function resolveCurrencyAlias\(/);
		expect(body).not.toMatch(/hasOwnProperty|\bObject\./);
		expect(body).toContain("_MAP.get(");
	});

	test("symbols, letter symbols, lower-case codes and words, as before", () => {
		expect(resolveCurrencyAlias("$")).toBe("USD");
		expect(resolveCurrencyAlias("A$")).toBe("AUD");
		expect(resolveCurrencyAlias("Ft")).toBe("HUF");
		expect(resolveCurrencyAlias("usd")).toBe("USD");
		expect(resolveCurrencyAlias("dollars")).toBe("USD");
		expect(resolveCurrencyAlias("Euros")).toBe("EUR");
	});

	test("case stays exact where it was exact", () => {
		// `ft` is the foot, `Usd` no spelling of a code, and a symbol has no case.
		expect(resolveCurrencyAlias("ft")).toBeUndefined();
		expect(resolveCurrencyAlias("Usd")).toBeUndefined();
		expect(resolveCurrencyAlias("KR")).toBeUndefined();
		expect(resolveCurrencyAlias("a$")).toBeUndefined();
	});

	test("every key of every table, and its other cases, reads what the old lookup read", () => {
		const keys = [CURRENCY_SYMBOL_ALIASES, CURRENCY_LETTER_SYMBOLS, CURRENCY_LOWERCASE_CODES, CURRENCY_WORD_ALIASES].flatMap((t) => Object.keys(t));
		expect(keys.length).toBeGreaterThan(80);
		for (const key of keys) {
			for (const form of [key, key.toUpperCase(), key.toLowerCase(), key[0].toUpperCase() + key.slice(1)]) {
				expect([form, resolveCurrencyAlias(form)]).toEqual([form, oldResolveCurrencyAlias(form)]);
			}
		}
	});

	test("empty, spaced and unknown text is no alias", () => {
		for (const text of ["", " ", " $", "$ ", "dollar ", "\t", "\n", "xyz", "USD"]) {
			expect([text, resolveCurrencyAlias(text)]).toEqual([text, oldResolveCurrencyAlias(text)]);
		}
		// Canonical codes are not aliases: callers fall back to the text itself.
		expect(resolveCurrencyAlias("USD")).toBeUndefined();
	});

	test("prototype words, in any case, are no alias, and nothing is written to Object.prototype", () => expectPrototypeUntouched(() => {
		for (const word of PROTOTYPE_WORDS) {
			for (const form of [word, word.toLowerCase(), word.toUpperCase()]) {
				expect([form, resolveCurrencyAlias(form)]).toEqual([form, undefined]);
			}
		}
	}));

	test("look-alike and markup-shaped text is read as text", () => {
		for (const text of [...TEXT_EDGES, "＄", "$​", "​dollar", "dollar‮", "<b>$</b>", "'; DROP TABLE"]) {
			expect(resolveCurrencyAlias(text)).toBe(oldResolveCurrencyAlias(text));
		}
		expect(resolveCurrencyAlias("＄")).toBeUndefined();
	});

	test("a very long word is refused as quickly as a short one", () => {
		const long = "dollar".repeat(50_000);
		const start = Date.now();
		expect(resolveCurrencyAlias(long)).toBeUndefined();
		expect(Date.now() - start).toBeLessThan(1000);
	});

	test("the rate targets it serves answer as before", () => {
		// Each taken from a run of the engine before this change.
		expect(doc("120 km/h to m/s")).toEqual(["= 33.33 m/s"]);
		expect(doc("$20/hour in $/day")).toEqual(["= $480.00/day"]);
		expect(doc("100 km/h in miles per hour")).toEqual(["= 62.14 miles/hour"]);
	});

	test("rateTargetNumerator over it: a unit as written, a currency word or symbol as its code", () => {
		const tok = (type: string, value: string): Token => ({ type, typeId: tokenTypeId(type), value, text: value, offset: 0 }) as Token;
		expect(rateTargetNumerator(tok("UNIT", "miles"))).toBe("miles");
		expect(rateTargetNumerator(tok("UNIT", "dollars"))).toBe("USD");
		expect(rateTargetNumerator(tok("DOLLAR", "$"))).toBe("USD");
		expect(rateTargetNumerator(tok("UNIT", "constructor"))).toBe("constructor");
		expect(rateTargetNumerator(tok("DOLLAR", "constructor"))).toBeUndefined();
		expect(rateTargetNumerator(tok("UNIT", ""))).toBeUndefined();
		expect(rateTargetNumerator(undefined)).toBeUndefined();
	});
});

// ── The IPv6 rule ────────────────────────────────────────────────────────────

const OLD_RUN_TEXT = /^[0-9A-Za-z.:%/]+$/;
const OLD_START_TYPES = ["IDENT", "NUMBER", "COLON", "E", "UNIT", "PLUS", "CONVERTER_NAME", "FUNC"];

/** The rule's match as it was, up to the fused token, returned as what it read. */
function oldIpv6Read(tokens: Token[], pos: number): { consumed: number; text: string; payload: string; runEnd: number } | null {
	const sourceText = (token: Token): string | undefined => {
		const text = token.text;
		return text !== undefined && text.length > 0 && OLD_RUN_TEXT.test(text) ? text : undefined;
	};
	const colonSoonAfter = (): boolean => {
		let end = tokens[pos].offset + (tokens[pos].text?.length ?? 0);
		for (let i = pos + 1; i < tokens.length && i <= pos + 4; i++) {
			const next = tokens[i];
			if (next.offset !== end) return false;
			if (next.type === "COLON") return true;
			end = next.offset + (next.text?.length ?? 0);
		}
		return false;
	};
	const first = tokens[pos];
	if (first === undefined || first.sourceEnd !== undefined) return null;
	if (!OLD_START_TYPES.includes(first.type)) return null;
	if (first.type !== "COLON" && !colonSoonAfter()) return null;
	const firstText = sourceText(first);
	if (firstText === undefined) return null;
	const before = pos > 0 ? tokens[pos - 1] : undefined;
	if (before !== undefined && before.sourceEnd === undefined && sourceText(before) !== undefined
		&& before.offset + (before.text?.length ?? 0) === first.offset) {
		return null;
	}
	let text = firstText;
	let runEnd = first.offset + firstText.length;
	let consumed = 1;
	let colons = firstText.split(":").length - 1;
	for (let i = pos + 1; i < tokens.length; i++) {
		const next = tokens[i];
		if (next.sourceEnd !== undefined || next.offset !== runEnd) break;
		const nextText = sourceText(next);
		if (nextText === undefined) break;
		text += nextText;
		if (text.length > MAX_IPV6_TEXT) return null;
		runEnd = next.offset + nextText.length;
		colons += nextText.split(":").length - 1;
		consumed++;
	}
	if (colons < 2) return null;
	const read = readAddress(text);
	if (read === null) return null;
	return { consumed, text, payload: `${read.addr.toString(16)}|${read.prefix}|${read.zone ?? ""}`, runEnd };
}

/** The new rule's match, reduced to the same fields. */
function newIpv6Read(tokens: Token[], pos: number): { consumed: number; text: string; payload: string; runEnd: number } | null {
	const match = ipv6NormalizerRule().match(tokens, pos);
	if (match === null) return null;
	const fused = match.replacement[0];
	return { consumed: match.consumed, text: fused.text, payload: fused.value, runEnd: fused.sourceEnd as number };
}

/** Lines that reach the rule's every branch: addresses, labels, clock times, colons in prose. */
const IPV6_CORPUS: readonly string[] = [
	"fe80::1", "fe80::1 + 2", "2001:db8::/32", "2001:db8::/129", "::ffff:192.168.1.1", "::1", "::", "e::1", "add::5",
	"fe80::1%eth0", "2001:0db8:85a3:0000:0000:8a2e:0370:7334", "85a3::1", "note::5", "a:b", "a:b:c", "1:2:3",
	"12:30", "12:30:45", ":v42 = 43", ":v1 + 11", "x: 5", "Label: 3 + 4", "fe80::1 in 2001:db8::/32", "hosts in 2001:db8::/120",
	"1::2::3", "gggg::1", "fe80::1-2", "10:20 - 5", "::ffff:1.2.3.4/96", "fe80 :: 1", "(fe80::1)", "3pm London in Tokyo",
	`${"1:".repeat(80)}1`, `${":".repeat(200)}`, `${"ab".repeat(70)}::1`, "",
];

describe("isRunText and colonsIn", () => {
	test("isRunText accepts exactly the characters the old pattern did, one code unit at a time", () => {
		for (let c = 0; c <= 0xffff; c++) {
			const ch = String.fromCharCode(c);
			if (isRunText(ch) !== OLD_RUN_TEXT.test(ch)) throw new Error(`differs at U+${c.toString(16)}`);
		}
	});

	test("isRunText on whole runs, the boundaries of each range included", () => {
		for (const text of ["fe80", "2001:db8::1", "::ffff:1.2.3.4", "fe80::1%eth0", "/64", "/", "0", "9", ":", "A", "Z", "a", "z", "."]) {
			expect([text, isRunText(text)]).toEqual([text, true]);
		}
		for (const text of ["", ";", "@", "[", "`", "{", "-", " ", "\n", "fe80-1", "fe 80", "a​", "１", "١", "ÿ", "$", "fe80::1\n"]) {
			expect([text, isRunText(text)]).toEqual([text, OLD_RUN_TEXT.test(text)]);
			expect(isRunText(text)).toBe(false);
		}
	});

	test("isRunText over the shared text corpus reads what the old pattern read", () => {
		for (const text of [...TEXT_EDGES, ...NUMERIC_EDGES, ...PROTOTYPE_WORDS]) {
			expect([text, isRunText(text)]).toEqual([text, OLD_RUN_TEXT.test(text)]);
		}
	});

	test("colonsIn counts what splitting counted", () => {
		for (const text of ["", ":", "::", "a:b:c", "fe80::1", "no colons", "：", ":".repeat(10_000), ...TEXT_EDGES]) {
			expect([text.slice(0, 20), colonsIn(text)]).toEqual([text.slice(0, 20), text.split(":").length - 1]);
		}
	});

	test("the hot helpers read no global", () => {
		for (const name of ["isRunText", "colonsIn", "secondCharacterIsColon"]) {
			const body = bodyOf("packages/ip/normalizer/Ipv6NormalizerRule.ts", new RegExp(`export function ${name}\\(`));
			expect(body).not.toMatch(/\bMath\.|\bObject\.|\bRegExp\b|\.test\(|\.split\(/);
		}
	});
});

describe("the IPv6 rule reads what it read before", () => {
	test("at every position of every corpus line", () => {
		let fused = 0;
		for (const line of IPV6_CORPUS) {
			const tokens = lex(line);
			for (let pos = 0; pos <= tokens.length; pos++) {
				const before = oldIpv6Read(tokens, pos);
				expect([line, pos, newIpv6Read(tokens, pos)]).toEqual([line, pos, before]);
				if (before !== null) fused++;
			}
		}
		// The corpus reaches the fusing branch, not only the rejects.
		expect(fused).toBeGreaterThan(8);
	});

	test("over hand-built tokens a lexer would not produce: no text, fused tokens, gaps", () => {
		const tok = (type: string, text: string | undefined, offset: number, sourceEnd?: number): Token =>
			({ type, typeId: tokenTypeId(type), value: text ?? "", text, offset, ...(sourceEnd !== undefined ? { sourceEnd } : {}) }) as unknown as Token;
		const streams: Token[][] = [
			[tok("IDENT", "fe80", 0), tok("COLON", ":", 4), tok("COLON", ":", 5), tok("NUMBER", "1", 6)],
			[tok("IDENT", "fe80", 0), tok("COLON", ":", 4), tok("COLON", undefined, 5), tok("NUMBER", "1", 6)],
			[tok("IDENT", "fe80", 0, 4), tok("COLON", ":", 4), tok("COLON", ":", 5), tok("NUMBER", "1", 6)],
			[tok("COLON", ":", 0), tok("COLON", ":", 1), tok("NUMBER", "1", 3)],
			[tok("COLON", "", 0), tok("COLON", ":", 0), tok("NUMBER", "1", 1)],
			[tok("COLON", "::", 0), tok("NUMBER", "1", 2)],
			[tok("COLON", "::", 0), tok("IDENT", "ffff", 2), tok("COLON", ":", 6), tok("NUMBER", "1", 7)],
			[tok("COLON", ":", 0), tok("COLON", ":", 2), tok("NUMBER", "1", 3)],
			[tok("COLON", ":", 0), tok("COLON", ":", 1, 2), tok("NUMBER", "1", 2)],
			[tok("COLON", ":", 0), tok("IDENT", ":ffff", 1), tok("COLON", ":", 6), tok("NUMBER", "1", 7)],
			[tok("COLON", ":", 0), tok("IDENT", "a", 1), tok("COLON", ":", 2), tok("COLON", ":", 3), tok("NUMBER", "1", 4)],
			[tok("IDENT", "constructor", 0), tok("COLON", ":", 11), tok("COLON", ":", 12), tok("IDENT", "__proto__", 13)],
		];
		for (const stream of streams) {
			for (let pos = 0; pos <= stream.length; pos++) {
				expect(newIpv6Read(stream, pos)).toEqual(oldIpv6Read(stream, pos));
			}
		}
	});

	test("the lines a reader writes answer as before", () => {
		// Each taken from a run of the engine before this change.
		expect(doc("fe80::1")).toEqual(["= fe80::1"]);
		expect(doc("::1")).toEqual(["= ::1"]);
		expect(doc("::ffff:192.168.1.1")).toEqual(["= ::ffff:192.168.1.1"]);
		expect(doc("2001:db8::/32")).toEqual(["= 2001:db8::/32"]);
		expect(doc(":v42 = 43\nv42 + 1")).toEqual(["= 43", "= 44"]);
		expect(doc("Label: 3 + 4")).toEqual(["= 7"]);
	});

	test("a long colon run, a long address-shaped line and a long sum of labels are handled within budget", () => {
		const start = Date.now();
		expectHonestDocument(`${"1:".repeat(2000)}1\n${":".repeat(5000)}\n${RESOURCE_PROBES.longSum(2000).replace(/(\d+)/g, ":v$1")}`);
		expect(Date.now() - start).toBeLessThan(20_000);
	});
});

describe("secondCharacterIsColon", () => {
	const tok = (type: string, text: string | undefined, offset: number, sourceEnd?: number): Token =>
		({ type, typeId: tokenTypeId(type), value: text ?? "", text, offset, ...(sourceEnd !== undefined ? { sourceEnd } : {}) }) as unknown as Token;

	test("in the first token's own text", () => {
		expect(secondCharacterIsColon([tok("COLON", "::", 0)], 0, "::")).toBe(true);
		expect(secondCharacterIsColon([tok("IDENT", ":a", 0)], 0, ":a")).toBe(false);
	});

	test("as the first character of the token joined after it", () => {
		expect(secondCharacterIsColon([tok("COLON", ":", 0), tok("COLON", ":", 1)], 0, ":")).toBe(true);
		expect(secondCharacterIsColon([tok("COLON", ":", 0), tok("IDENT", "v42", 1)], 0, ":")).toBe(false);
	});

	test("never across a gap, past the end, from a fused token or from a token with no text", () => {
		expect(secondCharacterIsColon([tok("COLON", ":", 0), tok("COLON", ":", 2)], 0, ":")).toBe(false);
		expect(secondCharacterIsColon([tok("COLON", ":", 0)], 0, ":")).toBe(false);
		expect(secondCharacterIsColon([tok("COLON", ":", 0), tok("COLON", ":", 1, 2)], 0, ":")).toBe(false);
		expect(secondCharacterIsColon([tok("COLON", ":", 0), tok("COLON", undefined, 1)], 0, ":")).toBe(false);
		expect(secondCharacterIsColon([tok("COLON", ":", 0), tok("IDENT", "", 1)], 0, ":")).toBe(false);
	});

	test("a colon look-alike is not a colon", () => {
		for (const lookAlike of ["：", "∶", "꞉", "׃"]) {
			expect(secondCharacterIsColon([tok("COLON", ":", 0), tok("IDENT", lookAlike, 1)], 0, ":")).toBe(false);
		}
	});

	test("every text that opens with one colon and not two is refused by the address reader", () => {
		for (const text of [":1", ":a::1", ":ffff::1", ":/0", ":%eth0", ":1:2:3:4:5:6:7", ":v42"]) {
			expect([text, readAddress(text)]).toEqual([text, null]);
		}
		expect(readAddress("::1")).not.toBeNull();
	});
});

// ── The zone-after-name rule ─────────────────────────────────────────────────

/** The shape test as it was ordered: the `in` last. */
function oldZoneAfterNameAt(tokens: readonly Token[], pos: number): boolean {
	return endsNamedTime(tokens, pos) && namesListedZone(tokens[pos + 1]) && tokens[pos + 2]?.type === "IN"
		&& startsZoneReference(tokens[pos + 3]);
}

describe("zoneAfterNameAt", () => {
	test("checks the `in` before the table lookup", () => {
		const body = bodyOf("packages/time/normalizer/ZoneAfterNameNormalizerRule.ts", /export function zoneAfterNameAt\(/);
		expect(body.indexOf('?.type === "IN"')).toBeGreaterThan(-1);
		expect(body.indexOf('?.type === "IN"')).toBeLessThan(body.indexOf("namesListedZone("));
	});

	test("answers as before at every position of every line", () => {
		const lines = [
			"t London in Tokyo", "(t + 1 hour) London in Tokyo", "m London in rio de janeiro", "x cat in kg", "t London",
			"The quarterly report covers revenue and cost", "3pm London in Tokyo", "t constructor in Tokyo", "t London in __proto__",
			"t toString in valueOf", "5 m London in Tokyo", "", "in in in in", "t london IN tokyo",
		];
		let shapes = 0;
		for (const line of lines) {
			const tokens = lex(line);
			for (let pos = 0; pos <= tokens.length + 1; pos++) {
				const before = oldZoneAfterNameAt(tokens, pos);
				expect([line, pos, zoneAfterNameAt(tokens, pos)]).toEqual([line, pos, before]);
				if (before) shapes++;
			}
		}
		expect(shapes).toBeGreaterThanOrEqual(3);
	});

	test("the rule still retypes the zone, and prose passes through", () => {
		const rule = zoneAfterNameNormalizerRule();
		const tokens = lex("t London in Tokyo");
		// `t` lexes as the teaspoon, and the rule keeps it as it was.
		expect(rule.match(tokens, 0)?.replacement.map((t) => t.type)).toEqual(["UNIT", "ZONE_SOURCE"]);
		const prose = lex("The quarterly report covers revenue and cost");
		for (let pos = 0; pos < prose.length; pos++) expect(rule.match(prose, pos)).toBeNull();
		expect(doc("t = 3pm\nt London in Tokyo")[1]).toBe(doc("3pm London in Tokyo")[0]);
	});

	test("prototype words in each slot are never a zone shape", () => expectPrototypeUntouched(() => {
		for (const word of PROTOTYPE_WORDS) {
			for (const line of [`t ${word} in Tokyo`, `t London in ${word}`, `${word} London in Tokyo`]) {
				const tokens = lex(line);
				for (let pos = 0; pos < tokens.length; pos++) {
					if (line.startsWith(word) && pos === 0) continue;
					expect([line, pos, zoneAfterNameAt(tokens, pos)]).toEqual([line, pos, false]);
				}
			}
		}
	}));
});

// ── The salary flourish ──────────────────────────────────────────────────────

/** The test as it was ordered: the word before the take-home form. */
function oldSalaryFlourishAt(tokens: readonly Token[], pos: number): "star" | "after" | null {
	const here = tokens[pos];
	const isSalary = (t: Token | undefined): boolean => t !== undefined && (t.type === "IDENT" || t.type === "UNIT") && (t.text ?? t.value ?? "").toLowerCase() === "salary";
	if (here === undefined || !isSalary(tokens[pos + 1]) || !["AFTER_TAX", "AFTER_TAX_MONTHLY"].includes(tokens[pos + 2]?.type ?? "")) return null;
	if (here.type === "STAR" && tokens[pos + 1] !== undefined && here.offset === tokens[pos + 1].offset) return pos > 0 ? "star" : null;
	return ["NUMBER", "RPAREN", "RBRACKET", "PERCENT", "IDENT", "UNIT"].includes(here.type) ? "after" : null;
}

describe("salaryFlourishAt", () => {
	test("checks the take-home form before the word", () => {
		const body = bodyOf("packages/payroll/normalizer/SalaryWordNormalizerRule.ts", /export function salaryFlourishAt\(/);
		expect(body.indexOf("TAKE_HOME_FORMS.has(")).toBeLessThan(body.indexOf("isSalaryWord("));
	});

	test("answers as before at every position, over the normalised stream the rule sees", () => {
		const engine = newTrackedEngine();
		const lines = [
			"£50,000 salary after tax", "salary after tax", "2 * salary after tax", "50000 SALARY per month after tax", "(5) salary after tax",
			"salary = £50,000", "The quarterly report covers revenue and cost", "", "salary", "constructor salary after tax", "5 __proto__ after tax",
		];
		let hits = 0;
		for (const line of lines) {
			const tokens = engine.getNormalizer().normalize(lex(line));
			for (let pos = 0; pos <= tokens.length + 1; pos++) {
				const before = oldSalaryFlourishAt(tokens, pos);
				expect([line, pos, salaryFlourishAt(tokens, pos)]).toEqual([line, pos, before]);
				if (before !== null) hits++;
			}
		}
		// The flourish is dropped during normalising, so the finished stream holds none of it.
		expect(hits).toBe(0);
	});

	test("over hand-built streams that reach each branch", () => {
		const tok = (type: string, text: string, offset: number): Token => ({ type, typeId: tokenTypeId(type), value: text, text, offset }) as Token;
		const streams: Token[][] = [
			[tok("NUMBER", "5", 0), tok("IDENT", "salary", 2), tok("AFTER_TAX", "after tax", 9)],
			[tok("NUMBER", "5", 0), tok("STAR", "*", 2), tok("IDENT", "Salary", 2), tok("AFTER_TAX_MONTHLY", "per month after tax", 9)],
			[tok("STAR", "*", 0), tok("IDENT", "salary", 0), tok("AFTER_TAX", "after tax", 7)],
			[tok("EQUALS", "=", 0), tok("UNIT", "salary", 2), tok("AFTER_TAX", "after tax", 9)],
			[tok("NUMBER", "5", 0), tok("IDENT", "wage", 2), tok("AFTER_TAX", "after tax", 7)],
			[tok("NUMBER", "5", 0), tok("IDENT", "salary", 2), tok("IDENT", "after", 9)],
			[tok("NUMBER", "5", 0), tok("IDENT", "constructor", 2), tok("AFTER_TAX", "after tax", 14)],
		];
		const seen = new Set<string | null>();
		for (const stream of streams) {
			for (let pos = 0; pos <= stream.length; pos++) {
				const before = oldSalaryFlourishAt(stream, pos);
				expect(salaryFlourishAt(stream, pos)).toBe(before);
				seen.add(before);
			}
		}
		expect([...seen].sort()).toEqual(["after", "star", null].sort());
	});

	test("the take-home lines answer as before", () => {
		// Each taken from a run of the engine before this change.
		expect(doc("£50,000 salary after tax")).toEqual(["= £39,519.60"]);
		expect(doc("salary = £50,000\nsalary after tax")).toEqual(["= £50,000.00", "= £39,519.60"]);
	});
});

// ── The calendar's year window ───────────────────────────────────────────────

/** `localDate` as it was: the integer part read first, for every year. */
function oldLocalDate(year: number, month0: number, day: number): Date {
	const whole = Math.trunc(year);
	if (!(whole >= 0 && whole <= 99)) return new Date(year, month0, day);
	const date = new Date(whole + 400, month0, day);
	date.setFullYear(date.getFullYear() - 400);
	return date;
}

/** `utcMs` as it was. */
function oldUtcMs(year: number, month0: number, day: number, hour = 0, minute = 0, second = 0): number {
	const whole = Math.trunc(year);
	if (whole >= 0 && whole <= 99) return Date.UTC(whole + 400, month0, day, hour, minute, second) - 146_097 * 86_400_000;
	return Date.UTC(year, month0, day, hour, minute, second);
}

/** Years at and around every edge of the window, and the values with no integer part. */
const YEARS: readonly number[] = [
	2026, 1970, 1000, 100, 100.5, 99.999, 99.5, 99, 50, 26, 1, 0.5, 0, -0, -0.5, -0.999, -1, -1.5, -100, -271821, 275760,
	2 ** 53, -(2 ** 53), Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, Infinity, -Infinity, NaN,
];

describe("localDate and utcMs", () => {
	test("localDate answers the old instant for every edge year, month and day", () => {
		for (const year of YEARS) {
			for (const [month0, day] of [[0, 1], [1, 29], [11, 31], [12, 1], [-1, 0], [1, 30]]) {
				const now = localDate(year, month0, day).getTime();
				const was = oldLocalDate(year, month0, day).getTime();
				expect([year, month0, day, Object.is(now, was) || now === was]).toEqual([year, month0, day, true]);
			}
		}
	});

	test("utcMs answers the old instant for every edge year, and the helpers over it agree", () => {
		for (const year of YEARS) {
			for (const [month0, day, hour] of [[0, 1, 0], [1, 29, 12], [11, 31, 23], [12, 1, 25]]) {
				const now = utcMs(year, month0, day, hour);
				const was = oldUtcMs(year, month0, day, hour);
				expect([year, month0, day, Object.is(now, was) || now === was]).toEqual([year, month0, day, true]);
			}
		}
		expect(daysInMonth(2024, 1)).toBe(29);
		expect(daysInMonth(0, 1)).toBe(29);
		expect(daysInMonth(100, 1)).toBe(28);
		expect(daysInMonth(99, 1)).toBe(28);
		expect(dayNumber(1970, 0, 1)).toBe(0);
		expect(dayNumber(1, 0, 1)).toBe(Math.floor(oldUtcMs(1, 0, 1) / 86_400_000));
	});

	test("the common year reads no Math", () => {
		const local = bodyOf("calendar/DateCalendar.ts", /export function localDate\(/);
		const firstMath = local.indexOf("Math.");
		expect(local.indexOf("return new Date(year, month0, day)")).toBeLessThan(firstMath);
		const utc = bodyOf("calendar/Gregorian.ts", /function literalUtc\(/);
		expect(utc).toMatch(/if \(year > -1 && year < 100\) return Date\.UTC\(Math\.trunc\(year\)/);
	});

	test("date lines a reader writes answer as before", () => {
		// Each taken from a run of the engine before this change.
		expect(doc("25 Dec 2026")).toEqual(["= Friday, December 25, 2026"]);
		expect(doc("1 Jan 0001")).toEqual(["= Monday, January 1, 1"]);
		expect(doc("1 Jan 0099")).toEqual(["= Thursday, January 1, 99"]);
		expect(doc("1 Jan 0100")).toEqual(["= Friday, January 1, 100"]);
		expect(doc("30 Feb 0001")).toEqual(['ERROR "30 Feb 0001" is not a real date: February 0001 has 28 days.']);
	});
});
