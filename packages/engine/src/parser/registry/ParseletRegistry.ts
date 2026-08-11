import { PrefixParselet, InfixParselet } from "@solve-js/parser/Parselet";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * The one binding-power field a parselet may expose beyond what its interface
 * requires, read only for diagnostic display.
 *
 * `InfixParselet` requires `bindingPower`; `PrefixParselet` declares none, and
 * some prefix parselets carry one anyway. That single field is the whole
 * optional surface deliberately. A `leftBindingPower`/`rightBindingPower` pair
 * used to be read here as well, and reading a name off an object this way finds
 * PRIVATE fields too, since TypeScript's `private` exists only at compile time:
 * `BinaryOpParselet` holds a private `rightBindingPower` meaning "the minimum
 * power to parse my right operand at", which is a different quantity from "the
 * power at which I bind to my right" and differs from it by one. Reading it
 * silently reported that other number. So neither is read.
 *
 * `category` is not here: both interfaces already declare it.
 */
interface ParseletBindingPowers {
	readonly bindingPower?: number;
}

/** Reads the optional binding-power field off a parselet for diagnostics. */
function bindingPowersOf(parselet: PrefixParselet | InfixParselet): ParseletBindingPowers {
	return parselet as ParseletBindingPowers;
}

/**
 * Dual-keyed ParseletRegistry, accepts both string token types and
 * integer token type IDs for fast dispatch in the Parser hot path.
 *
 * Providers call registerPrefix("NUMBER", ...) with string token types.
 * Internally, we populate both string-keyed and integer-keyed maps so
 * Parser.parseExpression() can use token.typeId (integer) for lookup
 * while diagnostics and error messages use token.type (string).
 *
 * Performance: Integer Map.get() avoids string hashing, saving ~2-5ns
 * per dispatch. With ~10-15 dispatches per expression, that's ~20-75ns.
 */
export class ParseletRegistry {
	// String-keyed maps (kept for diagnostics + backwards compat)
	private prefixParselets: Map<string, PrefixParselet> = new Map();
	private infixParselets: Map<string, InfixParselet> = new Map();

	// Integer-keyed maps for parser hot path
	private prefixById: Map<number, PrefixParselet> = new Map();
	private infixById: Map<number, InfixParselet> = new Map();

	/**
	 * Register a prefix parselet for `tokenType`.
	 *
	 * If another parselet is already registered for this token type, it is
	 * silently overwritten by default (`Map.set()` semantics), the old
	 * parselet is simply unreachable from then on, with no error. This is
	 * a real footgun for third-party packages: two packages independently
	 * choosing the same custom token type will collide with zero signal
	 * about which one "won". Mirrors ResolverRegistry.register()'s and
	 * ExpressionEngine.registerPackage()'s existing "warn and replace"
	 * pattern for the same class of problem at the resolver-namespace and
	 * package-name levels.
	 *
	 * Note: this warns about registry-level collisions only. It does NOT
	 * detect the separate case where `tokenType` is one of PrecedenceParser's
	 * Tier-1 fast-path token types (NUMBER, STRING, IDENT, LPAREN, MINUS,
	 * PLUS, and the Tier-1 infix operators), those are deliberately kept
	 * registered here for introspection/diagnostics even though Tier-1
	 * always intercepts them before this registry is consulted (see
	 * PrecedenceParser.parsePrefix()'s docs), so warning there would
	 * misfire on that intentional, already-documented pattern.
	 */
	registerPrefix(tokenType: string, parselet: PrefixParselet): void {
		const existing = this.prefixParselets.get(tokenType);
		if (existing && existing !== parselet) {
			console.warn(
				`[ParseletRegistry] Prefix parselet for token "${tokenType}" is already registered ` +
				`(category: "${existing.category ?? "unknown"}"). Overwriting with a new ` +
				`parselet (category: "${parselet.category ?? "unknown"}") — the previous ` +
				`parselet is now unreachable. Two packages may be claiming the same token type.`,
			);
		}
		this.prefixParselets.set(tokenType, parselet);
		this.prefixById.set(tokenTypeId(tokenType), parselet);
	}

	/** Register an infix parselet for `tokenType`. See {@link registerPrefix} for the collision-warning behavior this mirrors. */
	registerInfix(tokenType: string, parselet: InfixParselet): void {
		const existing = this.infixParselets.get(tokenType);
		if (existing && existing !== parselet) {
			console.warn(
				`[ParseletRegistry] Infix parselet for token "${tokenType}" is already registered ` +
				`(category: "${existing.category ?? "unknown"}"). Overwriting with a new ` +
				`parselet (category: "${parselet.category ?? "unknown"}") — the previous ` +
				`parselet is now unreachable. Two packages may be claiming the same token type.`,
			);
		}
		this.infixParselets.set(tokenType, parselet);
		this.infixById.set(tokenTypeId(tokenType), parselet);
	}

