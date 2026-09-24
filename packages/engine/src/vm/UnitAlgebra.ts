/**
 * Products and quotients of quantities whose units cancel, or refuse to.
 *
 * Units multiply and divide the way numbers do. A rate is a quantity per unit of
 * something else, and multiplying it by that something cancels the unit it is
 * per: $0.30 per kilowatt-hour times six kilowatt-hours is $1.80, and 60 miles
 * an hour for two hours is 120 miles. Dividing a quantity by a rate for it
 * cancels the other way: 20 square metres of wall at 5 square metres to the
 * litre is 4 litres of paint. A quotient of two rates cancels what the two share.
 *
 * What cannot cancel into a unit the engine can show is refused by name rather
 * than answered with a unit that is wrong: a mass times a mass, a speed divided
 * by a time, a quantity divided by a rate for something else. The rule the
 * engine keeps is the right answer or a named error, never a number wearing the
 * left operand's unit.
 *
 * The run-time half, called from `vm/VM.ts`'s multiply and divide once their own
 * rules for plain numbers, money counts, named derived units and lengths have
 * had their turn. Products and quotients of lengths are in `QuantityPowers.ts`,
 * and named derived units (newtons, joules, watts) in `uom/Dimensions.ts`.
 */

import { Value, ValueType, uomValue, numberValue, errorValue } from "@solve-js/vm/Value";
import { rateForm, isNamedRate, type RateForm } from "@solve-js/uom/RateForms";
import { getMeasure, convertUnit } from "@solve-js/uom/UomConverter";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { describeMeasure } from "@solve-js/vm/VMConversion";

/**
 * The factor that turns one `from` into `to`, or `null` when the two do not
 * measure the same thing. Two currencies line up through the cached exchange
 * rate, and have no factor until one is known. A temperature lines up only with
 * itself, since a change of temperature scale is an offset rather than a factor.
 */
function axisFactor(from: string, to: string): number | null {
	if (from === to) return 1;
	if (from === "" || to === "") return null;
	const fromMoney = sharedCurrencyExchange.isCurrency(from);
	const toMoney = sharedCurrencyExchange.isCurrency(to);
	if (fromMoney || toMoney) {
		return fromMoney && toMoney ? sharedCurrencyExchange.convertSync(1, from, to) : null;
	}
	const measure = getMeasure(from);
	if (measure === undefined || measure === "temperature" || measure !== getMeasure(to)) return null;
	return convertUnit(1, from, to);
}

/** A rate's magnitude in its own `numerator/denominator` pair. */
function inPair(value: Value, form: RateForm): number {
	return value.toNumber() * form.scale;
}

/**
 * A rate's denominator as the unit of a count of it: a word takes its plural
 * when the table has one, so `$100 / $5/hour` is 20 hours, as `$100 at $5/hour`
 * already was. A symbol (`h`, `kg`) is left as it is: the plural must be the
 * same unit, since `hs` is a hectosecond and not two hours.
 */
function countOf(unit: string, count: number): string {
	if (count === 1) return unit;
	const plural = `${unit}s`;
	const entry = UNIT_TABLE[unit];
	return entry !== undefined && UNIT_TABLE[plural] === entry ? plural : unit;
}

/** A value in `unit`, where a countless unit is the plain number it is. */
function quantityIn(magnitude: number, unit: string): Value {
	return unit === "" ? numberValue(magnitude) : uomValue(magnitude, unit);
}

/**
 * The error for a quotient with no unit.
 *
 * @param left - The dividend's unit.
 * @param right - The divisor's unit.
 * @returns A `UNIT_QUOTIENT_UNSUPPORTED` error value.
 */
export function unitQuotientUnsupported(left: string, right: string): Value {
	return errorValue(
		"UNIT_QUOTIENT_UNSUPPORTED",
		`A quantity in ${left} divided by one in ${right} has no unit: nothing cancels, and ${left} per ${right} is a rate of a rate, which is not a unit.`,
	);
}

/**
 * A product in which a rate meets what it is per, or two rates chain, as the
 * quantity or rate left once the shared unit cancels; `undefined` when neither
 * operand is a rate, or they share nothing, so the caller keeps its own rule.
 *
 * A named rate times a quantity cancels like a compound one: `60 mph * 2 h` is
 * 120 miles, where the unit arithmetic used to refuse a speed times a time. Two
 * rates chain when one is per what the other counts: `$30/h * 8 h/day` is $240
 * a day, and `60 km/h * 2 h/day` is 120 km a day. When both halves cancel the
 * answer is a plain number. The general multiply keeps a compound rate times a
 * matching quantity (`$50/week * 12 weeks`), which is why only a named rate is
 * cancelled against a plain quantity here.
 *
 * @param l - The left operand, a Uom with its unit set.
 * @param r - The right operand, a Uom with its unit set.
 * @returns The product, or `undefined` if these are not a rate and its match.
 */
