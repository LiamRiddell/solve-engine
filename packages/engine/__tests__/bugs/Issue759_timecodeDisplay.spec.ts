import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, NUMERIC_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { serializeValue } from "@solve-js/worker/serialize";
import { ValueType, numberValue, stringValue, timecodeUnit, uomValue } from "@solve-js/vm/Value";
import { isTimecodeRate, timecodeSeconds, timecodeText } from "@solve-js/packages/time/timecode/TimecodeMath";
import { timecodeConverted, timecodeOperandRefused, timecodeUnitPhrase } from "@solve-js/vm/TimecodeConversion";
import { unitForMessage } from "@solve-js/uom/UomConverter";
import { describeMeasure, valueKindName } from "@solve-js/vm/VMConversion";

/**
 * Issue #759: a timecode answered with the engine's internal unit name.
 * `01:02:03:04 at 30 fps` gave `= 111,694.00 timecode@30`, the frame count
 * under `timecode@<fps>`, and every path out of a timecode (a conversion to
 * seconds, arithmetic on two of them, a refusal naming one, the worker DTO)
 * could put that name in front of the reader. A timecode now answers in the
 * notation it was written in, `<N> frames at <fps>` is that timecode rather
 * than its text, and it converts to frames and to any unit of time.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text, { inputType: "markdown" }).lines.map((line) =>
		line.error ? `ERROR ${line.error}` : line.result ? formatValue(line.result).replace(/^=\s*/, "") : "");
}

