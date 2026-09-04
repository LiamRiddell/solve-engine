/**
 * Shared inputs for the normalizer's fidelity and cost specs.
 *
 * {@link NORMALIZER_CORPUS} is a breadth-first list of expressions reaching
 * every rule family the built-in packages register. A shape is only proven at
 * the spellings something actually reaches, so a family missing from this list
 * is a family whose declaration is unproven. It is kept beside the rules rather
 * than harvested from the docs so that a spelling with no documentation page is
 * still covered; the specs that read it add the documentation corpus on top.
 *
 * {@link mixedDocument} builds a document in the proportions a person actually
 * types, prose beside arithmetic, units, dates, longer expressions and
 * cross-line references, with every line distinct so the engine's compiled
 * front-half cache cannot skip any of them.
 */

/** Expressions exercising every rule family the built-in packages register. */
export const NORMALIZER_CORPUS: readonly string[] = [
	// Plain arithmetic and grouping, where nothing should fire.
	"12 + 34 * (56 - 7) / 8",
	"The quarterly report covers revenue and cost",
	":v42 = 43",
	"sqrt(144) + 5",

	// Implicit multiplication.
	"2(x + 1) + 3y",
	"5(3 + 2)",
	"2 power of 3",
	"99 per week",

	// The three rules shaped last: bill splits, recurring schedules and nth weekdays.
	"split $120 between 3",
	"$120 split 3 ways",
	"split $100 between 4 people",
	"$120 + 18% split 3 ways",
	"10 split 3 ways",
	"450 monthly for 18 months",
	"12.99 monthly for 2 years",
	"2000 every 2 weeks for 6 months",
	"$12.99 monthly for 2 years",
	"2nd Tuesday of March 2026",
	"4th Thursday of November 2026",
	"last Friday of November 2026",
	"1st Monday of next month",

	// Phrases.
	"10 increase by 5%",
	"half of 250",
	"2 to the power of 8",

	// Clock times, laptimes, timecodes, frames.
	"9:00am + 30 minutes",
	"16:00",
	"4pm",
	"01:02:03",
	"01:02:03:04 @ 30fps",
	"10 frames at 24fps",
	"9:30 to 17:00",

	// Ranges, which the time rules must NOT claim.
	"map(10*x, 0:3)",
	"[1, 2, 3]",

	// Units, compounds, rates, conversions.
	"120 km/h to m/s",
	"3 kg + 2 kg",
	"5 m/s^2",
	"100 miles per gallon",
	"1 hour 30 minutes",
	"20 degrees celsius in fahrenheit",
	"8 L/100km",
	"$50 at 5% per year",

	// Dates.
	"25/12/2026",
	"March 9, 2024",
	"next friday",
	"3rd monday of January",
	"days until christmas",
	"now + 5 days",

	// Call-fusion families.
	'sha256("hi")',
	'md5("x")',
	'base64("hello")',
	'upper("text")',
	"mean(1, 2, 3)",
	"median(4, 5, 6)",
	"pick(1, 2, 3)",
	"ratio(3, 4)",
	"bmi(70, 1.8)",
	"rgb(255, 0, 0)",
	"plot(x^2)",
	"solve(x + 2 = 10)",
	"derivative(x^2)",

	// Percentages.
	"200 + 10%",
	"50% of 200",
	"20% off 80",
	"increase 100 by 10%",

	// Numerics and literals.
	"1.5M + 2k",
	"3 + 4i",
	"192.168.0.1/24",
	"0xFF + 0b1010",
	"1/2 + 1/3",

	// Uncertainty, bigint, misc.
	"10 +/- 2",
	"2^100",
	"45°",

	// Variables and line references.
	":total = 100",
	"line 1 + 2",
	"sum(line1: line2)",
];

/**
 * Line templates for {@link mixedDocument}, one pool per kind of content.
 * `{n}` is replaced by a two-digit number that changes every line, which is
 * what keeps every line of the document distinct.
 */
const POOLS: ReadonlyArray<{ readonly pool: readonly string[]; readonly weight: number }> = [
	{
		weight: 30,
		pool: [
			"Notes from planning session {n}",
			"The team agreed the budget for year {n}",
			"Remember to check figure {n} against the finance sheet",
			"Anything below line {n} is a working estimate",
			"## Costs {n}",
		],
	},
	{
		weight: 25,
		pool: [
			":budget{n} = {n}000",
			":headcount = {n}",
			"{n}200 + 340 + 89",
			"15% of {n}000",
			"{n}000 - 12%",
			":rent = 2{n}00 * 12",
			"{n} + {n} * 2",
		],
	},
	{
		weight: 15,
		pool: [
			"{n}0 km/h to m/s",
			"3.5 kg + {n}00 g",
			"{n} L/100km in mpg",
			"{n} degrees celsius in fahrenheit",
			"1 hour {n} minutes + 45 minutes",
			"{n} hours + 30 minutes",
			"{n} GB / 8",
		],
	},
	{
		weight: 10,
		pool: [
			"25/12/20{n} - now",
			"now + {n} days",
			"days until 01/01/20{n}",
			"{n} weeks in hours",
		],
	},
	{
		weight: 15,
		pool: [
			"sqrt(144) + {n}% of 200 - 3 * (10 + 5)",
			"(1200 + {n}) * 1.2 / (4 - 1)",
			"round(({n}000 / 6) * 0.85, 2)",
			"max(120, {n}, 89) - min(12, 45, 7)",
			"((2 + {n}) * (4 + 5)) ^ 2 / 15",
			"{n}% of (48000 / 6) + 250 GB / 8",
		],
	},
	{
		weight: 5,
		pool: [
			":subtotal{n} = 1200 + {n}",
			":subtotal{n} * 1.2",
			"line 1 + {n}",
			"total above + {n}",
		],
	},
];

/**
 * A document of `lines` distinct lines, cycling the pools in a fixed ratio
 * (roughly 30% prose, 25% simple arithmetic, 15% units, 10% dates, 15% longer
 * expressions, 5% cross-line references), the same proportions the document
 * parse benchmark uses.
 *
 * @param lines - How many lines to produce.
 * @returns The lines, in document order.
 */
export function mixedDocument(lines: number): string[] {
	const out: string[] = [];
	let round = 0;
	while (out.length < lines) {
		for (const { pool, weight } of POOLS) {
			for (let k = 0; k < weight && out.length < lines; k++) {
				const template = pool[(round + k) % pool.length];
				const n = String(10 + (out.length % 90));
				out.push(template.replace(/\{n\}/g, n));
			}
		}
		round++;
	}
	return out;
}
