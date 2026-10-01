/**
 * The documents the throughput and document-parse benchmarks time.
 *
 * They live here, outside the benchmark specs, so the ordinary suite can check
 * what they claim to be (`__tests__/bugs/Issue715_benchmarkCorpora.spec.ts`):
 * a benchmark runs outside the normal run, and a corpus that drifts into
 * measuring the error path is otherwise noticed only by someone reading it.
 * Both corpora were measuring the wrong thing before (#715): the throughput
 * corpus read variables that were never assigned on more than a third of its
 * lines, and the document-parse corpus repeated 33 lines, so past 250 lines
 * every further line was a compile-cache hit.
 */

/**
 * A throughput document of `lineCount` lines over `exprCount` expression slots.
 *
 * The lines cycle five shapes: an assignment (`:v0 = 1`), arithmetic over a
 * variable, a function call, a percentage, and a chained read. Every read
 * names the nearest variable assigned above it, so no line is an undefined
 * name: the published figure is lines per second of a document that
 * evaluates, not of one that fails (#715). The slot count repeats the shape
 * sequence (`i % exprCount`), which is what makes the tiers' distinct-line
 * counts differ from their line counts.
 *
 * @param exprCount - Expression slots before the shapes repeat; at least 1.
 * @param lineCount - Lines in the document.
 */
export function generateTierDocument(exprCount: number, lineCount: number): string {
	const lines: string[] = [];
	const shapes = ["assign", "arithmetic", "function", "percentage", "chained"] as const;
	const slots = Math.max(1, Math.floor(exprCount));
	let lastAssigned = -1;
	for (let i = 0; i < lineCount; i++) {
		const shape = shapes[(i % slots) % shapes.length];
		// The first line of every cycle is an assignment, so a read always has
		// one above it; the guard covers a caller's one-slot document.
		if (shape === "assign" || lastAssigned < 0) {
			lines.push(`:v${i} = ${(i % 100) + 1}`);
			lastAssigned = i;
			continue;
		}
		switch (shape) {
			case "arithmetic":
				lines.push(`:v${lastAssigned} + ${(i % 50) + 10}`);
				break;
			case "function":
				lines.push(i % 2 === 0 ? `sqrt(${(i % 100) + 1})` : `abs(-${(i % 100) + 1})`);
				break;
			case "percentage":
				lines.push(`${(i % 50) + 1}% of ${(i % 200) + 100}`);
				break;
			case "chained":
				lines.push(`:v${lastAssigned} * ${(i % 20) + 1}`);
				break;
		}
	}
	return lines.join("\n");
}

/** Words for the prose lines: ordinary nouns that name no unit, function or keyword. */
const TOPICS = [
	"garden", "kitchen", "roof", "office", "garage", "library", "studio", "attic", "cellar", "porch",
	"hallway", "bathroom", "balcony", "workshop", "stable", "orchard", "pantry", "nursery", "terrace", "shed",
	"fence", "window", "chimney", "staircase", "driveway",
];
const PEOPLE = [
	"Alice", "Bruno", "Clara", "Dmitri", "Esther", "Farid", "Greta", "Hugo", "Ingrid", "Jonas",
	"Keiko", "Luca", "Marta", "Nikhil", "Olga", "Pedro", "Quentin", "Rosa", "Sven", "Tamsin",
	"Umar", "Vera", "Wendell", "Ximena", "Yusuf",
];

/** The prose sentences; `{t}` is a topic and `{p}` a person, so each block's prose differs. */
const PROSE_TEMPLATES = [
	"Notes from the {t} planning session with {p}",
	"{p} agreed the following budget for the {t}",
	"Remember to check the {t} figures against the sheet {p} sent",
	"Anything below about the {t} is a working estimate from {p}",
	"## The {t} costs for {p}",
	"Ask {p} whether the {t} quote includes labour",
];

/** A prose line, distinct for every `(block, template)` pair up to 625 blocks per template, then cycling. */
function prose(block: number, template: number): string {
	const t = TOPICS[block % TOPICS.length];
	const p = PEOPLE[Math.floor(block / TOPICS.length) % PEOPLE.length];
	return PROSE_TEMPLATES[template].replace("{t}", t).replace("{p}", p);
}

/**
 * The lines of one block of the document-parse corpus, whose first line is
 * line `first` of the document (1-based), with every line distinct from every
 * other block's.
 *
 * About a quarter prose, beside everyday arithmetic, units, dates, longer
 * expressions and cross-line references, in the proportions a person types.
 * Every non-prose line evaluates: the variables are assigned in the block
 * before they are read, `line N` names this block's first assignment, and
 * `total above` sums a run of lines that work. The prose is expected not to
 * parse, which is the failed-parse path a real note takes for it.
 */
function documentBlock(b: number, first: number): string[] {
	const budgetLine = first + 1;
	return [
		prose(b, 0),
		`:budget${b} = ${48000 + b}`,
		`:headcount${b} = ${(b % 9) + 2}`,
		`:budget${b} / :headcount${b}`,
		`${1200 + b} + ${340 + (b % 50)} + 89`,
		`${(b % 40) + 5}% of ${48000 + b}`,
		prose(b, 1),
		`${120 + b} km/h to m/s`,
		`${b + 3.5} kg + ${400 + (b % 100)} g`,
		`${(b % 12) + 4 + b / 1000} l/100km in mpg`,
		`${20 + b} degrees celsius in fahrenheit`,
		prose(b, 2),
		`now + ${b + 1} days`,
		`${b + 1} weeks in hours`,
		prose(b, 3),
		`sqrt(${144 + b}) + 50% of ${200 + b} - 3 * (10 + 5)`,
		`round((${48000 + b} / 6) * 0.85, 2)`,
		`max(${120 + b}, 340, 89) - min(12, 45, 7)`,
		prose(b, 4),
		`:subtotal${b} = ${1200 + b} + 340`,
		`:subtotal${b} * 1.2`,
		`line ${budgetLine} + ${100 + b}`,
		prose(b, 5),
	];
}

/**
 * The document-parse corpus: `lines` lines, each distinct, so a cold pass
 * over it is one compilation per line and a warm pass is a real test of the
 * compile caches (#715, #765). Built block by block; see {@link documentBlock}.
 *
 * @param lines - Lines in the document; distinct up to 14,375 (625 blocks of 23).
 */
export function realisticDocument(lines: number): string {
	const out: string[] = [];
	for (let b = 0; out.length < lines; b++) {
		for (const line of documentBlock(b, out.length + 1)) {
			if (out.length >= lines) break;
			out.push(line);
		}
	}
	return out.join("\n");
}

/** Whether `line` is one of the prose lines {@link realisticDocument} writes, for a check that only they fail. */
export function isCorpusProse(line: string): boolean {
	return /^(Notes from the |[A-Z][a-z]+ agreed the following |Remember to check the |Anything below about the |## The |Ask [A-Z])/.test(line);
}
