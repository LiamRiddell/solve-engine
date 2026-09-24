/**
 * A regular-expression matcher whose work is bounded by the length of the text
 * times the size of the pattern, whatever the pattern is.
 *
 * JavaScript's own `RegExp` backtracks. On a pattern like `(a+)+$` it retries
 * every way of dividing a run of letters between the two loops, and each
 * further letter doubles the work: measured in Node.js, twenty-six letters and
 * a full stop take over half a second, so thirty-six take around ten minutes. A
 * notepad is exactly where a pattern and a pasted text meet without either
 * being checked, so the text package never hands a pattern to `RegExp`. It
 * compiles the pattern to a small program and runs every way of matching at
 * once, one character at a time (the construction usually called a Pike VM),
 * which visits each program step at most once per character of text.
 *
 * The price is the two features that cannot run that way. A backreference
 * (`\1`) asks whether the text repeats something it matched earlier, which no
 * fixed program can answer, and lookahead or lookbehind (`(?=...)`) needs a
 * second search at every position. Both are refused by name rather than
 * approximated. Everything else follows JavaScript's syntax and its
 * leftmost-first choice between alternatives, including resetting a group's
 * capture on each pass of a loop and refusing an optional pass that matched
 * nothing, so a pattern copied from a JavaScript program finds the same text
 * with the same groups. A seeded differential run against `RegExp` holds it to
 * that (`__tests__/packages/text/TextPattern.spec.ts`).
 *
 * Four limits bound the work whatever is asked: the pattern's length, how many
 * groups it captures, the size of its compiled program (a counted repeat like
 * `a{1000}` copies its body), and a count of program steps per evaluated line.
 * The step count is deterministic, not a clock, so a line gives the same answer
 * on every machine and on every run.
 *
 * Characters are Unicode code points, so an emoji is one character to `.` and
 * to a class. Positions reported back are indexes into the JavaScript string,
 * ready for `slice`.
 */

/** The longest pattern accepted, in characters. */
export const MAX_PATTERN_LENGTH = 500;

/** The most capturing groups one pattern may have. */
export const MAX_PATTERN_GROUPS = 32;

/** The largest count a repeat such as `{2,5}` may name. */
export const MAX_PATTERN_REPEAT = 1000;

/** The most instructions a compiled pattern may hold, counting every copy a repeat makes. */
export const MAX_PATTERN_PROGRAM = 10_000;

/** How deeply groups may nest. Bounds the recursion that reads the pattern. */
export const MAX_PATTERN_NESTING = 100;

/**
 * The most program steps the pattern forms may take while one line is
 * evaluated, across every call and every search they make.
 *
 * Measured rather than guessed: a step costs tens of nanoseconds, so spending
 * all of them takes a fifth of a second or less, and an ordinary pattern over a
 * pasted line uses a few thousand. Counted per evaluation rather than per call,
 * so fifty calls on one line share one allowance instead of having fifty.
 */
export const MAX_PATTERN_STEPS = 5_000_000;

// ── Instructions ──────────────────────────────────────────────────────────

// The three instructions that consume a character continue at step `b`, which
// is the next step except in the first copy of a loop body that must not match
// nothing (see PatternCompiler.nonEmptyPass).

/** Match one character equal to `a` (already case-folded under `(?i)`), then continue at `b`. */
const CHAR = 0;
/** Match any character except a line break, then continue at `b`. */
const ANY = 1;
/** Match one character in class number `a`, then continue at `b`. */
const CLASS = 2;
/** Continue at `a` first and at `b` second: the preferred branch comes first. */
const SPLIT = 3;
/** Continue at `a`. */
const JMP = 4;
/** Record the current position in capture slot `a`. */
const SAVE = 5;
/** Forget capture slots `a` up to (not including) `b`: a loop's groups start each pass unset. */
const CLEAR = 6;
/** Succeed only at the start of the text. */
const BOL = 7;
/** Succeed only at the end of the text. */
const EOL = 8;
/** Succeed only between a word character and a non-word character. */
const WORD_BOUNDARY = 9;
/** Succeed only where {@link WORD_BOUNDARY} would not. */
const NOT_WORD_BOUNDARY = 10;
/** The whole pattern has matched. */
const MATCH = 11;
/** A dead end: this way of matching stops here. */
const FAIL = 12;

/** A character class as sorted, merged, inclusive code-point ranges. */
interface CharClass {
	/** Flattened `[lo, hi, lo, hi, ...]` pairs. */
	readonly ranges: readonly number[];
	/** True for `[^...]`: the class matches what the ranges do not. */
	readonly negated: boolean;
}

/** A compiled pattern, ready to run against any number of texts. */
export interface CompiledPattern {
	/** The instruction of each step. */
	readonly op: Uint8Array;
	/** Each step's first operand (a character, a target, a slot or a class). */
	readonly a: Int32Array;
	/** Each step's second operand (the second target of a split, the end of a cleared run). */
	readonly b: Int32Array;
	/** The classes `CLASS` steps refer to by number. */
	readonly classes: readonly CharClass[];
	/** How many capturing groups the program records (0 when compiled without them). */
	readonly groupCount: number;
	/** Whether the pattern opened with `(?i)`, matching letters regardless of case. */
	readonly ignoreCase: boolean;
}

