import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { membershipThroughName } from "@solve-js/vm/VM";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { ipInCidr } from "@solve-js/packages/ip/IpPluginFunctions";
import { IP_PACKAGE } from "@solve-js/packages/ip/IpPackage";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import type { VM } from "@solve-js/vm/OpRegistry";
import type { PluginFunctionHandler } from "@solve-js/engine/EngineContext";
import { Value, ValueType, numberValue, stringValue, uomValue, type IpCidrData } from "@solve-js/vm/Value";

/**
 * Found bug: with `lab = 192.168.1.0/24`, `192.168.1.7 in lab` was refused as
 * "An IP address has no single amount to convert to lab". The parser sends
 * `in` to the membership test only when a block literal follows it, so a name
 * after `in` was always a unit to convert into. What a name holds is only known
 * when the line runs, so the conversion now asks first (`membershipThroughName`
 * in vm/VM.ts): an IP value before `in` and an IP value in the name make it the
 * membership test, and anything else keeps its meaning as a conversion target.
 */

function doc(text: string): string[] {
	return expectHonestDocument(text).batch;
}

const ip = (data: IpCidrData): Value => new Value(ValueType.IpCidr, data);
const block24 = ip({ addr: 0xc0a80100, prefix: 24 });
const inside = ip({ addr: 0xc0a80107 });

/** A machine with only what membershipThroughName reads: its variables and the registered test. */
function machine(vars: Record<string, Value>, registered = true): VM {
	const handlers: Record<number, PluginFunctionHandler> = {};
	if (registered) handlers[pluginFunctionIndexFor("solve-ip:ipInCidr")] = ipInCidr;
	const variables = new Map(Object.entries(vars));
	const stub = { getVar: (name: string) => variables.get(name), context: { pluginFunctions: handlers } };
	return stub as unknown as VM;
}

describe("the line that exposed it", () => {
	test("an address in a variable holding a block is the membership test", () => {
		expect(doc("lab = 192.168.1.0/24\n192.168.1.7 in lab\n10.0.0.1 in lab")).toEqual(["= 192.168.1.0/24", "= true", "= false"]);
	});
});

describe("the membership test through a name", () => {
	test("IPv6, an address held by name on the left too, and a family mismatch refused by name", () => {
		expect(doc("v6 = 2001:db8::/32\n2001:db8::1 in v6")[1]).toBe("= true");
		expect(doc("lab = 10.0.0.0/8\nme = 10.1.2.3\nme in lab")[2]).toBe("= true");
		expect(doc("v6 = 2001:db8::/32\n192.168.1.1 in v6")[1]).toMatch(/^ERROR "in" needs an address and a subnet of the same kind/);
	});

	test("a name holding a single address is refused as a block literal's absence is", () => {
		expect(doc("host = 192.168.1.5\n192.168.1.5 in host")[1]).toBe('ERROR "in" expects a subnet on the right, e.g. 10.0.0.0/8');
	});

	test("any other value after in keeps its meaning", () => {
		// A name that is also a unit still converts a quantity into that unit.
		expect(doc("m = 10.0.0.0/8\n5 km in m\n10.1.2.3 in m")).toEqual(["= 10.0.0.0/8", "= 5,000.00 m", "= true"]);
		expect(doc("h = 10.0.0.0/8\n2 hours in h")[1]).toBe("= 2.00 h");
		// A name holding a number is not a block, so the old refusal stands.
		expect(doc("x = 5\n192.168.1.7 in x")[1]).toMatch(/^ERROR An IP address has no single amount to convert to x/);
		expect(doc("192.168.1.7 in nowhere")[0]).toMatch(/^ERROR An IP address has no single amount to convert to nowhere/);
		// A literal block after in is unchanged.
		expect(doc("192.168.1.7 in 192.168.1.0/24")[0]).toBe("= true");
	});

	test("one line on its own has no variable to read, and refuses honestly", () => {
		const v = newTrackedEngine().evaluateExpression("192.168.1.7 in lab");
		expect(v.errorCode).toBe("CONVERT_NON_NUMERIC");
	});
});

