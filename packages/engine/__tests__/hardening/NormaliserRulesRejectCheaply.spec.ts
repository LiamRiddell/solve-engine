/**
 * The normaliser's rules turn a position away with a cheap test before an
 * expensive one.
 *
 * The benchmark gate measured the normaliser suite at 1.23 times its merge
 * base, every case slower, the lines where no rule fires included. Bisected
 * against the merge base, the commit after the earlier hot-path fix and the
 * batch merges since, the step was the ISO duration rule (#760): the 97th
 * rule, which took every rule mask from three words to four. Nothing in the
 * rule was slow; the cost was spread across the index and across the rules
 * every word and number of a line is offered to, each of which paid something
 * before its first cheap reject:
 *
 * - a word lower-cased (an allocation) only to be compared with `how`, `up`,
 *   `sum`, `of` or a month name and fail (weekday count, between unit, up and
 *   down, tag and section aggregates, month name date, bare rate, call fusion);
 * - a pattern run before the token type that settles it (line reference,
 *   address, large number suffix, mixed number, date literal, month name date);
 * - a closure built on every call (mixed number), the engine's calendar read
 *   before it was needed (month name date, date literal), `parseInt` and
 *   `isNaN`, two globals, read before the shape (clock time), and a unit's
 *   measure looked up before the connector after it (date offset).
 *
 * Each now asks the cheap question first. The answers are the ones the rules
 * gave before, and this spec proves that two ways:
 *
 * - each helper that changed is compared with the form it replaced, kept below
 *   as an oracle, over every UTF-16 code unit where it reads one character and
 *   over the shared corpora;
 * - each rule that changed is run at every position of 1,429 token
 *   streams, hostile ones included, and compared with what the rule answered
 *   before the change. Those answers are recorded in
 *   `fixtures/NormaliserRulesRejectCheaply.oracle.json`, made by running this
 *   spec's recorder against 277b709 (the commit before the change), streams
 *   and all, so the comparison does not move when the lexer or another rule
 *   does.
 *
 * Three answers differ, on purpose. The weekday count, section aggregate and
 * date offset tables were plain objects, so a word naming an inherited
 * property found `Object` itself: `constructor until friday` printed the
 * source of `Object` in its error, and `constructor of section "x"` and
 * `5 days constructor 3` made a token whose type was a function, which the
 * next pass failed on with a raw `TypeError`. The tables are `Map`s now, and
 * those words are no trigger.
 */

