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
