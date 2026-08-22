/**
 * Pure colour maths for the colour package. Everything here is a plain function
 * over numbers and {@link ColourData} with no engine imports and no side effects,
 * so it is trivially unit-testable and can be reused by a host renderer (the docs
 * notepad reads these to draw a swatch). Canonical storage is sRGB: `r`,`g`,`b`
 * are integers 0-255 and `a` is 0-1. HSL is derived on demand and re-quantised,
 * never stored, so equal-and-opposite operations return to a stable colour.
 */
import type { ColourData, ColourFormat } from "@solve-js/vm/Value";
import { CSS_NAMED_COLOURS } from "./CssNamedColours";

/** Round and clamp a value to a valid 0-255 sRGB channel. */
export function clamp255(x: number): number {
	return Math.min(255, Math.max(0, Math.round(x)));
}

/** Clamp a value to the 0-1 range used for alpha and normalised HSL. */
export function clamp01(x: number): number {
	return Math.min(1, Math.max(0, x));
}

function hexByte(n: number): string {
	return clamp255(n).toString(16).padStart(2, "0");
}

/**
 * Render the alpha channel the way CSS does: a plain decimal with no trailing
 * zeros (`1`, `0.5`, `0.333`), so `rgba(255, 0, 0, 0.5)` reads back cleanly.
 */
function formatAlpha(a: number): string {
	return String(Number(a.toFixed(3)));
}

// ── Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a CSS hex colour: `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`,
 * case-insensitive, leading `#` optional. Three and four digit forms expand each
 * nibble (`f` becomes `ff`), matching a browser. Any other length or a non-hex
 * character returns null so the caller can raise a clear error.
 */
export function parseHex(input: string): ColourData | null {
	const s = input.startsWith("#") ? input.slice(1) : input;
	if (!/^[0-9a-fA-F]+$/.test(s)) return null;
	const dbl = (h: string): number => parseInt(h + h, 16);
	const pair = (h: string): number => parseInt(h, 16);
	switch (s.length) {
		case 3:
			return { r: dbl(s[0]), g: dbl(s[1]), b: dbl(s[2]), a: 1, format: "hex" };
		case 4:
			return { r: dbl(s[0]), g: dbl(s[1]), b: dbl(s[2]), a: dbl(s[3]) / 255, format: "hex" };
		case 6:
			return { r: pair(s.slice(0, 2)), g: pair(s.slice(2, 4)), b: pair(s.slice(4, 6)), a: 1, format: "hex" };
		case 8:
			return {
				r: pair(s.slice(0, 2)),
				g: pair(s.slice(2, 4)),
				b: pair(s.slice(4, 6)),
				a: pair(s.slice(6, 8)) / 255,
				format: "hex",
			};
		default:
			return null;
	}
}

/**
 * Resolve a CSS named colour (case-insensitive), including `transparent`. Returns
 * null for an unknown keyword so the caller can raise an error.
 */
export function namedColour(name: string): ColourData | null {
	const key = name.trim().toLowerCase();
	if (key === "transparent") return { r: 0, g: 0, b: 0, a: 0, format: "named", name: "transparent" };
	const rgb = CSS_NAMED_COLOURS[key];
	if (!rgb) return null;
	return { r: rgb[0], g: rgb[1], b: rgb[2], a: 1, format: "named", name: key };
}

/** Parse either a hex string or a named colour; null if neither. */
export function parseColour(input: string): ColourData | null {
	const trimmed = input.trim();
	if (trimmed.startsWith("#") || /^[0-9a-fA-F]{3,8}$/.test(trimmed)) {
		const hex = parseHex(trimmed);
		if (hex) return hex;
	}
	return namedColour(trimmed);
}

// ── RGB <-> HSL ─────────────────────────────────────────────────────────

/** Convert sRGB (0-255) to HSL with h in [0, 360), s and l in [0, 1]. */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return { h: 0, s: 0, l };
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
	else if (max === gn) h = (bn - rn) / d + 2;
	else h = (rn - gn) / d + 4;
	return { h: h * 60, s, l };
}

/** Convert HSL (h in degrees, s and l in [0, 1]) to sRGB (0-255 integers). */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
	if (s === 0) {
		const v = clamp255(l * 255);
		return { r: v, g: v, b: v };
	}
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const hn = (((h % 360) + 360) % 360) / 360;
	const hue = (t: number): number => {
		let tt = t;
		if (tt < 0) tt += 1;
		if (tt > 1) tt -= 1;
		if (tt < 1 / 6) return p + (q - p) * 6 * tt;
		if (tt < 1 / 2) return q;
		if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
		return p;
	};
	return {
		r: clamp255(hue(hn + 1 / 3) * 255),
		g: clamp255(hue(hn) * 255),
		b: clamp255(hue(hn - 1 / 3) * 255),
	};
}

// ── Display ─────────────────────────────────────────────────────────────

/** Canonical hex string, `#rrggbb`, extended to `#rrggbbaa` only when a < 1. */
export function toHexString(c: ColourData): string {
	const base = `#${hexByte(c.r)}${hexByte(c.g)}${hexByte(c.b)}`;
	return c.a < 1 ? `${base}${hexByte(c.a * 255)}` : base;
}

/**
 * Render a colour as the CSS string matching its authored `format`. Always valid
 * CSS, so a host can drop it straight into a `background` (this is both the
 * displayed answer text and the DTO `css` field).
 */
