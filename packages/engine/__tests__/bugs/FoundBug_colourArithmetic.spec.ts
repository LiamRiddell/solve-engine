import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { colourEqual, colourRefused, hasNoNumber, noNumberArithmeticRefused, noNumberRefused } from "@solve-js/vm/VMConversion";
import { builtinArgumentRefused, colourArgumentRefused } from "@solve-js/vm/VMBuiltins";
import { Value, ValueType, colourValue, errorValue, numberValue, stringValue, type IpCidrData } from "@solve-js/vm/Value";

/**
 * Found bug: arithmetic on a colour answered a confident wrong number. A
 * colour is three channels and an alpha, and its `toNumber()` reports 0, so
 * every path that read a number from it took that zero: `#ff0000 + 2` answered
 * 2, `sqrt(#ff0000)` answered 0 and `#ff0000 < 3` answered true. A colour is
 * now refused by name (`COLOUR_ARITHMETIC`) wherever a number is wanted, as an
 * IPv6 address is refused with `IPV6_ARITHMETIC`, at the same shared checks.
 * What the colour package gives a colour meaning for stays: equality on the
 * channels, `as hex` and the other formats, `+` as a no-op, and the colour
 * functions themselves.
 */

/** The refusal's text for one thing asked of a colour. */
const refused = (done: string): string =>
	`A colour cannot be ${done}: it is three channels (red, green and blue), not one number. To use one channel as a number, read it out first, as in red(#3366cc).`;

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const red = colourValue({ r: 255, g: 0, b: 0, a: 1, format: "hex" });
const alsoRed = colourValue({ r: 255, g: 0, b: 0, a: 1, format: "rgb" });
const green = colourValue({ r: 0, g: 255, b: 0, a: 1, format: "hex" });
const ipv6 = new Value(ValueType.IpCidr, { addr6: 1n } satisfies IpCidrData);

describe("the lines that exposed it", () => {
	test.each([
		["#ff0000 + 2", "added"],
		["sqrt(#ff0000)", "given to sqrt"],
		["#ff0000 < 3", "put in order"],
	])("%s is refused by name", (line, done) => {
		expect(shown(line)).toBe(`COLOUR_ARITHMETIC: ${refused(done)}`);
	});
});

describe("every way a number was read off a colour", () => {
	test.each([
		["#ff0000 * 2", "multiplied"],
		["#ff0000 - #00ff00", "subtracted"],
		["#ff0000 + #00ff00", "added"],
		["#ff0000 / 2", "divided"],
		["5 / #ff0000", "divided"],
		["-#ff0000", "negated"],
		["#ff0000 + 10%", "added"],
		["#ff0000 * 10%", "multiplied"],
		["10% of #ff0000", "multiplied"],
		["#ff0000 ^ 2", "used in this arithmetic"],
		["2 ^ #ff0000", "used in this arithmetic"],
		["#ff0000 mod 2", "used in this arithmetic"],
		["#ff0000 << 1", "used in this arithmetic"],
		["#ff0000 & 1", "used in this arithmetic"],
		["~#ff0000", "used in this arithmetic"],
		["[1, 2] + #ff0000", "added"],
		["#ff0000 > #00ff00", "put in order"],
		["#ff0000 <= 3", "put in order"],
		["#ff0000 as %", "written as a percentage"],
		["#ff0000 as fraction", "written as a fraction"],
		["#ff0000 as sci", "written in scientific notation"],
		["#ff0000 as number", "read as one number"],
		["#ff0000 in binary", "written in binary"],
		["#ff0000 in octal", "written in octal"],
		["#ff0000 +/- 1", "given a tolerance"],
		["round(#ff0000)", "given to round"],
		["hex(#ff0000)", "given to hex"],
		["int(#ff0000)", "given to int"],
		["#ff0000!", "given to fact"],
		["#ff0000 to 2 dp", "used in this calculation"],
	])("%s is refused", (line, done) => {
		expect(shown(line)).toBe(`COLOUR_ARITHMETIC: ${refused(done)}`);
	});

	test("what a colour does mean is kept", () => {
		expect(shown("#ff0000 == rgb(255, 0, 0)")).toBe("true");
		expect(shown("#ff0000 != #00ff00")).toBe("true");
		expect(shown("#000000 == 0")).toBe("false");
		expect(shown("#ff0000 != 0")).toBe("true");
		expect(shown("+#ff0000")).toBe("#ff0000");
		expect(shown("#ff0000 as rgb as hex")).toBe("#ff0000");
		expect(shown("#ff0000 as hsl")).toBe("hsl(0, 100%, 50%)");
		expect(shown("lighten(#3366cc, 20%)")).toBe("#85a3e0");
		expect(shown("mix(#ff0000, #0000ff)")).toBe("#800080");
		expect(shown("red(#3366cc) + 1")).toBe("52");
	});

	test("a colour met by a quantity keeps the refusal that names the unit", () => {
		expect(shown("#ff0000 * 2 km")).toBe("QUANTITY_NON_NUMERIC: A colour and a quantity in km cannot be multiplied: a colour has no single amount to put in km.");
	});
});

