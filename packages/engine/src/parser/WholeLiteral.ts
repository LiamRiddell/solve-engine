/**
 * Which typed whole numbers a double cannot hold.
 *
 * A double holds every whole number up to 9,007,199,254,740,991 (2^53 - 1) and
 * only some beyond it, so `9007199254740993` read as a double is
 * 9,007,199,254,740,992: a confident wrong number for a literal the reader
 * typed digit by digit. Such a literal is compiled to PUSH_DECIMAL with its
 * digits, and the VM pushes it as a Number carrying its exact integer (see
 * `vm/ExactIntegers.ts`), the same sidecar `2^53 + 1` already carries.
 *
 * The boundary is the written form: only plain digits count. Scientific
 * notation (`1e16`) names a double on purpose, and a hex, binary or octal
 * literal is its own type. A literal too large for any finite double (past
 * about 1.8e308) is left alone, so it is Infinity exactly as before and no
 * bigint is ever built from it.
 */

/** Plain decimal digits and nothing else. */
const WHOLE_DIGITS = /^\d+$/;

/**
 * Whether `digits` is a plain whole-number literal past the exact range of a
 * double but still finite as one.
 *
 * @param digits - The literal with any grouping already removed.
 * @returns True when the literal needs its exact integer kept.
 */
export function isPastSafeWholeLiteral(digits: string): boolean {
	// Sixteen digits is the shortest string past 2^53 - 1, so the common
	// literal is settled by its length alone.
	if (digits.length < 16 || !WHOLE_DIGITS.test(digits)) return false;
	const approx = Number(digits);
	return approx > Number.MAX_SAFE_INTEGER && Number.isFinite(approx);
}

/** A typed number in a base: `0x`, `0b` or `0o` in either case, then digits of that base and nothing else. */
const BASE_LITERAL = /^0(?:[xX][0-9a-fA-F]+|[bB][01]+|[oO][0-7]+)$/;

/**
 * The exact decimal digits of a typed hexadecimal, binary or octal literal a
 * double cannot hold, or null when the double read of it is already exact.
 *
 * `0xFFFFFFFFFFFFFFFFFFFF` read through `parseInt` is the nearest double,
 * which shows as 1,208,925,819,614,629,200,000,000 with its last digits
 * invented. A literal past 2^53 is compiled from these digits instead, to
 * PUSH_DECIMAL, the opcode a long decimal literal takes, so the VM keeps its
 * exact integer (see `vm/ExactIntegers.ts`) and `"0xFF..." as number` and the
 * typed literal agree digit for digit.
 *
 * The boundary matches {@link isPastSafeWholeLiteral}: a literal past about
 * 1.8e308 is Infinity as a double, and is left so, so no bigint is built from
 * a literal of any length.
 *
 * @param raw - The literal as the lexer read it, prefix included.
 * @param approx - The double `parseInt` read from it, which settles the common literal without a bigint.
 * @returns The decimal digits, or null.
 */
export function pastSafeBaseLiteralDigits(raw: string, approx: number): string | null {
	if (!(approx > Number.MAX_SAFE_INTEGER) || approx === Number.POSITIVE_INFINITY) return null;
	if (!BASE_LITERAL.test(raw)) return null;
	return BigInt(raw).toString();
}
