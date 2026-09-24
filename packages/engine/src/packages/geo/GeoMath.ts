/**
 * The arithmetic behind the geo forms, as pure functions.
 *
 * Kept apart from the package so it can be tested directly and read without the
 * engine in the way: degrees in, kilometres and degrees out, no Value, no parser.
 * A form that cannot answer returns a reason rather than a number, and the
 * package turns that into a refusal that names what was wrong.
 *
 * Everything here is worked on a sphere of the Earth's mean radius, not on the
 * flattened ellipsoid a surveyor would use. That is a choice, not a shortcut:
 * the sphere gives one well-defined answer for every pair of places, including
 * two on exactly opposite sides of the world, where the usual ellipsoidal method
 * (Vincenty's) fails to settle on an answer at all. The price is accuracy, and it
 * is small and bounded: a spherical distance is within about 0.5% of the
 * ellipsoidal one everywhere, usually much closer, which is less than the
 * uncertainty in where a city "is" when its coordinates are typed from a map.
 *
 * @module GeoMath
 */

import type { Hemisphere } from "@solve-js/lexer/GeoAngleLiteral";

/**
 * The Earth's mean radius in kilometres: the IUGG mean radius, (2a + b) / 3 on
 * the WGS-84 ellipsoid. Every distance here is an arc on a sphere of this radius.
 */
export const EARTH_MEAN_RADIUS_KM = 6371.0088;

/** Degrees to radians. */
const RADIANS_PER_DEGREE = Math.PI / 180;

/**
 * How close two points' unit vectors must be to count as the same point, or as
 * exact opposites. On the Earth this is a few micrometres: far below anything a
 * typed coordinate can mean, and far above the rounding in the sine and cosine
 * of a typed angle.
 */
const COINCIDENT = 1e-12;

/** A place on the globe, in signed decimal degrees: north and east positive. */
export interface GeoPoint {
	/** Degrees north of the equator (negative for south), -90 to 90. */
	readonly lat: number;
	/** Degrees east of the Greenwich meridian (negative for west), -180 to 180. */
	readonly lon: number;
}

/**
 * Why a latitude or longitude is not a place, or null when it is one.
 *
 * @param lat - Degrees north, negative for south.
 * @param lon - Degrees east, negative for west.
 * @returns A sentence naming the part that is out of range, or null.
 */
export function placeProblem(lat: number, lon: number): string | null {
	if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
		return `latitude ${plain(lat)}° is past a pole: latitudes run from -90° (the South Pole) to 90° (the North Pole)`;
	}
	if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
		return `longitude ${plain(lon)}° is outside -180° to 180°: write a place west of Greenwich as a negative longitude, or with W`;
	}
	return null;
}

/**
 * The angle at the Earth's centre between two places, in radians, by the
 * haversine formula.
 *
 * The haversine form is the one that stays accurate for places close together,
 * where the plainer spherical law of cosines loses its digits to rounding. The
 * longitude difference goes only through a sine and a cosine, so a pair either
 * side of the 180° meridian is measured the short way across it, not the long
 * way round.
 *
 * @returns The central angle, 0 to pi.
 */
