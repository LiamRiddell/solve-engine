import type { ExplainCall, ExplainContext, ExplanationStep } from "@solve-js/explain/Explanation";
import { uomValue } from "@solve-js/vm/Value";
import { convertRate, convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";

/**
 * A unit as it reads after "1": `mile` rather than `miles`, where the unit
 * table knows the singular as the same unit. The check is on the unit, not the
 * spelling, so `ms` (milliseconds) is never cut down to `m` (metres).
 */
function singular(unit: string): string {
	if (unit.length < 3 || !unit.endsWith("s")) return unit;
	const candidate = unit.slice(0, -1);
	const measure = getMeasure(unit);
	if (!measure || getMeasure(candidate) !== measure) return unit;
	return convertUnit(1, candidate, unit) === 1 ? candidate : unit;
}

/**
 * Describe a unit, rate or currency conversion (`5 km in miles`) as the factor
 * the engine converts by and the multiplication by it.
 *
 * The factor is the engine's own: the same conversion function the VM used,
 * asked what one unit of the source is. A linear conversion reads as two steps,
 * `1 km is 0.621371 miles` and `5 times 0.621371`, the second carrying the
 * conversion's own result. A temperature scale is not linear (0 °C is not 0 °F),
 * so it reads as the offset and the rate per degree instead. A time-zone
 * reading of a date is not a conversion by a factor and is left undescribed.
 *
 * @param call - The call to describe; only `"conversion"` calls are.
 * @param context - The formatting the engine hands every hook.
 * @returns The steps, or `undefined` for anything else.
 */
export function explainConversion(call: ExplainCall, context: ExplainContext): readonly ExplanationStep[] | undefined {
	if (call.kind !== "conversion") return undefined;
	const source = call.args[0];
	const from = source?.unit;
	const to = call.result.unit;
	if (from === undefined || to === undefined) return undefined;
	const { formatNumber } = context;
	const magnitude = source.toNumber();

	let offset = 0;
	let factor: number | null;
	if (call.name === "measure") {
		offset = convertUnit(0, from, to);
		factor = convertUnit(1, from, to) - offset;
	} else if (call.name === "rate") {
		factor = convertRate(1, from, to);
	} else if (call.name === "currency") {
		factor = sharedCurrencyExchange.convertSync(1, from, to);
	} else {
		return undefined;
	}
	if (factor === null || !Number.isFinite(factor)) return undefined;

	if (offset === 0) {
		return [
			{ description: `1 ${singular(from)} is ${formatNumber(factor)} ${to}`, value: uomValue(factor, to) },
			{ description: `${formatNumber(magnitude)} times ${formatNumber(factor)}`, value: call.result },
		];
	}
	return [
		{
			description: `0 ${from} is ${formatNumber(offset)} ${to}, and each 1 ${from} adds ${formatNumber(factor)} ${to}`,
			value: uomValue(offset, to),
		},
		{ description: `${formatNumber(offset)} plus ${formatNumber(magnitude)} times ${formatNumber(factor)}`, value: call.result },
	];
}
