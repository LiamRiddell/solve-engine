import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { WhatIfParselet } from "./parselets/WhatIfParselet";
import { SweepParselet } from "./parselets/SweepParselet";
import {
	whatIfNormalizerRule,
	sweepNormalizerRule,
	scenarioDeclarationNormalizerRule,
	scenarioReadNormalizerRule,
	WHAT_IF_TOKEN,
	SWEEP_TOKEN,
	SWEEP_STEP_TOKEN,
	SCENARIO_DECLARATION_TOKEN,
	SCENARIO_READ_TOKEN,
} from "./normalizer/WhatIfNormalizerRules";
import { WHAT_IF_FN_NAME, SWEEP_FN_NAME, whatIfHandler, sweepHandler } from "./WhatIfPluginFunctions";
import { ScenarioDeclarationParselet, ScenarioReadParselet } from "./parselets/ScenarioParselets";
import { SCENARIO_DECLARE_FN_NAME, SCENARIO_READ_FN_NAME, scenarioDeclareHandler, scenarioReadHandler } from "./ScenarioPluginFunctions";

/**
 * What-if and sweeps, re-running a line with different inputs (GitHub issue
 * #505).
 *
 * `line 4 with deposit = 150000` reads as "what line 4 would say if deposit
 * were 150000", and `line 4 for rate from 3% to 6% step 1%` as "line 4's
 * answer for each of those rates". Neither edits the note. Both re-run every
 * line from the top of the document to the target, from its text, in a
 * scratch engine with the input held fixed, so the input reaches the target
 * through every line between (see `LineExecutionContext.rerunLines`).
 *
 * Grammar and work live apart, the split every package here uses:
 *  - `whatIfNormalizerRule` fuses `line N with` into `WHAT_IF` when a `<name>
 *    =` follows, and `sweepNormalizerRule` fuses `line N for <name> from` into
 *    `SWEEP` and the sweep's `step` into `SWEEP_STEP`. Neither `with`, `for`
 *    nor `step` becomes a keyword anywhere else.
 *  - `WhatIfParselet` and `SweepParselet` read the rest and emit the plugin
 *    calls.
 *  - `WhatIfPluginFunctions` does the work, including the sweep's step and
 *    work limits.
 *
 * Named scenarios (#744) are a what-if with a name kept in the note:
 * `scenario bull with growth = 8%` declares one, and `line 5 under bull` reads
 * line 5 with its inputs, through the same re-run.
 *
 * Registered after `LINES_PACKAGE`, whose rule mints the `LINE_REF` both of
 * this package's rules read.
 */
export const WHATIF_PACKAGE: IEnginePackage = {
	name: "solve-whatif",
	normalizerRules: [whatIfNormalizerRule(), sweepNormalizerRule(), scenarioDeclarationNormalizerRule(), scenarioReadNormalizerRule()],
	prefixParselets: {
		[WHAT_IF_TOKEN]: new WhatIfParselet(),
		[SWEEP_TOKEN]: new SweepParselet(),
		[SCENARIO_DECLARATION_TOKEN]: new ScenarioDeclarationParselet(),
		[SCENARIO_READ_TOKEN]: new ScenarioReadParselet(),
	},
	pluginFunctions: {
		[WHAT_IF_FN_NAME]: whatIfHandler,
		[SWEEP_FN_NAME]: sweepHandler,
		[SCENARIO_DECLARE_FN_NAME]: scenarioDeclareHandler,
		[SCENARIO_READ_FN_NAME]: scenarioReadHandler,
	},
	tokenCategories: {
		[WHAT_IF_TOKEN]: "keyword",
		[SWEEP_TOKEN]: "keyword",
		[SWEEP_STEP_TOKEN]: "keyword",
		[SCENARIO_DECLARATION_TOKEN]: "keyword",
		[SCENARIO_READ_TOKEN]: "keyword",
	},
};