export function formatColour(c: ColourData): string {
	switch (c.format) {
		case "rgb":
			return `rgb(${c.r}, ${c.g}, ${c.b})`;
		case "rgba":
			return `rgba(${c.r}, ${c.g}, ${c.b}, ${formatAlpha(c.a)})`;
		case "hsl": {
			const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
			return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
		}
		case "hsla": {
			const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
			return `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${formatAlpha(c.a)})`;
		}
		case "named":
			return c.name ?? toHexString(c);
		case "hex":
		default:
			return toHexString(c);
	}
}

// ── WCAG luminance and contrast ─────────────────────────────────────────

function linearise(channel8: number): number {
	const cs = channel8 / 255;
	return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) to 1 (white). Alpha is ignored, per WCAG. */
export function relativeLuminance(c: ColourData): number {
	return 0.2126 * linearise(c.r) + 0.7152 * linearise(c.g) + 0.0722 * linearise(c.b);
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: ColourData, b: ColourData): number {
	const la = relativeLuminance(a) + 0.05;
	const lb = relativeLuminance(b) + 0.05;
	return la > lb ? la / lb : lb / la;
}

// ── Operations ──────────────────────────────────────────────────────────

/**
 * Rebuild a colour from new channels, preserving the display format and alpha
 * unless overridden. A `named` colour whose channels change is no longer that
 * keyword, so it falls back to hex display.
 */
function derive(c: ColourData, next: { r?: number; g?: number; b?: number; a?: number }): ColourData {
	const format: ColourFormat = c.format === "named" ? "hex" : c.format;
	return {
		r: next.r ?? c.r,
		g: next.g ?? c.g,
		b: next.b ?? c.b,
		a: next.a ?? c.a,
		format,
	};
}

function adjustHsl(c: ColourData, fn: (hsl: { h: number; s: number; l: number }) => void): ColourData {
	const hsl = rgbToHsl(c.r, c.g, c.b);
	fn(hsl);
	const { r, g, b } = hslToRgb(hsl.h, hsl.s, hsl.l);
	return derive(c, { r, g, b });
}

/** Increase lightness by `amount` (a fraction 0-1). */
export function lighten(c: ColourData, amount: number): ColourData {
	return adjustHsl(c, (hsl) => (hsl.l = clamp01(hsl.l + amount)));
}

/** Decrease lightness by `amount`. */
export function darken(c: ColourData, amount: number): ColourData {
	return adjustHsl(c, (hsl) => (hsl.l = clamp01(hsl.l - amount)));
}

/** Increase saturation by `amount`. */
export function saturate(c: ColourData, amount: number): ColourData {
	return adjustHsl(c, (hsl) => (hsl.s = clamp01(hsl.s + amount)));
}

/** Decrease saturation by `amount`. */
export function desaturate(c: ColourData, amount: number): ColourData {
	return adjustHsl(c, (hsl) => (hsl.s = clamp01(hsl.s - amount)));
}

/** Rotate the hue by `degrees` (wraps at 360). */
export function rotateHue(c: ColourData, degrees: number): ColourData {
	return adjustHsl(c, (hsl) => (hsl.h = ((hsl.h + degrees) % 360 + 360) % 360));
}

/** The colour on the opposite side of the wheel (hue + 180). */
export function complement(c: ColourData): ColourData {
	return rotateHue(c, 180);
}

/** Convert to grey using Rec.601 luma, preserving alpha. */
export function grayscale(c: ColourData): ColourData {
	const y = clamp255(0.299 * c.r + 0.587 * c.g + 0.114 * c.b);
	return derive(c, { r: y, g: y, b: y });
}

/** Invert each channel by `amount` (1 = full inversion), preserving alpha. */
export function invert(c: ColourData, amount = 1): ColourData {
	const t = clamp01(amount);
	return derive(c, {
		r: clamp255(c.r + (255 - 2 * c.r) * t),
		g: clamp255(c.g + (255 - 2 * c.g) * t),
		b: clamp255(c.b + (255 - 2 * c.b) * t),
	});
}

/**
 * Blend two colours by linear sRGB interpolation, `weight` toward `b` (0.5 is the
 * midpoint). This matches Sass `mix()` and DevTools blending; it is not
 * perceptually uniform (that would be Oklab), a deliberate zero-dependency choice.
 */
export function mix(a: ColourData, b: ColourData, weight = 0.5): ColourData {
	const t = clamp01(weight);
	const lerp = (x: number, y: number): number => x * (1 - t) + y * t;
	const format: ColourFormat = a.format === "named" ? "hex" : a.format;
	return {
		r: clamp255(lerp(a.r, b.r)),
		g: clamp255(lerp(a.g, b.g)),
		b: clamp255(lerp(a.b, b.b)),
		a: clamp01(lerp(a.a, b.a)),
		format,
	};
}

/** Set the alpha channel, upgrading the display format so the alpha shows. */
export function withAlpha(c: ColourData, alpha: number): ColourData {
	const a = clamp01(alpha);
	let format: ColourFormat = c.format;
	if (a < 1) {
		if (format === "rgb") format = "rgba";
		else if (format === "hsl") format = "hsla";
		else if (format === "named") format = "hex";
	}
	return { r: c.r, g: c.g, b: c.b, a, format };
}
