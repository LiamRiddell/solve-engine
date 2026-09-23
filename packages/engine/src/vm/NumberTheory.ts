/**
 * Primes, integer factorisation and modular arithmetic (#514), over exact
 * integers.
 *
 * Every function here works on `bigint`, so a whole number past 2^53 (which the
 * engine keeps exact, see vm/ExactIntegers.ts) is tested, factored and reduced
 * on its true digits rather than its nearest double.
 *
 * Primality is Miller-Rabin with the first thirteen primes as witnesses, which is
 * a proof, not a probability, for every number below 3.3 × 10^24; above that a
 * number that passes is a strong probable prime, and {@link isPrime} says so on
 * its caller's behalf. Factorisation is trial division by the small primes and
 * then Pollard's rho (Brent's variant) for what remains, bounded to numbers up to
 * 2^64 so that it always answers in a few milliseconds.
 */

/** The witnesses that make Miller-Rabin a proof below {@link DETERMINISTIC_LIMIT}. */
const WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];

/** Below this, a number that passes every witness is proved prime (Sorenson and Webster, 2015). */
export const DETERMINISTIC_LIMIT = 3317044064679887385961981n;

/** The largest number {@link factorInteger} will factor, 2^64. */
export const FACTOR_LIMIT = 1n << 64n;

/** `base ** exponent mod modulus` by repeated squaring, for a non-negative exponent and a positive modulus. */
export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
	if (modulus === 1n) return 0n;
	let result = 1n;
	let b = ((base % modulus) + modulus) % modulus;
	let e = exponent;
	while (e > 0n) {
		if (e & 1n) result = (result * b) % modulus;
		b = (b * b) % modulus;
		e >>= 1n;
	}
	return result;
}

/** The greatest common divisor of two integers, as a non-negative bigint. */
function gcd(a: bigint, b: bigint): bigint {
	let x = a < 0n ? -a : a;
	let y = b < 0n ? -b : b;
	while (y !== 0n) {
		const t = x % y;
		x = y;
		y = t;
	}
	return x;
}

/**
 * The inverse of `a` modulo `m`: the `x` in 0 to m-1 with `a * x ≡ 1`, or
 * undefined when there is none (when `a` and `m` share a factor).
 */
export function modInverse(a: bigint, m: bigint): bigint | undefined {
	let [oldR, r] = [((a % m) + m) % m, m];
	let [oldS, s] = [1n, 0n];
	while (r !== 0n) {
		const q = oldR / r;
		[oldR, r] = [r, oldR - q * r];
		[oldS, s] = [s, oldS - q * s];
	}
	if (oldR !== 1n) return undefined;
	return ((oldS % m) + m) % m;
}

/** Whether `n` is prime; see this module's doc comment for when that is a proof. */
export function isPrime(n: bigint): boolean {
	if (n < 2n) return false;
	for (const p of WITNESSES) {
		if (n === p) return true;
		if (n % p === 0n) return false;
	}
	let d = n - 1n;
	let s = 0;
	while ((d & 1n) === 0n) {
		d >>= 1n;
		s++;
	}
	outer: for (const a of WITNESSES) {
		let x = modPow(a, d, n);
		if (x === 1n || x === n - 1n) continue;
		for (let i = 1; i < s; i++) {
			x = (x * x) % n;
			if (x === n - 1n) continue outer;
		}
		return false;
	}
	return true;
}

/** The smallest prime greater than `n`. */
export function nextPrime(n: bigint): bigint {
	if (n < 2n) return 2n;
	let candidate = n + 1n;
	if (candidate > 2n && (candidate & 1n) === 0n) candidate++;
	while (!isPrime(candidate)) candidate += 2n;
	return candidate;
}

/** A non-trivial factor of a composite `n` by Pollard's rho, Brent's variant. */
function pollardRho(n: bigint): bigint {
	if ((n & 1n) === 0n) return 2n;
	for (let c = 1n; ; c++) {
		let y = 2n;
		let m = 128n;
		let g = 1n;
		let r = 1n;
		let q = 1n;
		let x = y;
		let ys = y;
		const f = (v: bigint): bigint => (v * v + c) % n;
		while (g === 1n) {
			x = y;
			for (let i = 0n; i < r; i++) y = f(y);
			let k = 0n;
			while (k < r && g === 1n) {
				ys = y;
				const limit = m < r - k ? m : r - k;
				for (let i = 0n; i < limit; i++) {
					y = f(y);
					q = (q * (x > y ? x - y : y - x)) % n;
				}
				g = gcd(q, n);
				k += m;
			}
			r *= 2n;
		}
		if (g === n) {
			do {
				ys = f(ys);
				g = gcd(x > ys ? x - ys : ys - x, n);
			} while (g === 1n);
		}
		if (g !== n) return g;
	}
}

/**
 * The prime factorisation of `n` (2 or more, at most {@link FACTOR_LIMIT}), as
 * `[prime, exponent]` pairs in ascending order of prime.
 */
export function factorInteger(n: bigint): Array<[bigint, number]> {
	const counts = new Map<bigint, number>();
	const add = (p: bigint): void => {
		counts.set(p, (counts.get(p) ?? 0) + 1);
	};
	let rest = n;
	for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n]) {
		while (rest % p === 0n) {
			add(p);
			rest /= p;
		}
	}
	const pending = rest > 1n ? [rest] : [];
	while (pending.length > 0) {
		const m = pending.pop()!;
		if (isPrime(m)) {
			add(m);
			continue;
		}
		const d = pollardRho(m);
		pending.push(d, m / d);
	}
	return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** A factorisation written the way it reads back as input: `2^3 * 3^2 * 5`. */
export function formatFactorisation(factors: Array<[bigint, number]>): string {
	return factors.map(([p, e]) => (e === 1 ? `${p}` : `${p}^${e}`)).join(" * ");
}