	/**
	 * Iterate all registered prefix parselets for diagnostic display.
	 *
	 * `PrefixParselet` declares no binding power, and this used to read a field
	 * of that name and report 0 for every one of them. 0 is not a neutral
	 * wrong answer: it is the value that means "not an operator, stop the
	 * expression", so a host drawing a table from this was told none of them
	 * bind at all. A prefix parselet in this parser has no per-parselet power
	 * to report, they all bind at the prefix level and each chooses for itself
	 * at what power to parse its own operand, so that level is what is
	 * reported. A parselet that does carry its own `bindingPower` still wins.
	 */
	getAllPrefix(): Array<{ tokenType: string; bindingPower: number; category?: string }> {
		const result: Array<{ tokenType: string; bindingPower: number; category?: string }> = [];
		for (const [tokenType, parselet] of this.prefixParselets) {
			result.push({
				tokenType,
				bindingPower: bindingPowersOf(parselet).bindingPower ?? BindingPower.Prefix,
				category: parselet.category,
			});
		}
		return result;
	}

	/**
	 * Iterate all registered infix parselets for diagnostic display.
	 *
	 * The field an `InfixParselet` actually declares is `bindingPower`. This
	 * used to read `leftBindingPower` and `rightBindingPower`, which no
	 * parselet in this codebase declares, so both reads were `undefined`, both
	 * fell to the `?? 0` default, and the public `getParseletRegistry()`
	 * reported a binding power of 0 for every one of the ~60 infix operators.
	 * A host building a precedence table from it was told `*` and `+` bind
	 * equally, and that neither binds at all.
	 *
	 * The left/right split: `bindingPower` is the LEFT power, and the right is
	 * one higher. That is the standard encoding for a left-associative
	 * operator, and it is what the parser itself does, see
	 * `PrecedenceParser.parseExpression()`'s `bp + 1` for the right operand.
	 * Every operator is reported that way, `^` included. Associativity is not
	 * something a parselet declares, it is a property of how each one calls
	 * `parseExpression`, so this API cannot report it without a new field on
	 * the interface. See {@link ParseletBindingPowers} for why scraping a
	 * plausible-looking one off the parselet is worse than not reporting it.
	 */
	getAllInfix(): Array<{ tokenType: string; leftBindingPower: number; rightBindingPower: number; category?: string }> {
		const result: Array<{ tokenType: string; leftBindingPower: number; rightBindingPower: number; category?: string }> = [];
		for (const [tokenType, parselet] of this.infixParselets) {
			const left = bindingPowersOf(parselet).bindingPower ?? 0;
			result.push({
				tokenType,
				leftBindingPower: left,
				rightBindingPower: left + 1,
				category: parselet.category,
			});
		}
		return result;
	}

	/** Number of registered prefix parselets. */
	get prefixCount(): number { return this.prefixParselets.size; }

	/** Number of registered infix parselets. */
	get infixCount(): number { return this.infixParselets.size; }

	/**
	 * Get prefix parselet by string token type OR integer typeId.
	 * Fast path for integer IDs (Parser hot path), fallback for strings
	 * (diagnostics, error messages, backwards compatibility).
	 */
	getPrefix(tokenType: string | number): PrefixParselet | undefined {
		if (typeof tokenType === 'number') return this.prefixById.get(tokenType);
		return this.prefixParselets.get(tokenType);
	}

	/**
	 * Get infix parselet by string token type OR integer typeId.
	 * Fast path for integer IDs (Parser hot path), fallback for strings.
	 */
	getInfix(tokenType: string | number): InfixParselet | undefined {
		if (typeof tokenType === 'number') return this.infixById.get(tokenType);
		return this.infixParselets.get(tokenType);
	}

	hasPrefix(tokenType: string): boolean {
		return this.prefixParselets.has(tokenType);
	}

	hasInfix(tokenType: string): boolean {
		return this.infixParselets.has(tokenType);
	}

	clear(): void {
		this.prefixParselets.clear();
		this.infixParselets.clear();
		this.prefixById.clear();
		this.infixById.clear();
	}
}

/**
 * A process-wide parselet registry.
 *
 * @deprecated An engine builds its own registry and does not read this one, so
 * registering here reaches nothing that evaluates. It survives for the
 * deprecated {@link PackageRegistry} path only.
 */
export const sharedParseletRegistry = new ParseletRegistry();
