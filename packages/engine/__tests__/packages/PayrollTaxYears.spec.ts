/**
 * The tax year the take-home figures are for.
 *
 * The package shipped one table, labelled 2024/25, and used it as the default
 * for good. The label went stale the moment the tax year rolled over, and
 * nothing said which year an answer was on. There is now a table per year, a
 * lookup by the year as a reader writes it, and the default is the latest
 * table shipped.
 *
 * What is pinned: the default is the newest year, every shipped year is
 * reachable by name in the spellings people write, a year with no table is
 * answered as unknown rather than given the nearest year's figures, and the
 * years whose figures HMRC left unchanged really are identical, so a salary
 * answers the same under each.
 */

import { describe, expect, test } from "@jest/globals";
import {
	bandsForYear,
	DEFAULT_TAX_YEAR,
	HMRC_2024_25,
	HMRC_2025_26,
	HMRC_2026_27,
	HMRC_TAX_YEARS,
	type TaxYearBands,
} from "@solve-js/packages/payroll/data/HmrcBands";
import { takeHome } from "@solve-js/packages/payroll/PayrollMath";

describe("the shipped tax years", () => {
	test("the default is the latest table, not the oldest", () => {
		const years = [...HMRC_TAX_YEARS.keys()];
		expect(years).toEqual(["2024/25", "2025/26", "2026/27"]);
		expect(DEFAULT_TAX_YEAR.year).toBe(years[years.length - 1]);
		expect(DEFAULT_TAX_YEAR).toBe(HMRC_2026_27);
	});

	test("each is reachable by name, in the spellings people write", () => {
		expect(bandsForYear("2025/26")).toBe(HMRC_2025_26);
		expect(bandsForYear("2025-26")).toBe(HMRC_2025_26);
		expect(bandsForYear("2025/2026")).toBe(HMRC_2025_26);
		expect(bandsForYear("2024/25")).toBe(HMRC_2024_25);
	});

	test("a year with no table is unknown, not the nearest one", () => {
		expect(bandsForYear("2019/20")).toBeUndefined();
		expect(bandsForYear("2030/31")).toBeUndefined();
		expect(bandsForYear("next year")).toBeUndefined();
	});
});

describe("the years HMRC left unchanged", () => {
	const figures = (b: TaxYearBands) => ({ ...b, year: "" });

	test("carry identical figures, so a salary answers the same under each", () => {
		expect(figures(HMRC_2025_26)).toEqual(figures(HMRC_2024_25));
		expect(figures(HMRC_2026_27)).toEqual(figures(HMRC_2024_25));
		for (const gross of [12_570, 30_000, 50_000, 120_000, 150_000]) {
			expect(takeHome(gross, HMRC_2026_27)).toBe(takeHome(gross, HMRC_2024_25));
		}
	});

	test("and the published 2026/27 figures are the ones in the table", () => {
		// gov.uk/income-tax-rates and the employer rates and thresholds for
		// 2026 to 2027, read on 3 September 2026.
		expect(HMRC_2026_27.personalAllowance).toBe(12_570);
		expect(HMRC_2026_27.personalAllowanceTaperFrom).toBe(100_000);
		expect(HMRC_2026_27.basicRateLimit).toBe(37_700);
		expect(HMRC_2026_27.higherRateLimit).toBe(125_140);
		expect([HMRC_2026_27.basicRate, HMRC_2026_27.higherRate, HMRC_2026_27.additionalRate]).toEqual([0.2, 0.4, 0.45]);
		expect(HMRC_2026_27.niPrimaryThreshold).toBe(12_570);
		expect(HMRC_2026_27.niUpperEarningsLimit).toBe(50_270);
		expect([HMRC_2026_27.niMainRate, HMRC_2026_27.niUpperRate]).toEqual([0.08, 0.02]);
	});
});