/** Why a pattern could not be compiled: a stable code and a sentence for the reader. */
export interface PatternFault {
	/** One of the pattern codes in {@link PATTERN_FAULT_CODES}. */
	readonly code: string;
	/** What is wrong, in the reader's words. */
	readonly message: string;
}

/** The codes a pattern can be refused with. */
export const PATTERN_FAULT_CODES = {
	/** The pattern is not well formed: an unclosed group, a quantifier with nothing before it. */
	INVALID: "TEXT_PATTERN_INVALID",
	/** The pattern uses a feature this matcher refuses: a backreference, lookaround, a Unicode property. */
	UNSUPPORTED: "TEXT_PATTERN_UNSUPPORTED",
	/** The pattern is longer, deeper, or compiles to more steps than the limits allow. */
	TOO_LARGE: "TEXT_PATTERN_TOO_LARGE",
} as const;

/** Thrown inside a search when the step budget runs out; the caller turns it into an Error value. */
export class PatternBudgetExceeded extends Error {
	/** @param steps - The budget that was spent. */
	constructor(readonly steps: number) {
		super(`pattern search passed ${steps} steps`);
	}
}

/** A running count of program steps, shared by every search it is handed to. */
export class PatternBudget {
	/**
	 * @param limit - The most steps that may be spent in all.
	 * @param spent - Steps already spent before this budget was made, by earlier
	 * calls in the same evaluation.
	 */
	constructor(readonly limit: number = MAX_PATTERN_STEPS, public spent: number = 0) {}

	/**
	 * Spend `count` steps.
	 *
	 * @throws PatternBudgetExceeded once the total passes the limit.
	 */
	spend(count: number): void {
		this.spent += count;
		if (this.spent > this.limit) throw new PatternBudgetExceeded(this.limit);
	}
}

// ── Character sets ────────────────────────────────────────────────────────

const DIGIT_RANGES = [0x30, 0x39];
const WORD_RANGES = [0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a];
// What JavaScript's `\s` matches: the ASCII spaces and the Unicode space
// separators, line terminators and the byte-order mark.
const SPACE_RANGES = [
	0x09, 0x0d, 0x20, 0x20, 0xa0, 0xa0, 0x1680, 0x1680, 0x2000, 0x200a,
	0x2028, 0x2029, 0x202f, 0x202f, 0x205f, 0x205f, 0x3000, 0x3000, 0xfeff, 0xfeff,
];
const MAX_CODE_POINT = 0x10ffff;

/** The code points not covered by `ranges` (which must be sorted and merged). */
function complement(ranges: readonly number[]): number[] {
	const out: number[] = [];
	let next = 0;
	for (let i = 0; i < ranges.length; i += 2) {
		if (ranges[i] > next) out.push(next, ranges[i] - 1);
		next = ranges[i + 1] + 1;
	}
	if (next <= MAX_CODE_POINT) out.push(next, MAX_CODE_POINT);
	return out;
}

/** Sort and merge overlapping or touching ranges. */
function normaliseRanges(ranges: readonly number[]): number[] {
	const pairs: [number, number][] = [];
	for (let i = 0; i < ranges.length; i += 2) pairs.push([ranges[i], ranges[i + 1]]);
	pairs.sort((x, y) => x[0] - y[0]);
	const out: number[] = [];
	for (const [lo, hi] of pairs) {
		const last = out.length - 1;
		if (last > 0 && lo <= out[last] + 1) {
			if (hi > out[last]) out[last] = hi;
		} else {
			out.push(lo, hi);
		}
	}
	return out;
}

/** Whether `cp` falls inside any of `ranges`. */
function inRanges(ranges: readonly number[], cp: number): boolean {
	for (let i = 0; i < ranges.length; i += 2) {
		if (cp < ranges[i]) return false;
		if (cp <= ranges[i + 1]) return true;
	}
	return false;
}

/** A word character for `\b`, which is ASCII letters, digits and underscore, as in JavaScript. */
function isWordUnit(unit: number): boolean {
	return (unit >= 0x30 && unit <= 0x39) || (unit >= 0x41 && unit <= 0x5a) || unit === 0x5f || (unit >= 0x61 && unit <= 0x7a);
}

/** The characters `.` does not match: the line terminators. */
function isLineTerminator(cp: number): boolean {
	return cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029;
}

/** Every code point whose canonical form differs from itself, as `[cp, canonical]` pairs. Built on first use. */
let casedPairs: Int32Array | null = null;

/**
 * The code points `(?i)` changes, found once by asking the runtime. Every one
 * of them is below U+20000 (measured: 1,476 of them, and none above), so the
 * search stops there, which takes a few milliseconds the first time a
 * case-insensitive pattern with a class is compiled and none after.
 */
function casedCodePoints(): Int32Array {
	if (casedPairs === null) {
		const pairs: number[] = [];
		for (let cp = 0; cp < 0x20000; cp++) {
			if (cp >= 0xd800 && cp <= 0xdfff) continue;
			const k = canonical(cp);
			if (k !== cp) pairs.push(cp, k);
		}
		casedPairs = Int32Array.from(pairs);
	}
	return casedPairs;
}

/**
 * A class widened by the canonical form of every member, so that under `(?i)`
 * testing a character's canonical form against it answers JavaScript's
 * question: does any member share this character's canonical form. `[a-z]`
 * gains `A-Z`, and `[µ]` gains the Greek capital mu the micro sign folds to.
 */
