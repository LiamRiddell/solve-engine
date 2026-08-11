/**
 * Random expressions built from the real grammar.
 *
 * Two things distinguish this from throwing characters at the parser. It draws
 * its words from {@link Vocabulary}, which reads them out of the engine, so a
 * package added next month is fuzzed on the next run with no edit here. And it
 * generates by shape rather than by concatenation: a production knows it is
 * building a conversion, so it emits something a conversion parselet will
 * actually accept, and the interesting failures happen deeper in the pipeline
 * than "the parser refused it on token two".
 *
 * Purely random text still has value, so a fraction of every run is exactly
 * that. Both matter: a valid-shaped expression finds bugs in evaluation, and a
 * malformed one finds bugs in error handling.
 *
 * @module ExpressionFuzzer
 */

import { Prng } from "@tools/fuzz/Prng";
import { wordsOf, type Vocabulary } from "@tools/fuzz/Vocabulary";
import type { ExpressionCase } from "@tools/fuzz/FuzzCase";

/** Knobs the two run modes differ on. */
export interface ExpressionFuzzOptions {
	/**
	 * How deeply productions may nest.
	 *
	 * The engine refuses past `validation.maxNestingDepth` (50), and a case that
	 * is refused at the safety gate never reaches the parser, so generating
	 * mostly-too-deep expressions wastes a run. The default sits well under it,
	 * and the deliberate depth-bomb production reaches past it on purpose.
	 */
	maxDepth?: number;
	/**
	 * Ceiling on generated length, in characters.
	 *
	 * `validation.maxExpressionLength` is 2000. Same reasoning as the depth
	 * bound: the default stays under it and one production deliberately exceeds
	 * it, so both sides of the gate get exercised.
	 */
	maxLength?: number;
}

/** Characters that are not part of any production, for the noise generator. */
const NOISE_CHARACTERS =
	"()[]{}<>+-*/^%$#@!?:;,.'\"`~|&\\= \t0123456789abcxyzABCXYZ°µ×÷≠∞∑";

/** Scripts that exist to break assumptions about what a character is. */
const AWKWARD_STRINGS: readonly string[] = [
	"\u0000", "�", "\uD800", "\uDFFF", "​", "‮", "﻿",
	"́", "\u{1F4A9}", "あ", "א", "ا",
	"é", "\r", "\n", "\t\t",
];

/** Magnitude suffixes the lexer reads after a number. */
const MAGNITUDE_SUFFIXES: readonly string[] = ["K", "k", "M", "B", "T"];

/** Date literal shapes the engine parses, one template per supported format. */
const DATE_TEMPLATES: readonly string[] = [
	"D/M/Y", "M-D-Y", "Y-M-D", "D.M.Y",
];

/**
 * A generator's state while it builds one expression.
 *
 * Depth and the running length are carried rather than passed, because every
 * production needs both and threading two extra parameters through twenty
 * functions obscures what each one is actually doing.
 */
class Builder {
	depth = 0;
	/**
	 * Characters emitted by leaf productions so far.
	 *
	 * Counted at the leaves rather than by measuring the finished string,
	 * because the budget has to be readable DURING generation: a production
	 * that has already spent it should stop recursing rather than be discovered
	 * over budget once it has returned. Operators and brackets are not counted,
	 * which makes this an underestimate, and an underestimate is the safe
	 * direction: it produces expressions a little longer than asked for rather
	 * than cutting them off early.
	 */
	produced = 0;

	constructor(
		readonly rng: Prng,
		readonly vocabulary: Vocabulary,
		readonly maxDepth: number,
		readonly maxLength: number,
	) {}

	/** Whether another production would push the expression past its budget. */
	get exhausted(): boolean {
		return this.depth >= this.maxDepth || this.produced >= this.maxLength;
	}

	/** Record a leaf's contribution and hand it back, so call sites stay one-liners. */
	spend(text: string): string {
		this.produced += text.length;
		return text;
	}
}

