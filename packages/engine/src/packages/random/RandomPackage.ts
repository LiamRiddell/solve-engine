import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { RANDOM_PLUGIN_FUNCTIONS } from "./RandomPluginFunctions";
import { nullaryRandomParselet, unaryRandomParselet, pickCallParselet } from "./parselets/RandomParselets";

/**
 * Everyday randomness and identifiers (issue #241): `uuid`, `coin`,
 * `random hex N`, `pick(a, b, c)` and `shuffle [a, b, c]`.
 *
 * A companion to the dice package, which owns dice-notation rolls; this is the
 * general pickers. On by default and removable. Randomness comes from the same
 * source the engine's `random()` and `roll` already use, so nothing here is any
 * more or less reproducible than the rest of the engine, which is why the docs
 * page for it carries no proven example values.
 */
export const RANDOM_PACKAGE: IEnginePackage = {
	name: "solve-random",
	phrases: {
		"random hex": "RANDOM_HEX",
	},
	lexerVocabulary: {
		keywords: {
			uuid: "UUID",
			coin: "COIN",
			shuffle: "SHUFFLE",
		},
	},
	prefixParselets: {
		UUID: nullaryRandomParselet("randomUuid"),
		COIN: nullaryRandomParselet("randomCoin"),
		RANDOM_HEX: unaryRandomParselet("randomHex"),
		SHUFFLE: unaryRandomParselet("randomShuffle"),
		PICK_CALL: pickCallParselet,
	},
	// `pick(...)`, fused to PICK_CALL by the engine's shared call-fusion rule.
	callFusions: { pick: "PICK_CALL" },
	pluginFunctions: RANDOM_PLUGIN_FUNCTIONS,
	tokenCategories: {
		UUID: "function",
		COIN: "function",
		RANDOM_HEX: "function",
		SHUFFLE: "function",
		PICK_CALL: "function",
	},
};