function caseWidened(ranges: readonly number[]): number[] {
	const pairs = casedCodePoints();
	const widened = ranges.slice();
	for (let i = 0; i < pairs.length; i += 2) {
		if (inRanges(ranges, pairs[i])) widened.push(pairs[i + 1], pairs[i + 1]);
	}
	return normaliseRanges(widened);
}

/**
 * The form `(?i)` compares a character in, JavaScript's rule for a pattern with
 * the `i` flag: its upper case, unless that is not exactly one character, or
 * would turn a character outside ASCII into one inside it. So `a` and `A` meet,
 * while the long s `ſ` stays apart from `s`, as it does in JavaScript.
 */
function canonical(cp: number): number {
	if (cp < 0x80) return cp >= 0x61 && cp <= 0x7a ? cp - 32 : cp;
	const raised = String.fromCodePoint(cp).toUpperCase();
	const first = raised.codePointAt(0)!;
	if (raised.length !== (first > 0xffff ? 2 : 1) || first < 0x80) return cp;
	return first;
}

// ── Reading the pattern ───────────────────────────────────────────────────

type Node =
	| { readonly t: "empty" }
	| { readonly t: "char"; readonly cp: number }
	| { readonly t: "any" }
	| { readonly t: "class"; readonly cls: CharClass }
	| { readonly t: "assert"; readonly op: number }
	| { readonly t: "group"; readonly slot: number | null; readonly body: Node }
	| { readonly t: "cat"; readonly items: readonly Node[] }
	| { readonly t: "alt"; readonly options: readonly Node[] }
	| { readonly t: "rep"; readonly body: Node; readonly min: number; readonly max: number; readonly greedy: boolean };

/** A class item: one character, or a whole set such as `\d`. */
type ClassItem = { readonly cp: number } | { readonly set: readonly number[] };

/** Raised while reading or compiling; caught at the top and returned as a {@link PatternFault}. */
class FaultSignal {
	constructor(readonly fault: PatternFault) {}
}

function invalid(message: string): FaultSignal {
	return new FaultSignal({ code: PATTERN_FAULT_CODES.INVALID, message });
}

function unsupported(message: string): FaultSignal {
	return new FaultSignal({ code: PATTERN_FAULT_CODES.UNSUPPORTED, message });
}

function tooLarge(message: string): FaultSignal {
	return new FaultSignal({ code: PATTERN_FAULT_CODES.TOO_LARGE, message });
}

const BACKSLASH = 0x5c;

/** Code point of a one-character string. */
function cp(ch: string): number {
	return ch.codePointAt(0)!;
}

/** Reads the pattern's code points into a {@link Node} tree, recursive descent, one pass. */
class PatternReader {
	private pos = 0;
	private depth = 0;
	groups = 0;

	constructor(private readonly src: readonly number[], private readonly keepGroups: boolean) {}

	read(): Node {
		const node = this.alternation();
		if (this.pos < this.src.length) {
			// alternation() stops only at "|" (which it consumes) or ")".
			throw invalid('the pattern has a ")" with no "(" to close');
		}
		return node;
	}

	private peek(offset = 0): number {
		const at = this.pos + offset;
		return at < this.src.length ? this.src[at] : -1;
	}

	private next(): number {
		return this.pos < this.src.length ? this.src[this.pos++] : -1;
	}

	private alternation(): Node {
		const options: Node[] = [this.sequence()];
		while (this.peek() === cp("|")) {
			this.pos++;
			options.push(this.sequence());
		}
		return options.length === 1 ? options[0] : { t: "alt", options };
	}

	private sequence(): Node {
		const items: Node[] = [];
		while (this.pos < this.src.length && this.peek() !== cp("|") && this.peek() !== cp(")")) {
			const atom = this.atom();
			items.push(this.quantified(atom));
		}
		if (items.length === 0) return { t: "empty" };
		return items.length === 1 ? items[0] : { t: "cat", items };
	}

	/**
	 * A `{n}`, `{n,}` or `{n,m}` quantifier starting at the current position, or
	 * null when the brace is not one (JavaScript then reads `{` as itself).
	 */
	private braceQuantifier(): { min: number; max: number; length: number } | null {
		let at = this.pos;
		if (this.src[at] !== cp("{")) return null;
		at++;
		const readInt = (): number | null => {
			const start = at;
			let value = 0;
			while (at < this.src.length && this.src[at] >= 0x30 && this.src[at] <= 0x39) {
				// Saturate rather than overflow: anything past the repeat limit is refused anyway.
				value = Math.min(value * 10 + (this.src[at] - 0x30), MAX_PATTERN_REPEAT + 1);
				at++;
			}
			return at === start ? null : value;
		};
		const min = readInt();
		if (min === null) return null;
		let max = min;
		if (this.src[at] === cp(",")) {
			at++;
			const upper = readInt();
			max = upper === null ? -1 : upper;
		}
		if (this.src[at] !== cp("}")) return null;
		at++;
		return { min, max, length: at - this.pos };
	}

	private startsQuantifier(): boolean {
		const c = this.peek();
		return c === cp("*") || c === cp("+") || c === cp("?") || (c === cp("{") && this.braceQuantifier() !== null);
	}