describe("colourRefused, hasNoNumber and noNumberRefused", () => {
	test("colourRefused words what was asked", () => {
		expect(colourRefused("added").errorCode).toBe("COLOUR_ARITHMETIC");
		expect(colourRefused("added").errorMessage).toBe(refused("added"));
		expect(colourRefused("").errorMessage).toBe(refused(""));
	});

	test("hasNoNumber is true for a colour and an IPv6 address only", () => {
		expect(hasNoNumber(red)).toBe(true);
		expect(hasNoNumber(ipv6)).toBe(true);
		expect(hasNoNumber(new Value(ValueType.IpCidr, { addr: 1, prefix: 24 } satisfies IpCidrData))).toBe(false);
		for (const v of [numberValue(0), numberValue(NaN), stringValue("#ff0000"), errorValue("X", "y")]) expect(hasNoNumber(v)).toBe(false);
	});

	test("noNumberRefused names the kind, or answers null", () => {
		expect(noNumberRefused(red, "negated")?.errorCode).toBe("COLOUR_ARITHMETIC");
		expect(noNumberRefused(ipv6, "negated")?.errorCode).toBe("IPV6_ARITHMETIC");
		expect(noNumberRefused(numberValue(1), "negated")).toBeNull();
		expect(noNumberRefused(stringValue("constructor"), "negated")).toBeNull();
	});

	test("noNumberArithmeticRefused names the left operand first, and the operation", () => {
		expect(noNumberArithmeticRefused(red, ipv6, "add")?.errorCode).toBe("COLOUR_ARITHMETIC");
		expect(noNumberArithmeticRefused(ipv6, red, "add")?.errorCode).toBe("IPV6_ARITHMETIC");
		expect(noNumberArithmeticRefused(numberValue(1), red, "div")?.errorMessage).toBe(refused("divided"));
		expect(noNumberArithmeticRefused(red, numberValue(1))?.errorMessage).toBe(refused("used in this arithmetic"));
		expect(noNumberArithmeticRefused(numberValue(1), numberValue(2), "add")).toBeNull();
	});
});

describe("colourEqual", () => {
	test("two colours compare on their channels, however each is written", () => {
		expect(colourEqual(red, alsoRed)).toBe(true);
		expect(colourEqual(red, green)).toBe(false);
		expect(colourEqual(red, colourValue({ r: 255, g: 0, b: 0, a: 0.5, format: "hex" }))).toBe(false);
	});

	test("a colour never equals anything else, and two non-colours are not its business", () => {
		expect(colourEqual(red, numberValue(0))).toBe(false);
		expect(colourEqual(stringValue("#ff0000"), red)).toBe(false);
		expect(colourEqual(numberValue(0), numberValue(0))).toBeNull();
	});
});

