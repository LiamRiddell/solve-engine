import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { fuelConsumptionNormalizerRule } from "./normalizer/FuelEconomyNormalizerRule";

/**
 * Fuel economy (issue #190): the abbreviations `mpg` and `kmpl`, and the
 * reciprocal conversion between distance-per-volume (miles per gallon, km per
 * litre) and volume-per-distance (litres per 100 km). The reciprocal itself
 * lives in the unit converter; this package just teaches the abbreviations. On
 * by default and removable.
 */
export const FUEL_PACKAGE: IEnginePackage = {
	name: "solve-fuel",
	normalizerRules: [fuelConsumptionNormalizerRule()],
};