export function centralAngle(a: GeoPoint, b: GeoPoint): number {
	const lat1 = a.lat * RADIANS_PER_DEGREE;
	const lat2 = b.lat * RADIANS_PER_DEGREE;
	const halfLat = (lat2 - lat1) / 2;
	const halfLon = ((b.lon - a.lon) * RADIANS_PER_DEGREE) / 2;
	const h = Math.sin(halfLat) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(halfLon) ** 2;
	// Rounding can carry h a hair past 1 for two exactly opposite places, which
	// would make the arcsine NaN; the true value never exceeds 1.
	return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The great-circle distance between two places: the shortest path over the
 * surface of the sphere, in kilometres.
 */
export function greatCircleKm(a: GeoPoint, b: GeoPoint): number {
	return centralAngle(a, b) * EARTH_MEAN_RADIUS_KM;
}

/** A place as a point on the unit sphere, for the same-point and opposite-point tests. */
function unitVector(p: GeoPoint): [number, number, number] {
	const lat = p.lat * RADIANS_PER_DEGREE;
	const lon = p.lon * RADIANS_PER_DEGREE;
	return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Why there is no single starting direction from one place to another. */
export type NoBearing = "same place" | "antipodes";

/**
 * The initial bearing from one place to another: the compass direction, in
 * degrees clockwise from true north (0 to 360), in which the great circle
 * leaves the first place.
 *
 * It is the starting heading only. Along a great circle the heading changes as
 * you go (London to Tokyo sets off north-east and arrives heading south-east),
 * which is why it is called the initial bearing.
 *
 * Three cases have no ordinary answer, and each is handled by name rather than
 * left to whatever the formula's rounding produces:
 * - the same place twice has no direction at all;
 * - two exactly opposite places (antipodes) are reached by every direction
 *   equally, so there is no single one;
 * - from a pole every direction is the same one: due south from the North Pole
 *   (180°) and due north from the South Pole (0°), whatever longitude the pole
 *   was typed with.
 *
 * @returns Degrees from 0 up to (not including) 360, or the reason there is none.
 */
export function initialBearing(a: GeoPoint, b: GeoPoint): number | NoBearing {
	const [ax, ay, az] = unitVector(a);
	const [bx, by, bz] = unitVector(b);
	if (Math.hypot(ax - bx, ay - by, az - bz) < COINCIDENT) return "same place";
	if (a.lat === 90) return 180;
	if (a.lat === -90) return 0;
	if (Math.hypot(ax + bx, ay + by, az + bz) < COINCIDENT) return "antipodes";

	const lat1 = a.lat * RADIANS_PER_DEGREE;
	const lat2 = b.lat * RADIANS_PER_DEGREE;
	const dLon = (b.lon - a.lon) * RADIANS_PER_DEGREE;
	const y = Math.sin(dLon) * Math.cos(lat2);
	const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
	const degrees = ((Math.atan2(y, x) / RADIANS_PER_DEGREE) % 360 + 360) % 360;
	// A heading a rounding error either side of north is north. Without this,
	// due north from a point just west of the meridian came out as 359.99...,
	// which displays as 360.
	return degrees < 1e-9 || degrees > 360 - 1e-9 ? 0 : degrees;
}

/**
 * The parts of a degrees-minutes-seconds angle turned into decimal degrees,
 * signed by the compass letter.
 *
 * @param degrees - The degrees as written.
 * @param minutes - The minutes of arc as written, if any.
 * @param seconds - The seconds of arc as written, if any.
 * @param hemisphere - The compass letter, if any: S and W make the angle negative.
 * @returns The angle in degrees, or the reason the parts do not make one.
 */
export function anglePartsToDegrees(
	degrees: string,
	minutes: string | undefined,
	seconds: string | undefined,
	hemisphere: Hemisphere | undefined,
): { degrees: number } | { problem: string } {
	const written = `${degrees}°${minutes === undefined ? "" : `${minutes}'`}${seconds === undefined ? "" : `${seconds}"`}`;
	if (minutes !== undefined && degrees.includes(".")) {
		return { problem: `${written} gives the degrees a fraction and minutes as well: write the fraction as minutes, or leave the minutes out` };
	}
	if (seconds !== undefined && minutes !== undefined && minutes.includes(".")) {
		return { problem: `${written} gives the minutes a fraction and seconds as well: write the fraction as seconds, or leave the seconds out` };
	}
	const d = Number(degrees);
	const m = minutes === undefined ? 0 : Number(minutes);
	const s = seconds === undefined ? 0 : Number(seconds);
	if (m >= 60) return { problem: `${written} has ${minutes} minutes: minutes of arc run from 0 to 59, and 60 of them make a degree` };
	if (s >= 60) return { problem: `${written} has ${seconds} seconds: seconds of arc run from 0 to 59, and 60 of them make a minute` };

	const magnitude = d + m / 60 + s / 3600;
	if ((hemisphere === "N" || hemisphere === "S") && magnitude > 90) {
		return { problem: `${written}${hemisphere} is past a pole: a latitude runs from 0° to 90° north or south` };
	}
	if ((hemisphere === "E" || hemisphere === "W") && magnitude > 180) {
		return { problem: `${written}${hemisphere} is past the 180° meridian: a longitude runs from 0° to 180° east or west` };
	}
	return { degrees: hemisphere === "S" || hemisphere === "W" ? -magnitude : magnitude };
}

/** Two digits, zero-padded, for the minutes of a degrees-minutes-seconds angle. */
function twoDigits(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/**
 * An angle written in degrees, minutes and seconds, the seconds to a hundredth:
 * `51.5074` is `51°30'26.64"`.
 *
 * The rounding is done once, on the whole angle counted in hundredths of a
 * second, so a value that rounds up carries into the minutes and the degrees
 * rather than showing 60 seconds. Minutes and seconds are padded to two digits,
 * as a map or a GPS shows them, and trailing zeros after the decimal point of
 * the seconds are dropped.
 *
 * @param degrees - The angle in decimal degrees, any sign.
 * @param signed - Whether to prefix a negative angle with `-`; a coordinate
 *   passes false and shows its sign as a compass letter instead.
 * @returns The formatted angle.
 */
export function formatDms(degrees: number, signed = true): string {
	let hundredths = Math.round(Math.abs(degrees) * 360000);
	const d = Math.floor(hundredths / 360000);
	hundredths -= d * 360000;
	const m = Math.floor(hundredths / 6000);
	hundredths -= m * 6000;
	const wholeSeconds = Math.floor(hundredths / 100);
	const fraction = hundredths % 100;
	const seconds = fraction === 0
		? twoDigits(wholeSeconds)
		: `${twoDigits(wholeSeconds)}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
	const isZero = d === 0 && m === 0 && wholeSeconds === 0 && fraction === 0;
	const sign = signed && degrees < 0 && !isZero ? "-" : "";
	return `${sign}${d}°${twoDigits(m)}'${seconds}"`;
}

/**
 * A place written as a map writes it: `51°30'26.64"N 0°07'40.08"W`.
 */
export function formatPlaceDms(p: GeoPoint): string {
	return `${formatDms(p.lat, false)}${p.lat < 0 ? "S" : "N"} ${formatDms(p.lon, false)}${p.lon < 0 ? "W" : "E"}`;
}

/** A number for a message: as written for a typed value, without a float's trailing noise. */
export function plain(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	return String(Number(n.toFixed(6)));
}