	private quantified(atom: Node): Node {
		if (!this.startsQuantifier()) return atom;
		if (atom.t === "assert") throw invalid("a quantifier has nothing to repeat: an anchor or a word boundary matches a position, not a character");
		let min: number;
		let max: number;
		const c = this.peek();
		if (c === cp("{")) {
			const brace = this.braceQuantifier()!;
			this.pos += brace.length;
			min = brace.min;
			max = brace.max;
			if (min > MAX_PATTERN_REPEAT || max > MAX_PATTERN_REPEAT) {
				throw tooLarge(`a repeat count in the pattern is past the limit of ${MAX_PATTERN_REPEAT}`);
			}
			if (max !== -1 && max < min) throw invalid(`the repeat {${min},${max}} has its numbers out of order`);
		} else {
			this.pos++;
			min = c === cp("+") ? 1 : 0;
			max = c === cp("?") ? 1 : -1;
		}
		let greedy = true;
		if (this.peek() === cp("?")) {
			this.pos++;
			greedy = false;
		}
		if (this.startsQuantifier()) throw invalid("a quantifier has nothing to repeat: two quantifiers cannot follow one another");
		return { t: "rep", body: atom, min, max, greedy };
	}

	private atom(): Node {
		const c = this.next();
		switch (c) {
			case cp("("):
				return this.group();
			case cp("["):
				return { t: "class", cls: this.characterClass() };
			case cp("."):
				return { t: "any" };
			case cp("^"):
				return { t: "assert", op: BOL };
			case cp("$"):
				return { t: "assert", op: EOL };
			case BACKSLASH:
				return this.escape();
			case cp("*"):
			case cp("+"):
			case cp("?"):
				throw invalid(`the quantifier "${String.fromCodePoint(c)}" has nothing to repeat`);
			case cp("{"):
				this.pos--;
				if (this.braceQuantifier() !== null) throw invalid("a repeat count has nothing to repeat");
				this.pos++;
				return { t: "char", cp: c };
			default:
				return { t: "char", cp: c };
		}
	}

	private group(): Node {
		if (++this.depth > MAX_PATTERN_NESTING) {
			throw tooLarge(`groups in the pattern nest more than ${MAX_PATTERN_NESTING} deep`);
		}
		let capturing = true;
		if (this.peek() === cp("?")) {
			const kind = this.peek(1);
			if (kind === cp(":")) {
				capturing = false;
				this.pos += 2;
			} else if (kind === cp("=") || kind === cp("!")) {
				throw unsupported("lookahead, (?=...) and (?!...), is not supported by this matcher, which keeps its time proportional to the text");
			} else if (kind === cp("<") && (this.peek(2) === cp("=") || this.peek(2) === cp("!"))) {
				throw unsupported("lookbehind, (?<=...) and (?<!...), is not supported by this matcher, which keeps its time proportional to the text");
			} else if (kind === cp("<")) {
				// A named group captures like any other; the name is read and set aside.
				this.pos += 2;
				const nameStart = this.pos;
				while (this.pos < this.src.length && this.src[this.pos] !== cp(">")) {
					const ch = this.src[this.pos];
					const isNameChar = (ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x5a) || ch === 0x5f || (ch >= 0x61 && ch <= 0x7a) || ch === 0x24;
					if (!isNameChar) throw invalid("a group name may use only letters, digits, _ and $");
					this.pos++;
				}
				if (this.pos >= this.src.length || this.pos === nameStart) throw invalid('a named group needs a name and a closing ">", as in (?<year>\\d{4})');
				this.pos++;
			} else {
				throw unsupported('only (?i) is supported as a flag, and only at the very start of the pattern');
			}
		}
		let slot: number | null = null;
		if (capturing) {
			this.groups++;
			if (this.groups > MAX_PATTERN_GROUPS) {
				throw tooLarge(`the pattern has more than ${MAX_PATTERN_GROUPS} capturing groups`);
			}
			slot = this.keepGroups ? this.groups : null;
		}
		const body = this.alternation();
		if (this.next() !== cp(")")) throw invalid('the pattern has a "(" that is never closed');
		this.depth--;
		return { t: "group", slot, body };
	}

	/** The character a `\x..` or `\u....` escape names, reading `digits` hexadecimal digits. */
	private hexEscape(digits: number, letter: string): number {
		let value = 0;
		for (let i = 0; i < digits; i++) {
			const h = this.next();
			const d = h >= 0x30 && h <= 0x39 ? h - 0x30 : h >= 0x41 && h <= 0x46 ? h - 0x37 : h >= 0x61 && h <= 0x66 ? h - 0x57 : -1;
			if (d < 0) throw invalid(`\\${letter} must be followed by ${digits} hexadecimal digits`);
			value = value * 16 + d;
		}
		return value;
	}

	/**
	 * The escapes both inside and outside a class. Returns a character, a set,
	 * or null when the letter is not one of these (the caller then decides).
	 */
	private commonEscape(e: number): ClassItem | null {
		switch (e) {
			case cp("d"): return { set: DIGIT_RANGES };
			case cp("D"): return { set: complement(DIGIT_RANGES) };
			case cp("w"): return { set: WORD_RANGES };
			case cp("W"): return { set: complement(WORD_RANGES) };
			case cp("s"): return { set: SPACE_RANGES };
			case cp("S"): return { set: complement(SPACE_RANGES) };
			case cp("t"): return { cp: 0x09 };
			case cp("n"): return { cp: 0x0a };
			case cp("r"): return { cp: 0x0d };
			case cp("f"): return { cp: 0x0c };
			case cp("v"): return { cp: 0x0b };
			case cp("x"): return { cp: this.hexEscape(2, "x") };
			case cp("u"): return { cp: this.hexEscape(4, "u") };
			case cp("0"):
				if (this.peek() >= 0x30 && this.peek() <= 0x39) throw unsupported("octal escapes such as \\012 are not supported: write \\x0A instead");
				return { cp: 0 };
			default:
				return null;
		}
	}