import { beforeAll, describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { NORMALIZER_CORPUS } from "@tools/normalizerCorpus";
import { formatValue } from "@solve-js/format/FormatEngine";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import type { NormalizerMatch, NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import { lowerCased, lowersTo, valueLowersTo } from "@solve-js/normalizer/RuleIndex";
import { weekdayIndexOf } from "@solve-js/packages/datetime/normalizer/WeekdayCountNormalizerRule";
import { monthOf } from "@solve-js/packages/datetime/normalizer/MonthNameDateNormalizerRule";
import { offsetConnectorOf } from "@solve-js/packages/datetime/normalizer/DateOffsetNormalizerRule";
import { mayContinueDate } from "@solve-js/packages/datetime/normalizer/DateLiteralNormalizerRule";
import { opensLine } from "@solve-js/packages/lines/normalizer/LineRefNormalizerRule";
import { sectionTriggerOf } from "@solve-js/packages/lines/normalizer/SectionAggregateNormalizerRule";
import { stepTokenAt } from "@solve-js/packages/percentage/normalizer/PercentUpDownNormalizerRule";
import { opensDottedQuad } from "@solve-js/packages/ip/normalizer/IpCidrNormalizerRule";
import { MAX_NAME_WORDS, definedNameWords, nameWordRun } from "@solve-js/packages/variables/MultiWordNames";

const SRC = path.resolve(__dirname, "../../src");
const ORACLE = path.join(__dirname, "fixtures", "NormaliserRulesRejectCheaply.oracle.json");

/**
 * Answers a later fix changed on purpose since the oracle was recorded, each
 * as `<line> @<position>` under its rule. A list in square brackets is no
 * range context, so its items are values and a colon pair there is a clock
 * time (FoundBug_clockTimesInAMapReduceCall.spec.ts): `[1:3]` holds 1:03.
 */
const CHANGED_SINCE: Readonly<Record<string, readonly string[]>> = {
	"time:clock-time": ["[1:3] @1"],
};

/** The rules this change altered, by name. */
const CHANGED_RULES: readonly string[] = [
	"datetime:weekday-count",
	"datetime:between-unit",
	"lines:line-ref",
	"lines:section-aggregate",
	"percentage:up-down",
	"tags:aggregate",
	"arithmetic:mixed-number",
	"datetime:month-name-date",
	"uom:bare-rate-denominator",
	"datetime:date-offset",
	"time:clock-time",
	"arithmetic:large-number-suffix",
	"variables:multi-word-definition",
	"datetime:date-literal",
	"ip:ip-cidr-literal",
	"engine:call-fusion",
];

/** The clock the oracle was recorded on, so a date with no year reads the same year. */
const NOW = Date.UTC(2026, 2, 11, 12, 0, 0);

/** An engine on that stopped clock, in UTC. */
function engineAtNow(): ExpressionEngine {
	return newTrackedEngine({ calendar: dateCalendarInZone("UTC", { now: () => NOW }) });
}

/** The body of the function whose signature matches, up to its closing brace at the margin. */
function bodyOf(file: string, signature: RegExp, end = "\n}"): string {
	const source = fs.readFileSync(path.join(SRC, file), "utf8");
	const start = source.search(signature);
	expect(start).toBeGreaterThanOrEqual(0);
	return source.slice(start, source.indexOf(end, start));
}

/** A token of the given type and text, for the hand-built cases. */
function tok(type: string, text: string, offset = 0): Token {
	return new LexerToken(type, tokenTypeId(type), text, text, offset, 0, 1, offset + 1);
}

/** Every UTF-16 code unit, as a one-character string. */
const CODE_UNITS: readonly string[] = Array.from({ length: 0x10000 }, (_, c) => String.fromCharCode(c));

/** Words a reader might type that look like a trigger and are not, beside the prototype words. */
const LOOK_ALIKES: readonly string[] = [
	"Ｆridays", "fridays​", "Kays", "İ", "ſum", "SUM", "Sum", "sUm", "how​", "Up", "UP", "dOwn", "Line", "LINE", "lіne",
	"<b>sum</b>", "${sum}", "",
];

// ── The corpus the rule oracle was recorded over ────────────────────────────

/** Lines that reach each changed rule's matching forms, its near misses and its edges. */
const TARGETED: readonly string[] = [
	"how many fridays until 31/12/2026", "fridays between 01/06/2026 and 31/08/2026", "Fridays since 1/1/2026",
	"HOW MANY Sundays until 1/1/2027", "how many mondays between 1/1/2026 and 1/2/2026", "friday until 1/1/2027", "fridays until",
	"days between 1/1/2026 and 1/2/2026", "how many days until 25/12/2026", "How Many weeks since 1/1/2020", "how many days", "many days between 1 and 2",
	"line1 + line 2", "LINE3", "Line 4 * 2", "line deleted", "line1 : line4", "sum(line1:line3)", "lines 2", "liner 3", ":line 2", "line", "line 2.5",
	'total of section "Travel"', 'sum of section "Travel"', 'SUM OF SECTION "x"', 'count of section "a"', 'average of section "b"', "sum of section", 'total section "x"',
	"120 up 10% then down 10%", "50 UP 20%", "80 Down 15%", "prices are up", "up 10%", "down", "up 10", "(5) up 10%",
	"sum of #food", "SUM of #food", "Sum Of #x", "total of #food", "count of #food", "average of #x", "sum of 1, 2", "sum #food",
	"1 1/2 cups", "2 ½", "½", "3 and 1/2 km", "1 + 1/2", "2 3/2", "2 0/2", "1.5 1/2", "2 and 1/2", "4 ¾ in", "07 1/3",
	"9 March", "9 March 2024", "March 9, 2024", "MARCH 9 2024", "February 2020", "march 9", "31 Feb 2026", "0 March", "32 March", "9 mar",
	"9 March 24", "Mar 9 2024", "may 5", "9 in march", "March", "9 march in days", "5 m to march",
	"30 bottles / week", "30 bottles per week", "$20 per hour", "5 / day", "m / s", "10 km a day", "3 Each week", "30 x / week",
	"30 bottles PER week", "100 / t", "/ 3 days", "a day + 2", "30 per / week",
	"5 days from today", "3 weeks after 1/1/2026", "2 days before Friday", "2 days BEFORE today", "line 2 for d from 1 to 3 step 1",
	"5 days from", "5 km from today", "2 weeks Before 1/1/2026",
	"9:00am + 30 minutes", "4pm", "16:00", "25:00", "9 am", "[1:3]", "12:30pm", "0:00", "-1:00", "23:59", "24:00", "9:60",
	"5k", "2.5M", "3B", "10 bn", "1.5mn", "5 k", "5kg", "5K", "1e3k", "0x10k",
	"hourly rate = $50", "monthly take home pay = 4000", "a b c d e = 3", "a b c d = 3", "hourly_rate = 5", "x y z", "Alice's food = 3",
	"25/12/2026", "2026-03-11", "25.12.2026", "2019-04-01T15:30:00Z", "2019-04-01T15:30:00.123+11:00", "12-25-2026", "2024 - 5 - 3",
	"1000/10/5", "25 .12 .2026", "3.4.2026", "31/02/2026 + 1 day", "2026-13-01", "1/1", "2026", "2026-",
	"192.168.1.0/24", "10.0.0.1", "1234.5", "1.5", "999.1.1.1", "1.2.3", "10.0.0.1/33", ".5",
	'sha256("hi")', 'SHA256("x")', 'Base64("y")', ":sha256(1)", "sha256 (1)", "length(\"abc\")",
];

/** Templates the look-alikes and prototype words are written into, one for each rule's trigger word. */
const TEMPLATES: readonly string[] = [
	"how many X until friday", "X until friday", "X between friday and monday", "how many X between 1 and 2",
	"line X", "X 3", 'X of section "x"', "sum of X", "X of #tag", "5 X 10%", "X 10%", "2 X", "X ½", "5 X / week", "X / week",
	"5 days X 3", "X 9", "9 X 2024", "5X", "X = 3", "hourly X = 3", "X(1)", "1 X", "X",
];

/** The lines the oracle was recorded over: the shared corpus, the targeted lines, the filled templates and the edges. */
function oracleLines(): string[] {
	const words = [...PROTOTYPE_WORDS, ...LOOK_ALIKES];
	const lines = [
		...NORMALIZER_CORPUS,
		...TARGETED,
		...TEMPLATES.flatMap((t) => fill(t, words)),
		...TEXT_EDGES,
		...NUMERIC_EDGES,
		...fill("5 X", NUMERIC_EDGES),
		...fill("X up 10%", NUMERIC_EDGES),
	];
	return [...new Set(lines)];
}

// ── Streams on the wire ─────────────────────────────────────────────────────

/**
 * A token as the oracle stores it: type, value, offset, then text (null when it
 * is the value), source end, fault code and may-name-variable, with the trailing
 * ones left off while they are null.
 */
type WireToken = [string, string, number, ...(string | number | boolean | null)[]];

/** A rule's answer at one position as the oracle stores it. */
type WireMatch = { consumed: number; ruleName: string | null; replacement: WireToken[] } | { throws: string };

/** The recorded oracle. */
interface Oracle {
	recordedFrom: string;
	streams: { line: string; kind: "lexed" | "normalised"; tokens: WireToken[] }[];
	/** Rule name to `stream:position` to the answer. A position with no entry answered null. */
	results: Record<string, Record<string, WireMatch>>;
}

/** The type of a token as text, naming what it is when it is not a string. */
function typeText(type: unknown): string {
	return typeof type === "string" ? type : `<${typeof type}>`;
}

function toWire(t: Token): WireToken {
	const rest = [
		t.text === t.value ? null : String(t.text),
		t.sourceEnd ?? null,
		t.fault?.code ?? null,
		t.mayNameVariable ?? null,
	];
	while (rest.length > 0 && rest[rest.length - 1] === null) rest.pop();
	return [typeText(t.type), String(t.value), t.offset, ...rest];
}

function fromWire([type, value, offset, text = null, sourceEnd = null, fault = null, mayNameVariable = null]: WireToken): Token {
	const t = new LexerToken(type, tokenTypeId(type), value, (text as string | null) ?? value, offset, 0, 1, offset + 1);
	if (sourceEnd !== null) t.sourceEnd = sourceEnd as number;
	if (fault !== null) t.fault = { code: fault as string, message: "" };
	if (mayNameVariable !== null) t.mayNameVariable = mayNameVariable as boolean;
	return t;
}

/** A rule's answer in the stored shape, or null. A raw error is kept as its message, so it is compared too. */
function answerOf(rule: NormalizerRule, tokens: Token[], pos: number, env: unknown): WireMatch | null {
	let m: NormalizerMatch | null;
	try {
		m = rule.match(tokens, pos, env as never);
	} catch (error) {
		return { throws: String(error) };
	}
	if (m === null) return null;
	return { consumed: m.consumed, ruleName: m.ruleName ?? null, replacement: m.replacement.map(toWire) };
}

/** The engine's registered rules by name. */
function rulesOf(engine: ExpressionEngine): Map<string, NormalizerRule> {
	const rules = (engine.getNormalizer() as unknown as { rules: NormalizerRule[] }).rules;
	return new Map(rules.map((r) => [r.name, r]));
}

/** The lexer's tokens for a line, as the normaliser receives them. */
function lexed(engine: ExpressionEngine, text: string): Token[] {
	const lexer = engine.getLexer();
	lexer.resetExpression(text);
	const out: Token[] = [];
	for (const t of lexer) if (t.type !== "COMMENT") out.push(t);
	return out;
}

/** Whether a recorded answer is one of the inherited-property readings this change ends. */
function readsInheritedProperty(answer: WireMatch): boolean {
	return "replacement" in answer && answer.replacement.some(([type, value]) => type.startsWith("<") || value.startsWith("function ") || value === "[object Object]");
}

// ── The recorder ────────────────────────────────────────────────────────────

const RECORD = process.env.RECORD_NORMALISER_ORACLE;

(RECORD === undefined ? describe.skip : describe)("records the oracle (run against the commit before a change)", () => {
	test("writes every changed rule's answer at every position", () => {
		const engine = engineAtNow();
		const rules = rulesOf(engine);
		const env = engine.getNormalizer().environment;
		const oracle: Oracle = { recordedFrom: process.env.RECORD_NORMALISER_ORACLE_FROM ?? "unknown", streams: [], results: {} };
		for (const line of oracleLines()) {
			const raw = lexed(engine, line);
			oracle.streams.push({ line, kind: "lexed", tokens: raw.map(toWire) });
			let normalised: Token[] | null = null;
			try { normalised = engine.getNormalizer().normalize(raw); } catch { normalised = null; }
			if (normalised !== null && JSON.stringify(normalised.map(toWire)) !== JSON.stringify(raw.map(toWire))) {
				oracle.streams.push({ line, kind: "normalised", tokens: normalised.map(toWire) });
			}
		}
		oracle.streams.forEach((stream, s) => {
			const tokens = stream.tokens.map(fromWire);
			for (const name of CHANGED_RULES) {
				const rule = rules.get(name);
				expect(rule).toBeDefined();
				for (let pos = 0; pos < tokens.length; pos++) {
					const answer = answerOf(rule!, tokens, pos, env);
					if (answer !== null) (oracle.results[name] ??= {})[`${s}:${pos}`] = answer;
				}
			}
		});
		fs.mkdirSync(path.dirname(RECORD!), { recursive: true });
		// One stream, and one rule's answers, to a line, so a change to the
		// oracle reads as a diff of the lines it touches.
		const body = [
			`{"recordedFrom":${JSON.stringify(oracle.recordedFrom)},"streams":[`,
			oracle.streams.map((s) => JSON.stringify(s)).join(",\n"),
			`],"results":{`,
			Object.entries(oracle.results).map(([name, answers]) => `${JSON.stringify(name)}:${JSON.stringify(answers)}`).join(",\n"),
			"}}",
		].join("\n");
		fs.writeFileSync(RECORD!, body + "\n");
	});
});

// ── The rules against their recorded answers ────────────────────────────────

describe("every changed rule answers what it answered before, at every position", () => {
	let oracle: Oracle;
	let streams: Token[][];
	const engine = engineAtNow();
	const rules = rulesOf(engine);
	const env = engine.getNormalizer().environment;
	beforeAll(() => {
		oracle = JSON.parse(fs.readFileSync(ORACLE, "utf8")) as Oracle;
		streams = oracle.streams.map((s) => s.tokens.map(fromWire));
	});

	test("the oracle was recorded before the change, over the whole corpus", () => {
		expect(oracle.recordedFrom).toBe("277b709");
		expect(oracle.streams.length).toBeGreaterThan(1000);
		for (const name of CHANGED_RULES) expect(Object.keys(oracle.results[name] ?? {}).length).toBeGreaterThan(0);
	});

	for (const name of CHANGED_RULES) {
		test(name, () => {
			const rule = rules.get(name);
			expect(rule).toBeDefined();
			const recorded = oracle.results[name] ?? {};
			const differences: string[] = [];
			const ended: string[] = [];
			let positions = 0;
			streams.forEach((tokens, s) => {
				for (let pos = 0; pos < tokens.length; pos++) {
					positions++;
					const before = recorded[`${s}:${pos}`] ?? null;
					const now = answerOf(rule!, tokens, pos, env);
					if (before !== null && readsInheritedProperty(before)) {
						// The one change: a word naming an inherited property is no trigger.
						if (now !== null) differences.push(`${oracle.streams[s].line} @${pos}: still ${JSON.stringify(now)}`);
						ended.push(oracle.streams[s].line);
						continue;
					}
					if ((CHANGED_SINCE[name] ?? []).indexOf(`${oracle.streams[s].line} @${pos}`) >= 0) continue;
					if (JSON.stringify(now) !== JSON.stringify(before)) {
						differences.push(`${oracle.streams[s].line} @${pos}: was ${JSON.stringify(before)}, now ${JSON.stringify(now)}`);
					}
				}
			});
			expect(positions).toBeGreaterThan(5000);
			expect(differences).toEqual([]);
			if (name === "datetime:weekday-count") expect(ended).toEqual(expect.arrayContaining(["constructor until friday", "constructor between friday and monday"]));
			if (name === "lines:section-aggregate") expect(ended).toContain('constructor of section "x"');
			if (name === "datetime:date-offset") expect(ended).toContain("5 days constructor 3");
			if (!["datetime:weekday-count", "lines:section-aggregate", "datetime:date-offset"].includes(name)) expect(ended).toEqual([]);
		});
	}
});

// ── lowersTo and valueLowersTo ──────────────────────────────────────────────

/** The comparison as every rule wrote it. */
function oldLowersTo(text: string, word: string): boolean {
	return text.toLowerCase() === word;
}

describe("lowersTo", () => {
	const WORDS = ["how", "many", "up", "down", "sum", "of", "section", "k"];

	test("ordinary words, in any case", () => {
		expect(lowersTo("how", "how")).toBe(true);
		expect(lowersTo("HOW", "how")).toBe(true);
		expect(lowersTo("How", "how")).toBe(true);
		expect(lowersTo("hows", "how")).toBe(false);
		expect(lowersTo("ho", "how")).toBe(false);
		expect(lowersTo("", "")).toBe(true);
		expect(lowersTo("", "of")).toBe(false);
	});

	test("past ASCII, the answer toLowerCase gives: the Kelvin sign lowers to k, a dotted capital I to two characters", () => {
		expect(lowersTo("K", "k")).toBe(true);
		expect(lowersTo("İ", "i")).toBe(false);
		expect(lowersTo("ſum", "sum")).toBe(false);
		expect(lowersTo("ＳＵＭ", "sum")).toBe(false);
	});

	test("every UTF-16 code unit, in every position of every word, answers as toLowerCase did", () => {
		const wrong: string[] = [];
		for (const word of WORDS) {
			for (let i = 0; i < word.length; i++) {
				for (const unit of CODE_UNITS) {
					for (const text of [word.slice(0, i) + unit + word.slice(i + 1), word.slice(0, i) + unit + word.slice(i), unit]) {
						if (lowersTo(text, word) !== oldLowersTo(text, word)) wrong.push(`${JSON.stringify(text)} / ${word}`);
					}
				}
			}
		}
		expect(wrong).toEqual([]);
	});

	test("the shared corpora and the prototype words, in four cases, answer as toLowerCase did", () => {
		const texts = [...PROTOTYPE_WORDS, ...TEXT_EDGES, ...NUMERIC_EDGES, ...LOOK_ALIKES, ...WORDS];
		for (const text of texts) {
			for (const form of [text, text.toUpperCase(), text.toLowerCase(), text.slice(0, 1).toUpperCase() + text.slice(1)]) {
				for (const word of [...WORDS, "constructor", "__proto__", "tostring"]) {
					expect([form, word, lowersTo(form, word)]).toEqual([form, word, oldLowersTo(form, word)]);
				}
			}
		}
	});

	test("a long word is settled by its length, whatever it holds", () => {
		const long = RESOURCE_PROBES.longIdentifier(100_000);
		const started = Date.now();
		for (let i = 0; i < 1000; i++) lowersTo(long, "how");
		expect(Date.now() - started).toBeLessThan(500);
		expect(lowersTo(long, "x".repeat(100_000))).toBe(true);
	});

	test("valueLowersTo reads a missing token, or one with no string value, as not the word", () => {
		expect(valueLowersTo(undefined, "how")).toBe(false);
		expect(valueLowersTo({}, "how")).toBe(false);
		expect(valueLowersTo({ value: null }, "how")).toBe(false);
		expect(valueLowersTo({ value: 5 as unknown as string }, "how")).toBe(false);
		expect(valueLowersTo({ value: "HOW" }, "how")).toBe(true);
		expect(valueLowersTo(tok("IDENT", "Many"), "many")).toBe(true);
		for (const word of PROTOTYPE_WORDS) expect(valueLowersTo(tok("IDENT", word), "how")).toBe(false);
	});

	test("lowerCased lowers only a word that needs it, to what toLowerCase gives", () => {
		for (const text of [...PROTOTYPE_WORDS, ...TEXT_EDGES, ...LOOK_ALIKES, "Fridays", "fridays"]) expect(lowerCased(text)).toBe(text.toLowerCase());
	});
});

// ── The one-character predicates ────────────────────────────────────────────

describe("opensLine", () => {
	/** The two patterns the rule ran at every word. */
	const oldLineForms = (text: string): boolean => /^line(\d+)$/i.test(text) || /^line$/i.test(text);

	test("an l of either case, and nothing else, as the first character", () => {
		expect(opensLine("line1")).toBe(true);
		expect(opensLine("LINE")).toBe(true);
		expect(opensLine("liner")).toBe(true);
		expect(opensLine("The")).toBe(false);
		expect(opensLine("")).toBe(false);
		expect(opensLine("ℓine")).toBe(false);
	});

	test("every UTF-16 code unit first: only an l the patterns can match passes, and every form the patterns match passes", () => {
		const wrong: string[] = [];
		for (const unit of CODE_UNITS) {
			if (opensLine(unit) !== /^l/i.test(unit)) wrong.push(`opens ${unit.charCodeAt(0).toString(16)}`);
			for (const text of [unit + "ine", unit + "ine1", unit + "INE42", unit]) {
				if (oldLineForms(text) && !opensLine(text)) wrong.push(`turns away ${JSON.stringify(text)}`);
			}
		}
		expect(wrong).toEqual([]);
	});

	test("the shared corpora and the prototype words: nothing the patterns match is turned away", () => {
		for (const text of [...PROTOTYPE_WORDS, ...TEXT_EDGES, ...NUMERIC_EDGES, ...LOOK_ALIKES]) {
			if (oldLineForms(text)) expect(opensLine(text)).toBe(true);
			expect(opensLine(text)).toBe(/^l/i.test(text));
		}
	});
});

describe("opensDottedQuad", () => {
	const oldOpens = (text: string): boolean => /^\d{1,3}\./.test(text);

	test("one to three digits then a dot", () => {
		expect(opensDottedQuad("192.168")).toBe(true);
		expect(opensDottedQuad("1.")).toBe(true);
		expect(opensDottedQuad("123.4")).toBe(true);
		expect(opensDottedQuad("1234.5")).toBe(false);
		expect(opensDottedQuad(".5")).toBe(false);
		expect(opensDottedQuad("12")).toBe(false);
		expect(opensDottedQuad("")).toBe(false);
		expect(opensDottedQuad("١.٢")).toBe(false);
	});

	test("every UTF-16 code unit in each of the first five places answers as the pattern did", () => {
		const wrong: string[] = [];
		for (const base of ["1234", "12.4", "1.34", "123.", "....", "1"]) {
			for (let i = 0; i <= base.length; i++) {
				for (const unit of CODE_UNITS) {
					const text = base.slice(0, i) + unit + base.slice(i + 1);
					if (opensDottedQuad(text) !== oldOpens(text)) wrong.push(JSON.stringify(text));
				}
			}
		}
		expect(wrong).toEqual([]);
	});

	test("the shared corpora and the prototype words answer as the pattern did", () => {
		for (const text of [...PROTOTYPE_WORDS, ...TEXT_EDGES, ...NUMERIC_EDGES, ...LOOK_ALIKES, "0.0.0.0", "-1.2"]) {
			expect([text, opensDottedQuad(text)]).toEqual([text, oldOpens(text)]);
		}
	});
});

describe("mayContinueDate", () => {
	test("a number, a slash, a minus or a text opening with a minus carries a date on; nothing else does", () => {
		expect(mayContinueDate(tok("NUMBER", ".12"))).toBe(true);
		expect(mayContinueDate(tok("SLASH", "/"))).toBe(true);
		expect(mayContinueDate(tok("MINUS", "-"))).toBe(true);
		expect(mayContinueDate(tok("IDENT", "-03"))).toBe(true);
		expect(mayContinueDate(undefined)).toBe(false);
		expect(mayContinueDate(tok("PLUS", "+"))).toBe(false);
		expect(mayContinueDate(tok("IDENT", ""))).toBe(false);
		expect(mayContinueDate(tok("UNIT", "days"))).toBe(false);
		for (const word of PROTOTYPE_WORDS) expect(mayContinueDate(tok("IDENT", word))).toBe(false);
	});
});

// ── The lookups that became Maps ────────────────────────────────────────────

describe("the table lookups read only their own keys, and every key as before", () => {
	const OLD_WEEKDAY_TOKEN: Record<string, number> = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };
	const OLD_WEEKDAY_PLURAL: Record<string, number> = { sundays: 0, mondays: 1, tuesdays: 2, wednesdays: 3, thursdays: 4, fridays: 5, saturdays: 6 };
	const oldWeekdayIndex = (t: Token): unknown =>
		OLD_WEEKDAY_TOKEN[t.type] ?? (t.type === "IDENT" ? OLD_WEEKDAY_PLURAL[(t.value ?? "").toLowerCase()] : undefined);

	const OLD_SECTION_WORD: Record<string, string> = { total: "SECTION_SUM", sum: "SECTION_SUM", count: "SECTION_COUNT", average: "SECTION_AVERAGE" };
	const oldSectionTrigger = (t: Token): unknown => OLD_SECTION_WORD[(t.text ?? t.value ?? "").toLowerCase()];

	const OLD_CONNECTORS: Record<string, string> = { FROM: "DATE_OFFSET_AFTER", AFTER: "DATE_OFFSET_AFTER", before: "DATE_OFFSET_BEFORE" };
	const oldConnector = (t: Token): unknown =>
		OLD_CONNECTORS[t.type] ?? (t.type === "IDENT" ? OLD_CONNECTORS[(t.value ?? "").toLowerCase()] : undefined);

	const words = [
		...Object.keys(OLD_WEEKDAY_PLURAL), ...Object.keys(OLD_SECTION_WORD), "before", "from", "after", "friday",
		...LOOK_ALIKES, ...TEXT_EDGES, ...NUMERIC_EDGES,
	];
	const types = ["IDENT", "UNIT", "FROM", "AFTER", "BEFORE", ...Object.keys(OLD_WEEKDAY_TOKEN), "NUMBER"];
	const forms = (w: string): string[] => [w, w.toUpperCase(), w.toLowerCase(), w.slice(0, 1).toUpperCase() + w.slice(1)];

	test("every key, in four cases and under every token type, reads what the object read", () => {
		for (const type of types) {
			for (const word of words) {
				for (const form of forms(word)) {
					const t = tok(type, form);
					expect([type, form, weekdayIndexOf(t)]).toEqual([type, form, oldWeekdayIndex(t)]);
					expect([type, form, sectionTriggerOf(t)]).toEqual([type, form, oldSectionTrigger(t)]);
					expect([type, form, offsetConnectorOf(t)]).toEqual([type, form, oldConnector(t)]);
				}
			}
		}
	});

	test("a word naming an inherited property is no trigger, where the object found Object's own members", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				for (const form of forms(word)) {
					const t = tok("IDENT", form);
					expect(weekdayIndexOf(t)).toBeUndefined();
					expect(sectionTriggerOf(t)).toBeUndefined();
					expect(offsetConnectorOf(t)).toBeUndefined();
				}
			}
		});
		// What the objects answered, which the oracle records.
		expect(typeof oldWeekdayIndex(tok("IDENT", "constructor"))).toBe("function");
		expect(typeof oldSectionTrigger(tok("IDENT", "constructor"))).toBe("function");
		expect(typeof oldConnector(tok("IDENT", "constructor"))).toBe("function");
	});

	test("monthOf lowers only what it must, and reads every month and near miss as before", () => {
		const MONTHS = new Map(Object.entries({
			january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
			august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
		}));
		const CONVERSIONS = new Set(["AS", "IN", "TO"]);
		const oldMonthOf = (t: Token | undefined, before?: Token): number => {
			if (t === undefined || !["IDENT", "UNIT", "CONVERTER_NAME"].includes(t.type)) return 0;
			if (t.type === "CONVERTER_NAME" && before !== undefined && CONVERSIONS.has(before.type)) return 0;
			return MONTHS.get((t.text ?? t.value ?? "").toLowerCase()) ?? 0;
		};
		const candidates = [...MONTHS.keys(), ...PROTOTYPE_WORDS, ...LOOK_ALIKES, ...TEXT_EDGES, "Mär", "MAÏ", "mаr"];
		for (const type of ["IDENT", "UNIT", "CONVERTER_NAME", "NUMBER", "MONDAY"]) {
			for (const word of candidates) {
				for (const form of forms(word)) {
					for (const before of [undefined, tok("IN", "in"), tok("NUMBER", "9")]) {
						const t = tok(type, form);
						expect([type, form, monthOf(t, before)]).toEqual([type, form, oldMonthOf(t, before)]);
					}
				}
			}
		}
		expect(monthOf(undefined)).toBe(0);
	});
});

