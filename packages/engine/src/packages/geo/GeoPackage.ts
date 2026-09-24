import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { readGeoAngle } from "@solve-js/lexer/GeoAngleLiteral";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { errorValue, rowVectorValue, stringValue, uomValue, ValueType, type MatrixData, type Value } from "@solve-js/vm/Value";
import {
	anglePartsToDegrees,
	formatDms,
	formatPlaceDms,
	greatCircleKm,
	initialBearing,
	placeProblem,
	plain,
	type GeoPoint,
} from "./GeoMath";
import { GeoAngleParselet } from "./parselets/GeoAngleParselet";
import { GeoQueryParselet } from "./parselets/GeoQueryParselet";

/** Error codes this package answers with. Each names something a reader can correct. */
export const GeoErrorCodes = {
	/** A distance or bearing was given something that is not a place. */
	GEO_EXPECTED_PLACE: "GEO_EXPECTED_PLACE",
	/** A latitude or longitude was outside the globe. */
	GEO_OUT_OF_RANGE: "GEO_OUT_OF_RANGE",
	/** An angle literal's parts do not make an angle (75 minutes, say). */
	GEO_BAD_ANGLE: "GEO_BAD_ANGLE",
	/** Two lettered angles side by side were not one latitude and one longitude. */
	GEO_NOT_A_PLACE: "GEO_NOT_A_PLACE",
	/** The two places have no single direction between them. */
	GEO_NO_BEARING: "GEO_NO_BEARING",
	/** `as dms` was given something that is not an angle or a place. */
	GEO_EXPECTED_ANGLE: "GEO_EXPECTED_ANGLE",
} as const;

/** The unit an angle answer is given in, the same one `90°` produces. */
const DEGREES = "degrees";

/** How a place is shown in a refusal: the pair as typed. */
const PLACE_EXAMPLE = "(51.5074, -0.1278) or 51.5074°N 0.1278°W";

/** An angle Value in degrees: a plain number is taken as degrees, an angle unit is converted. */
function degreesOf(value: Value): number | null {
	if (value.type === ValueType.Number) return value.value as number;
	if (value.type === ValueType.Uom && value.unit !== undefined && getMeasure(value.unit) === "angle") {
		return value.unit === DEGREES ? value.toNumber() : convertUnit(value.toNumber(), value.unit, DEGREES);
	}
	return null;
}

/** A place from a two-number matrix, or the refusal that says why it is not one. */
function placeOf(value: Value, which: string): { place: GeoPoint } | { fault: Value } {
	if (value.type !== ValueType.Matrix) {
		return {
			fault: errorValue(
				GeoErrorCodes.GEO_EXPECTED_PLACE,
				`the ${which} place is not a latitude and a longitude: write it as ${PLACE_EXAMPLE}`,
			),
		};
	}
	const matrix = value.value as MatrixData;
	if (matrix.data.length !== 2) {
		return {
			fault: errorValue(
				GeoErrorCodes.GEO_EXPECTED_PLACE,
				`the ${which} place has ${matrix.data.length} numbers, and a place is two, a latitude and a longitude, as in ${PLACE_EXAMPLE}`,
			),
		};
	}
	const [lat, lon] = matrix.data;
	if (typeof lat !== "number" || typeof lon !== "number") {
		return {
			fault: errorValue(
				GeoErrorCodes.GEO_EXPECTED_PLACE,
				`the ${which} place is not two numbers: write it as ${PLACE_EXAMPLE}`,
			),
		};
	}
	const problem = placeProblem(lat, lon);
	if (problem !== null) return { fault: errorValue(GeoErrorCodes.GEO_OUT_OF_RANGE, problem) };
	return { place: { lat, lon } };
}

/** Both places of a distance or bearing, or the refusal for the first that is not one. */
function placesOf(args: Value[]): { from: GeoPoint; to: GeoPoint } | { fault: Value } {
	const from = placeOf(args[0], "first");
	if ("fault" in from) return from;
	const to = placeOf(args[1], "second");
	if ("fault" in to) return to;
	return { from: from.place, to: to.place };
}

/** A place as the engine holds it: a row of two numbers, latitude then longitude. */
function placeValue(lat: number, lon: number): Value {
	const problem = placeProblem(lat, lon);
	return problem === null ? rowVectorValue([lat, lon]) : errorValue(GeoErrorCodes.GEO_OUT_OF_RANGE, problem);
}

/** A `GEO_ANGLE` literal's text as degrees, with its compass letter, or the refusal. */
function literalDegrees(text: string): { degrees: number; hemisphere?: string } | Value {
	const literal = readGeoAngle(text);
	if (literal === null) return errorValue(GeoErrorCodes.GEO_BAD_ANGLE, `${text} is not an angle this can read`);
	const answer = anglePartsToDegrees(literal.degrees, literal.minutes, literal.seconds, literal.hemisphere);
	if ("problem" in answer) return errorValue(GeoErrorCodes.GEO_BAD_ANGLE, answer.problem);
	return { degrees: answer.degrees, hemisphere: literal.hemisphere };
}

/** `51°30'27"` or `51.5074°N` on its own: an angle, in degrees, signed by its compass letter. */
function geoAngle(args: Value[]): Value {
	const read = literalDegrees(args[0].value as string);
	return "degrees" in read ? uomValue(read.degrees, DEGREES) : read;
}