describe("colourArgumentRefused and builtinArgumentRefused", () => {
	test("a numeric builtin refuses a colour in any position, naming the builtin", () => {
		expect(colourArgumentRefused(0, [red])?.errorMessage).toBe(refused("given to sqrt"));
		expect(colourArgumentRefused(31, [numberValue(2), red])?.errorMessage).toBe(refused("given to pow"));
		// roundToPlaces is reached through `to 2 dp`, so its own name is not the reader's.
		expect(colourArgumentRefused(97, [red, numberValue(2)])?.errorMessage).toBe(refused("used in this calculation"));
	});

	test("the aggregates word their own refusal, and a builtin with no colour passes", () => {
		expect(colourArgumentRefused(10, [red, numberValue(1)])).toBeNull();
		expect(colourArgumentRefused(0, [numberValue(4)])).toBeNull();
		expect(colourArgumentRefused(0, [])).toBeNull();
		expect(colourArgumentRefused(-1, [red])?.errorCode).toBe("COLOUR_ARITHMETIC");
	});

	test("builtinArgumentRefused puts a date first, then an address, a colour, then text", () => {
		expect(builtinArgumentRefused(0, [red])?.errorCode).toBe("COLOUR_ARITHMETIC");
		expect(builtinArgumentRefused(0, [ipv6])?.errorCode).toBe("IPV6_ARITHMETIC");
		expect(builtinArgumentRefused(31, [stringValue("a"), red])?.errorCode).toBe("COLOUR_ARITHMETIC");
		expect(builtinArgumentRefused(0, [numberValue(4)])).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: prototype words holding a colour, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch, incremental } = expectHonestDocument(`${word} = #ff0000\n${word} + 2`);
				expect(incremental).toEqual(batch);
			}
		});
	});

	test("security: look-alike and markup-shaped text beside a colour", () => {
		for (const line of fill("#ff0000 + X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("sqrt(X) + #ff0000", TEXT_EDGES)) expectHonestLine(line);
		// A zero-width space inside the literal is not a colour, and says so honestly.
		expectHonestLine("#ff​0000 + 2");
	});

	test("security: a long sum of colours is refused within budget", () => {
		// 190 terms sits under the 2,000-character line limit, which refuses longer lines first.
		const line = Array.from({ length: 190 }, () => "#ff0000").join(" + ");
		expect(expectHonestLine(line)).toEqual(expect.objectContaining({ kind: "error", code: "COLOUR_ARITHMETIC" }));
		expectHonestLine(`${RESOURCE_PROBES.longSum(2_000)} + #ff0000`);
	});

	test("realistic: a colour from the line above, a check of its channel, both passes agreeing", () => {
		const text = "brand = #3366cc\nbrand + 10\nred(brand) + 10\ncheck red(brand) == 51\nbrand < 3";
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch[1]).toBe(`ERROR ${refused("added")}`);
		expect(batch[2]).toBe("= 61");
		expect(batch[3]).toBe("= ✓");
		expect(batch[4]).toBe(`ERROR ${refused("put in order")}`);
		expect(incremental).toEqual(batch);
	});

	test("realistic: a typo that makes a colour of a number is still refused, not read as zero", () => {
		expect(shown("#100 + 1")).toBe(`COLOUR_ARITHMETIC: ${refused("added")}`);
		expect(shown("total of #ff0000, 2")).toMatch(/colour/);
	});

	test("edge: every numeric edge against a colour is refused, never a number", () => {
		for (const line of fill("#ff0000 * X", NUMERIC_EDGES)) {
			expect(expectHonestLine(line, { allowNaN: true })).toEqual(expect.objectContaining({ kind: "error" }));
		}
		for (const line of fill("X < #000000", NUMERIC_EDGES)) {
			expect(expectHonestLine(line, { allowNaN: true })).toEqual(expect.objectContaining({ kind: "error" }));
		}
	});

	test("edge: black, transparent and the short forms", () => {
		expect(shown("#000 + 0")).toBe(`COLOUR_ARITHMETIC: ${refused("added")}`);
		expect(shown("#00000000 * 0")).toBe(`COLOUR_ARITHMETIC: ${refused("multiplied")}`);
		expect(shown("color(\"transparent\") == #00000000")).toBe("true");
		expect(shown("-(#fff)")).toBe(`COLOUR_ARITHMETIC: ${refused("negated")}`);
	});
});