	/** An escape that is not one of {@link commonEscape}'s: refused when it is a letter or digit, itself otherwise. */
	private otherEscape(e: number): number {
		if (e === -1) throw invalid("the pattern ends with a backslash that escapes nothing");
		if (e >= 0x31 && e <= 0x39) {
			throw unsupported("a backreference such as \\1 is not supported: no matcher can promise to answer one in time proportional to the text, and this one makes that promise");
		}
		if (e === cp("p") || e === cp("P")) throw unsupported("Unicode property escapes such as \\p{L} are not supported");
		if (e === cp("k")) throw unsupported("a named backreference such as \\k<name> is not supported, for the same reason as \\1");
		const isLetterOrDigit = (e >= 0x30 && e <= 0x39) || (e >= 0x41 && e <= 0x5a) || (e >= 0x61 && e <= 0x7a);
		if (isLetterOrDigit) throw invalid(`\\${String.fromCodePoint(e)} is not an escape this pattern syntax knows`);
		return e;
	}

	private escape(): Node {
		const e = this.next();
		if (e === cp("b")) return { t: "assert", op: WORD_BOUNDARY };
		if (e === cp("B")) return { t: "assert", op: NOT_WORD_BOUNDARY };
		const common = this.commonEscape(e);
		if (common !== null) {
			return "cp" in common ? { t: "char", cp: common.cp } : { t: "class", cls: { ranges: common.set, negated: false } };
		}
		return { t: "char", cp: this.otherEscape(e) };
	}

	private classItem(): ClassItem {
		const c = this.next();
		if (c !== BACKSLASH) return { cp: c };
		const e = this.next();
		// Inside a class, \b is the backspace character, as in JavaScript.
		if (e === cp("b")) return { cp: 0x08 };
		if (e === cp("-")) return { cp: e };
		const common = this.commonEscape(e);
		if (common !== null) return common;
		return { cp: this.otherEscape(e) };
	}

	private characterClass(): CharClass {
		let negated = false;
		if (this.peek() === cp("^")) {
			negated = true;
			this.pos++;
		}
		const ranges: number[] = [];
		const add = (item: ClassItem): void => {
			if ("cp" in item) ranges.push(item.cp, item.cp);
			else ranges.push(...item.set);
		};
		for (;;) {
			if (this.pos >= this.src.length) throw invalid('the pattern has a "[" that is never closed');
			// "]" closes the class even straight after "[", so [] matches nothing
			// and [^] matches anything, which is JavaScript's reading.
			if (this.peek() === cp("]")) {
				this.pos++;
				break;
			}
			const first = this.classItem();
			const isRange = this.peek() === cp("-") && this.peek(1) !== cp("]") && this.peek(1) !== -1;
			if (!isRange) {
				add(first);
				continue;
			}
			this.pos++; // the "-"
			const last = this.classItem();
			if (!("cp" in first) || !("cp" in last)) {
				// A range with a set at either end, like [\d-z], is read the way
				// JavaScript reads it: the set, a literal hyphen, and the other end.
				add(first);
				ranges.push(cp("-"), cp("-"));
				add(last);
				continue;
			}
			if (first.cp > last.cp) {
				throw invalid(`the class range ${String.fromCodePoint(first.cp)}-${String.fromCodePoint(last.cp)} runs backwards`);
			}
			ranges.push(first.cp, last.cp);
		}
		return { ranges: normaliseRanges(ranges), negated };
	}
}

// ── Compiling ─────────────────────────────────────────────────────────────

/** The slots of the capturing groups inside a node, as a range of group numbers, or null when it has none. */
function capturedSlots(node: Node): { lo: number; hi: number } | null {
	let lo = Infinity;
	let hi = -Infinity;
	const visit = (n: Node): void => {
		switch (n.t) {
			case "group":
				if (n.slot !== null) {
					lo = Math.min(lo, n.slot);
					hi = Math.max(hi, n.slot);
				}
				visit(n.body);
				return;
			case "cat":
				n.items.forEach(visit);
				return;
			case "alt":
				n.options.forEach(visit);
				return;
			case "rep":
				visit(n.body);
				return;
			default:
				return;
		}
	};
	visit(node);
	return lo === Infinity ? null : { lo, hi };
}

/** Whether a node can match without consuming a character. */
function nullable(node: Node): boolean {
	switch (node.t) {
		case "empty":
		case "assert":
			return true;
		case "char":
		case "any":
		case "class":
			return false;
		case "group":
			return nullable(node.body);
		case "cat":
			return node.items.every(nullable);
		case "alt":
			return node.options.some(nullable);
		case "rep":
			return node.min === 0 || nullable(node.body);
	}
}

/** Whether an instruction consumes a character, and so carries the step it continues at in `b`. */
function consumes(op: number): boolean {
	return op === CHAR || op === ANY || op === CLASS;
}

