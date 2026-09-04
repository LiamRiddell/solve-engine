import { reduceRatio } from "@solve-js/packages/ratio/RatioOps";

/**
 * Pixel dimensions: the aspect ratio of a pair, and the pair a resize produces.
 *
 * Both are pure functions over whole numbers of pixels. Screens and image files
 * are counted in whole pixels, so a resize rounds to one rather than answering
 * with a fraction of a pixel that no file can hold.
 *
 * @module Dimensions
 */

/** A width and a height, in whole pixels. */
export interface PixelSize {
	/** Width in pixels. */
	readonly width: number;
	/** Height in pixels. */
	readonly height: number;
}

/** Whether a pair can be treated as pixel dimensions: two whole positive counts. */
export function isPixelSize(width: number, height: number): boolean {
	return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
}

/**
 * The aspect ratio of a pair, in lowest whole-number terms: 1920 by 1080 is
 * `16:9`. Null for a pair that is not two whole positive counts.
 */
export function aspectRatioOf(width: number, height: number): string | null {
	if (!isPixelSize(width, height)) return null;
	return reduceRatio([width, height]);
}

/**
 * The pair a resize produces, keeping the original shape: a target width sets
 * the height, a target height sets the width.
 *
 * The other side is rounded to the nearest whole pixel, which is what an image
 * file can actually hold, so the ratio of the result is only as exact as whole
 * pixels allow: 4000 by 3000 to 1200 wide is exactly 900 tall, and 1000 by 333
 * to 500 wide is 167 tall rather than 166.5.
 *
 * @param width - The original width in pixels.
 * @param height - The original height in pixels.
 * @param target - The size the named side becomes.
 * @param side - Which side `target` names.
 * @returns The resized pair, or null if either the original or the target is not a whole positive count.
 */
export function resizeToSide(width: number, height: number, target: number, side: "width" | "height"): PixelSize | null {
	if (!isPixelSize(width, height)) return null;
	if (!Number.isInteger(target) || target <= 0) return null;
	if (side === "width") {
		return { width: target, height: Math.max(1, Math.round((height * target) / width)) };
	}
	return { width: Math.max(1, Math.round((width * target) / height)), height: target };
}

/** A pair written the way the engine displays it, `1200 x 900`. */
export function formatPixelSize(size: PixelSize): string {
	return `${size.width} x ${size.height}`;
}