export function multiplyRates(l: Value, r: Value): Value | undefined {
	if (l.type !== ValueType.Uom || r.type !== ValueType.Uom || l.unit === undefined || r.unit === undefined) return undefined;
	const lf = rateForm(l.unit);
	const rf = rateForm(r.unit);
	if (lf === null && rf === null) return undefined;

	if (lf !== null && rf !== null) {
		const lv = inPair(l, lf);
		const rv = inPair(r, rf);
		// (a/b) * (c/d). The left is per what the right counts: b cancels c.
		const bc = axisFactor(rf.numerator, lf.denominator);
		if (bc !== null) {
			const product = lv * rv * bc;
			// Both halves cancel: (a/b) * (b/a) is a plain number.
			const ad = axisFactor(lf.numerator, rf.denominator);
			if (ad !== null) return numberValue(product * ad);
			return uomValue(product, `${lf.numerator}/${rf.denominator}`);
		}
		// The right is per what the left counts: d cancels a.
		const da = axisFactor(lf.numerator, rf.denominator);
		if (da !== null) return quantityIn(lv * rv * da, `${rf.numerator}/${lf.denominator}`);
		return undefined;
	}

	// A named rate against a plain quantity measured in what the rate is per.
	const [rate, form, quantity] = lf !== null ? [l, lf, r] : [r, rf as RateForm, l];
	if (!isNamedRate(rate.unit as string)) return undefined;
	const factor = axisFactor(quantity.unit as string, form.denominator);
	if (factor === null) return undefined;
	return quantityIn(inPair(rate, form) * quantity.toNumber() * factor, form.numerator);
}

/**
 * A quotient involving a rate, as the quantity, rate or plain number left once
 * the shared unit cancels; `undefined` when neither operand is a rate, so the
 * caller keeps its own rule (a quantity over a quantity is a new rate).
 *
 * - A quantity over a rate for it is a quantity of what the rate is per:
 *   `20 m² / (5 m²/l)` is 4 litres, `$100 / ($5/kg)` is 20 kg and
 *   `120 mi / 60 mph` is 2 hours.
 * - A rate over a quantity it counts is a rate of how often: `(60 km/h) / 2 km`
 *   is 30 an hour.
 * - A rate over a rate cancels what the two share: two speeds make a plain
 *   ratio, and `(100 km/h) / (10 l/h)` is 10 km/l.
 *
 * Anything else with a compound rate on either side is refused by name. The
 * general divide used to join the two units with another slash, so
 * `(100 km/h) / 2 h` was 50 km/h/h and `$100 / ($5/kg)` 20 USD/USD/kg. A named
 * rate (`mph`) that meets nothing it cancels against is left to the caller,
 * whose `kg/mph` is at least a unit with one slash.
 *
 * @param l - The dividend, a Uom with its unit set.
 * @param r - The divisor, a Uom with its unit set.
 * @returns The quotient, an error value, or `undefined` if neither is a rate.
 */
export function divideRates(l: Value, r: Value): Value | undefined {
	if (l.type !== ValueType.Uom || r.type !== ValueType.Uom || l.unit === undefined || r.unit === undefined) return undefined;
	const lf = rateForm(l.unit);
	const rf = rateForm(r.unit);
	if (lf === null && rf === null) return undefined;
	const refuse = (): Value | undefined =>
		(lf === null || isNamedRate(l.unit as string)) && (rf === null || isNamedRate(r.unit as string))
			? undefined
			: unitQuotientUnsupported(l.unit as string, r.unit as string);

	if (lf === null && rf !== null) {
		// A quantity over a rate for it.
		const factor = axisFactor(l.unit, rf.numerator);
		if (factor === null) return refuse();
		const count = (l.toNumber() * factor) / inPair(r, rf);
		return uomValue(count, countOf(rf.denominator, count));
	}
	if (lf !== null && rf === null) {
		// A rate over a quantity it counts, which leaves how often.
		const factor = axisFactor(r.unit, lf.numerator);
		if (factor === null) return refuse();
		return uomValue(inPair(l, lf) / (r.toNumber() * factor), `/${lf.denominator}`);
	}

	// (a/b) / (c/d).
	const left = lf as RateForm;
	const right = rf as RateForm;
	const lv = inPair(l, left);
	const rv = inPair(r, right);
	const ac = axisFactor(left.numerator, right.numerator);
	if (ac !== null) {
		const bd = axisFactor(left.denominator, right.denominator);
		// Both halves cancel: a plain ratio.
		if (bd !== null) return numberValue((lv * ac) / bd / rv);
		// The numerators cancel, leaving d per b.
		return uomValue((lv * ac) / rv, `${right.denominator}/${left.denominator}`);
	}
	// The denominators cancel, leaving a per c. Not for two currencies with no
	// rate between them yet: money per money is an exchange rate, which the
	// general divide already refuses to invent for `$5 / €2`.
	const db = axisFactor(right.denominator, left.denominator);
	const twoCurrencies = sharedCurrencyExchange.isCurrency(left.numerator) && sharedCurrencyExchange.isCurrency(right.numerator);
	if (db !== null && !twoCurrencies) return quantityIn((lv * db) / rv, `${left.numerator}/${right.numerator}`);
	return refuse();
}

