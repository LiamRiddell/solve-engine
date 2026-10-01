import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const PAYROLL_CASE = "PAYROLL_CASE";
const PAYROLL_CASE_ID = tokenTypeId(PAYROLL_CASE);

/** The fused payroll phrases a case clause may follow, and the clause before another one. */
const PAYROLL_FORMS: ReadonlySet<string> = new Set(["TAKE_HOME_ON", "AFTER_TAX", "AFTER_TAX_MONTHLY", PAYROLL_CASE]);

/** The places a take-home can be asked for, by the words written after `in`, and the bands each uses. */
const PLACES: ReadonlyArray<{ readonly words: readonly string[]; readonly place: string }> = [
	{ words: ["scotland"], place: "scotland" },
	{ words: ["england"], place: "rUK" },
	{ words: ["wales"], place: "rUK" },
	{ words: ["northern", "ireland"], place: "rUK" },
];

/** The lower-cased word a token spells, or "" for one that is not a word. */
function word(token: Token | undefined): string {
	if (token === undefined) return "";
	return (token.text ?? token.value ?? "").toLowerCase();
}

/** Whether a payroll form stands earlier on the line, so a clause here belongs to it. */
function followsPayrollForm(tokens: Token[], pos: number): boolean {
	for (let i = pos - 1; i >= 0; i--) if (PAYROLL_FORMS.has(tokens[i].type)) return true;
	return false;
}

/**
 * Reads the clause after `with` (or after `and` joining a second clause): a
 * student loan (`plan 2 student loan`, `postgraduate loan`, `student loan`) or a
 * pension (`5% pension`).
 *
 * @returns The clause's payload and how many tokens it spans, or null.
 */
function readWithClause(tokens: Token[], at: number): { payload: string; length: number } | null {
	// `plan <n> [student] loan`, with the implicit `*` another rule may have put
	// between the number and the word already.
	if (word(tokens[at]) === "plan" && tokens[at + 1]?.type === "NUMBER") {
		let i = at + 2;
		if (tokens[i]?.type === "STAR") i++;
		if (word(tokens[i]) === "student") i++;
		if (word(tokens[i]) !== "loan") return null;
		return { payload: `loan:plan${tokens[at + 1].value ?? ""}`, length: i + 1 - at };
	}
	if (word(tokens[at]) === "postgraduate") {
		let i = at + 1;
		if (word(tokens[i]) === "student") i++;
		if (word(tokens[i]) !== "loan") return null;
		return { payload: "loan:postgraduate", length: i + 1 - at };
	}
	if (word(tokens[at]) === "student" && word(tokens[at + 1]) === "loan") {
		return { payload: "loan:", length: 2 };
	}
	// `<n>% pension`, the number folded into the payload as `after 20% tax` folds its rate.
	if (tokens[at]?.type === "NUMBER" && tokens[at + 1]?.type === "PERCENT" && word(tokens[at + 2]) === "pension") {
		return { payload: `pension:${tokens[at].value ?? ""}`, length: 3 };
	}
	return null;
}

/**
 * Fuses one clause that describes whose take-home a payroll line asks for into
 * a `PAYROLL_CASE` token (issue #747): `in Scotland` (or England, Wales and
 * Northern Ireland), `with plan 2 student loan`, `with postgraduate loan`,
 * `with 5% pension`, and a second clause joined by `and`.
 *
 * ## Why only after a payroll form
 * `in` is a conversion and `with` a spelling of addition everywhere else, and
 * `and` joins lists. A clause is fused only when `take home on`, `after tax` or
 * `per month after tax` stands earlier on the line (or another clause, for
 * `and`), so `5 km in Scotland` stays the unknown-unit message it was and
 * `3 with 4` stays 7. The payroll phrases are themselves fused by the phrase
 * pass, so on the first pass they are still words; the normaliser runs until
 * nothing changes, and the clause is fused on the pass that sees them.
 *
 * The token's value is the clause as a payload (`place:scotland`,
 * `loan:plan2`, `pension:5`), which the payroll parselets collect and hand to
 * the plugin; a clause the plugin cannot use (`with student loan` with no plan,
 * a plan that does not exist) is still fused, so it is refused by name there
 * rather than failing to parse.
 */
export function payrollCaseNormalizerRule(priority = 76): NormalizerRule {
	const RULE = "payroll:case-clause";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["IN", "PLUS", "AND_CONJ"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const head = tokens[pos];
			if (head === undefined) return null;
			let payload: string | null = null;
			let consumed = 0;

			if (head.type === "IN") {
				for (const { words, place } of PLACES) {
					if (words.every((w, k) => word(tokens[pos + 1 + k]) === w)) {
						payload = `place:${place}`;
						consumed = 1 + words.length;
						break;
					}
				}
			} else if ((head.type === "PLUS" && word(head) === "with") || head.type === "AND_CONJ") {
				// `and` joins a second clause only straight after a first one.
				if (head.type === "AND_CONJ" && tokens[pos - 1]?.type !== PAYROLL_CASE) return null;
				const clause = readWithClause(tokens, pos + 1);
				if (clause !== null) {
					payload = clause.payload;
					consumed = 1 + clause.length;
				}
			}
			if (payload === null || !followsPayrollForm(tokens, pos)) return null;

			const last = tokens[pos + consumed - 1];
			const fused = new LexerToken(
				PAYROLL_CASE,
				PAYROLL_CASE_ID,
				payload,
				head.text ?? "",
				head.offset,
				0,
				head.line,
				head.col,
				last.offset + (last.text?.length ?? 0),
			);
			return { consumed, replacement: [fused], ruleName: RULE };
		},
	};
}
