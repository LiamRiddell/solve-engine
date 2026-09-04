/**
 * The root font size a `rem` is measured against, when it is not the CSS
 * default of 16px.
 *
 * One `rem` is whatever the page's root font size is. The engine's plain `px in
 * rem` conversion treats that as 16px, the browser default, which is what most
 * pages leave it at. A page that sets its own root needs the same sum against a
 * different number, and that is all this is: a division or a multiplication by
 * the stated base.
 *
 * @module RootFontSize
 */

/** An amount and the unit it is in. */
export interface SizedValue {
	/** The amount. */
	readonly amount: number;
	/** The unit, `px` or `rem`. */
	readonly unit: "px" | "rem";
}

/** Whether a unit is one this can convert between: the two the root size relates. */
export function isRootRelativeUnit(unit: string): unit is "px" | "rem" {
	return unit === "px" || unit === "rem";
}

/**
 * The same size in the other unit, measured against a stated root font size:
 * a `rem` becomes pixels, pixels become `rem`.
 *
 * @param amount - The size.
 * @param unit - The unit it is written in, `px` or `rem`.
 * @param basePx - The root font size in pixels, which must be above zero.
 * @returns The size in the other unit, or null for a unit this does not relate or a base that is not positive.
 */
export function atRootFontSize(amount: number, unit: string, basePx: number): SizedValue | null {
	if (!isRootRelativeUnit(unit)) return null;
	if (!(basePx > 0) || !Number.isFinite(basePx)) return null;
	return unit === "rem" ? { amount: amount * basePx, unit: "px" } : { amount: amount / basePx, unit: "rem" };
}