/**
 * A plain number divided by a quantity, as the reciprocal it is: `1 / (2 m)` is
 * half of one per metre, `0.50 /m`, and `10 / (5 s)` is two a second. The
 * general divide kept the quantity's unit, so the first was reported as half a
 * metre (#570). `undefined` when the operands are not a number over a quantity.
 *
 * The reciprocal unit is the per-unit rate the engine already writes as `/m`
 * (the same one `(60 km/h) / 2 km` gives as `/h`), so it cancels against the
 * quantity again: `1 / (2 m) * 4 m` is 2. A rate turns over (`1 / (60 km/h)` is
 * a time per kilometre, `h/km`), a count per something turns into that something
 * (`1 / (2/week)` is half a week), and a frequency is its period in seconds
 * (`1 / (50 Hz)` is 0.02 s). A quantity with no reciprocal the engine can show,
 * a temperature or a label that is not a unit, is refused by name.
 *
 * `1 / 2 hour` never arrives here: a fraction written in front of a unit is
 * bracketed by the uom package's fraction rule, so it is still half an hour.
 *
 * @param l - The dividend.
 * @param r - The divisor.
 * @returns The reciprocal, an error value, or `undefined` if not applicable.
 */
export function reciprocalOf(l: Value, r: Value): Value | undefined {
	if (l.type !== ValueType.Number || r.type !== ValueType.Uom || r.unit === undefined) return undefined;
	const unit = r.unit;
	const form = rateForm(unit);
	if (form !== null) {
		const magnitude = l.toNumber() / inPair(r, form);
		return form.numerator === "" ? uomValue(magnitude, form.denominator) : uomValue(magnitude, `${form.denominator}/${form.numerator}`);
	}
	const measure = getMeasure(unit);
	if (measure === "frequency") return uomValue(l.toNumber() / convertUnit(r.toNumber(), unit, "Hz"), "s");
	if ((measure !== undefined && measure !== "temperature") || sharedCurrencyExchange.isCurrency(unit)) {
		return uomValue(l.toNumber() / r.toNumber(), `/${unit}`);
	}
	return errorValue(
		"UNIT_RECIPROCAL_UNSUPPORTED",
		measure === "temperature"
			? `A number divided by a temperature in ${unit} has no unit: a temperature is measured from a zero point of its own, so there is no "per degree" to show it in.`
			: `A number divided by a quantity in ${unit} has no unit: ${unit} is not a unit the engine can count "per" of.`,
	);
}

/**
 * The error for a product of two quantities of the same kind that are not
 * lengths, or `undefined` when the pair is not that. A mass times a mass has no
 * unit the engine can show, and neither has money times money; the general
 * multiply converted the right operand into the left's unit and kept only that,
 * so `2 kg * 3 kg` was reported as 6 kg. Lengths never arrive here: they
 * multiply into an area or a volume first.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @returns A `UNIT_PRODUCT_UNSUPPORTED` error value, or `undefined`.
 */
export function refuseLikeProduct(l: Value, r: Value): Value | undefined {
	if (l.type !== ValueType.Uom || r.type !== ValueType.Uom || l.unit === undefined || r.unit === undefined) return undefined;
	const left = describeMeasure(l.unit);
	const alike = l.unit === r.unit || (left !== undefined && left === describeMeasure(r.unit));
	if (!alike) return undefined;
	const noun = left ?? l.unit;
	return errorValue(
		"UNIT_PRODUCT_UNSUPPORTED",
		`A quantity in ${l.unit} times one in ${r.unit} has no unit: ${noun} times ${noun} is not a unit. Lengths multiply into an area or a volume, and no other quantity squares into one.`,
	);
}
