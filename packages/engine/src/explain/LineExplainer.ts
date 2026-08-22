import type { Token } from "@solve-js/lexer/Token";
import { TokenTypes } from "@solve-js/lexer/Token";
import type { Value } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { getLocale } from "@solve-js/constants/locales";
import type { Explanation, ExplanationStep } from "./Explanation";

/**
 * Evaluate a standalone sub-expression and return its value.
 *
 * Supplied by the engine so the explainer reuses real evaluation rather than
 * re-deriving arithmetic: every value in a derivation is the value the engine
 * itself would compute for that piece of the line. It must be side-effect-free
 * with respect to document state (it is only ever handed self-contained
 * sub-expressions of the line being explained).
 */
export type EvaluateSpan = (source: string) => Value;

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
 * `on`/`off` bind below arithmetic (the engine's `Conditional` level), so the
 * base is the whole arithmetic expression after the phrase: "20% off 80 + 20"
 * is "20% off (80 + 20)", not "(20% off 80) + 20".
 */
const ON_OFF = 24;

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
// step. `wrap` is a parenthesised group or a signed group, transparent for step
// emission but shown by its computed value when it stands as an operand.
type Node =
	| { kind: "leaf"; start: number; end: number }
	| { kind: "binary"; op: string; left: Node; right: Node; start: number; end: number }
	| { kind: "wrap"; child: Node; start: number; end: number };

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
			// `^` is the only right-associative operator, matching the engine.
			const rightBindingPower =
				t.type === TokenTypes.CARET ? bindingPower - 1 : bindingPower;
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
		while (
			this.peek() &&
			(this.peek()!.type === TokenTypes.PLUS || this.peek()!.type === TokenTypes.MINUS)
		) {
			this.next();
			sawSign = true;
		}

		if (sawSign && this.peek() && this.peek()!.type === TokenTypes.LPAREN) {
			const group = this.parseGroup();
			return { kind: "wrap", child: group, start: signStart, end: group.end };
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
		return { kind: "wrap", child: inner, start: open.offset, end: tokenEnd(close) };
	}
}

/**
 * Turn a parse tree into an ordered derivation.
 *
 * Values come from re-evaluating each operation's own span through the engine,
 * cached per node so a span is never evaluated twice. Descriptions read an
 * operand as its source text when it is a literal, or as its running value when
 * it is the result of the steps above it.
 */
class Builder {
	private readonly steps: ExplanationStep[] = [];
	private readonly resultPrefix: string;

	constructor(
		private readonly source: string,
		private readonly evaluate: EvaluateSpan,
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
		// A group or an operation is shown by the value it carries.
		return this.render(this.valueOf(node));
	}

	/** A node's value, evaluated once from its own span and then cached. */
	private valueOf(node: Node): Value {
		const cached = this.cache.get(node);
		if (cached) return cached;
		const value = this.evaluate(this.source.slice(node.start, node.end));
		this.cache.set(node, value);
		return value;
	}
	private readonly cache = new Map<Node, Value>();

	/** Format a value for inline display, without the result prefix ("= "). */
	private render(value: Value): string {
		const formatted = formatValue(value, DEFAULT_FORMATTING_SETTINGS);
		return formatted.startsWith(this.resultPrefix)
			? formatted.slice(this.resultPrefix.length)
			: formatted;
	}
}

/**
 * Build a derivation for a single line.
 *
 * `tokens` are the engine's normalized tokens for `expression` (offsets index
 * back into `expression`), and `evaluate` runs a self-contained sub-expression
 * through the engine. When the line cannot be broken down, the answer is still
 * returned with an empty step list.
 */
export function buildExplanation(params: {
	expression: string;
	tokens: Token[];
	evaluate: EvaluateSpan;
	locale: string;
}): Explanation {
	const { expression, tokens, evaluate, locale } = params;

	const terminal = (): Explanation => ({
		expression,
		steps: [],
		result: evaluate(expression),
	});

	let root: Node;
	try {
		root = new Parser(tokens).parseAll();
	} catch {
		// The line uses a construct this slice does not derive. Report the
		// answer alone rather than a partial or misleading breakdown.
		return terminal();
	}

	try {
		const { steps, result } = new Builder(expression, evaluate, locale).build(root);
		return { expression, steps, result };
	} catch {
		// A span failed to evaluate on its own (an unmodelled grouping). The
		// whole line may still evaluate, so report the answer without steps.
		return terminal();
	}
}