class PatternCompiler {
	readonly op: number[] = [];
	readonly a: number[] = [];
	readonly b: number[] = [];
	readonly classes: CharClass[] = [];

	constructor(private readonly ignoreCase: boolean) {}

	emit(op: number, a = 0, b = 0): number {
		if (this.op.length >= MAX_PATTERN_PROGRAM) {
			throw tooLarge(`the pattern compiles to more than ${MAX_PATTERN_PROGRAM.toLocaleString("en-US")} steps; a large repeat count copies its body that many times`);
		}
		this.op.push(op);
		this.a.push(a);
		this.b.push(b);
		return this.op.length - 1;
	}

	/** Emit an instruction that consumes a character and continues at the next step. */
	private emitConsuming(op: number, a = 0): void {
		const pc = this.emit(op, a);
		this.b[pc] = pc + 1;
	}

	get here(): number {
		return this.op.length;
	}

	compile(node: Node): void {
		switch (node.t) {
			case "empty":
				return;
			case "char":
				this.emitConsuming(CHAR, this.ignoreCase ? canonical(node.cp) : node.cp);
				return;
			case "any":
				this.emitConsuming(ANY);
				return;
			case "class":
				this.classes.push(this.ignoreCase ? { ranges: caseWidened(node.cls.ranges), negated: node.cls.negated } : node.cls);
				this.emitConsuming(CLASS, this.classes.length - 1);
				return;
			case "assert":
				this.emit(node.op);
				return;
			case "group":
				if (node.slot === null) {
					this.compile(node.body);
					return;
				}
				this.emit(SAVE, 2 * node.slot);
				this.compile(node.body);
				this.emit(SAVE, 2 * node.slot + 1);
				return;
			case "cat":
				for (const item of node.items) this.compile(item);
				return;
			case "alt": {
				const exits: number[] = [];
				node.options.forEach((option, i) => {
					if (i === node.options.length - 1) {
						this.compile(option);
						return;
					}
					const split = this.emit(SPLIT);
					this.a[split] = this.here;
					this.compile(option);
					exits.push(this.emit(JMP));
					this.b[split] = this.here;
				});
				for (const jump of exits) this.a[jump] = this.here;
				return;
			}
			case "rep":
				this.repeat(node);
				return;
		}
	}

	/** One pass of a loop body: its groups cleared first, as JavaScript does on every iteration. */
	private pass(body: Node, slots: { lo: number; hi: number } | null): void {
		if (slots !== null) this.emit(CLEAR, 2 * slots.lo, 2 * slots.hi + 2);
		this.compile(body);
	}

	/**
	 * One optional pass of a loop whose body can match nothing, which must
	 * consume at least one character to count.
	 *
	 * JavaScript refuses an optional iteration that matched nothing, and goes on
	 * to the body's next alternative instead, so `(a|)*` never loops on nothing
	 * and `(\w*?)+` expands its lazy body rather than stopping. The rule depends
	 * on whether anything has been consumed since the pass began, and a thread in
	 * this matcher is only its step and its captures, so that fact has to live in
	 * the step: the body is compiled twice. The first copy is the pass before any
	 * character, and reaching its end is a dead end. Each instruction in it that
	 * consumes a character continues in the second copy, at the same point of the
	 * body, and the second copy's end is the end of the pass.
	 */
	private nonEmptyPass(body: Node, slots: { lo: number; hi: number } | null): void {
		if (slots !== null) this.emit(CLEAR, 2 * slots.lo, 2 * slots.hi + 2);
		const firstCopy = this.here;
		this.compile(body);
		const firstEnd = this.here;
		this.emit(FAIL);
		const offset = this.here - firstCopy;
		this.compile(body);
		// Shift each continuation into the second copy rather than setting it to
		// the next step there: a loop nested in the body has already pointed its
		// own first copy's continuations into its own second copy, and the shift
		// keeps that, landing in the matching place of this pass's second copy.
		for (let pc = firstCopy; pc < firstEnd; pc++) {
			if (consumes(this.op[pc])) this.b[pc] += offset;
		}
	}

	/** Point a loop's decision at its two continuations, the preferred one first. */
	private decide(split: number, again: number, stop: number, greedy: boolean): void {
		this.a[split] = greedy ? again : stop;
		this.b[split] = greedy ? stop : again;
	}

	private repeat(node: Extract<Node, { t: "rep" }>): void {
		const slots = capturedSlots(node.body);
		if (nullable(node.body)) {
			// The required passes may match nothing; every optional pass must not.
			for (let i = 0; i < node.min; i++) this.pass(node.body, slots);
			if (node.max === -1) {
				const split = this.emit(SPLIT);
				this.nonEmptyPass(node.body, slots);
				this.emit(JMP, split);
				this.decide(split, split + 1, this.here, node.greedy);
				return;
			}
			const splits: number[] = [];
			for (let i = node.min; i < node.max; i++) {
				splits.push(this.emit(SPLIT));
				this.nonEmptyPass(node.body, slots);
			}
			for (const split of splits) this.decide(split, split + 1, this.here, node.greedy);
			return;
		}

		const required = node.max === -1 ? Math.max(node.min - 1, 0) : node.min;
		for (let i = 0; i < required; i++) this.pass(node.body, slots);
		if (node.max === -1) {
			if (node.min >= 1) {
				// e+ : one more pass, then loop back while the preferred branch says so.
				const top = this.here;
				this.pass(node.body, slots);
				const split = this.emit(SPLIT);
				this.decide(split, top, this.here, node.greedy);
				return;
			}
			// e* : decide first, then run a pass and come back to decide again.
			const split = this.emit(SPLIT);
			this.pass(node.body, slots);
			this.emit(JMP, split);
			this.decide(split, split + 1, this.here, node.greedy);
			return;
		}
		// e{n,m} : the n required passes above, then m - n optional ones, each of
		// which may stop the loop. Every stop jumps to the same end.
		const splits: number[] = [];
		for (let i = node.min; i < node.max; i++) {
			splits.push(this.emit(SPLIT));
			this.pass(node.body, slots);
		}
		for (const split of splits) this.decide(split, split + 1, this.here, node.greedy);
	}
}

