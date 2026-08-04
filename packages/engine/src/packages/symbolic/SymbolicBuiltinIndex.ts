/**
 * Builtin-function indices claimed by the symbolic algebra package.
 *
 * These are the numbers pushed as the first operand of `OpCode.CALL_BUILTIN`
 * and used to key `vm/VMBuiltins.ts`'s `builtinFunctions` table. They live in
 * their own module so a parselet can reference one without importing the
 * package descriptor, which would be circular.
 *
 * Allocating an index and never implementing it has happened twice before when
 * parallel work collided on this shared number space, so
 * `__tests__/engine/SymbolicSurfaceParity.spec.ts` asserts every index named
 * here has both a registered parselet and a live implementation.
 */

/** `expand(expr)`, see `packages/symbolic/parselets/ExpandParselet.ts`. */
export const SYMBOLIC_BUILTIN_EXPAND = 67;

/** `factor(expr)`, see `packages/symbolic/parselets/FactorParselet.ts`. */
export const SYMBOLIC_BUILTIN_FACTOR = 68;

/** `solve(equation, variable)`, see `packages/symbolic/parselets/SolveParselet.ts`. */
export const SYMBOLIC_BUILTIN_SOLVE = 69;

/** `der(expr, variable[, order])`, also spelled `derivative`. */
export const SYMBOLIC_BUILTIN_DER = 70;

/** `integral(expr, variable)`. */
export const SYMBOLIC_BUILTIN_INTEGRAL = 71;

/** `taylor(expr, variable = point, degree)`. */
export const SYMBOLIC_BUILTIN_TAYLOR = 72;

/** `jacobian(f1, f2, ...)`, variadic. */
export const SYMBOLIC_BUILTIN_JACOBIAN = 73;

/** An imaginary literal such as `3i`, see `packages/symbolic/parselets/ImaginaryParselet.ts`. */
export const SYMBOLIC_BUILTIN_IMAGINARY = 74;

/** `conj(z)`, the complex conjugate. */
export const SYMBOLIC_BUILTIN_CONJ = 75;

/** `re(z)`, the real part. */
export const SYMBOLIC_BUILTIN_RE = 76;

/** `im(z)`, the imaginary part. */
export const SYMBOLIC_BUILTIN_IM = 77;