/** `51°30'26"N 0°07'40"W`: two lettered angles as one place, in either order. */
function geoPlaceFromAngles(args: Value[]): Value {
	const first = literalDegrees(args[0].value as string);
	if (!("degrees" in first)) return first;
	const second = literalDegrees(args[1].value as string);
	if (!("degrees" in second)) return second;

	const isLatitude = (h: string | undefined): boolean => h === "N" || h === "S";
	if (isLatitude(first.hemisphere) === isLatitude(second.hemisphere)) {
		const kind = isLatitude(first.hemisphere) ? "latitudes (N or S)" : "longitudes (E or W)";
		return errorValue(
			GeoErrorCodes.GEO_NOT_A_PLACE,
			`${args[0].value} and ${args[1].value} are both ${kind}: a place is one latitude and one longitude, as in 51.5074°N 0.1278°W`,
		);
	}
	return isLatitude(first.hemisphere)
		? placeValue(first.degrees, second.degrees)
		: placeValue(second.degrees, first.degrees);
}

/** `51.5074, -0.1278` with no brackets, inside a distance or bearing: two numbers joined into a place. */
function geoPlace(args: Value[]): Value {
	const lat = degreesOf(args[0]);
	const lon = degreesOf(args[1]);
	if (lat === null || lon === null) {
		return errorValue(
			GeoErrorCodes.GEO_EXPECTED_PLACE,
			`a latitude and a longitude are numbers of degrees, as in ${PLACE_EXAMPLE}`,
		);
	}
	return placeValue(lat, lon);
}

/** `distance from <place> to <place>`: the great-circle distance, in kilometres. */
function geoDistance(args: Value[]): Value {
	const places = placesOf(args);
	if ("fault" in places) return places.fault;
	return uomValue(greatCircleKm(places.from, places.to), "km");
}

/** `bearing from <place> to <place>`: the initial compass heading, in degrees. */
function geoBearing(args: Value[]): Value {
	const places = placesOf(args);
	if ("fault" in places) return places.fault;
	const bearing = initialBearing(places.from, places.to);
	if (bearing === "same place") {
		return errorValue(GeoErrorCodes.GEO_NO_BEARING, "the two places are the same point, so there is no direction from one to the other");
	}
	if (bearing === "antipodes") {
		return errorValue(
			GeoErrorCodes.GEO_NO_BEARING,
			"the two places are on exactly opposite sides of the Earth, so every direction reaches the second and there is no single bearing",
		);
	}
	return uomValue(bearing, DEGREES);
}

/**
 * `<angle> as dms`: an angle in degrees, minutes and seconds, or a place with
 * its compass letters (`51°30'26.64"N 0°07'40.08"W`).
 */
function asDms(value: Value): Value {
	if (value.type === ValueType.Matrix) {
		const read = placeOf(value, "given");
		return "fault" in read ? read.fault : stringValue(formatPlaceDms(read.place));
	}
	const degrees = degreesOf(value);
	if (degrees === null || !Number.isFinite(degrees)) {
		const shown = value.type === ValueType.Uom ? `${plain(value.toNumber())} ${value.unit}` : "this value";
		return errorValue(
			GeoErrorCodes.GEO_EXPECTED_ANGLE,
			`"as dms" writes an angle in degrees, minutes and seconds, and ${shown} is not an angle`,
		);
	}
	return stringValue(formatDms(degrees));
}

/**
 * Geo: places on the globe by their coordinates, the distance between two of
 * them, the direction from one to the other, and angles written as a map
 * writes them.
 *
 * A coordinate is a latitude (how far north or south of the equator) and a
 * longitude (how far east or west of Greenwich), both in degrees. The distance
 * is the great-circle distance, the shortest path over the Earth's surface,
 * worked on a sphere of the mean radius (see `GeoMath.ts` for why a sphere);
 * the bearing is the compass heading at the start of that path.
 *
 * The boundary: places are typed as coordinates, or held in a variable. There is
 * no built-in list of cities and nothing reaches the network, so `distance from
 * London to Tokyo` needs `London` and `Tokyo` defined first. The distance is as
 * the crow flies, not by road, and ignores height above the ground.
 */
export const GEO_PACKAGE: IEnginePackage = {
	name: "solve-geo",
	phrases: {
		"distance from": "GEO_DISTANCE_FROM",
		"distance between": "GEO_DISTANCE_BETWEEN",
		"bearing from": "GEO_BEARING_FROM",
	},
	prefixParselets: {
		GEO_ANGLE: new GeoAngleParselet(),
		GEO_DISTANCE_FROM: new GeoQueryParselet("geoDistance", "TO"),
		GEO_DISTANCE_BETWEEN: new GeoQueryParselet("geoDistance", "AND_CONJ"),
		GEO_BEARING_FROM: new GeoQueryParselet("geoBearing", "TO"),
	},
	pluginFunctions: {
		geoAngle,
		geoPlaceFromAngles,
		geoPlace,
		geoDistance,
		geoBearing,
	},
	asConverters: {
		dms: asDms,
	},
	tokenCategories: {
		GEO_DISTANCE_FROM: "keyword",
		GEO_DISTANCE_BETWEEN: "keyword",
		GEO_BEARING_FROM: "keyword",
	},
};