describe("the issue's lines", () => {
	test.each([
		["01:02:03:04 at 30 fps", "01:02:03:04 at 30 fps"],
		["01:02:03:04 at 30 fps + 10", "01:02:03:14 at 30 fps"],
		["01:02:03:04 at 25 fps", "01:02:03:04 at 25 fps"],
		["01:02:03:04 at 30 fps in frames", "111,694.00 frames"],
		["111694 frames at 30 fps", "01:02:03:04 at 30 fps"],
		["(111694 frames at 30 fps) + 1", "01:02:03:05 at 30 fps"],
		["01:02:03:04 at 30 fps in seconds", "3,723.13 seconds"],
		["01:02:03:04 @ 30 fps", "01:02:03:04 at 30 fps"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("the shown answer reads back in as the same value", () => {
		for (const line of ["01:02:03:04 at 30 fps", "00:00:01:29 at 29.97 fps", "00:00:00:00 at 30 fps - 10", "01:00:00:00 at 25 fps + 0.5 seconds"]) {
			const engine = newTrackedEngine();
			const first = engine.evaluateExpression(line);
			const again = engine.evaluateExpression(formatValue(first).replace(/^=\s*/, ""));
			expect(again.toNumber()).toBe(first.toNumber());
			expect(again.unit).toBe(first.unit);
		}
	});
});

describe("no path out of a timecode names its internal unit", () => {
	test.each([
		["(01:02:03:04 at 30 fps) to seconds", "3,723.13 seconds"],
		["(01:02:03:04 at 30 fps) in minutes", "62.05 minutes"],
		["(01:02:03:04 at 30 fps) as timespan", "1 hour 2 minutes 3.133 seconds"],
		["(01:02:03:04 at 30 fps) as laptime", "01:02:03.133"],
		["(01:02:03:04 at 30 fps) in kg", "A timecode converts to frames or to a unit of time, such as seconds or minutes, and kg is neither."],
		["01:02:03:04 at 30 fps + 5 kg", "A timecode at 30 fps moves by frames or by a length of time, such as 10 frames or 2 seconds, not by a mass."],
		["(01:02:03:04 at 30 fps) * (01:02:03:04 at 30 fps)", "A timecode at 30 fps times a timecode at 30 fps has no meaning: a timecode is multiplied or divided by a plain number, as in \"* 2\", and one timecode divides by another at the same rate."],
		["(01:02:03:04 at 30 fps) / (1 second)", "A timecode at 30 fps divided by a quantity in second has no meaning: a timecode is multiplied or divided by a plain number, as in \"* 2\", and one timecode divides by another at the same rate."],
		["(01:02:03:04 at 30 fps) < (01:02:03:04 at 25 fps)", "Cannot compare incompatible units: timecode at 30 fps and timecode at 25 fps"],
		["(01:02:03:04 at 30 fps) km", "A quantity in timecode at 30 fps cannot take a second unit, km: two units side by side are not a unit. To convert, write \"in km\"."],
		["(01:02:03:04 at 30 fps) ^ 2", "A quantity in timecode at 30 fps cannot be raised to the power 2: only a length squared or cubed has a unit, an area or a volume."],
		["30 fps * (01:02:03:04 at 30 fps)", "A quantity in frames/s times a timecode at 30 fps has no meaning: a timecode is multiplied or divided by a plain number, as in \"* 2\", and one timecode divides by another at the same rate."],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
		expect(show(line)).not.toContain("timecode@");
	});

	test("the worker DTO carries a timecode as frames and its rate", () => {
		const dto = serializeValue(newTrackedEngine().evaluateExpression("01:02:03:04 at 30 fps"));
		expect(dto).toEqual({ type: ValueType.Uom, text: "= 01:02:03:04 at 30 fps", number: 111694, unit: "frames", timecodeFps: 30 });
		expect(JSON.stringify(dto)).not.toContain("timecode@");
		expect(JSON.parse(JSON.stringify(dto))).toEqual(structuredClone(dto));
	});

	test("a frame count, which is not a timecode, carries no rate", () => {
		const dto = serializeValue(newTrackedEngine().evaluateExpression("01:02:03:04 at 30 fps in frames"));
		expect(dto.unit).toBe("frames");
		expect(dto.timecodeFps).toBeUndefined();
	});

	test("a fractional rate crosses as the rate written", () => {
		expect(serializeValue(newTrackedEngine().evaluateExpression("00:00:01:29 at 29.97 fps")).timecodeFps).toBe(29.97);
	});
});

describe("the parts", () => {
	describe("timecodeText", () => {
		test.each([
			[111694, 30, "01:02:03:04 at 30 fps"],
			[0, 30, "00:00:00:00 at 30 fps"],
			[-0, 30, "00:00:00:00 at 30 fps"],
			[-10, 30, "-00:00:00:10 at 30 fps"],
			[59, 29.97, "00:00:01:29 at 29.97 fps"],
			[29, 30, "00:00:00:29 at 30 fps"],
			[30, 30, "00:00:01:00 at 30 fps"],
			[90012.5, 25, "90012.5 frames at 25 fps"],
			[360000 * 30, 30, "100:00:00:00 at 30 fps"],
			[Number.MAX_SAFE_INTEGER, 30, "83399993099:27:13:01 at 30 fps"],
			[Number.MAX_SAFE_INTEGER + 2, 30, "9007199254740992 frames at 30 fps"],
			[Infinity, 30, "Infinity frames at 30 fps"],
			[NaN, 30, "NaN frames at 30 fps"],
		])("%p frames at %p fps", (frames, fps, text) => {
			expect(timecodeText(frames, fps)).toBe(text);
		});
	});

	describe("isTimecodeRate", () => {
		test.each([
			[30, true], [29.97, true], [0.5, true], [1, true],
			[0, false], [0.4, false], [-30, false], [NaN, false], [Infinity, false], [-Infinity, false],
		])("%p", (fps, ok) => {
			expect(isTimecodeRate(fps)).toBe(ok);
		});
	});

	test("timecodeSeconds is the count over the rate", () => {
		expect(timecodeSeconds(45, 30)).toBe(1.5);
		expect(timecodeSeconds(0, 30)).toBe(0);
		expect(timecodeSeconds(-30, 30)).toBe(-1);
		expect(timecodeSeconds(108000, 29.97)).toBeCloseTo(3603.6036, 3);
	});

	describe("timecodeConverted", () => {
		const tc = (frames: number, fps = 30) => uomValue(frames, timecodeUnit(fps));
		test("into frames, seconds and minutes", () => {
			expect(formatValue(timecodeConverted(tc(45), "frames")!)).toBe("= 45.00 frames");
			expect(timecodeConverted(tc(45), "seconds")!.toNumber()).toBe(1.5);
			expect(timecodeConverted(tc(1800), "minutes")!.toNumber()).toBe(1);
			expect(timecodeConverted(tc(1800), "ms")!.toNumber()).toBe(60000);
		});
		test("anything else is refused by name", () => {
			const refused = timecodeConverted(tc(45), "kg")!;
			expect(refused.type).toBe(ValueType.Error);
			expect(refused.value).toBe("INCOMPATIBLE_UNITS");
		});
		test("a value that is not a timecode is left to the ordinary conversion", () => {
			expect(timecodeConverted(uomValue(5, "seconds"), "minutes")).toBeNull();
			expect(timecodeConverted(numberValue(5), "seconds")).toBeNull();
			expect(timecodeConverted(stringValue("timecode@30"), "seconds")).toBeNull();
		});
		test.each(PROTOTYPE_WORDS)("a prototype word as the target, %s, is refused and touches nothing", (word) => {
			expectPrototypeUntouched(() => {
				expect(timecodeConverted(tc(45), word)!.type).toBe(ValueType.Error);
			});
		});
	});

	describe("timecodeOperandRefused", () => {
		const tc = (frames: number, fps = 30) => uomValue(frames, timecodeUnit(fps));
		test("a plain number scales a timecode", () => {
			expect(timecodeOperandRefused(tc(10), numberValue(2), "mul")).toBeNull();
			expect(timecodeOperandRefused(numberValue(2), tc(10), "mul")).toBeNull();
			expect(timecodeOperandRefused(tc(10), numberValue(2), "div")).toBeNull();
		});
		test("two timecodes at one rate divide into a ratio", () => {
			expect(timecodeOperandRefused(tc(10), tc(5), "div")).toBeNull();
		});
		test("every other pair is refused", () => {
			expect(timecodeOperandRefused(tc(10), tc(5, 25), "div")?.type).toBe(ValueType.Error);
			expect(timecodeOperandRefused(numberValue(2), tc(10), "div")?.type).toBe(ValueType.Error);
			expect(timecodeOperandRefused(tc(10), uomValue(1, "second"), "mul")?.type).toBe(ValueType.Error);
			expect(timecodeOperandRefused(tc(10), tc(10), "mul")?.type).toBe(ValueType.Error);
		});
		test("a pair with no timecode is not its concern", () => {
			expect(timecodeOperandRefused(uomValue(1, "kg"), uomValue(1, "m"), "mul")).toBeNull();
			expect(timecodeOperandRefused(numberValue(1), numberValue(2), "div")).toBeNull();
		});
	});

	test("timecodeUnitPhrase, unitForMessage, describeMeasure and valueKindName never print the internal unit", () => {
		expect(timecodeUnitPhrase("timecode@30")).toBe("a timecode at 30 fps");
		expect(timecodeUnitPhrase("timecode@29.97")).toBe("a timecode at 29.97 fps");
		expect(timecodeUnitPhrase("seconds")).toBeNull();
		expect(timecodeUnitPhrase(undefined)).toBeNull();
		expect(unitForMessage("timecode@30")).toBe("timecode at 30 fps");
		expect(unitForMessage("mps2")).toBe("m/s²");
		expect(unitForMessage("km")).toBe("km");
		expect(describeMeasure("timecode@25")).toBe("timecode");
		expect(valueKindName(uomValue(1, "timecode@25"))).toBe("a timecode at 25 fps");
		expect(valueKindName(uomValue(1, "kg"))).toBe("an amount in kg");
	});
});

describe("adversarial", () => {
	describe("security", () => {
		test.each(PROTOTYPE_WORDS.flatMap((word) => [`01:02:03:04 at 30 fps in ${word}`, `(01:02:03:04 at 30 fps) in ${word}`, `${word} frames at 30 fps`]))("%s", (line) => {
			expectPrototypeUntouched(() => {
				expectHonestLine(line);
			});
		});

		test("a long run of frame additions stays within its budget", () => {
			expectHonestLine(`01:02:03:04 at 30 fps${" + 1".repeat(2_000)}`, { budgetMs: 5_000 });
		});

		test("an hour field far past a day is still a timecode, not a hang", () => {
			expect(show("999999999:59:59:29 at 30 fps")).toBe("999999999:59:59:29 at 30 fps");
		});

		test.each(["01:02:03:04 at 30 fps <b>", "01:02:03:04 at 30 fps in <script>"])("markup-shaped text beside a timecode, %s, is read as text", (line) => {
			expectHonestLine(line);
		});
	});

	describe("realistic breakage", () => {
		test("a typo in the unit asked for is refused, not read as frames", () => {
			expect(show("01:02:03:04 at 30 fps in secnds")).toBe("THROWS A timecode converts to frames or to a unit of time, as in \"in frames\" or \"in seconds\", not to \"secnds\".");
		});

		test("a frame rate of zero is refused by name", () => {
			expect(show("01:02:03:04 at 0 fps")).toBe("THROWS A timecode needs a frame rate of at least one frame a second, as in \"at 30 fps\", and 0 fps has none.");
			expect(show("10 frames at 0 fps")).toBe("THROWS A timecode needs a frame rate of at least one frame a second, as in \"at 30 fps\", and 0 fps has none.");
		});

		test("a value from the line above, a sum below it and a check over it", () => {
			expect(doc("a = 01:02:03:04 at 30 fps\na + 10\na in seconds\ncheck a + 10 == 01:02:03:14 at 30 fps")).toEqual([
				"01:02:03:04 at 30 fps",
				"01:02:03:14 at 30 fps",
				"3,723.13 seconds",
				"✓",
			]);
			expect(doc("01:02:03:04 at 30 fps\n00:00:00:04 at 30 fps\ntotal")).toEqual(["01:02:03:04 at 30 fps", "00:00:00:04 at 30 fps", "01:02:03:08 at 30 fps"]);
		});

		test("the document passes agree, and nothing internal shows", () => {
			expectHonestDocument("a = 01:02:03:04 at 30 fps\nb = 00:00:00:04 at 30 fps\na - b\na + b\nsum\n111694 frames at 30 fps");
		});

		test("a different rate on the other side is refused, not combined", () => {
			expect(show("01:02:03:04 at 30 fps + 00:00:00:01 at 25 fps")).toBe("Cannot combine timecodes at different frame rates (30 fps vs 25 fps)");
		});
	});

	describe("edge cases", () => {
		test.each([
			["a negative result, a timecode minus a later one", "01:02:03:00 at 30 fps - 01:02:03:04 at 30 fps", "-4.00 frames"],
			["a timecode moved back past zero", "00:00:00:00 at 30 fps - 10", "-00:00:00:10 at 30 fps"],
			["a negated timecode", "-(01:02:03:04 at 30 fps)", "-01:02:03:04 at 30 fps"],
			["a fractional rate", "00:00:01:29 at 29.97 fps", "00:00:01:29 at 29.97 fps"],
			["a fractional rate in seconds of real time", "00:00:01:29 at 29.97 fps in seconds", "1.97 seconds"],
			["a frame field at the rate's limit", "00:00:00:29 at 30 fps + 1", "00:00:01:00 at 30 fps"],
			["a frame field past the limit", "00:00:00:30 at 30 fps", "THROWS Frame number 30 is out of range for 30 fps (must be 0-29)"],
			["a duration in seconds added", "01:02:03:04 at 30 fps + 2 seconds", "01:02:05:04 at 30 fps"],
			["half a second at 25 fps, not a whole frame", "01:00:00:00 at 25 fps + 0.5 seconds", "90012.5 frames at 25 fps"],
			["a quotient by zero", "(01:02:03:04 at 30 fps) / 0", "Infinity frames at 30 fps"],
			["zero frames", "0 frames at 30 fps", "00:00:00:00 at 30 fps"],
		])("%s", (_name, line, answer) => {
			expect(show(line)).toBe(answer);
		});

		test.each(fill("01:02:03:04 at 30 fps + X", NUMERIC_EDGES))("the numeric edges added: %s", (line) => {
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		});
	});
});
