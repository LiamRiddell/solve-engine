/**
 * The adversarial sweep: every form the engine reads, attacked with the shared
 * corpora in `tools/adversarial.ts`.
 *
 * Each feature's own spec proves it works for the input its author had in mind.
 * This file proves the forms stay honest for the input nobody had in mind: the
 * numeric edges (negative zero, 2^53, the 34-digit decimal limit, the
 * quotients with no finite answer), the text edges (blank lines, stray carriage
 * returns, invisible and direction-changing characters, digits from other
 * scripts, markup-shaped text), the words that name an inherited property, and
 * inputs sized to exhaust time. "Honest" means what the engine promises: the
 * right answer or a refusal that names the problem, never a raw JavaScript
 * error, a leaked internal, a hang or a changed `Object.prototype`.
 *
 * A form added to the engine gets a template here in the same change (see the
 * "Adversarial tests" rule in CLAUDE.md). A case that is a known open bug is a
 * one-assertion `test.failing` naming its issue, per FailingTestShape.spec.ts,
 * so the fix turns it red and it is moved into the passing set.
 */

import { describe, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import {
	DOCUMENT_EDGES,
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";

/** One-line forms, each with `X` where an edge value goes. Grouped by the feature they exercise. */
const LINE_FORMS: Readonly<Record<string, readonly string[]>> = {
	arithmetic: ["X + 1", "X * 3", "X / 7", "X ^ 2", "-X", "X mod 3", "X == X"],
	rounding: ["round(X)", "round(X, 2)", "X to 0 dp", "X to 3 sf", "X rounded", "X to nearest 10", "floor(X)", "trunc(X)"],
	formats: ["X as engineering", "X as compact", "X as fraction", "X as hex", "X as percent", "X as binary"],
	numberTheory: ["isprime(X)", "factor(X)", "X choose 2", "modpow(X, 2, 7)", "gcd(X, 6)", "fact(X)"],
	functions: ["sqrt(X)", "sin(X)", "log(X)", "exp(X)", "asin(X)", "abs(X)", "root(3, X)"],
	checks: ["check X == X", "check X > 0", "check X ≈ 1 within 1%"],
	units: ["X m * 3 m", "X kg * $5/kg", "X m in ft", "X °C in °F", "$X", "X%", "X km/h in mph"],
	// The unit forms the units-and-money batch changed (#638 to #650).
	unitsAndMoney: [
		"area of circle radius X m",
		"area of rectangle width X m, height 4 m",
		"(X +/- 0.1) in km",
		"(X m +/- 1 cm) + 2 m",
		"[X, 2] km",
		"[X km, 2 km]",
		"standard deviation of X kg, 1000 g",
		"variance of X m, 2 m",
		"bmi(X kg, 175 cm)",
		"20 °C + X °F",
		"X in widgets",
		"X in roman",
		"boltzmann * X K",
		"planck * X Hz",
		"inflationAdjust($X, 1990, 2020)",
	],
	// The UK and euro-area price indices, chosen by the amount's currency (#756).
	priceIndices: [
		"inflationAdjust(£X, 1990, 2020)",
		"inflationAdjust(€X, 2000, 2020)",
		"inflationAdjust(£100, X, 2020)",
		"inflationAdjust(€100, 2000, X)",
		"what was £X worth in 1965",
	],
	// A derived unit's prefix read in its own case after `as` and `in` (#824).
	derivedPrefixes: ["X W as mW", "X W as MW", "X W as mw", "X V in MV", "X J as pJ"],
	// The qualified cups, the typographic point, imperial mpg and a stated
	// density (#752, #749, #736).
	qualifiedUnits: [
		"X metric cups in ml",
		"X imperial cups flour in grams",
		"X US cups in ml",
		"X typographic points in mm",
		"X mpg imperial in l/100km",
		"8 l/100km in X mpg uk",
		"fuel for 300 miles at X UK mpg",
		"X px at 300 dpi in mm",
		"X in at 300 dpi",
		"4000px at X dpi",
	],
	money: ["$X * 3", "$X split 3 ways", "X% of $200", "₹1,00,000 * X", "X INR + 12,34,567 INR"],
	// Each currency's own places and a split in its smallest unit (#731), a money
	// rate with its symbol and a time word that agrees with its count (#753).
	currencyPlaces: ["¥X / 3", "X KWD / 3", "X BTC", "¥X split 3 ways", "split (X KWD) between 3", "$X per hour", "¥X/kWh"],
	unitWords: ["X seconds in hours", "X hour", "X hours in minutes"],
	// The reversed conversion over every unit table, in each unit's own case (#825).
	reversedConversion: ["km in X furlong", "mW in X W", "m in X mile", "km in -X mile"],
	// Speed, acceleration, frequency and the ampere in unit algebra (#737), a
	// rate target written with per or a symbol (#738), a price per kWh in
	// reading order (#758), a power after a slash (#834), and a price per unit
	// written short.
	unitAlgebra: [
		"X m/s^2 * 3 s",
		"100 km/h / X s",
		"X Hz * 2 s",
		"X W / 20 V",
		"X Hz in /min",
		"X ft/s^2 in m/s^2",
		"X km/h in miles per hour",
		"$X/hour in $/day",
		"$X/week in /month",
		"$0.30/kWh * X kW * 3 h",
		"$0.30/kWh * 2 kW * X h",
		"X kg/m^3",
		"check X g/mL == X g/cm^3",
		"$X/hour as compact",
	],
	finance: ["npv of -1000, X, 400 at 10%", "irr of -1000, X, 400"],
	// The investment grammar the investments page documents (#778). The amount
	// invested is swept too, now that an infinite one is refused by name.
	investments: [
		"$X after 3 years at 7%",
		"X invested $1,500 returned",
		"$1,000 after X years at 7%",
		"$1,000 for 3 years at X% compounding monthly",
		"present value of $X after 3 years at 7%",
		"$1,000 invested X returned",
		"annual return on $1,000 invested $X returned after 5 years",
		// `payment on` beside `repayment on`, and `compounded` with an interval (#746).
		"monthly payment on $X over 25 years at 4%",
		"total payment on 200000 over X years at 4%",
		"$1,000 for 3 years at X% compounded monthly",
	],
	// Lists that carry a unit (#745).
	unitLists: [
		"[X km, 500 m] * 2",
		"[1 km, 2 km] + X m",
		"[X, 2] km in m",
		"[$X, $6][1]",
		"map(x * 2, [X km, 1 km])",
		"-[X kg, 1 kg]",
	],
	// Scotland, student loans and pensions on the take-home forms (#747).
	payrollCases: [
		"£X after tax in Scotland",
		"take home on £X with plan 2 student loan",
		"£50,000 after tax with X% pension",
		"£X per month after tax in Scotland with postgraduate loan and 5% pension",
	],
	// An IPv6 address wherever it stands, its subnet forms and its number (#748).
	ipv6: [
		"fe80::1 + X",
		"X + fe80::1",
		"X * 2001:db8::/32",
		"fe80::1 in X",
		"hosts in /X",
		"netmask of /X",
		"fe80::1 == X",
		"X < fe80::1",
		"fe80::1 as int + X",
		"round(fe80::1, X)",
		"2001:db8::X",
		"network of 2001:db8::/X",
	],
	// A savings goal over a duration, read as in one is.
	savingsGoals: ["how much per month to reach $X over 2 years", "how much per month to reach $10,000 over X years"],
	distributions: ["normalcdf(X)", "binompdf(10, 0.5, X)"],
	solving: ["solve(x^2 = X, x)", "integral(x, x, 0, X)"],
	// The forms #828, #829, #830 and #835 changed.
	vectorsAndWords: [
		"vec2(X, 1)",
		"vec3(X, 1, 2)",
		"dot([X, 1], [2, 3])",
		"float(X)",
		"X as multiplier",
		"add X to 10",
		"X is prime",
		"asin(X) in degrees",
		"larger of X and 4 and 12",
		"smaller of 10 and X and 12",
		"compoundInterest($1,000, X, 3)",
		"$1,000 invested X returned",
	],
	dates: ["1 Jan 2026 + X days", "1 Jan 2026 + X", "1 Jan 2026 to X", "X to 1 Jan 2026", "X * 9:00", "round(9:00) + X", "(9:30 - 8:30) + X minutes", "X as iso8601",
		// The first century and the years before year 1 (#823): a four-digit year below 100, and a step back past it.
		"1 Jan 0001 + X days", "1 Jan 0001 - X days", "1 Jan 2026 - X years", "31 Dec 0099 + X months"],
	// A signed offset after a date or in a conversion (#730).
	utcOffsets: ["2026-04-03T15:00 in UTC-X", "2026-04-03T15:00 in GMT+X", "2026-04-03 in UTC+X:30", "3pm London in UTC-X", "now in UTC+X"],
	// Negation (#751), a label without its colon (#742) and a name of several
	// words on its definition line (#743).
	negation: ["not (X > 0)", "!(X > 0)", "not X", "!X", "if not X > 0 then 1 else 2"],
	wordLabels: ["Rent $X", "Petrol X l", "Flight to Paris X EUR", "Chapter X", "take home $X"],
	multiWordNames: ["hourly rate = X", "take home = X", "tax on = X"],
	// An unknown given a unit or a percentage under the arrow, a possessive
	// name with either apostrophe, an operator word ending a name, and an
	// equation line with several unknowns (FoundBug_unknownUnderTheArrow,
	// FoundBug_possessiveName, FoundBug_operatorWordEndingAName,
	// FoundBug_equationWithSeveralUnknowns).
	unknownsAndNames: [
		"X percent =>",
		"(X + foo) km =>",
		"foo * X km =>",
		"$(foo + X) =>",
		"Alice's food = X",
		"Alice’s food = X",
		"the Smiths' rent = X",
		"monthly take = X",
		"(salary / 12) * rate / X = net",
		"x + y = X",
	],
	// The forms the found-bug batch changed: a difference in words, two rates
	// added, an approximate check to its written places, two booleans checked,
	// an inverse trigonometric call to a unit that is not an angle, a quotient
	// by zero in the algebra, and a rate solved for as a percentage.
	foundBugs: [
		"subtract X from 10",
		"take 3 from X",
		"10 m/s + X km/h",
		"check X ≈ 96.56",
		"check (X > 0) == true",
		"asin(X) in km",
		"expand((x+1)/X)",
		"X:30",
		// The second found-bug batch: half a dinar split, a finance refusal in
		// the reader's terms, a one-letter label, a knot, a literal past 2^53
		// and a quotient with no single answer.
		"split X/2 KWD between 3",
		"compound interest on 1000 over 3 years at X",
		"x:X",
		"5 mph + X knots",
		"X + 9007199254740993",
		"X / 0",
		// The third: a decimal literal past 2^53, a take-home in a check, and a
		// sum or product of a range or a list on its own.
		"X + 9007199254740993.5",
		"check £X after tax > £30,000",
		"£50,000 after tax == £X",
		"sum(X:3)",
		"prod(1:X)",
		"sum([X, 2])",
		// The fourth: a salary below zero, a number past 2^53 as an integer and
		// as a percentage, and a map or reduce over a single value.
		"-£X after tax",
		"hourly for -£X",
		"-X after 20% tax",
		"X + 0.5 as int",
		"-(X) as int",
		"X + 0.5 as percent",
		"map(x * 2, X)",
		"reduce(acc + x, X)",
		// The fifth: an exact fraction past 2^53 through each rounding, and a
		// number whose percentage, a hundred times it, overflows.
		"floor((X) + 2^60 + 1/2)",
		"round(-(X) - 2^60 - 1/2)",
		"(X) + 2^60 + 1/3 as int",
		"(X) * 1e306 as %",
		"-(X) * 1e306 in %",
		"50% + (X) * 1e308",
	],
	// A timecode in its own notation, its arithmetic and its conversions out
	// (#759), and an ISO 8601 duration beside a value, spread through a date
	// and written back (#760).
	timecodes: [
		"01:02:03:04 at 30 fps + X",
		"00:00:00:00 at 30 fps - X",
		"(01:02:03:04 at 30 fps) * X",
		"(01:02:03:04 at 30 fps) / X",
		"X frames at 30 fps",
		"01:02:03:04 at 30 fps + X seconds",
		"(01:02:03:04 at 30 fps + X) in seconds",
		"(01:02:03:04 at 30 fps + X) as timespan",
	],
	isoDurations: [
		"PT1H30M + X",
		"PT1H30M * X",
		"X * P1DT1H",
		"X - P1DT1H",
		"2026-01-31 + P1M1D + X days",
		"PT1H30M + X minutes",
		"(PT1H30M * X) as iso8601",
		"X seconds as iso8601",
		"X months as iso8601",
	],
	// Arithmetic straight on a value written in a base, a base conversion of
	// a value with no digits, and checks between colours and addresses.
	basesAndIdentities: [
		"X in hex + 1",
		"(X in hex) * 2",
		"(X in hex) mod 3",
		"(X in binary) ^ 2",
		"-(X in hex)",
		"(X in hex) > 2^100",
		"X in octal",
		"hex(X)",
		"check (X in hex) == (X in hex)",
		"check #ff0000 == rgb(X, 0, 0)",
		"check 192.168.1.1 < X",
	],
	// A conversion on each side of a comparison, each bound to its own side,
	// and a check whose sides carry one (FoundBug_checkWithBaseConversion).
	conversionsBesideComparisons: [
		"check X in hex == X",
		"check X in hex == X in hex",
		"check X as binary < X in octal",
		"X in hex == X in hex",
		"X == X to hex",
		"check X to hex != X + 1",
	],
	// A fraction written in a base, which the value now drops as the display
	// does (FoundBug_fractionInABase); a check against text, refused by name
	// (FoundBug_checkAgainstText); a chained check and a check joined with
	// `and`, each read as every comparison at once (FoundBug_chainedCheck,
	// FoundBug_checkJoinedWithAnd).
	checksOfSeveralThings: [
		"(X + 0.5) in hex == X in hex",
		"check ((X + 0.7) in hex) == X in hex",
		"check X == \"X\"",
		"check X in hex == \"X\"",
		"check 0 <= X <= X",
		"check X == X == X",
		"check X > -1/0 and X < 1/0",
		"check X == X and X ≈ X within 1%",
		"check X == X or X == 1",
	],
	// A number against text in a plain comparison, a base prefix read by
	// `as number`, a decimal past 2^53 in a base, money through a rounding,
	// and a large percentage or quantity written in full (the sixth
	// found-bug batch).
	textNumbersAndLargeResults: [
		"X == \"X\"",
		"X != \"X\"",
		"\"X\" > X",
		"\"0xFF\" as number + X",
		"(X + 12345678901234567890.5) in hex",
		"floor($9007199254740993.5 + (X))",
		"round(-(X) * $1)",
		"(X) * 1e22 as %",
		"(X) * 1e22 m",
		"(X) / 0 as %",
	],
	// A typed hex literal past 2^53, a sign before text, a base prefix read by
	// int and float, the difference of two dates, and an ISO duration with no
	// digit before its decimal mark (the seventh found-bug batch).
	baseLiteralsSignsAndDateDifferences: [
		"0xFFFFFFFFFFFFFFFFFFFF + X",
		"-(\"0xFF\" as number) + X",
		"-\"X\"",
		"int(\"0xFF\") + X",
		"float(\"0b101\") * X",
		"(25/12/2026 - 24/12/2026) * X",
		"2026-12-24 + (2026-12-25 - 2026-12-24) * X",
		"P.5D + X",
		"P * .5 + X",
	],
};

describe("every form stays honest over the numeric edges", () => {
	for (const [feature, forms] of Object.entries(LINE_FORMS)) {
		const lines = forms.flatMap((form) => fill(form, NUMERIC_EDGES));
		test.each(lines)(`${feature}: %s`, (line) => {
			// 1/0 - 1/0 is NaN (the floating-point standard's answer), and a form
			// fed an infinity may answer NaN in turn; that is not a leak. 0/0 is
			// refused by name, so the allowance is only for the lines naming it.
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		});
	}
});

describe("text edges are read as text, not acted on", () => {
	test.each(TEXT_EDGES)("the line %j", (line) => {
		expectHonestLine(line);
	});

	test.each(fill("X + 1", TEXT_EDGES.filter((t) => t.trim() !== "")))("inside an expression: %j", (line) => {
		expectHonestLine(line);
	});
});

/**
 * An ISO 8601 duration is read from an identifier, so the text edges go inside
 * it as well as beside it, and the prototype words go where a duration's
 * letters, a converter or a unit would be (#760). A timecode's conversion
 * target is a word the reader typed too (#759).
 */
describe("an ISO 8601 duration and a timecode stay honest over the text edges and the prototype words", () => {
	test.each([...fill("PTX1H", TEXT_EDGES), ...fill("P1DX", TEXT_EDGES), ...fill("X + PT1H30M", TEXT_EDGES.filter((t) => t.trim() !== ""))])("%j", (line) => {
		expectHonestLine(line);
	});

	test.each(PROTOTYPE_WORDS.flatMap((word) => [`P${word}`, `${word} + PT1H`, `PT1H in ${word}`, `01:02:03:04 at 30 fps in ${word}`, `(01:02:03:04 at 30 fps) in ${word}`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});
});

describe("document edges agree through both passes", () => {
	// The four trailing-newline documents were pinned open here until #613.
	test.each(DOCUMENT_EDGES)("the document %j", (text) => {
		expectHonestDocument(text);
	});
});

/**
 * The cross-line forms, each with `X` where an edge value goes, run through both
 * document passes. Goal seek resolves only in the incremental pass by design,
 * so its passes are not compared.
 */
const DOCUMENT_FORMS: ReadonlyArray<{ readonly form: string; readonly agree?: boolean }> = [
	{ form: "a = X\nb = a * 2\nline 2 with a = 5" },
	{ form: "a = 1\nb = a * 2\nline 2 with a = X" },
	{ form: "a = 1\nb = a * 2\nline 2 for a from X to 3 step 1" },
	{ form: "a = 1\nb = a * 2\nline 2 for a from 1 to 3 step X" },
	{ form: "X\ncheck line 1 == X" },
	{ form: "X #t\n5 #t\ntotal of #t" },
	{ form: "# S\nX\n5\ntotal of section \"S\"" },
	{ form: "| item | cost |\n| --- | --- |\n| food | X |\n\ncolumn \"cost\" for \"food\"" },
	{ form: "X\n5\ntotal above\naverage above" },
	{ form: "X\ninputs of line 1" },
	{ form: "x = 1\ny = x * 3\nsolve line 2 for x = X", agree: false },
	{ form: ":price = £200\nprice * 3\nsolve line 2 for price = £X", agree: false },
	// Both signs, a gap in the scan and a stated range (#739).
	{ form: "x = 1\ny = 2^x\nsolve line 2 for x = X", agree: false },
	{ form: "x = 1\ny = 1/x\nsolve line 2 for x = X between -10 and 10", agree: false },
	{ form: "x = 1\ny = x * 3\nsolve line 2 for x = 6 between X and 10", agree: false },
	// A formula stored before its unknown had a value, read below it (#732).
	{ form: "y = x + 1\nx = X\ny + x" },
	{ form: "y = x * 2\nx = X\ny" },
	// A document's own unit as a conversion target, and a rename (#762).
	{ form: "1 sprint = 2 weeks\nX days in sprints" },
	{ form: "1 click = 1 km\nX km in clicks" },
	{ form: "1 click = 1 km\nX clicks" },
	// A lone sum or total under labelled lines (#742), and a name of several
	// words read below its definition (#743).
	{ form: "Rent $X\nFood $300\nsum" },
	{ form: "total = X\ntotal" },
	{ form: "hourly rate = X\nhours = 8\nhourly rate * hours" },
	// A possessive name read with the other apostrophe, a stored formula given
	// a unit, and an equation left with one unknown once the others have
	// values (the eighth found-bug batch).
	{ form: "Alice's food = X\nAlice’s food * 2" },
	{ form: "y = x + X\ny km\ny percent =>" },
	{ form: "salary = X\nnet = 1000\n(salary / 12) * rate / 100 = net\nrate =>" },
	// A named scenario and a date sweep (#744).
	{ form: "a = 1\nb = a * 2\nscenario s with a = X\nline 2 under s" },
	{ form: "d = 2026-01-01\n(d - 2026-01-01) in days\nline 2 for d from 2026-01-01 to 2026-06-01 step X months" },
	{ form: "d = 2026-01-01\n(d - 2026-01-01) in days\nline 2 for d from 2026-01-01 to 2026-06-01 step X days" },
	// A list that carries a unit, from a line above (#745).
	{ form: "a = X km\n[a, 500 m] * 2" },
	// A time held in a variable, converted from a zone named after it; a
	// variable named salary after tax; a one-letter label beside the variable
	// of that name (the second found-bug batch).
	{ form: "t = 3pm\n(t + X hours) London in Tokyo" },
	{ form: "t = X\nt London in Tokyo" },
	{ form: "salary = £X\nsalary after tax" },
	{ form: "x = X\nx:3\nx + 1" },
	// Membership through a variable holding a block, and a variable holding
	// anything else after `in`.
	{ form: "lab = 192.168.1.0/24\nX in lab" },
	{ form: "lab = X\n192.168.1.7 in lab" },
	{ form: "big = (2^100 + X) in hex\nbig + 1" },
	{ form: "A = X\nB = X\nA in hex == B in hex\ncheck A in hex == B in binary" },
	// A chained check and a check joined with `and` over the lines above.
	{ form: "A = X\ncheck A - 1 < A < A + 1\ncheck A == A and A >= A" },
	{ form: "A = X + 0.5\nB = A in hex\ncheck B == A and B in hex == B" },
	// A number in a base inside a column the span aggregates read.
	{ form: "X in hex\n0b101 as binary\ntotal above\naverage above\ntotal above in hex" },
	{ form: "X in hex\n2\nsum(line 1 : line 2)" },
];

describe("the cross-line forms stay honest over the numeric edges, through both passes", () => {
	for (const { form, agree } of DOCUMENT_FORMS) {
		test.each(fill(form, NUMERIC_EDGES))(`${form.split("\n").pop()}: %j`, (text) => {
			expectHonestDocument(text, { agree, allowNaN: text.includes("0/0") });
		});
	}
});

describe("a word naming an inherited property is an ordinary unknown word", () => {
	const forms = [
		"5 as X",
		"5 in X",
		"5 to nearest X",
		"X(5)",
		"X",
		"time in X",
		"2026-04-03T15:00 in X-5",
		"total of #X",
		"5 X",
		"5 metric X",
		"35 mpg X",
		"4000px at X dpi",
		"X at 300 dpi",
		"X is prime",
		"add X to 10",
		"larger of X and 4 and 12",
		"5 kg/X^3",
		"9.81 m/s^2 in X/s^2",
		"60 km/h in miles per X",
		"$20/hour in $/X",
		"10 Hz in /X",
		"$0.30/kWh * 2 X * 3 h",
		"84 days in X",
		"X(16)",
		"fe80::1%X",
		"fe80::1 in X",
		"192.168.1.7 in X",
		"check X == #ff0000",
		"check 1 < X < 2",
		"check X == 1 and 1 == X",
		"check X == \"X\"",
		"X == \"X\"",
		"\"X\" < 1",
		"\"X\" as number",
		"-\"X\"",
		"int(\"0xX\")",
		"P.5X",
		"hosts in X",
	];
	test.each(forms.flatMap((form) => fill(form, PROTOTYPE_WORDS)))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test.each(PROTOTYPE_WORDS)("as a variable, a section and a table column: %s", (word) => {
		expectPrototypeUntouched(() => {
			expectHonestDocument(`${word} = 5\n${word} * 2`);
			// As a label, before a lone total, and in a name of several words.
			expectHonestDocument(`${word} $5\nsum`);
			expectHonestDocument(`${word} rate = 5\n${word} rate * 2`);
			// With a possessive, under the arrow, and in an equation of several unknowns.
			expectHonestDocument(`${word}'s rate = 5\n${word}’s rate * 2`);
			expectHonestDocument(`${word} percent =>\n${word} km =>`);
			expectHonestDocument(`${word} + y = 10\n${word} =>`);
			expectHonestDocument(`# ${word}\n10\ntotal of section "${word}"`, { agree: false });
			expectHonestDocument(`| ${word} | cost |\n| --- | --- |\n| food | 10 |\n\ncolumn "${word}" for "food"`, { agree: false });
		});
	});
});

describe("inputs sized to exhaust time are answered or refused in time", () => {
	test.each([
		["a long sum", RESOURCE_PROBES.longSum()],
		["deep brackets", RESOURCE_PROBES.deepParens()],
		["a long string", RESOURCE_PROBES.longText()],
		["a long name", RESOURCE_PROBES.longIdentifier()],
		["a huge power", RESOURCE_PROBES.hugePower()],
		["a huge range", RESOURCE_PROBES.hugeRange()],
		["a long run of words before an amount", `${RESOURCE_PROBES.longIdentifier(10).concat(" ").repeat(2_000)}$5`],
		["a long run of words before an =", `${RESOURCE_PROBES.longIdentifier(10).concat(" ").repeat(2_000)}= 5`],
		["a long chain of negations", `${"not ".repeat(1_000)}true`],
	])("%s", (_name, line) => {
		expectHonestLine(line, { budgetMs: 5_000 });
	});

	test("a long chain of previous-line reads", () => {
		expectHonestDocument(RESOURCE_PROBES.manyLines(1_000), { budgetMs: 10_000 });
	});
});

/**
 * The forms that depend on how an engine is configured: a sentence ending read
 * when the host opts in (#741), and the decimal comma and `;` separator of a
 * comma-decimal locale (#740).
 */
describe("the configured forms stay honest over the numeric and text edges", () => {
	const punctuated = newTrackedEngine({ config: { validation: { allowTrailingPunctuation: true } } });
	test.each([...fill("X?", NUMERIC_EDGES), ...fill("X + 1.", NUMERIC_EDGES), ...fill("what is X km in miles?", NUMERIC_EDGES), ...TEXT_EDGES.map((t) => `${t}?`)])(
		"a trailing mark, opted in: %j",
		(line) => {
			expectHonestLine(line, { engine: punctuated, allowNaN: line.includes("0/0") });
		},
	);

	const german = newTrackedEngine({ locale: "de" });
	const french = newTrackedEngine({ locale: "fr" });
	const COMMA_FORMS = ["X + 1,5", "max(X; 2,5)", "max(X, 1,5)", "[X, 1,5; 2, 3]", "€X * 1,5", "X * 12,5%"];
	test.each(COMMA_FORMS.flatMap((form) => fill(form, NUMERIC_EDGES)))("a decimal comma under de and fr: %j", (line) => {
		expectHonestLine(line, { engine: german, allowNaN: line.includes("0/0") });
		expectHonestLine(line, { engine: french, allowNaN: line.includes("0/0") });
	});

	test.each(PROTOTYPE_WORDS.flatMap((word) => [`${word} + 1,5`, `max(${word}; 1,5)`, `${word}?`]))("a prototype word beside the configured forms: %s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line, { engine: german });
			expectHonestLine(line, { engine: punctuated });
		});
	});

	// A pack's own function names and conversion words, which add to English
	// (#833), and a package's unit aliases (#762).
	const PACK_FORMS: ReadonlyArray<readonly [string, typeof german]> = [
		["wurzel(X)", german], ["runden(X)", german], ["aufrunden(X)", german], ["sqrt(X)", german], ["X km in m", german], ["3pm Tokyo in Dubai + X", german],
		["racine(X)", french], ["plafond(X)", french], ["X km en m", french], ["convertir X km en m", french],
	];
	test.each(PACK_FORMS.flatMap(([form, engine]) => fill(form, NUMERIC_EDGES).map((line) => [line, engine] as const)))("a pack's word over the numeric edges: %s", (line, engine) => {
		expectHonestLine(line, { engine, allowNaN: line.includes("0/0") });
	});

	const aliased = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, { name: "sweep-aliases", unitAliases: { Meile: "mile", Tage: "days" } }] });
	test.each(["X Meile", "X km in Meile", "X Tage in hours", "X Meile to 2 dp"].flatMap((form) => [...fill(form, NUMERIC_EDGES), ...fill(form, TEXT_EDGES)]))("a unit alias over the edges: %j", (line) => {
		expectHonestLine(line, { engine: aliased, allowNaN: line.includes("0/0") });
	});

	test.each(PROTOTYPE_WORDS.flatMap((word) => [`2 ${word}`, `5 km in ${word}`]))("a prototype word where an alias is read: %s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line, { engine: aliased });
		});
	});
});