/**
 * Compile a pattern, or explain why it cannot be.
 *
 * A leading `(?i)` makes letters match regardless of case; no other flag is
 * read. Capturing groups are recorded only when `keepGroups` is set, since a
 * search that wants only where the match is gets there faster without them.
 *
 * @param source - The pattern as written.
 * @param keepGroups - Whether to record what each capturing group matched.
 * @returns The compiled program, or a {@link PatternFault}.
 */
export function compilePattern(source: string, keepGroups: boolean): CompiledPattern | PatternFault {
	let body = source;
	let ignoreCase = false;
	if (body.startsWith("(?i)")) {
		ignoreCase = true;
		body = body.slice(4);
	}
	const points = Array.from(body, (ch) => ch.codePointAt(0)!);
	if (points.length > MAX_PATTERN_LENGTH) {
		return { code: PATTERN_FAULT_CODES.TOO_LARGE, message: `the pattern is ${points.length.toLocaleString("en-US")} characters long, past the limit of ${MAX_PATTERN_LENGTH}` };
	}
	try {
		const reader = new PatternReader(points, keepGroups);
		const tree = reader.read();
		const compiler = new PatternCompiler(ignoreCase);
		compiler.emit(SAVE, 0);
		compiler.compile(tree);
		compiler.emit(SAVE, 1);
		compiler.emit(MATCH);
		return {
			op: Uint8Array.from(compiler.op),
			a: Int32Array.from(compiler.a),
			b: Int32Array.from(compiler.b),
			classes: compiler.classes,
			groupCount: keepGroups ? reader.groups : 0,
			ignoreCase,
		};
	} catch (signal) {
		if (signal instanceof FaultSignal) return signal.fault;
		throw signal;
	}
}

/** Whether a {@link compilePattern} result is a refusal. */
export function isPatternFault(result: CompiledPattern | PatternFault): result is PatternFault {
	return (result as PatternFault).code !== undefined;
}

// ── Running ───────────────────────────────────────────────────────────────

/**
 * Whether a class admits a character. Under `(?i)` the class has already been
 * widened to its members' canonical forms (see {@link caseWidened}), so the
 * test is on the character's canonical form, which is JavaScript's rule: a
 * character is in the class when some member shares its canonical form.
 */
function classAdmits(cls: CharClass, c: number, ignoreCase: boolean): boolean {
	return inRanges(cls.ranges, ignoreCase ? canonical(c) : c) !== cls.negated;
}

/**
 * Runs one compiled pattern over one text, as many searches as the caller
 * asks for. The thread lists are allocated once and reused by every search,
 * so counting ten thousand matches does not allocate ten thousand lists.
 */
export class PatternRunner {
	private readonly slotCount: number;
	private readonly unset: Int32Array;
	private readonly copyCost: number;
	private currentPcs: Int32Array;
	private currentCaps: Int32Array[];
	private currentCount = 0;
	private nextPcs: Int32Array;
	private nextCaps: Int32Array[];
	private nextCount = 0;
	private readonly visited: Int32Array;
	private generation = 0;
	private readonly stackPcs: number[] = [];
	private readonly stackCaps: Int32Array[] = [];

	/**
	 * @param pattern - A compiled pattern.
	 * @param text - The text every search reads.
	 * @param budget - The step budget every search spends from.
	 */
	constructor(private readonly pattern: CompiledPattern, private readonly text: string, private readonly budget: PatternBudget) {
		const size = pattern.op.length;
		this.slotCount = 2 * (pattern.groupCount + 1);
		this.unset = new Int32Array(this.slotCount).fill(-1);
		// A SAVE or CLEAR copies the slots, so it costs more than a jump, in
		// proportion to how many there are: measured, a pattern with 32 groups
		// took three times as long per step as one with none until this was
		// weighted.
		this.copyCost = 1 + (this.slotCount >> 2);
		this.currentPcs = new Int32Array(size);
		this.currentCaps = new Array(size);
		this.nextPcs = new Int32Array(size);
		this.nextCaps = new Array(size);
		this.visited = new Int32Array(size).fill(-1);
	}