/** A number literal in one of the spellings the lexer accepts. */
function numberLiteral(builder: Builder): string {
	const rng = builder.rng;
	switch (rng.int(12)) {
		case 0: return String(rng.range(0, 9));
		case 1: return String(rng.range(-1000000, 1000000));
		case 2: return (rng.float() * 1000).toFixed(rng.int(12));
		case 3: return `0x${rng.nextUint32().toString(16)}`;
		case 4: return `0b${(rng.nextUint32() % 65536).toString(2)}`;
		case 5: return `${rng.range(1, 999)}e${rng.range(-320, 320)}`;
		case 6: return `${rng.range(1, 999)},${String(rng.range(0, 999)).padStart(3, "0")}`;
		case 7: return `${rng.range(1, 999)}${rng.pick(MAGNITUDE_SUFFIXES)}`;
		case 8: return `${rng.range(0, 1000000)}n`;
		case 9: return `${rng.range(0, 1000)}%`;
		case 10: return String(rng.awkwardNumber());
		default: return String(rng.range(1, 100));
	}
}

/** A quantity with a unit, a currency, or a rate. */
function unitLiteral(builder: Builder): string {
	const rng = builder.rng;
	const { units, currencyUnits } = builder.vocabulary;
	if (currencyUnits.length > 0 && rng.chance(0.3)) {
		const amount = numberLiteral(builder);
		if (rng.chance(0.4)) return `$${amount}`;
		return `${amount} ${rng.pick(currencyUnits)}`;
	}
	if (units.length === 0) return numberLiteral(builder);
	const unit = rng.pick(units);
	// A rate is a unit over a unit, which is its own opcode band and its own
	// class of unify-the-denominators arithmetic.
	if (rng.chance(0.15)) return `${numberLiteral(builder)} ${unit}/${rng.pick(units)}`;
	return `${numberLiteral(builder)}${rng.chance(0.5) ? " " : ""}${unit}`;
}

/** A date, clock time or timecode literal. */
function temporalLiteral(builder: Builder): string {
	const rng = builder.rng;
	switch (rng.int(6)) {
		case 0: {
			const template = rng.pick(DATE_TEMPLATES);
			const separator = template.includes("/") ? "/" : template.includes(".") ? "." : "-";
			const day = String(rng.range(1, 31));
			const month = String(rng.range(1, 13));
			const year = String(rng.range(1900, 2100));
			const order = template.replace(/[^DMY]/g, "").split("");
			return order.map((slot) => (slot === "D" ? day : slot === "M" ? month : year)).join(separator);
		}
		case 1: return `${rng.range(0, 24)}:${String(rng.range(0, 60)).padStart(2, "0")}`;
		case 2: return `${rng.range(0, 13)}${rng.pick(["am", "pm", "AM", "PM"])}`;
		case 3: return `${rng.range(0, 99)}:${rng.range(0, 99)}:${rng.range(0, 99)}:${rng.range(0, 99)}`;
		case 4: {
			const weekdays = wordsOf(builder.vocabulary, "MONDAY").concat(
				wordsOf(builder.vocabulary, "FRIDAY"),
				wordsOf(builder.vocabulary, "SUNDAY"),
			);
			const modifier = rng.pick([...wordsOf(builder.vocabulary, "NEXT"), ...wordsOf(builder.vocabulary, "LAST"), ""]);
			const day = weekdays.length > 0 ? rng.pick(weekdays) : "monday";
			return `${modifier} ${day}`.trim();
		}
		default: {
			const nowWords = [
				...wordsOf(builder.vocabulary, "NOW"),
				...wordsOf(builder.vocabulary, "TODAY"),
				...wordsOf(builder.vocabulary, "TOMORROW"),
				...wordsOf(builder.vocabulary, "YESTERDAY"),
			];
			return nowWords.length > 0 ? rng.pick(nowWords) : "now";
		}
	}
}

/** A bare identifier, which the engine reads as a variable name. */
function identifier(builder: Builder): string {
	const rng = builder.rng;
	const alphabet = "abcdefghijklmnopqrstuvwxyz";
	const length = rng.range(1, 6);
	let name = "";
	for (let i = 0; i < length; i++) name += alphabet[rng.int(alphabet.length)];
	return name;
}

/** A string literal, sometimes containing something that is not text. */
function stringLiteral(builder: Builder): string {
	const rng = builder.rng;
	if (rng.chance(0.3)) return `"${rng.pick(AWKWARD_STRINGS)}"`;
	return `"${identifier(builder)}"`;
}

/** A matrix or vector literal, whose size is bounded so most cases still evaluate. */
function matrixLiteral(builder: Builder): string {
	const rng = builder.rng;
	const rows = rng.range(1, 4);
	const cols = rng.range(1, 4);
	const cells: string[] = [];
	for (let r = 0; r < rows; r++) {
		const row: string[] = [];
		for (let c = 0; c < cols; c++) row.push(numberLiteral(builder));
		cells.push(row.join(","));
	}
	return `[${cells.join(";")}]`;
}

