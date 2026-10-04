/**
 * The mistakes in an engine's options that the engine can see when it is built
 * (#719): an option it does not have, a `config` section it does not have, and
 * a setting a section does not have. Each was dropped without a word, so a host
 * that wrote `createEngine({ network: { enabled: false } })` believed live data
 * was off while every place name and currency pair still went to the public
 * endpoints.
 *
 * Each is a warning rather than a refusal: a host typed against a newer release
 * may pass an option an older engine does not know, and an engine that refused
 * to build over it would be the worse failure.
 *
 * @module OptionChecks
 */

import { DEFAULT_CONFIG } from "@solve-js/constants/Configuration";
import { nearestNames } from "@solve-js/errors/DidYouMean";

/** The options {@link EngineOptions} has. Kept beside the interface's own list; a spec asserts they agree. */
export const ENGINE_OPTION_KEYS: readonly string[] = [
	"locale", "packages", "config", "diagnostics", "calendar", "warmup", "random", "strict", "onPackageError",
];

/**
 * The settings a section has that its defaults leave unset, so they do not
 * appear among `DEFAULT_CONFIG`'s keys: `date.holidays` is off until a host
 * supplies a calendar. Kept beside the interfaces in
 * `constants/Configuration.ts`; a spec reads that file and asserts every
 * optional setting there is listed here.
 */
export const OPTIONAL_SETTINGS: Readonly<Record<string, readonly string[]>> = {
	date: ["inputLocale", "holidays", "weekend", "firstDayOfWeek"],
};

/** Options that exist, one level down, under another name. */
const MOVED: Readonly<Record<string, string>> = {
	seed: "`random: { seed }`",
	extraPackages: "createEngine's options; the constructor takes `packages`",
};

/** The nearest spelling in `known`, as a sentence to append, or the empty string. */
function nearest(word: string, known: readonly string[]): string {
	const names = nearestNames(word, known, 2);
	return names.length === 0 ? "" : ` Did you mean ${names.map((n) => `"${n}"`).join(" or ")}?`;
}

/**
 * The sentences that describe what an engine's options hold that it does not
 * know, one per mistake; none when there is nothing to say.
 *
 * @param options - The options the engine was built with.
 * @returns A sentence per unknown option, config section or setting.
 */
export function unknownOptionWarnings(options: object): string[] {
	const warnings: string[] = [];
	const sections = Object.keys(DEFAULT_CONFIG);
	for (const key of Object.keys(options)) {
		if (ENGINE_OPTION_KEYS.includes(key)) continue;
		if (sections.includes(key)) {
			warnings.push(`"${key}" is not an engine option, so it is ignored: it is a config section, and belongs under \`config\`, as in { config: { ${key}: { ... } } }.${nearest(key, ENGINE_OPTION_KEYS)}`);
		} else if (Object.prototype.hasOwnProperty.call(MOVED, key)) {
			warnings.push(`"${key}" is not an engine option, so it is ignored: it belongs under ${MOVED[key]}.`);
		} else {
			warnings.push(`"${key}" is not an engine option, so it is ignored.${nearest(key, ENGINE_OPTION_KEYS)}`);
		}
	}

	const config = (options as { config?: unknown }).config;
	if (config === null || typeof config !== "object") return warnings;
	for (const [section, settings] of Object.entries(config)) {
		if (!sections.includes(section)) {
			warnings.push(`"config.${section}" is not a config section, so it is ignored.${nearest(section, sections)}`);
			continue;
		}
		if (settings === null || typeof settings !== "object") continue;
		const known = [
			...Object.keys((DEFAULT_CONFIG as unknown as Record<string, object>)[section]),
			...(Object.prototype.hasOwnProperty.call(OPTIONAL_SETTINGS, section) ? OPTIONAL_SETTINGS[section] : []),
		];
		for (const setting of Object.keys(settings)) {
			if (known.includes(setting)) continue;
			warnings.push(`"config.${section}.${setting}" is not a setting, so it is ignored.${nearest(setting, known)}`);
		}
	}
	return warnings;
}