// ── The rules' own helpers ──────────────────────────────────────────────────

describe("stepTokenAt and definedNameWords answer as before", () => {
	/** The step test as it was: the word lower-cased first. */
	function oldStepTokenAt(tokens: Token[], i: number): string | null {
		const word = tokens[i];
		if (word?.type !== "IDENT") return null;
		const text = (word.text ?? word.value ?? "").toLowerCase();
		if (text !== "up" && text !== "down") return null;
		if (tokens[i + 1]?.type !== "NUMBER") return null;
		if (tokens[i + 2]?.type !== "PERCENT") return null;
		return `${text === "up" ? "PCT_UP" : "PCT_DOWN"}:${text}`;
	}

	/** The definition test as it was: the letter pattern at every word before the `=` was looked for. */
	function oldDefinedNameWords(tokens: Token[]): string[] | null {
		const run = nameWordRun(tokens, 0, MAX_NAME_WORDS + 1);
		if (run < 2 || run > MAX_NAME_WORDS) return null;
		if (tokens[run]?.type !== "EQUALS") return null;
		return tokens.slice(0, run).map((t) => t.value);
	}

	const engine = newTrackedEngine();
	const lines = [...new Set([...NORMALIZER_CORPUS, ...TARGETED, ...TEMPLATES.flatMap((t) => fill(t, [...PROTOTYPE_WORDS, ...LOOK_ALIKES])), ...TEXT_EDGES])];

	test("stepTokenAt at every position of every line, and of hand-built streams", () => {
		const streams = [
			...lines.map((l) => lexed(engine, l)),
			[tok("IDENT", "UP"), tok("NUMBER", "5"), tok("PERCENT", "%")],
			[tok("IDENT", "dOwN"), tok("NUMBER", "5"), tok("PERCENT", "%")],
			[tok("IDENT", "Kown"), tok("NUMBER", "5"), tok("PERCENT", "%")],
			[tok("IDENT", "up"), tok("NUMBER", "5")],
			[tok("UNIT", "up"), tok("NUMBER", "5"), tok("PERCENT", "%")],
		];
		for (const tokens of streams) {
			for (let i = 0; i <= tokens.length; i++) {
				const now = stepTokenAt(tokens, i);
				expect(now === null ? null : `${now.type}:${now.value}`).toBe(oldStepTokenAt(tokens, i));
			}
		}
	});

	test("definedNameWords on every line, and on runs at and past the longest name", () => {
		const streams = [
			...lines.map((l) => lexed(engine, l)),
			...[1, 2, 3, 4, 5, 6].map((n) => [...Array.from({ length: n }, (_, k) => tok("IDENT", `w${"abcdef"[k]}`)), tok("EQUALS", "=")]),
			...[1, 2, 3, 4, 5, 6].map((n) => [...Array.from({ length: n }, (_, k) => tok("IDENT", "abcdef"[k])), tok("EQUALS", "=")]),
			[tok("IDENT", "a"), tok("IDENT", "b_c"), tok("EQUALS", "=")],
			[tok("IDENT", "a"), tok("IDENT", "b"), tok("IDENT", "c")],
			[tok("IDENT", "a"), tok("NUMBER", "1"), tok("EQUALS", "=")],
			[],
		];
		for (const tokens of streams) expect(definedNameWords(tokens)).toEqual(oldDefinedNameWords(tokens));
	});
});

