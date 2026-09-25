import type { Token } from "@solve-js/lexer/Token";
import { TokenTypes } from "@solve-js/lexer/Token";
import type { Value } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { getLocale } from "@solve-js/constants/locales";
import type { Explanation, ExplanationStep, ExplainCall } from "./Explanation";
import type { DateReading } from "@solve-js/packages/datetime/DateReading";
import type { ValueSource } from "@solve-js/vm/Provenance";

/**
 * An instant as a reader-facing UTC stamp, `2026-09-23 16:02 UTC`.
 *
 * UTC rather than the reader's zone so a derivation reads the same wherever it
 * is produced; a host that wants local time has the epoch value on the
 * answer's `sources` and `frozen` fields to format itself.
 */
function utcStamp(epochMs: number): string {
	const iso = new Date(epochMs).toISOString();
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** One provenance record as a derivation step's sentence. */
function describeSource(source: ValueSource): string {
	const what = source.subject !== undefined ? `${source.subject} from ${source.provider}` : `From ${source.provider}`;
	const how = source.kind === "live"
		? "live"
		: source.kind === "primed"
			? "supplied by the host"
			: `the figure for ${source.asOf ?? "a past day"}`;
	const frozen = source.frozenAt !== undefined ? `, frozen ${utcStamp(source.frozenAt)}` : "";
	return `${what} (${how}), fetched ${utcStamp(source.fetchedAt)}${frozen}`;
}

/**
 * The steps that say where an answer's live figures came from, and whether it
 * is frozen. Each carries the line's own answer, because a source is a fact
 * about the answer rather than an intermediate value of its own, the same shape
 * a date reading's note takes.
 */
function provenanceSteps(result: Value): ExplanationStep[] {
	const steps: ExplanationStep[] = [];
	if (result.frozen !== undefined) {
		steps.push({ description: `Frozen ${utcStamp(result.frozen.at)}: this answer is kept, not fetched again`, value: result });
	}
	for (const source of result.sources ?? []) steps.push({ description: describeSource(source), value: result });
	return steps;
}

/**
 * A span's value, with every call the engine made while working it out, in
 * the order it made them.
 */
export interface ObservedSpan {
	/** The span's value, the same object evaluation returned. */
	readonly value: Value;
	/** The calls made on the way, innermost first (arguments run before the call that takes them). */
	readonly calls: readonly ExplainCall[];
}

/**
 * Evaluate a standalone sub-expression and return its value, with the calls it made.
 *
 * Supplied by the engine so the explainer reuses real evaluation rather than
 * re-deriving arithmetic: every value in a derivation is the value the engine
 * itself would compute for that piece of the line. It must be side-effect-free
 * with respect to document state (it is only ever handed self-contained
 * sub-expressions of the line being explained).
 */
export type EvaluateSpan = (source: string) => ObservedSpan;

/**
 * Ask the registered packages to describe one call, as `explainLine` does:
 * the steps from its arguments to its result, or `undefined` when no package
 * describes it. See `IEnginePackage.explain`.
 */
export type DescribeCall = (call: ExplainCall) => readonly ExplanationStep[] | undefined;

/**
 * Binding powers for the operators the derivation understands, mirrored from
 * the engine's own parser (`parser/BindingPower.ts` and the built-in infix
 * table) so that node boundaries match how the line actually evaluates. A
 * mismatch here would not produce wrong values (each node is re-evaluated
 * through the engine), but it would group the steps in a way that misleads,
 * which is the one thing a derivation must not do.
 */
const SUM = 30;
const PRODUCT = 40;
const EXPONENT = 50;
/**
 * `on`/`off` bind on their left as tightly as the `%` before them (the
 * engine's `Postfix` level), so the rate is that percentage alone: "5 + 20% off
 * 100" is "5 + (20% off 100)" (#635).
 */
const ON_OFF = 70;
/**
 * And they read their base below arithmetic (the engine's `Conditional` level),
 * so the base is the whole arithmetic expression after the phrase: "20% off 80
 * + 20" is "20% off (80 + 20)", and a chain groups to the right.
 */
const ON_OFF_BASE = 24;

/** Left binding power of an infix operator, or 0 when it is not one we derive. */
function infixBindingPower(type: string): number {
	switch (type) {
		case TokenTypes.PLUS:
		case TokenTypes.MINUS:
			return SUM;
		case TokenTypes.STAR:
		case TokenTypes.SLASH:
		case TokenTypes.MOD:
		case TokenTypes.OF:
			return PRODUCT;
		case TokenTypes.CARET:
			return EXPONENT;
		case TokenTypes.PCT_ON:
		case TokenTypes.PCT_OFF:
			return ON_OFF;
		default:
			return 0;
	}
}

/** The connective word shown between the two operands of a step. */
function connective(type: string): string {
	switch (type) {
		case TokenTypes.PLUS:
			return "plus";
		case TokenTypes.MINUS:
			return "minus";
		case TokenTypes.STAR:
			return "times";
		case TokenTypes.SLASH:
			return "divided by";
		case TokenTypes.MOD:
			return "mod";
		case TokenTypes.CARET:
			return "to the power of";
		case TokenTypes.OF:
			return "of";
		case TokenTypes.PCT_ON:
			return "plus";
		case TokenTypes.PCT_OFF:
			return "less";
		default:
			return type.toLowerCase();
	}
}

// A parse node. `leaf` is a run of operand tokens (a number, "$80", "5 km",
// "20%") shown by its source text. `binary` is an operation that becomes one
// step. `wrap` is a parenthesised group or a signed group: a group adds no step
// of its own, a minus in front of one adds "the negative of", and either is
// shown by its computed value when it stands as an operand. `call`
// is a function call, `sqrt(16)`: its arguments are derived first, then the
// package that owns the function describes the call itself, and it is shown by
// its computed value when it stands as an operand.
type Node =
	| { kind: "leaf"; start: number; end: number }
	| { kind: "binary"; op: string; left: Node; right: Node; start: number; end: number }
	| { kind: "wrap"; child: Node; start: number; end: number; negate: boolean }
	| { kind: "call"; args: Node[]; start: number; end: number };

/**
 * How many calls a node makes: one per function call in it, arguments included.
 * Compared with the calls the whole line actually made, so a call hidden where
 * the tree does not show one (and so would go undescribed) sends the line to
 * the fallback instead of into a derivation with a gap in it.
 */
function callCount(node: Node): number {
	switch (node.kind) {
		case "leaf":
			return 0;
		case "wrap":
			return callCount(node.child);
		case "binary":
			return callCount(node.left) + callCount(node.right);
		case "call":
			return 1 + node.args.reduce((sum, arg) => sum + callCount(arg), 0);
	}
}

/**
 * End offset of a token in the original source, exclusive.
 *
 * A fused token (a normalized phrase like "10 frames") carries `sourceEnd`,
 * because its `value` no longer spans the text it came from; every other token's
 * value does, so its end is `offset + value.length`.
 */
function tokenEnd(t: Token): number {
	return t.sourceEnd ?? t.offset + t.value.length;
}

/**
 * Token types that make up an operand atom: a value literal or a reference to one
 * (a number, a unit or currency amount, a percentage, a variable, a constant, a
 * boolean). An operand run is the maximal span of these.
 *
 * The set is defined as what an operand *is*, not as what stops one, so anything
 * that is not operand material ends the run: every parenthesis, and every
 * operator, modelled or not. That is the point. An operator the derivation does
 * not model (`==`, `<`, `in`, `to`, `and`, a bitwise or conversion op) is left
 * unconsumed, {@link Parser.parseAll} then sees the leftover token and throws,
 * and the line falls back to reporting its answer with no steps, rather than
 * gluing the operator into a leaf and emitting a misleading arithmetic step whose
 * result is not even the arithmetic kind. Preferring no derivation to a wrong one
 * is the rule the whole slice obeys, so this errs toward the empty fallback: an
 * exotic operand kind left out here loses its breakdown, never its answer.
 */
const OPERAND_TOKEN_TYPES: ReadonlySet<string> = new Set([
	TokenTypes.NUMBER,
	TokenTypes.BIGINT,
	TokenTypes.IDENT,
	TokenTypes.UNIT,
	TokenTypes.PERCENT,
	TokenTypes.PI,
	TokenTypes.E,
	TokenTypes.TRUE,
	TokenTypes.FALSE,
	TokenTypes.DOLLAR,
	TokenTypes.POUND,
	TokenTypes.EURO,
	TokenTypes.YEN,
	TokenTypes.RUBLE,
	TokenTypes.WON,
	TokenTypes.CURRENCY_SYMBOL,
]);

/**
 * True for a token that cannot start or continue an operand run: any token that
 * is not operand material ({@link OPERAND_TOKEN_TYPES}). The modelled infix
 * operators and parentheses are boundaries under this rule, and so is every
 * operator the derivation does not model, which is what keeps an unmodelled tail
 * (`== 4`, `in kg`) out of a leaf instead of gluing it into a misleading step.
 */
function isBoundary(type: string): boolean {
	return !OPERAND_TOKEN_TYPES.has(type);
}

/**
 * A recursive-descent, precedence-climbing parser over the already-normalized
 * token stream, producing a small tree whose nodes each know the span of source
 * they cover. Only the shapes a readable arithmetic derivation needs are
 * modelled; anything else makes {@link parse} throw, and the caller falls back
 * to reporting the answer with no breakdown.
 */
class Parser {
	private pos = 0;

	constructor(private readonly tokens: Token[]) {}

	private peek(): Token | undefined {
		return this.tokens[this.pos];
	}

	private next(): Token {
		return this.tokens[this.pos++];
	}

	/** Parse the whole stream, requiring every token to be consumed. */
	parseAll(): Node {
		const node = this.parseExpression(0);
		if (this.pos !== this.tokens.length) {
			// Leftover tokens mean the line uses something this slice does not
			// model. Signal a fallback rather than guess at a grouping.
			throw new Error("explain: unconsumed tokens");
		}
		return node;
	}

	private parseExpression(minBindingPower: number): Node {
		let left = this.parseOperand();

		for (;;) {
			const t = this.peek();
			if (!t) break;
			const bindingPower = infixBindingPower(t.type);
			if (bindingPower === 0 || bindingPower <= minBindingPower) break;

			this.next(); // consume the operator
			// `^` is right-associative, matching the engine, and `on`/`off` read
			// their base at a lower level than they bind at on their left.
			const rightBindingPower =
				t.type === TokenTypes.CARET ? bindingPower - 1
				: t.type === TokenTypes.PCT_ON || t.type === TokenTypes.PCT_OFF ? ON_OFF_BASE
				: bindingPower;
			const right = this.parseExpression(rightBindingPower);
			left = {
				kind: "binary",
				op: t.type,
				left,
				right,
				start: left.start,
				end: right.end,
			};
		}

		return left;
	}

	/** A parenthesised group, an optional sign, then a run of operand tokens. */
	private parseOperand(): Node {
		const first = this.peek();
		if (!first) throw new Error("explain: expected an operand");

		if (first.type === TokenTypes.LPAREN) {
			return this.parseGroup();
		}

		// A leading sign belongs to the operand it precedes. When that operand
		// is a group ("-(2 + 3)") the sign wraps the group; otherwise it is just
		// the first character of a signed literal ("-5").
		const signStart = first.offset;
		let sawSign = false;
		let minuses = 0;
		while (
			this.peek() &&
			(this.peek()!.type === TokenTypes.PLUS || this.peek()!.type === TokenTypes.MINUS)
		) {
			if (this.next().type === TokenTypes.MINUS) minuses++;
			sawSign = true;
		}
		const negate = minuses % 2 === 1;

		if (sawSign && this.peek() && this.peek()!.type === TokenTypes.LPAREN) {
			const group = this.parseGroup();
			return { kind: "wrap", child: group, start: signStart, end: group.end, negate };
		}

		// A function call: a word that is not operand material, directly followed
		// by its argument list (`sqrt(16)`, `round(x, 2)`). A leading sign stays
		// outside it, as a signed group does.
		const callee = this.peek();
		if (callee && isBoundary(callee.type) && this.tokens[this.pos + 1]?.type === TokenTypes.LPAREN) {
			const call = this.parseCall();
			return sawSign ? { kind: "wrap", child: call, start: signStart, end: call.end, negate } : call;
		}

		// Greedy operand run: everything up to the next operator or parenthesis.
		let end = -1;
		while (this.peek() && !isBoundary(this.peek()!.type)) {
			end = tokenEnd(this.next());
		}
		if (end === -1) {
			// No operand material at all (e.g. a stray operator). Fall back.
			throw new Error("explain: expected an operand");
		}
		return { kind: "leaf", start: signStart, end };
	}

	private parseGroup(): Node {
		const open = this.next(); // LPAREN
		const inner = this.parseExpression(0);
		const close = this.peek();
		if (!close || close.type !== TokenTypes.RPAREN) {
			throw new Error("explain: unbalanced parentheses");
		}
		this.next(); // RPAREN
		return { kind: "wrap", child: inner, start: open.offset, end: tokenEnd(close), negate: false };
	}

	/** `name(arg, arg, ...)`, each argument an expression of its own. */
	private parseCall(): Node {
		const name = this.next(); // the function word
		this.next(); // LPAREN
		const args: Node[] = [];
		if (this.peek()?.type !== TokenTypes.RPAREN) {
			args.push(this.parseExpression(0));
			while (this.peek()?.type === TokenTypes.COMMA) {
				this.next();
				args.push(this.parseExpression(0));
			}
		}
		const close = this.peek();
		if (!close || close.type !== TokenTypes.RPAREN) {
			throw new Error("explain: unbalanced call");
		}
		this.next(); // RPAREN
		return { kind: "call", args, start: name.offset, end: tokenEnd(close) };
	}
}

/**
 * Turn a parse tree into an ordered derivation.
 *
 * Values come from re-evaluating each operation's own span through the engine,
 * cached per node so a span is never evaluated twice. Descriptions read an
 * operand as its source text when it is a literal, or as its running value when
 * it is the result of the steps above it. A function call is described by the
 * package that owns it, from the call the engine made while evaluating it.
 */
class Builder {
	private readonly steps: ExplanationStep[] = [];
	private readonly resultPrefix: string;

	constructor(
		private readonly source: string,
		private readonly evaluate: EvaluateSpan,
		private readonly describeCall: DescribeCall,
		locale: string,
	) {
		this.resultPrefix = getLocale(locale).display.resultPrefix;
	}

	build(root: Node): { steps: ExplanationStep[]; result: Value } {
		this.emit(root);
		return { steps: this.steps, result: this.valueOf(root) };
	}

	/** Walk in evaluation order, emitting one step per operation. */
	private emit(node: Node): void {
		if (node.kind === "leaf") return;
		if (node.kind === "wrap") {
			this.emit(node.child);
			// A minus in front of a group or a call is an operation of its own:
			// without this step `-(2 + 3)` derived to 5 and answered -5, a last
			// step that disagreed with the answer.
			if (node.negate) {
				this.steps.push({ description: `the negative of ${this.operand(node.child)}`, value: this.valueOf(node) });
			}
			return;
		}
		if (node.kind === "call") {
			for (const arg of node.args) this.emit(arg);
			this.steps.push(...this.callSteps(node));
			return;
		}
		// binary
		this.emit(node.left);
		this.emit(node.right);
		this.steps.push({
			description: this.describe(node),
			value: this.valueOf(node),
		});
	}

	/**
	 * The steps a call node contributes: the owning package's account of the
	 * call itself. Its arguments have already been derived above it, so only
	 * the last call its span made is described, which in evaluation order is
	 * always the node's own call (an argument's call runs before the call that
	 * takes its result). A call that no package describes, or whose last call
	 * is not what the span answered, throws, and the line falls back rather
	 * than being derived with a gap where the call was.
	 */
	private callSteps(node: Extract<Node, { kind: "call" }>): readonly ExplanationStep[] {
		const span = this.observe(node);
		const own = span.calls[span.calls.length - 1];
		if (own === undefined || own.result !== span.value) {
			throw new Error("explain: call not accounted for");
		}
		const steps = this.describeCall(own);
		if (steps === undefined) throw new Error("explain: call not described");
		return steps;
	}

	private describe(node: Extract<Node, { kind: "binary" }>): string {
		const word = connective(node.op);
		// `on`/`off` state the rate first ("20% off 80") but read best base
		// first ("80 less 20%"), so their operands are shown the other way round.
		if (node.op === TokenTypes.PCT_ON || node.op === TokenTypes.PCT_OFF) {
			return `${this.operand(node.right)} ${word} ${this.operand(node.left)}`;
		}
		return `${this.operand(node.left)} ${word} ${this.operand(node.right)}`;
	}

	/** How an operand appears inside a step's description. */
	private operand(node: Node): string {
		if (node.kind === "leaf") {
			return this.source.slice(node.start, node.end).trim();
		}
		// A group, a call or an operation is shown by the value it carries.
		return this.render(this.valueOf(node));
	}

	/** A node's value, evaluated once from its own span and then cached. */
	private valueOf(node: Node): Value {
		return this.observe(node).value;
	}

	/** A node's value and the calls that produced it, evaluated once and cached. */
	private observe(node: Node): ObservedSpan {
		const cached = this.cache.get(node);
		if (cached) return cached;
		const span = this.evaluate(this.source.slice(node.start, node.end));
		this.cache.set(node, span);
		return span;
	}
	private readonly cache = new Map<Node, ObservedSpan>();

	/** Format a value for inline display, without the result prefix ("= "). */
	private render(value: Value): string {
		const formatted = formatValue(value, DEFAULT_FORMATTING_SETTINGS);
		return formatted.startsWith(this.resultPrefix)
			? formatted.slice(this.resultPrefix.length)
			: formatted;
	}
}

/**
 * The derivation of a line the arithmetic tree cannot hold (`5 km in miles`, a
 * finance phrase), told as the chain of calls the line made.
 *
 * Accepted only when the calls account for the whole answer: the last call's
 * result is the line's answer, and every earlier call's result is an argument
 * of a later one, so no operation happened between them that the steps would
 * leave out. `round(5 km in miles + 1 mile, 1)` fails the second test (the sum
 * between the conversion and the rounding is not a call) and gets no steps
 * rather than a derivation that skips a step. Every call must also be
 * described by a package.
 *
 * @returns The steps, or `null` when the calls do not tell the whole story.
 */
function chainSteps(line: ObservedSpan, describeCall: DescribeCall): ExplanationStep[] | null {
	const { calls, value } = line;
	if (calls.length === 0) return null;
	if (calls[calls.length - 1].result !== value) return null;
	for (let i = 0; i < calls.length - 1; i++) {
		const produced = calls[i].result;
		let consumed = false;
		for (let j = i + 1; j < calls.length && !consumed; j++) consumed = calls[j].args.includes(produced);
		if (!consumed) return null;
	}
	const steps: ExplanationStep[] = [];
	for (const call of calls) {
		const described = describeCall(call);
		if (described === undefined) return null;
		steps.push(...described);
	}
	return steps;
}

/**
 * Build a derivation for a single line.
 *
 * `tokens` are the engine's normalized tokens for `expression` (offsets index
 * back into `expression`), `evaluate` runs a self-contained sub-expression
 * through the engine and reports the calls it made, and `describeCall` asks the
 * registered packages to describe one of those calls. When the line cannot be
 * broken down, the answer is still returned with an empty step list.
 *
 * Arithmetic is derived from the token tree, with each function call in it
 * described by its package. A line the tree cannot hold (a conversion, a
 * finance phrase) is derived from the calls it made instead, when those calls
 * account for the whole answer; see {@link chainSteps}.
 *
 * `readings` are the line's date literals, from `ExpressionEngine.readDates`.
 * The ones worth remarking on lead the derivation, because how a date was read
 * is the fact that decided the answer and it is not visible in the answer: a
 * reader who typed `03/04/2026` and got a date has no way to tell which of the
 * two days it is from the arithmetic that followed.
 */
export function buildExplanation(params: {
	expression: string;
	tokens: Token[];
	evaluate: EvaluateSpan;
	describeCall: DescribeCall;
	locale: string;
	readings?: DateReading[];
}): Explanation {
	const { expression, tokens, evaluate, describeCall, locale, readings = [] } = params;

	/**
	 * One step per literal whose reading a reader should be told about: a
	 * genuine choice between two real days, a windowed two-digit year, or a
	 * refusal. Each carries the line's own answer, because a reading is a fact
	 * about the line rather than an intermediate value of its own.
	 */
	const readingSteps = (result: Value): ExplanationStep[] =>
		readings.filter((r) => r.needsNote).map((r) => ({ description: r.note, value: result }));

	// The whole line once, with its calls: the answer, the fallback's material,
	// and the count the tree's calls are checked against.
	const line = evaluate(expression);

	const terminal = (): Explanation => {
		const chain = chainSteps(line, describeCall) ?? [];
		return { expression, steps: [...readingSteps(line.value), ...chain, ...provenanceSteps(line.value)], result: line.value };
	};

	let root: Node;
	try {
		root = new Parser(tokens).parseAll();
	} catch {
		// The line uses a construct the tree does not model. Derive it from its
		// calls if they tell the whole story, else report the answer alone.
		return terminal();
	}
	// A call the tree does not show would go undescribed; see callCount.
	if (callCount(root) !== line.calls.length) return terminal();

	try {
		const { steps, result } = new Builder(expression, evaluate, describeCall, locale).build(root);
		// Where the answer's live figures came from closes the derivation: the
		// steps above say how the line combined them, these say whose they were.
		return { expression, steps: [...readingSteps(result), ...steps, ...provenanceSteps(result)], result };
	} catch {
		// A span failed to evaluate on its own (an unmodelled grouping), or a
		// call in the tree has no description. The whole line may still
		// evaluate, so fall back rather than report a partial breakdown.
		return terminal();
	}
}

