/**
 * Pixels and physical length, bridged by a stated density.
 *
 * A pixel has no physical size of its own: how large an image prints, or how
 * many pixels a printed inch needs, depends on how many dots the printer or the
 * screen packs into each inch (its density, in dots or pixels per inch: `dpi`,
 * `ppi`). The engine keeps pixels apart from physical length for that reason
 * (a CSS pixel is a reference pixel, not a slice of a centimetre), and a density
 * written on the line is the one thing that relates the two. This is that sum: a
 * division or a multiplication by the stated density.
 *
 * @module PixelDensity
 */

import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";

/** An amount and the unit it is in. */
export interface DensityResult {
	/** The amount. */
	readonly amount: number;
	/** `in` for a print size worked out from pixels, `px` for pixels worked out from a length. */
	readonly unit: "in" | "px";
}

/**
 * Whether `dotsPerInch` is a density a size can be measured against: a finite
 * number above zero.
 *
 * @param dotsPerInch - The stated density.
 * @returns True when it is above zero and finite.
 */
export function isUsableDensity(dotsPerInch: number): boolean {
	return Number.isFinite(dotsPerInch) && dotsPerInch > 0;
}

/**
 * The same size on the other side of a stated density: pixels (or `rem`, at the
 * CSS default of 16px) become inches, and a physical length becomes pixels.
 *
 * @param amount - The size.
 * @param unit - Its unit: a CSS length (`px`, `rem`) or a physical length (`in`, `mm`, `cm`, ...).
 * @param dotsPerInch - The density, which must be above zero and finite.
 * @returns The size across the density, or null for a unit that is neither kind or a density that is not usable.
 */
export function atPixelDensity(amount: number, unit: string, dotsPerInch: number): DensityResult | null {
	if (!isUsableDensity(dotsPerInch)) return null;
	const measure = getMeasure(unit);
	if (measure === "cssLength") {
		const pixels = unit === "px" ? amount : convertUnit(amount, unit, "px");
		return { amount: pixels / dotsPerInch, unit: "in" };
	}
	if (measure === "length") {
		const inches = unit === "in" ? amount : convertUnit(amount, unit, "in");
		return { amount: inches * dotsPerInch, unit: "px" };
	}
	return null;
}
