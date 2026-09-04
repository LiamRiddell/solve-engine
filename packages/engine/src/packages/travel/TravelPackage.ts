import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { errorValue, isRateUnit, splitRateUnit, uomValue, Value, ValueType } from "@solve-js/vm/Value";
import { isFuelEconomyUnit, litresForTrip } from "./TripCost";
import { TripFuelParselet } from "./parselets/TripFuelParselet";

/** Error codes this package answers with. Each names something a driver can correct. */
export const TravelErrorCodes = {
	/** The first quantity was not a distance. */
	TRIP_EXPECTED_DISTANCE: "TRIP_EXPECTED_DISTANCE",
	/** The second quantity was not a fuel economy. */
	TRIP_EXPECTED_ECONOMY: "TRIP_EXPECTED_ECONOMY",
	/** The price was not an amount of money for a volume. */
	TRIP_EXPECTED_FUEL_PRICE: "TRIP_EXPECTED_FUEL_PRICE",
} as const;

/** The distance and economy both trip forms start with, or the fault that says which was wrong. */
function litresOrFault(distance: Value, economy: Value): { litres: number } | { fault: Value } {
	if (distance.type !== ValueType.Uom || distance.unit === undefined || getMeasure(distance.unit) !== "length") {
		return {
			fault: errorValue(
				TravelErrorCodes.TRIP_EXPECTED_DISTANCE,
				'a trip starts with a distance, as in "fuel for 500 km at 7 l/100km"',
			),
		};
	}
	if (economy.type !== ValueType.Uom || economy.unit === undefined || !isFuelEconomyUnit(economy.unit)) {
		return {
			fault: errorValue(
				TravelErrorCodes.TRIP_EXPECTED_ECONOMY,
				`"${economy.unit ?? economy.toNumber()}" is not a fuel economy: write it as mpg or l/100km`,
			),
		};
	}
	const litres = litresForTrip(distance.toNumber(), distance.unit, economy.toNumber(), economy.unit);
	if (litres === null) {
		return {
			fault: errorValue(
				TravelErrorCodes.TRIP_EXPECTED_ECONOMY,
				`${economy.toNumber()} ${economy.unit} is not an economy a trip can be worked out from`,
			),
		};
	}
	return { litres };
}

/** `fuel for <distance> at <economy>` -> the volume, in litres. */
function tripFuel(args: Value[]): Value {
	const answer = litresOrFault(args[0], args[1]);
	return "fault" in answer ? answer.fault : uomValue(answer.litres, "litre");
}

/**
 * `cost to drive <distance> at <economy> at <price>` -> what the fuel costs.
 *
 * The price carries its own volume unit (`£1.50/litre`, `$4.20/gallon`), so the
 * litres are converted into whatever the pump was quoted in before multiplying.
 * A price per gallon and a distance in kilometres is an ordinary mixture on a
 * hire car, and it should not need the reader to convert anything by hand.
 */
function tripCost(args: Value[]): Value {
	const answer = litresOrFault(args[0], args[1]);
	if ("fault" in answer) return answer.fault;

	const price = args[2];
	if (price.type !== ValueType.Uom || price.unit === undefined || !isRateUnit(price.unit)) {
		return errorValue(
			TravelErrorCodes.TRIP_EXPECTED_FUEL_PRICE,
			'a fuel price is an amount for a volume, as in "£1.50/litre"',
		);
	}
	const { numerator, denominator } = splitRateUnit(price.unit);
	if (getMeasure(denominator) !== "volume") {
		return errorValue(
			TravelErrorCodes.TRIP_EXPECTED_FUEL_PRICE,
			`fuel is priced by volume, and "${price.unit}" is priced by ${getMeasure(denominator) ?? denominator}`,
		);
	}
	const volumeAtThePump = denominator === "litre" ? answer.litres : convertUnit(answer.litres, "litre", denominator);
	return uomValue(volumeAtThePump * price.toNumber(), numerator);
}

/**
 * Travel: what a journey burns, and what that costs.
 *
 * Drive time (`250 miles at 60 mph`) and economy conversion (`40 mpg in
 * l/100km`) already ship, in the units and fuel packages. What was missing is
 * the pair of sums that join a distance, a car's economy and the price at the
 * pump, which no unit conversion can express because each needs two quantities
 * of different kinds.
 *
 * The boundary the issue draws and this keeps: no live fuel prices. The price
 * is stated on the line, because a pump price is local, changes daily, and
 * guessing one would be worse than asking.
 */
export const TRAVEL_PACKAGE: IEnginePackage = {
	name: "solve-travel",
	phrases: {
		"cost to drive": "TRIP_COST",
		"fuel for": "TRIP_FUEL",
		"fuel to drive": "TRIP_FUEL",
	},
	prefixParselets: {
		TRIP_COST: new TripFuelParselet("tripCost", true),
		TRIP_FUEL: new TripFuelParselet("tripFuel", false),
	},
	pluginFunctions: {
		tripCost,
		tripFuel,
	},
	tokenCategories: {
		TRIP_COST: "keyword",
		TRIP_FUEL: "keyword",
	},
};
