/**
 * Generates `packages/engine/src/calendar/generated/ZoneNames.generated.ts`:
 * a name for every place in the IANA time zone database, from the last part of
 * each zone identifier (`Asia/Kathmandu` gives `kathmandu`,
 * `America/Argentina/Buenos_Aires` gives `buenos aires`) (#698).
 *
 * Run by hand, output committed, like `generate-unit-table.mjs`. The zones come
 * from the running Node's `Intl.supportedValuesOf("timeZone")`, which lists the
 * database as ICU ships it: 418 zones on Node 22 and 24. ICU keeps some zones
 * under their older spellings (`Asia/Calcutta`, `Asia/Katmandu`), so each of
 * those is listed in RENAMED with the current identifier, and both names are
 * generated for it: a reader may write Calcutta or Kolkata.
 *
 * Not a build step and not checked in CI: a different Node carries a
 * different release of the database, and the table should change when someone
 * decides to regenerate it, not when the runner is upgraded.
 *
 * Usage:
 *   node scripts/generate-zone-names.mjs            write the file
 *   node scripts/generate-zone-names.mjs --check    verify the committed file matches this Node's list
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = path.join(REPO_ROOT, "packages", "engine", "src", "calendar", "generated", "ZoneNames.generated.ts");

/**
 * Zones ICU lists under an older identifier, to the one the database uses now.
 * Both spellings of the place become names for the current identifier.
 */
const RENAMED = {
	"Asia/Calcutta": "Asia/Kolkata",
	"Asia/Katmandu": "Asia/Kathmandu",
	"Asia/Saigon": "Asia/Ho_Chi_Minh",
	"Asia/Rangoon": "Asia/Yangon",
	"Europe/Kiev": "Europe/Kyiv",
	"America/Godthab": "America/Nuuk",
	"Atlantic/Faeroe": "Atlantic/Faroe",
	"Pacific/Truk": "Pacific/Chuuk",
	"Pacific/Ponape": "Pacific/Pohnpei",
	"America/Buenos_Aires": "America/Argentina/Buenos_Aires",
	"Pacific/Enderbury": "Pacific/Kanton",
	"America/Coral_Harbour": "America/Atikokan",
	"America/Indianapolis": "America/Indiana/Indianapolis",
	"America/Louisville": "America/Kentucky/Louisville",
	"Africa/Asmera": "Africa/Asmara",
};

/**
 * Names left out, each with its reason. A name here is not read as a place,
 * because reading it as one would mislead or would take a word the engine
 * already reads as something else.
 */
const EXCLUDED = {
	// Common English words.
	easter: "an ordinary word (Pacific/Easter is Easter Island)",
	christmas: "an ordinary word (Indian/Christmas is Christmas Island)",
	reunion: "an ordinary word (Indian/Reunion is Réunion)",
	wake: "an ordinary word (Pacific/Wake is Wake Island)",
	midway: "an ordinary word (Pacific/Midway is the Midway Atoll)",
	resolute: "an ordinary word (America/Resolute is Resolute, Nunavut)",
	oral: "an ordinary word (Asia/Oral is Oral, Kazakhstan)",
	center: "an ordinary word, and a county zone (America/North_Dakota/Center)",
	// County zones named after a town that shares its name with better-known places.
	petersburg: "St Petersburg is the city a reader means; America/Indiana/Petersburg is a county in Indiana",
	knox: "a county zone in Indiana (America/Indiana/Knox), and a name shared by many places",
	marengo: "a county zone in Indiana (America/Indiana/Marengo)",
	"tell city": "a county zone in Indiana (America/Indiana/Tell_City)",
	vevay: "a county zone in Indiana (America/Indiana/Vevay)",
	vincennes: "a county zone in Indiana (America/Indiana/Vincennes)",
	winamac: "a county zone in Indiana (America/Indiana/Winamac)",
	monticello: "a county zone in Kentucky (America/Kentucky/Monticello), and a name shared by many places",
	"new salem": "a county zone in North Dakota (America/North_Dakota/New_Salem)",
	beulah: "a county zone in North Dakota (America/North_Dakota/Beulah)",
	menominee: "a county zone in Michigan (America/Menominee)",
	// Names a better-known place elsewhere, in another zone.
	cordoba: "Córdoba in Spain is as likely as America/Argentina/Cordoba",
	merida: "Mérida in Spain and in Venezuela are as likely as America/Merida (Yucatán)",
	chatham: "Chatham in Kent is as likely as Pacific/Chatham (the Chatham Islands)",
	norfolk: "Norfolk in England and in Virginia are more likely than Pacific/Norfolk (Norfolk Island)",
	"san luis": "San Luis Potosí and San Luis Obispo are as likely as America/Argentina/San_Luis",
	"la rioja": "La Rioja in Spain is as likely as America/Argentina/La_Rioja",
	"san juan": "San Juan, Puerto Rico is the one a reader means, and the hand-written table names it; America/Argentina/San_Juan is a province",
};