/** A range, sometimes an enormous one, since an unbounded expansion is what started all this. */
function rangeLiteral(builder: Builder): string {
	const rng = builder.rng;
	if (rng.chance(0.25)) return `${rng.range(0, 10)}:${rng.pick([1e6, 1e9, 2 ** 31, Number.MAX_SAFE_INTEGER])}`;
	return `${rng.range(-100, 100)}:${rng.range(-100, 200)}`;
}

/** An atom: something with no sub-expression inside it. */
function atom(builder: Builder): string {
	return builder.spend(atomText(builder));
}

/** The atom itself, before it is charged against the budget. */
function atomText(builder: Builder): string {
	const rng = builder.rng;
	switch (rng.int(10)) {
		case 0: return unitLiteral(builder);
		case 1: return temporalLiteral(builder);
		case 2: return identifier(builder);
		case 3: return stringLiteral(builder);
		case 4: return matrixLiteral(builder);
		case 5: return rangeLiteral(builder);
		case 6: {
			const booleans = [...wordsOf(builder.vocabulary, "TRUE"), ...wordsOf(builder.vocabulary, "FALSE")];
			return booleans.length > 0 ? rng.pick(booleans) : "true";
		}
		case 7: {
			const constants = [...wordsOf(builder.vocabulary, "PI"), ...wordsOf(builder.vocabulary, "E")];
			return constants.length > 0 ? rng.pick(constants) : "pi";
		}
		case 8: return `${rng.range(1, 20)}d${rng.range(1, 200)}`;
		default: return numberLiteral(builder);
	}
}

/**
 * Any expression, recursively.
 *
 * The weights are deliberate rather than uniform. Half the draws are atoms,
 * which keeps the average case small enough that a soak run gets through
 * millions of them, and keeps a shrunk reproducer short. The rest spread over
 * every grammar the engine has, in rough proportion to how much machinery sits
 * behind each one.
 */
