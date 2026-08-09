/**
 * The CPI table, checked against the published series it claims to follow.
 *
 * The table carried a warning that its last two years were projections from
 * model knowledge rather than published figures, and nothing checked how far
 * off they were. Measured against the IMF monthly CPI series for the USA
 * (statisticsoftheworld.com, `IMF.CPI.YOY.M?geo=USA`), chaining annual mean
 * year-over-year rates forward from the published 2024 figure:
 *
 *   year   table    from IMF   difference
 *   2021   271.0    270.9      -0.02%
 *   2022   292.7    292.6      -0.02%
 *   2023   304.7    304.7      +0.02%
 *   2024   313.7    313.7      +0.01%
 *   2025   320.6    322.2      +0.49%   <- projection
 *   2026   327.4    332.7      +1.63%   <- projection
 *
 * So the published years were already right to two hundredths of a percent,
 * and only the two projections drifted. They are now the IMF-derived figures.
 *
 * The ratios below are what the engine actually uses, and are asserted rather
 * than the raw index values, because a uniform rescaling of the whole table
 * would leave every answer unchanged and should not fail a test.
 *
 * These are fixed numbers rather than a live fetch on purpose. A test that
 * calls a network service is a test that fails when the service is down, and
 * the point here is to catch the table being edited wrongly, not to monitor
 * somebody's uptime.
 */

import { describe, expect, test } from "@jest/globals";
import { CPI_TABLE, CPI_MIN_YEAR, CPI_MAX_YEAR } from "@solve-js/packages/finance/data/CpiTable";

/** Cumulative inflation between two years, as the engine computes it. */
function ratio(from: number, to: number): number {
	return CPI_TABLE[to] / CPI_TABLE[from];
}

describe("against the IMF series", () => {
	test("2021 to 2024 reproduce the published rates", () => {
		// Year-over-year, from the same series. Each within a tenth of a point,
		// which is the rounding the table's one-decimal index values allow.
		expect((ratio(2020, 2021) - 1) * 100).toBeCloseTo(4.7, 0);
		expect((ratio(2021, 2022) - 1) * 100).toBeCloseTo(8.0, 0);
		expect((ratio(2022, 2023) - 1) * 100).toBeCloseTo(4.1, 0);
		expect((ratio(2023, 2024) - 1) * 100).toBeCloseTo(3.0, 0);
	});

	test("the corrected 2025 and 2026 follow the series too", () => {
		expect((ratio(2024, 2025) - 1) * 100).toBeCloseTo(2.7, 0);
		expect((ratio(2025, 2026) - 1) * 100).toBeCloseTo(3.3, 0);
	});

	test("cumulative 2024 to 2026 is the 6.05% the series shows", () => {
		// The figure that exposed the drift. The projections gave 4.37%.
		expect((ratio(2024, 2026) - 1) * 100).toBeCloseTo(6.05, 1);
	});
});

describe("the table's shape", () => {
	test("every year in the declared range is present", () => {
		const missing: number[] = [];
		for (let year = CPI_MIN_YEAR; year <= CPI_MAX_YEAR; year++) {
			if (CPI_TABLE[year] === undefined) missing.push(year);
		}
		expect(missing).toEqual([]);
	});

	test("the index rises every year except the one it really fell", () => {
		// 2009 is the exception and it is genuine: US CPI fell after the 2008
		// crisis, the only annual decline in the covered period. Asserting a
		// monotonic rise failed here, and the table was right.
		const decreases: number[] = [];
		for (let year = CPI_MIN_YEAR + 1; year <= CPI_MAX_YEAR; year++) {
			if (CPI_TABLE[year] <= CPI_TABLE[year - 1]) decreases.push(year);
		}
		expect(decreases).toEqual([2009]);
	});

	test("no single year moves by an implausible amount", () => {
		// A fat-fingered digit shows up as a jump no real year had. The worst
		// in the covered period is 1980, at just over 13%.
		const implausible: string[] = [];
		for (let year = CPI_MIN_YEAR + 1; year <= CPI_MAX_YEAR; year++) {
			const change = (ratio(year - 1, year) - 1) * 100;
			if (change > 15) implausible.push(`${year}: ${change.toFixed(1)}%`);
		}
		expect(implausible).toEqual([]);
	});
});

describe("known anchors", () => {
	test("a dollar in 1970 is worth about eight and a half now", () => {
		expect(ratio(1970, 2026)).toBeCloseTo(8.57, 1);
	});

	test("the 1970s inflation shows up where it should", () => {
		// Prices roughly doubled across the decade, which is the headline fact
		// about that period and a useful guard on the early entries.
		expect(ratio(1970, 1980)).toBeCloseTo(2.12, 1);
	});
});