	/**
	 * Follow every step from `pc0` that consumes no character, in priority
	 * order, and queue each step reached that does consume one (or that ends
	 * the match) onto the current or the next list.
	 */
	private addThread(toNext: boolean, pc0: number, caps0: Int32Array, pos: number): void {
		const { op, a, b } = this.pattern;
		const { stackPcs, stackCaps, visited, text, budget } = this;
		const generation = this.generation;
		stackPcs.push(pc0);
		stackCaps.push(caps0);
		while (stackPcs.length > 0) {
			const pc = stackPcs.pop()!;
			const caps = stackCaps.pop()!;
			if (visited[pc] === generation) continue;
			visited[pc] = generation;
			budget.spend(1);
			switch (op[pc]) {
				case JMP:
					stackPcs.push(a[pc]);
					stackCaps.push(caps);
					break;
				case SPLIT:
					// The second branch goes on the stack first so the first is explored first.
					stackPcs.push(b[pc]);
					stackCaps.push(caps);
					stackPcs.push(a[pc]);
					stackCaps.push(caps);
					break;
				case SAVE: {
					budget.spend(this.copyCost);
					const copy = caps.slice();
					copy[a[pc]] = pos;
					stackPcs.push(pc + 1);
					stackCaps.push(copy);
					break;
				}
				case CLEAR: {
					budget.spend(this.copyCost);
					const copy = caps.slice();
					copy.fill(-1, a[pc], b[pc]);
					stackPcs.push(pc + 1);
					stackCaps.push(copy);
					break;
				}
				case BOL:
					if (pos === 0) {
						stackPcs.push(pc + 1);
						stackCaps.push(caps);
					}
					break;
				case EOL:
					if (pos === text.length) {
						stackPcs.push(pc + 1);
						stackCaps.push(caps);
					}
					break;
				case WORD_BOUNDARY:
				case NOT_WORD_BOUNDARY: {
					const before = pos > 0 && isWordUnit(text.charCodeAt(pos - 1));
					const after = pos < text.length && isWordUnit(text.charCodeAt(pos));
					if ((before !== after) === (op[pc] === WORD_BOUNDARY)) {
						stackPcs.push(pc + 1);
						stackCaps.push(caps);
					}
					break;
				}
				case FAIL:
					break;
				default:
					if (toNext) {
						this.nextPcs[this.nextCount] = pc;
						this.nextCaps[this.nextCount++] = caps;
					} else {
						this.currentPcs[this.currentCount] = pc;
						this.currentCaps[this.currentCount++] = caps;
					}
			}
		}
	}

	/**
	 * The leftmost-first match starting at or after `from`, as capture slots:
	 * `[start, end]` for the whole match and a pair per group, `-1` for a group
	 * that took no part. Null when there is no match.
	 *
	 * Every live way of matching advances one character at a time, in priority
	 * order. A new attempt starts at each position, below every attempt already
	 * running, until one of them reaches the end of the pattern. That one beats
	 * every attempt below it, and the attempts above it run on in case they
	 * finish too, since they are preferred. This is what makes the answer the
	 * one a backtracking matcher would give.
	 *
	 * @throws PatternBudgetExceeded when the budget runs out.
	 */
	search(from: number): Int32Array | null {
		const { op, a, b, classes, ignoreCase } = this.pattern;
		const { text, budget } = this;
		const length = text.length;
		let matched: Int32Array | null = null;

		this.generation++;
		this.currentCount = 0;
		this.addThread(false, 0, this.unset, from);
		let pos = from;
		for (;;) {
			this.generation++;
			this.nextCount = 0;
			const c = pos < length ? text.codePointAt(pos)! : -1;
			const width = c > 0xffff ? 2 : 1;
			const folded = ignoreCase && c !== -1 ? canonical(c) : c;
			for (let i = 0; i < this.currentCount; i++) {
				const pc = this.currentPcs[i];
				budget.spend(1);
				let advance = false;
				switch (op[pc]) {
					case MATCH:
						matched = this.currentCaps[i];
						// Every attempt below this one is less preferred, so it is dropped.
						i = this.currentCount;
						continue;
					case CHAR:
						advance = c !== -1 && folded === a[pc];
						break;
					case ANY:
						advance = c !== -1 && !isLineTerminator(c);
						break;
					case CLASS:
						advance = c !== -1 && classAdmits(classes[a[pc]], c, ignoreCase);
						break;
				}
				if (advance) this.addThread(true, b[pc], this.currentCaps[i], pos + width);
			}
			if (pos >= length) break;
			if (matched === null) this.addThread(true, 0, this.unset, pos + width);
			if (this.nextCount === 0 && matched !== null) break;
			const pcs = this.currentPcs;
			this.currentPcs = this.nextPcs;
			this.nextPcs = pcs;
			const caps = this.currentCaps;
			this.currentCaps = this.nextCaps;
			this.nextCaps = caps;
			this.currentCount = this.nextCount;
			pos += width;
		}
		return matched;
	}

	/**
	 * Every non-overlapping match, leftmost first, handed to `each` as capture
	 * slots. After a match that is empty the next search starts one character
	 * later, so a pattern that can match nothing still finishes. Stops early
	 * when `each` returns false.
	 *
	 * @throws PatternBudgetExceeded when the budget runs out.
	 */
	each(each: (slots: Int32Array) => boolean): void {
		const { text } = this;
		let from = 0;
		while (from <= text.length) {
			const slots = this.search(from);
			if (slots === null) return;
			if (!each(slots)) return;
			if (slots[1] > slots[0]) {
				from = slots[1];
			} else {
				const c = text.codePointAt(slots[1]);
				from = slots[1] + (c !== undefined && c > 0xffff ? 2 : 1);
			}
		}
	}
}