// ── The source, so the old forms cannot come back unnoticed ─────────────────

describe("the cheap test comes first in the source", () => {
	test("weekday count and between unit compare `how many` in place, and the weekday count asks for its connector before its weekday", () => {
		const weekday = bodyOf("packages/datetime/normalizer/WeekdayCountNormalizerRule.ts", /export function weekdayCountNormalizerRule\(/);
		expect(weekday).not.toContain(".toLowerCase()");
		expect(weekday.indexOf("CONNECTOR_TYPE.get(")).toBeLessThan(weekday.indexOf("weekdayIndexOf("));
		const between = bodyOf("packages/datetime/normalizer/BetweenUnitNormalizerRule.ts", /export function betweenUnitNormalizerRule\(/);
		expect(between).not.toContain('toLowerCase() === "how"');
		expect(between).toContain('valueLowersTo(tokens[pos], "how")');
	});

	test("the tables a reader's word reaches are Maps", () => {
		for (const [file, table] of [
			["packages/datetime/normalizer/WeekdayCountNormalizerRule.ts", "WEEKDAY_PLURAL_INDEX"],
			["packages/lines/normalizer/SectionAggregateNormalizerRule.ts", "WORD_TRIGGER"],
			["packages/datetime/normalizer/DateOffsetNormalizerRule.ts", "CONNECTORS"],
		]) {
			const source = fs.readFileSync(path.join(SRC, file), "utf8");
			expect(source).toMatch(new RegExp(`const ${table}: ReadonlyMap<`));
			expect(source).not.toMatch(new RegExp(`${table}\\[`));
		}
	});

	test("line reference tests the first letter before either pattern", () => {
		const body = bodyOf("packages/lines/normalizer/LineRefNormalizerRule.ts", /export function lineRefNormalizerRule\(/);
		expect(body.indexOf("opensLine(")).toBeGreaterThan(0);
		expect(body.indexOf("opensLine(")).toBeLessThan(body.indexOf("/^line(\\d+)$/i"));
	});

	test("up and down, tags and sections compare their words in place", () => {
		const step = bodyOf("packages/percentage/normalizer/PercentUpDownNormalizerRule.ts", /export function stepTokenAt\(/);
		expect(step).not.toContain(".toLowerCase()");
		expect(step.indexOf('"PERCENT"')).toBeLessThan(step.indexOf("lowersTo("));
		const tags = bodyOf("packages/tags/normalizer/TagAggregateNormalizerRule.ts", /export function tagAggregateNormalizerRule\(/);
		expect(tags).not.toContain('wordOf(head) === "sum"');
		const section = bodyOf("packages/lines/normalizer/SectionAggregateNormalizerRule.ts", /export function sectionAggregateNormalizerRule\(/);
		expect(section).not.toContain(".toLowerCase()");
	});

	test("mixed number builds no closure per call, and looks at the next token before its pattern", () => {
		const body = bodyOf("packages/arithmetic/normalizer/MixedNumberNormalizerRule.ts", /export function mixedNumberNormalizerRule\(/);
		expect(body).not.toMatch(/const number = \(/);
		expect(body.indexOf("MAY_FOLLOW_WHOLE.has(")).toBeLessThan(body.indexOf("WHOLE.test(whole)"));
	});

	test("month name date reads the calendar only for a date, and the types before the words", () => {
		const body = bodyOf("packages/datetime/normalizer/MonthNameDateNormalizerRule.ts", /export function monthNameDateNormalizerRule\(/);
		const firstReturn = body.indexOf("return null");
		expect(body.indexOf("getCalendar()")).toBeGreaterThan(firstReturn);
		expect(body.indexOf("MONTH_TOKEN_TYPES.has(second.type)")).toBeLessThan(body.indexOf("PLAIN_INTEGER.test(first.text"));
		const monthOfBody = bodyOf("packages/datetime/normalizer/MonthNameDateNormalizerRule.ts", /export function monthOf\(/);
		expect(monthOfBody).not.toContain(".toLowerCase()");
	});

	test("date literal turns a number with nothing date-like after it away before reading the calendar", () => {
		const body = bodyOf("packages/datetime/normalizer/DateLiteralNormalizerRule.ts", /export function dateLiteralNormalizerRule\(/);
		expect(body.indexOf("mayContinueDate(")).toBeGreaterThan(0);
		expect(body.indexOf("mayContinueDate(")).toBeLessThan(body.indexOf("getCalendar()"));
	});

	test("clock time reads parseInt only for a clock shape, and large number suffix its pattern only before a word", () => {
		const clock = bodyOf("packages/time/normalizer/ClockTimeNormalizerRule.ts", /export function clockTimeNormalizerRule\(/);
		expect(clock.indexOf("parseInt(")).toBeGreaterThan(clock.indexOf("if (!colonShape && !bareShape) return null;"));
		const suffix = bodyOf("packages/arithmetic/normalizer/LargeNumberSuffixNormalizerRule.ts", /export function largeNumberSuffixNormalizerRule\(/);
		expect(suffix.indexOf("PLAIN_DECIMAL.test(")).toBeGreaterThan(suffix.indexOf('suffixToken.type !== "IDENT" && suffixToken.type !== "UNIT"'));
	});

	test("bare rate asks for a slash or per word before the unit lookup, and date offset for its connector before the measure", () => {
		const rate = bodyOf("packages/uom/normalizer/BareRateDenominatorNormalizerRule.ts", /export function bareRateDenominatorNormalizerRule\(/);
		expect(rate.indexOf("if (!isSlash && !isPerWord) return null;")).toBeLessThan(rate.indexOf("isDenominatorUnit(tokens[pos + 1])"));
		expect(rate).not.toContain(".toLowerCase()");
		const offset = bodyOf("packages/datetime/normalizer/DateOffsetNormalizerRule.ts", /export function dateOffsetNormalizerRule\(/);
		expect(offset.indexOf("offsetConnectorOf(")).toBeLessThan(offset.indexOf("getMeasure("));
	});

	test("the address rule runs no pattern for its cheap reject, call fusion lowers only a capital, and a definition looks for its `=` first", () => {
		const cidr = bodyOf("packages/ip/normalizer/IpCidrNormalizerRule.ts", /export function ipCidrNormalizerRule\(/);
		expect(cidr).not.toContain("/^\\d{1,3}\\./.test(");
		expect(cidr).toContain("opensDottedQuad(");
		const call = bodyOf("normalizer/CallFusionRule.ts", /export function callFusionRule\(/);
		expect(call).not.toContain(".toLowerCase()");
		const defined = bodyOf("packages/variables/MultiWordNames.ts", /export function definedNameWords\(/);
		expect(defined.indexOf('"EQUALS"')).toBeLessThan(defined.indexOf("nameWordRun("));
	});
});

// ── What a reader sees ──────────────────────────────────────────────────────

describe("the lines a reader writes", () => {
	/** Each line of a document as the reader sees it. */
	function doc(text: string): string[] {
		return engineAtNow().parseDocument(text).lines.map((l) =>
			l.result == null ? `ERROR ${l.error}` : l.result.isError() ? `ERROR ${l.result.errorMessage}` : formatValue(l.result));
	}

	test("answer what they answered before", () => {
		expect(doc([
			"how many fridays between 01/06/2026 and 31/08/2026",
			"days between 1/1/2026 and 1/2/2026",
			"120 up 10% then down 10%",
			"1 1/2 + 2 ½",
			"9 March 2026 + 1 day",
			"30 bottles / week",
			"5 days from 1/1/2026",
			"9:00am + 30 minutes",
			"2.5M",
			"hourly rate = $50",
			"hourly rate * 8",
			"line1 + line 2",
			"25/12/2026",
			"192.168.1.0/24",
		].join("\n"))).toEqual(EXPECTED_DOCUMENT);
	});

	test('a section, a tag and a weekday count keep their meaning in any case', () => {
		expect(doc('# Travel\n10\n20\n\nSUM OF SECTION "Travel"')).toEqual(doc('# Travel\n10\n20\n\nsum of section "Travel"'));
		expect(doc("10 #food\n20 #food\nSum Of #food")).toEqual(doc("10 #food\n20 #food\nsum of #food"));
		expect(doc("HOW MANY Fridays between 01/06/2026 and 31/08/2026")).toEqual(doc("how many fridays between 01/06/2026 and 31/08/2026"));
	});

	test("a word naming an inherited property where a trigger stands is read as a word, with an honest answer", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				for (const line of [`${word} of section "x"`, `5 days ${word} 3`, `${word} until friday`, `${word} between friday and monday`]) {
					expectHonestLine(line);
					for (const answer of doc(line)) {
						expect(answer).not.toContain("function Object");
						expect(answer).not.toContain("[native code]");
					}
				}
			}
		});
	});

	test("a long line of prose and a long sum normalise within budget", () => {
		const engine = engineAtNow();
		for (const text of [Array(5000).fill("word").join(" "), RESOURCE_PROBES.longSum(5000), Array(2000).fill("The Fridays").join(" ")]) {
			const tokens = lexed(engine, text);
			const started = Date.now();
			engine.getNormalizer().normalize(tokens);
			expect(Date.now() - started).toBeLessThan(2000);
		}
	});
});

/** What the reader's document printed, the same from a run of 277b709 and of this change. */
const EXPECTED_DOCUMENT: string[] = [
	"= 13",
	"= 31 days",
	"= 118.80",
	"= 4",
	"= Tuesday, March 10, 2026",
	"= 30.00 bottles/week",
	"= Tuesday, January 6, 2026",
	"= 9:30:00 AM",
	"= 2,500,000",
	"= $50.00",
	"= $400.00",
	"= 44 days",
	"= Friday, December 25, 2026",
	"= 192.168.1.0/24",
];
