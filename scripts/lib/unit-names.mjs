/**
 * The names the unit reference gives its rows and its base-unit sentences.
 *
 * The unit tables list the American spelling first (`kilometer` before
 * `kilometre`) and some units only as codes (`mps`, `m3s`, `kmpl`), and the
 * page used to headline whichever came first (#782). These choose by
 * preference instead: British where the row carries it, a readable name over a
 * code. Kept apart from `generate-unit-reference.mjs`, which needs a built
 * engine, so the choice can be tested on its own.
 *
 * @module unit-names
 */

/**
 * Readable names for the units whose every spelling is a code: the compact
 * forms `ExtendedUnits.ts` defines (`mps`, `m3s`, `kmpl`) and the electrical
 * and data-rate symbols. A row headed by one of these shows the name in the
 * Unit column and lists every spelling, the code included, beside it. A `Map`,
 * so a spelling named after an inherited property is not read as listed.
 *
 * Every key must be a spelling that reaches the page: the generator fails the
 * run on one that does not, so a renamed unit cannot leave a name
 * here that heads nothing.
 */
export const DISPLAY_NAMES = new Map([
	["mps", "metre per second"],
	["kph", "kilometre per hour"],
	["mph", "mile per hour"],
	["kn", "knot"],
	["ft_s", "foot per second"],
	["min_km", "minute per kilometre"],
	["min_mi", "minute per mile"],
	["bps", "bit per second"],
	["kbps", "kilobit per second"],
	["Mbps", "megabit per second"],
	["Gbps", "gigabit per second"],
	["Tbps", "terabit per second"],
	["kBps", "kilobyte per second"],
	["MBps", "megabyte per second"],
	["GBps", "gigabyte per second"],
	["px", "CSS pixel"],
	["rem", "root em"],
	["V", "volt"],
	["kV", "kilovolt"],
	["mV", "millivolt"],
	["A", "ampere"],
	["kA", "kiloampere"],
	["mA", "milliampere"],
	["VA", "volt-ampere"],
	["kVA", "kilovolt-ampere"],
	["MVA", "megavolt-ampere"],
	["kvar", "kilovar"],
	["Mvar", "megavar"],
	["varh", "var-hour"],
	["kvarh", "kilovar-hour"],
	["Mvarh", "megavar-hour"],
	["m3s", "cubic metre per second"],
	["m3h", "cubic metre per hour"],
	["lps", "litre per second"],
	["lpm", "litre per minute"],
	["gpm", "US gallon per minute"],
	["cfs", "cubic foot per second"],
	["kmpl", "kilometre per litre"],
	["mpg", "mile per US gallon"],
	["l100km", "litre per 100 kilometres"],
	["ppm", "part per million"],
	["ppb", "part per billion"],
	["ppt", "part per trillion"],
]);

/**
 * The base a measure is counted against when none of its rows has a relative
 * size of 1, so no spelling names it. Without this the section had no base
 * sentence at all, and the Relative size column was against nothing the reader
 * could see. Keyed by the measure's name in the tables.
 */
export const UNNAMED_BASES = new Map([
	["pace", "second per metre"],
	["reactivePower", "var"],
	["fuelConsumption", "litre per kilometre"],
	["partsPer", "whole"],
]);

/**
 * The British spelling of a unit name: `meter` as `metre`, `liter` as `litre`.
 * Only those two stems differ between the spellings the tables carry; every
 * other name (`gram`, `ton`, `foot`) is spelled alike, or names a different unit
 * (`ton` and `tonne` are not the same weight), so nothing else is rewritten.
 *
 * @param {string} spelling - A spelling from the table.
 * @returns {string} The same spelling with the British stems.
 */
export function britishSpelling(spelling) {
	return spelling.replace(/meter/g, "metre").replace(/liter/g, "litre");
}

/**
 * The row's headline name.
 *
 * By preference rather than by table order, since the tables list the
 * American spelling first and the docs are written in British spelling: a
 * readable name from {@link DISPLAY_NAMES} when the row is headed by a code;
 * otherwise the British form of the first spelling when the row carries it
 * (`kilometre` over `kilometer`); otherwise the first spelling, since upstream
 * lists a unit's canonical name before its aliases. Picking the longest word
 * instead labelled area's base unit "centiares", which is correct and not what
 * anybody calls a square metre.
 *
 * @param {Set<string>} displayNamesUsed - The display names used so far, added to in place.
 * @param {string[]} spellings - The row's typable spellings, in table order.
 * @returns {string} The name for the Unit column and the base sentence.
 */
function headlineUsing(displayNamesUsed, spellings) {
	const first = spellings[0];
	if (DISPLAY_NAMES.has(first)) {
		displayNamesUsed.add(first);
		return DISPLAY_NAMES.get(first);
	}
	const british = britishSpelling(first);
	return british !== first && spellings.includes(british) ? british : first;
}

/**
 * A headline picker for one run of the generator, and the check that every
 * {@link DISPLAY_NAMES} entry was used by it.
 *
 * @returns {{ headline: (spellings: string[]) => string, unusedDisplayNames: () => string[] }}
 *   `headline` names a row; `unusedDisplayNames` lists the display names no row
 *   was headed by, so a renamed unit cannot leave a name that heads nothing.
 */
export function unitNamer() {
	const displayNamesUsed = new Set();
	return {
		headline: (spellings) => headlineUsing(displayNamesUsed, spellings),
		unusedDisplayNames: () => [...DISPLAY_NAMES.keys()].filter((spelling) => !displayNamesUsed.has(spelling)),
	};
}