describe("membershipThroughName", () => {
	test("ordinary: an address and a named block give the test's answer", () => {
		expect(membershipThroughName(inside, "lab", machine({ lab: block24 }))?.value).toBe(true);
		expect(membershipThroughName(ip({ addr: 0x0a000001 }), "lab", machine({ lab: block24 }))?.value).toBe(false);
	});

	test("boundary: prefix 0 holds everything, /32 holds one, and no registered test leaves the conversion", () => {
		expect(membershipThroughName(inside, "all", machine({ all: ip({ addr: 0, prefix: 0 }) }))?.value).toBe(true);
		expect(membershipThroughName(inside, "one", machine({ one: ip({ addr: 0xc0a80107, prefix: 32 }) }))?.value).toBe(true);
		expect(membershipThroughName(inside, "lab", machine({ lab: block24 }, false))).toBeNull();
	});

	test("hostile: a non-IP on either side, an undefined name and inherited-property names are not its business", () => {
		expect(membershipThroughName(numberValue(5), "lab", machine({ lab: block24 }))).toBeNull();
		expect(membershipThroughName(uomValue(5, "km"), "m", machine({ m: block24 }))).toBeNull();
		expect(membershipThroughName(inside, "x", machine({ x: numberValue(5) }))).toBeNull();
		expect(membershipThroughName(inside, "s", machine({ s: stringValue("192.168.1.0/24") }))).toBeNull();
		expect(membershipThroughName(inside, "nowhere", machine({}))).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(membershipThroughName(inside, word, machine({}))).toBeNull();
	});

	test("the slot it reads is the one the IP package registers under", () => {
		expect(IP_PACKAGE.name).toBe("solve-ip");
		expect(IP_PACKAGE.pluginFunctions?.ipInCidr).toBe(ipInCidr);
	});
});

describe("adversarial", () => {
	test("security: prototype words holding a block, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch, incremental } = expectHonestDocument(`${word} = 192.168.1.0/24\n192.168.1.7 in ${word}`);
				expect(batch[1]).toBe("= true");
				expect(incremental).toEqual(batch);
				expectHonestLine(`192.168.1.7 in ${word}`);
			}
		});
	});

	test("security: look-alike and markup-shaped names, and a thousand tests against one block", () => {
		for (const text of fill("lab = 192.168.1.0/24\n192.168.1.7 in X", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestDocument(text);
		// A zero-width space makes a different name, which holds nothing.
		expect(doc("lab = 192.168.1.0/24\n192.168.1.7 in la​b")[1]).toMatch(/^ERROR/);
		const lines = Array.from({ length: 1_000 }, (_, i) => `192.168.${i % 256}.7 in lab`);
		const { batch } = expectHonestDocument(`lab = 192.168.1.0/24\n${lines.join("\n")}`);
		expect(batch.filter((line) => line === "= true").length).toBe(4);
	});

	test("realistic: an edit to the block re-answers the line below, and a check over it", () => {
		const engine = newTrackedEngine();
		const model = new DocumentModel();
		model.setDocument("lab = 192.168.1.0/24\n192.168.1.7 in lab");
		const evaluator = new ThreeTierEvaluator(model, engine);
		try {
			const pass = () => evaluator.evaluate({ startLine: 1, endLine: model.lineCount }).lines.map((l) => (l.result ? formatValue(l.result) : ""));
			expect(pass()[1]).toBe("= true");
			model.editLine(1, "lab = 10.0.0.0/8");
			expect(pass()[1]).toBe("= false");
		} finally {
			evaluator.terminateWorker();
		}
		expect(doc("lab = 192.168.1.0/24\ncheck (192.168.1.7 in lab) == true")[1]).toBe("= ✓");
		expect(doc("lab = 192.168.1.0/24\nif 192.168.1.7 in lab then 1 else 2")[1]).toBe("= 1");
	});

	test("edge: the numeric edges as the address and as the name's value, and the document edges after a block", () => {
		for (const text of fill("lab = 192.168.1.0/24\nX in lab", NUMERIC_EDGES)) expectHonestDocument(text, { allowNaN: true });
		for (const text of fill("lab = X\n192.168.1.7 in lab", NUMERIC_EDGES)) expectHonestDocument(text, { allowNaN: true });
		for (const edge of DOCUMENT_EDGES) expectHonestDocument(`lab = 192.168.1.0/24\n${edge}\n192.168.1.7 in lab`);
		expect(doc("lab = 192.168.1.0/24\r\n192.168.1.7 in lab\r\n")[1]).toBe("= true");
		expect(doc("all = 0.0.0.0/0\n255.255.255.255 in all")[1]).toBe("= true");
	});
});
