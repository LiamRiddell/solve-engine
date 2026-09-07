import { describe, test, afterEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, EvalTier } from "@solve-js/engine/ThreeTierEvaluator";

const engines: ExpressionEngine[] = [];
function mk(lines: string[]) {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	engines.push(engine);
	const doc = new DocumentModel();
	doc.setDocument(lines.join(String.fromCharCode(10)));
	const ev = new ThreeTierEvaluator(doc, engine);
	return { engine, doc, ev };
}
afterEach(() => {
	while (engines.length) engines.pop()!.clear();
});

const vp = (doc: DocumentModel) => ({ startLine: 1, endLine: doc.lineCount });

function show(r: any): string {
	return r.lines
		.map((l: any) => `${l.lineNumber}:T${l.tier}=${l.result ? String(l.result.value ?? "?") : "-"}${l.error ? " ERR" : ""}`)
		.join(" | ");
}

/**
 * The proposed gate, computed ONCE before the pass (computing it during the
 * pass is wrong: tier 1 clears the dirty flag as it goes, so the affected set
 * empties itself mid-pass).
 */
function installGate(ev: ThreeTierEvaluator, engine: ExpressionEngine, doc: DocumentModel) {
	const dag: any = engine.getDag();
	const allowed = new Set<number>();
	for (let p = 1; p <= doc.lineCount; p++) {
		const s = doc.getLineAt(p);
		if (!s || !s.dirty) continue;
		const keys = new Set<string>([...dag.getWrites(p), ...(s.writes ?? [])]);
		for (const w of keys) for (const n of dag.getAffectedLines(w)) allowed.add(n);
	}
	const anyEv = ev as any;
	const orig = anyEv.evaluateSingleLine.bind(ev);
	anyEv.evaluateSingleLine = (state: any, pos: number, inViewport: boolean) => {
		if (!state.dirty && !allowed.has(pos)) {
			return { lineId: state.lineId, lineNumber: pos, tier: EvalTier.Skipped, result: state.result, results: state.results, error: null };
		}
		return orig(state, pos, inViewport);
	};
	return allowed;
}

/** Run one edit both ways and print both answers side by side. */
function bothWays(lines: string[], edit: (doc: DocumentModel, ev: ThreeTierEvaluator) => void, label: string) {
	{
		const { doc, ev } = mk(lines);
		ev.evaluate(vp(doc));
		edit(doc, ev);
		console.log(`${label} UNGATED (today): ${show(ev.evaluate(vp(doc)))}`);
	}
	{
		const { engine, doc, ev } = mk(lines);
		ev.evaluate(vp(doc));
		edit(doc, ev);
		const allowed = installGate(ev, engine, doc);
		console.log(`${label} GATED   allowed=${JSON.stringify([...allowed])}: ${show(ev.evaluate(vp(doc)))}`);
	}
}

describe("ScratchCritique", () => {
	test("P1 redefinition: the VM store is a positional prefix", () => {
		bothWays([":x = 1", "x + 100", ":x = 2", "x + 200"], (doc) => doc.editLine(2, "x + 500"), "P1");
	});

	test("P4 user function body read reaches the caller", () => {
		bothWays([":rate = 2", "f(n) = n * rate", "f(3)"], (doc) => doc.editLine(1, ":rate = 10"), "P4");
	});

	test("P5 tag aggregate after a structural insert", () => {
		bothWays(["10 #food", "20 #food", "total of #food"], (_doc, ev) => {
			ev.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["30 #food"] }]);
		}, "P5");
	});

	test("P5c tag aggregate after an in-place member edit (no structural change)", () => {
		bothWays(["10 #food", "20 #food", "total of #food"], (doc) => doc.editLine(2, "25 #food"), "P5c");
	});

	test("P7 user-unit redefinition", () => {
		bothWays(["1 sprint = 2 weeks", "3 sprints in days", "2 sprints in days"], (doc) => doc.editLine(1, "1 sprint = 3 weeks"), "P7");
	});

	test("P8 prev / total above", () => {
		bothWays([":a = 10", "a * 2", "prev + 1", "total above"], (doc) => doc.editLine(1, ":a = 100"), "P8");
	});

	test("P9 accumulator", () => {
		bothWays([":spent = 0", "spent += 10", "spent += 20", "spent"], (doc) => doc.editLine(2, "spent += 11"), "P9");
	});

	test("P10 bare assignment (symbolic channel) has no write edge", () => {
		bothWays(["count = 10", "count * 3"], (doc) => doc.editLine(1, "count = 20"), "P10");
	});

	test("P11 global variable, same prefix shape", () => {
		bothWays(["global :g = 1", "g + 100", "global :g = 2", "g + 200"], (doc) => doc.editLine(2, "g + 500"), "P11");
	});

	test("P12 symbolic lines: opcode counts", () => {
		const { doc, ev } = mk(["1 sprint = 2 weeks", "count = 10", "y + 3 = 10", "spent += 5", ":ok = 1", "3 sprints in days"]);
		ev.evaluate(vp(doc));
		for (let p = 1; p <= doc.lineCount; p++) {
			const s = doc.getLineAt(p)!;
			console.log(`P12 L${p} ${JSON.stringify(s.text)} bc=${s.bytecodes.length} ops=${s.bytecodes.map((b) => b.opcodes.length).join(",")} reads=${JSON.stringify(s.reads)} writes=${JSON.stringify(s.writes)} dirty=${s.dirty} res=${s.result ? String(s.result.value) : "-"}`);
		}
		const r2 = ev.evaluate(vp(doc));
		console.log("P12 second pass (no edit):", show(r2));
	});

	test("P13 retained Values across many arena cycles", () => {
		const { doc, ev } = mk([":p = 3.14159", "p * 2", "10 usd", "1/3"]);
		ev.evaluate(vp(doc));
		const held = [1, 2, 3, 4].map((n) => doc.getLineAt(n)!.result);
		const before = held.map((v) => (v ? String(v.value) : "-")).join(",");
		for (let i = 0; i < 8; i++) {
			doc.editLine(4, `1/${3 + i}`);
			ev.evaluate(vp(doc));
		}
		const after = held.map((v) => (v ? String(v.value) : "-")).join(",");
		console.log(`P13 held before=[${before}] after 8 arena cycles=[${after}] same=${before === after}`);
	});

	test("P14 does an inserted variable definition propagate at all?", () => {
		const { doc, ev, engine } = mk([":x = 1", "x + 1", "x * 3"]);
		console.log("P14 pass1:", show(ev.evaluate(vp(doc))));
		// Insert a NEW definition of x above line 2. Nothing else edited.
		ev.applyTransaction([{ startLine: 2, deleteCount: 0, insertLines: [":x = 50"] }]);
		const dirty: number[] = [];
		for (let p = 1; p <= doc.lineCount; p++) if (doc.getLineAt(p)!.dirty) dirty.push(p);
		console.log("P14 dirty after insert:", JSON.stringify(dirty), "dag reads:", JSON.stringify(engine.getDag().getSnapshot().reads));
		const allowed = installGate(ev, engine, doc);
		console.log("P14 GATED allowed=", JSON.stringify([...allowed]), show(ev.evaluate(vp(doc))));
	});

	test("P14b same insert without the gate", () => {
		const { doc, ev } = mk([":x = 1", "x + 1", "x * 3"]);
		ev.evaluate(vp(doc));
		ev.applyTransaction([{ startLine: 2, deleteCount: 0, insertLines: [":x = 50"] }]);
		console.log("P14b UNGATED:", show(ev.evaluate(vp(doc))));
	});
});