function expression(builder: Builder): string {
	if (builder.exhausted) return atom(builder);
	builder.depth++;
	try {
		const rng = builder.rng;
		const vocabulary = builder.vocabulary;
		switch (rng.int(22)) {
			// Binary operator, as a symbol or as the word for the same thing.
			case 0:
			case 1:
			case 2: {
				const symbolic = ["+", "-", "*", "/", "%", "^", "&", "|", "<<", ">>", "==", "!=", "<", ">", "<=", ">="];
				const wordForms = [
					...wordsOf(vocabulary, "PLUS"), ...wordsOf(vocabulary, "MINUS"),
					...wordsOf(vocabulary, "STAR"), ...wordsOf(vocabulary, "SLASH"),
					...wordsOf(vocabulary, "MOD"), ...wordsOf(vocabulary, "CARET"),
					...wordsOf(vocabulary, "BIT_XOR"), ...wordsOf(vocabulary, "AND_CONJ"),
				];
				const pool = rng.chance(0.5) || wordForms.length === 0 ? symbolic : wordForms;
				return `${expression(builder)} ${rng.pick(pool)} ${expression(builder)}`;
			}
			// A fused phrase used as the operator, which is a different code path
			// from the single-token operators above.
			case 3: {
				if (vocabulary.phrases.length === 0) return atom(builder);
				return `${expression(builder)} ${rng.pick(vocabulary.phrases)} ${expression(builder)}`;
			}
			case 4: return `(${expression(builder)})`;
			case 5: return `${rng.pick(["-", "+", "~", "!"])}${expression(builder)}`;
			// Function call, with an argument count that is sometimes wrong.
			case 6: {
				if (vocabulary.functionNames.length === 0) return atom(builder);
				const args: string[] = [];
				const count = rng.range(0, 3);
				for (let i = 0; i < count; i++) args.push(expression(builder));
				return `${rng.pick(vocabulary.functionNames)}(${args.join(", ")})`;
			}
			// Conversion, in each of its spellings.
			case 7: {
				if (vocabulary.units.length === 0) return atom(builder);
				const keyword = rng.pick([
					...wordsOf(vocabulary, "TO"), ...wordsOf(vocabulary, "IN"), ...wordsOf(vocabulary, "BEST"),
				].filter(Boolean).concat(["to"]));
				const target = rng.chance(0.1) ? "?" : rng.pick(vocabulary.units);
				const convert = wordsOf(vocabulary, "CONVERT");
				const prefix = convert.length > 0 && rng.chance(0.3) ? `${rng.pick(convert)} ` : "";
				return `${prefix}${expression(builder)} ${keyword} ${target}`;
			}
			// The "as <converter>" mechanism.
			case 8: {
				const names = wordsOf(vocabulary, "CONVERTER_NAME");
				const asWord = wordsOf(vocabulary, "AS");
				if (names.length === 0 || asWord.length === 0) return atom(builder);
				return `${expression(builder)} ${rng.pick(asWord)} ${rng.pick(names)}`;
			}
			// Percentage grammars, which have their own parselets rather than
			// reusing the arithmetic ones.
			case 9: {
				const of = wordsOf(vocabulary, "OF");
				const increase = wordsOf(vocabulary, "INCREASE");
				const decrease = wordsOf(vocabulary, "DECREASE");
				const choice = rng.int(3);
				if (choice === 0 && of.length > 0) return `${rng.range(0, 200)}% ${rng.pick(of)} ${expression(builder)}`;
				if (choice === 1 && increase.length > 0) return `${rng.pick(increase)} ${expression(builder)} by ${rng.range(0, 100)}%`;
				if (decrease.length > 0) return `${rng.pick(decrease)} ${expression(builder)} by ${rng.range(0, 100)}%`;
				return atom(builder);
			}
			// Matrix indexing and slicing.
			case 10: {
				const target = rng.chance(0.6) ? matrixLiteral(builder) : expression(builder);
				switch (rng.int(3)) {
					case 0: return `${target}[${expression(builder)}]`;
					case 1: return `${target}[${expression(builder)}, ${expression(builder)}]`;
					default: return `${target}[${rangeLiteral(builder)}, ${rangeLiteral(builder)}]`;
				}
			}
			// map and reduce, which expand a collection inside a single opcode.
			case 11: {
				const verb = rng.pick(["map", "reduce", "sum", "prod"]);
				return `${verb}(${expression(builder)}, ${rng.chance(0.5) ? matrixLiteral(builder) : rangeLiteral(builder)})`;
			}
			// A user-defined function, defined and called on the same line, which
			// is the shape that reaches DEFINE_USER_FUNCTION and CALL_USER_FUNCTION.
			case 12: {
				const name = identifier(builder);
				const parameter = identifier(builder);
				return `${name}(${parameter}) = ${expression(builder)}`;
			}
			// Conditionals.
			case 13: {
				const ifWord = wordsOf(vocabulary, "IF");
				const thenWord = wordsOf(vocabulary, "THEN");
				const elseWord = wordsOf(vocabulary, "ELSE");
				if (ifWord.length === 0 || thenWord.length === 0 || elseWord.length === 0) return atom(builder);
				return `${rng.pick(ifWord)} ${expression(builder)} ${rng.pick(thenWord)} ${expression(builder)} ${rng.pick(elseWord)} ${expression(builder)}`;
			}
			// Variable assignment, local and global.
			case 14: {
				const global = wordsOf(vocabulary, "GLOBAL");
				const prefix = global.length > 0 && rng.chance(0.3) ? `${rng.pick(global)} ` : "";
				return `${prefix}:${identifier(builder)} = ${expression(builder)}`;
			}
			// Date arithmetic and the between/from/until phrase grammars.
			case 15: {
				const connector = rng.pick([
					...wordsOf(vocabulary, "BETWEEN"), ...wordsOf(vocabulary, "FROM"),
					...wordsOf(vocabulary, "UNTIL"), ...wordsOf(vocabulary, "SINCE"),
				].concat(["between"]));
				return `${connector} ${temporalLiteral(builder)} and ${temporalLiteral(builder)}`;
			}
			// Symbolic algebra: an equation, a derivative, a solve arrow.
			case 16: {
				switch (rng.int(4)) {
					case 0: return `${expression(builder)} = ${expression(builder)}`;
					case 1: return `der(${expression(builder)}, x)`;
					case 2: return `${expression(builder)} => ${identifier(builder)}`;
					default: return `x^${rng.range(0, 6)} ${rng.pick(["+", "-"])} ${rng.range(0, 50)} = 0`;
				}
			}
			// A word of a token type nothing above names explicitly. This is the
			// production that keeps the fuzzer current: a package registering a
			// new keyword is reached by this arm without any edit here.
			case 17: {
				const tokenTypes = [...vocabulary.wordsByTokenType.keys()];
				if (tokenTypes.length === 0) return atom(builder);
				const words = wordsOf(vocabulary, rng.pick(tokenTypes));
				if (words.length === 0) return atom(builder);
				return `${expression(builder)} ${rng.pick(words)} ${expression(builder)}`;
			}
			// A multi-character operator any package registered.
			case 18: {
				if (vocabulary.operators.length === 0) return atom(builder);
				return `${expression(builder)} ${rng.pick(vocabulary.operators)} ${expression(builder)}`;
			}
			// A long flat chain, which is what finds a quadratic in the parser or
			// the normaliser rather than a wrong answer.
			case 19: {
				const terms: string[] = [];
				const count = rng.range(4, 40);
				for (let i = 0; i < count && !builder.exhausted; i++) terms.push(atom(builder));
				if (terms.length === 0) terms.push(atom(builder));
				return terms.join(` ${rng.pick(["+", "-", "*", "/", "^", "to", "of", ","])} `);
			}
			// Deep nesting, aimed straight at the nesting-depth gate and at any
			// recursive descent that does not respect it.
			case 20: {
				const depth = rng.range(2, 80);
				const open = rng.pick(["(", "[", "-", "!"]);
				const close = open === "(" ? ")" : open === "[" ? "]" : "";
				builder.produced += depth * 2;
				return open.repeat(depth) + atom(builder) + close.repeat(depth);
			}
			default: return atom(builder);
		}
	} finally {
		builder.depth--;
	}
}

