/**
 * The fuzzers' only source of randomness.
 *
 * Written here rather than installed, for two reasons. A fuzzer's whole value
 * rests on a failure being reproducible from its seed, and a dependency that
 * changes its algorithm in a patch release silently invalidates every seed in
 * the corpus. And a fuzz corpus outlives the run that found it: a reproducer
 * recorded today has to still reproduce in a year, which means the generator
 * has to be pinned to this file rather than to a version range.
 *
 * The algorithm is SplitMix64 run on a pair of 32-bit halves, because a
 * BigInt-based 64-bit generator costs an allocation per draw and this is called
 * millions of times in a soak. The constants are the published ones. Quality
 * beyond "well distributed and reproducible" is not needed: nothing here is
 * cryptographic, and a fuzzer explores by volume rather than by the statistical
 * purity of any single draw.
 *
 * @module Prng
 */

/**
 * A seeded, deterministic pseudo-random source.
 *
 * Two instances built from the same seed produce the same sequence forever,
 * which is the property the whole corpus rests on.
 */
export class Prng {
	/** Low 32 bits of the SplitMix64 state. */
	private lo: number;
	/** High 32 bits of the SplitMix64 state. */
	private hi: number;

	/**
	 * @param seed - Any 32-bit integer. Seeds are recorded in corpus entries, so
	 * this is the value a reader types to replay a failure.
	 */
	constructor(seed: number) {
		// The seed is spread across both halves before the first draw. Seeding
		// only the low half makes the first few outputs of nearby seeds
		// correlate, and nearby seeds are exactly what a soak run uses.
		this.lo = seed | 0;
		this.hi = (Math.imul(seed, 0x9e3779b9) ^ 0x85ebca6b) | 0;
		// Discard a few draws so a caller that only ever asks for one value per
		// seed still gets a well mixed one.
		for (let i = 0; i < 4; i++) this.nextUint32();
	}

	/**
	 * The next raw draw.
	 *
	 * @returns An unsigned 32-bit integer, uniformly distributed.
	 */
	nextUint32(): number {
		// state += 0x9e3779b97f4a7c15, as two 32-bit adds with a carry.
		const carry = (this.lo >>> 0) + 0x7f4a7c15 > 0xffffffff ? 1 : 0;
		this.lo = (this.lo + 0x7f4a7c15) | 0;
		this.hi = (this.hi + 0x9e3779b9 + carry) | 0;

		// The SplitMix64 finaliser, folded onto 32 bits. The full 64-bit
		// version needs BigInt; folding the two halves together with the same
		// multiply constants keeps the avalanche without the allocation.
		let z0 = this.lo ^ (this.hi >>> 15);
		z0 = Math.imul(z0, 0x85ebca6b);
		z0 ^= z0 >>> 13;
		z0 = Math.imul(z0, 0xc2b2ae35);
		z0 ^= z0 >>> 16;
		return z0 >>> 0;
	}

	/**
	 * A draw in `[0, bound)`.
	 *
	 * @param bound - Exclusive upper bound. A bound of zero or less returns 0,
	 * so a caller looping over an empty table does not have to guard.
	 * @returns An integer below `bound`.
	 */
	int(bound: number): number {
		if (bound <= 0) return 0;
		return this.nextUint32() % bound;
	}

	/**
	 * A draw in `[min, max]`, both ends included.
	 *
	 * @param min - Lower bound.
	 * @param max - Upper bound, inclusive.
	 * @returns An integer in the range.
	 */
	range(min: number, max: number): number {
		if (max <= min) return min;
		return min + this.int(max - min + 1);
	}

	/**
	 * A draw in `[0, 1)`.
	 *
	 * @returns A float, with 32 bits of entropy.
	 */
	float(): number {
		return this.nextUint32() / 0x100000000;
	}

	/**
	 * Whether an event of the given probability happened.
	 *
	 * @param probability - Chance in `[0, 1]`.
	 * @returns True with that probability.
	 */
	chance(probability: number): boolean {
		return this.float() < probability;
	}

	/**
	 * One element of an array.
	 *
	 * @param items - The array to choose from. Must not be empty.
	 * @returns A uniformly chosen element.
	 */
	pick<T>(items: readonly T[]): T {
		return items[this.int(items.length)];
	}

	/**
	 * A number chosen to be awkward rather than typical.
	 *
	 * A uniform float almost never lands on the values that break arithmetic.
	 * Half the draws here come from a table of the ones that historically do,
	 * which is what makes a numeric fuzzer find anything at all.
	 *
	 * @returns A float, frequently a boundary value.
	 */
	awkwardNumber(): number {
		if (this.chance(0.5)) return this.pick(AWKWARD_NUMBERS);
		if (this.chance(0.5)) return this.range(-1000, 1000);
		// A wide exponent range, so overflow and underflow are both reachable.
		const mantissa = this.float() * 2 - 1;
		return mantissa * Math.pow(10, this.range(-300, 300));
	}
}

/**
 * The numbers that break arithmetic, gathered in one place.
 *
 * Every entry is here because it is a boundary for something the engine does:
 * the float limits, the integer-precision limits, the typed-array and
 * collection-size limits, and the values that make a guard's comparison behave
 * differently (NaN fails every comparison, negative zero compares equal to zero
 * but divides differently).
 */
const AWKWARD_NUMBERS: readonly number[] = [
	0, -0, 1, -1, 0.5, -0.5,
	NaN, Infinity, -Infinity,
	Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
	Number.MAX_SAFE_INTEGER + 1,
	Number.MAX_VALUE, -Number.MAX_VALUE,
	Number.MIN_VALUE, -Number.MIN_VALUE,
	Number.EPSILON,
	2147483647, -2147483648, 4294967295, 4294967296,
	65535, 65536, 255, 256, 127, 128,
	1e15, 1e16, 1e21, 1e-7, 1e-323,
	// The engine's own default ceilings, so a case can sit exactly on one.
	200, 50000, 100000, 2000000,
];
