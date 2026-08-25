import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { GoalSeekParselet } from "./parselets/GoalSeekParselet";
import { goalSeekNormalizerRule } from "./normalizer/GoalSeekNormalizerRule";
import { GOAL_SEEK_FN_NAME, goalSeekHandler } from "./GoalSeekPluginFunctions";

/**
 * Goal seek, inverting a line against a target.
 *
 * `solve line 4 for rate = 900` reads as "find the value of rate that makes
 * line 4 equal 900". It is the answer to the forwards-only engine's one
 * standing gap: every "what input gives me this answer" otherwise means editing
 * a number and re-reading the result until it looks right (see GitHub issue
 * #98). The relationship comes from a line reference, so there is a well-defined
 * target to solve against without inventing any syntax for the relationship
 * itself, the line already expresses it.
 *
 * Grammar and search live apart, the same split every other package here uses:
 *  - `GoalSeekNormalizerRule` fuses the bare word `solve` into a GOAL_SEEK
 *    token, but only directly before a LINE_REF, so `solve(x^2-4=0, x)` (the
 *    algebra verb) and `:solve = 2` (a variable) are both untouched.
 *  - `GoalSeekParselet` reads `line N for <var> = <target>` and emits the
 *    plugin call.
 *  - `GoalSeekPluginFunctions` does the work: a closed-form inversion when the
 *    line is closed form in the variable, a bounded, hard-capped numeric search
 *    otherwise. See its module doc for the search domain, the monotonicity
 *    assumption, and the iteration cap.
 *
 * Trigger-word decision: `solve` is never a bare lexer keyword (it is the
 * product's own name and a plausible variable), so, exactly like the algebra
 * verbs' own `symbolic:call` rule, it is fused only in the one shape that means
 * goal seek, `solve` immediately before a line reference.
 */
export const GOALSEEK_PACKAGE: IEnginePackage = {
	name: "solve-goalseek",
	normalizerRules: [goalSeekNormalizerRule()],
	prefixParselets: { GOAL_SEEK: new GoalSeekParselet() },
	pluginFunctions: { [GOAL_SEEK_FN_NAME]: goalSeekHandler },
	// GOAL_SEEK's highlight category lives in the static TokenCategoryMap
	// alongside every other token declared in Token.ts's TokenTypes (the same
	// place the lines package's LINE_REF etc. are categorized), so it is not
	// repeated here.
};