/**
 * Whole regions left out. Antarctica's zones are research stations, several
 * named after people (Casey, Davis, Palmer) whose names are also places
 * elsewhere: `time in Davis` should not answer for an Antarctic base.
 */
const EXCLUDED_REGIONS = ["Antarctica/", "Etc/"];

/** A zone identifier's place, as a reader would write it: `Port-au-Prince` gives `port au prince`. */
function placeName(zone) {
	const last = zone.split("/").pop();
	return last.replace(/[_-]+/g, " ").toLowerCase();
}

function generate() {
	const zones = Intl.supportedValuesOf("timeZone");
	const names = new Map();
	const excluded = new Map();
	for (const listed of zones) {
		if (EXCLUDED_REGIONS.some((region) => listed.startsWith(region)) || !listed.includes("/")) continue;
		const zone = RENAMED[listed] ?? listed;
		for (const source of listed === zone ? [zone] : [listed, zone]) {
			const name = placeName(source);
			if (Object.prototype.hasOwnProperty.call(EXCLUDED, name)) {
				excluded.set(name, zone);
				continue;
			}
			const previous = names.get(name);
			if (previous !== undefined && previous !== zone) {
				throw new Error(`"${name}" names two zones, ${previous} and ${zone}; add one to EXCLUDED with a reason`);
			}
			names.set(name, zone);
		}
	}
	for (const name of Object.keys(EXCLUDED)) {
		if (!excluded.has(name)) throw new Error(`EXCLUDED lists "${name}", which this Node's zone list does not produce; remove it`);
	}
	const sorted = [...names.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const single = sorted.filter(([name]) => !name.includes(" "));
	const multi = sorted.filter(([name]) => name.includes(" "));
	const entry = ([name, zone]) => `\t${JSON.stringify(name)}: ${JSON.stringify(zone)},`;
	return `/**
 * A name for every place in the IANA time zone database (#698), from the last
 * part of each zone identifier.
 *
 * DO NOT EDIT BY HAND. Regenerate with:
 *   node scripts/generate-zone-names.mjs
 *
 * Generated from ${zones.length} zones (IANA time zone database ${process.versions.tz}, ICU ${process.versions.icu}).
 * The hand-written tables in \`calendar/ZoneNames.ts\` take precedence over
 * these, and the names the generator leaves out are listed, with their
 * reasons, in its EXCLUDED table.
 */

/** Single-word place names, lower case, to the IANA identifier. */
export const GENERATED_ZONE_NAMES: Readonly<Record<string, string>> = {
${single.map(entry).join("\n")}
};

/**
 * Place names of more than one word, lower case and space-separated, to the
 * IANA identifier. Fused into one token by the time package's phrases, as the
 * hand-written multi-word names are.
 */
export const GENERATED_MULTI_WORD_ZONE_NAMES: Readonly<Record<string, string>> = {
${multi.map(entry).join("\n")}
};
`;
}

const output = generate();
if (process.argv.includes("--check")) {
	const committed = fs.readFileSync(OUTPUT_PATH, "utf8").replace(/\r\n/g, "\n");
	const strip = (text) => text.replace(/^ \* Generated from .*$/m, "");
	if (strip(committed) !== strip(output)) {
		console.error("ZoneNames.generated.ts differs from this Node's zone list. Run: node scripts/generate-zone-names.mjs");
		process.exit(1);
	}
	console.log("ZoneNames.generated.ts matches this Node's zone list.");
} else {
	fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
	fs.writeFileSync(OUTPUT_PATH, output);
	const count = (output.match(/^\t"/gm) ?? []).length;
	console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT_PATH)}: ${count} names.`);
}