/** A string of characters with no grammar behind it at all. */
function noise(rng: Prng, maxLength: number): string {
	const length = rng.range(1, Math.min(200, maxLength));
	let text = "";
	for (let i = 0; i < length; i++) {
		text += rng.chance(0.08) ? rng.pick(AWKWARD_STRINGS) : NOISE_CHARACTERS[rng.int(NOISE_CHARACTERS.length)];
	}
	return text;
}

/**
 * One generated expression case.
 *
 * @param seed - The seed. The same seed always produces the same expression, on
 * any machine, which is what a corpus entry's provenance depends on.
 * @param vocabulary - The vocabulary read off a live engine.
 * @param options - Depth and length bounds.
 * @returns The case, ready to run.
 */
export function generateExpressionCase(
	seed: number,
	vocabulary: Vocabulary,
	options: ExpressionFuzzOptions = {},
): ExpressionCase {
	const rng = new Prng(seed);
	const maxDepth = options.maxDepth ?? 8;
	const maxLength = options.maxLength ?? 400;

	// A tenth of the run is pure noise, and a twentieth is a grammatical
	// expression with noise spliced into it. The second is the more productive
	// of the two: it gets past the prose gate and the safety checks that reject
	// pure garbage on sight, then fails somewhere further in.
	if (rng.chance(0.1)) return { kind: "expression", source: noise(rng, maxLength) };

	const builder = new Builder(rng, vocabulary, maxDepth, maxLength);
	let source = expression(builder);

	if (rng.chance(0.05)) {
		const cut = rng.int(source.length + 1);
		source = source.slice(0, cut) + noise(rng, 20) + source.slice(cut);
	}
	// Occasionally exceed the length gate on purpose, so the refusal path runs.
	if (rng.chance(0.02)) source = source.repeat(Math.ceil(2100 / Math.max(1, source.length)));

	return { kind: "expression", source };
}

/**
 * A batch of expressions, used as the mutation fuzzer's seed material.
 *
 * The bytecode fuzzer mutates real compiled programs, and "real" has to come
 * from somewhere. Generating that somewhere with this function rather than
 * hard-coding a list keeps the mutation pool as current as the rest of it.
 *
 * @param seed - Starting seed. Each expression uses a distinct derived seed.
 * @param count - How many to produce.
 * @param vocabulary - The vocabulary read off a live engine.
 * @returns The generated sources.
 */
export function generateSeedExpressions(seed: number, count: number, vocabulary: Vocabulary): string[] {
	const sources: string[] = [];
	for (let i = 0; i < count; i++) {
		sources.push(generateExpressionCase(seed + i * 7919, vocabulary, { maxDepth: 5, maxLength: 120 }).source);
	}
	return sources;
}
