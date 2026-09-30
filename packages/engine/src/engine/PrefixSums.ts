/**
 * Running totals over a fixed run of positions, which a single position can
 * change and any prefix can be summed in O(log n): a Fenwick tree.
 *
 * The evaluator keeps what each line spent when it last ran (#711, #694), and
 * a pass limited to the viewport starts from the sum of what the lines above
 * it spent. Summing that by walking every line was most of the cost of a
 * scroll on a long note; this answers it by position instead, and a line that
 * runs again changes its own figure in place.
 */
export class PrefixSums {
	/** The tree, 1-based: slot `i` holds the sum of the `i & -i` positions ending at `i`. */
	private readonly tree: Float64Array;

	/**
	 * @param values - The figure at each position, `values[0]` for position 1.
	 * A figure that is not a finite number counts as 0.
	 */
	constructor(values: ArrayLike<number>) {
		const size = values.length;
		this.tree = new Float64Array(size + 1);
		for (let i = 1; i <= size; i++) {
			const value = values[i - 1];
			this.tree[i] += Number.isFinite(value) ? value : 0;
			const parent = i + (i & -i);
			if (parent <= size) this.tree[parent] += this.tree[i];
		}
	}

	/** How many positions the totals cover. */
	get size(): number {
		return this.tree.length - 1;
	}

	/**
	 * Add `delta` to the figure at `position`. A position outside 1 to
	 * {@link size}, or a delta that is not a finite number, changes nothing.
	 *
	 * @param position - The 1-based position.
	 * @param delta - The change.
	 */
	add(position: number, delta: number): void {
		if (!Number.isInteger(position) || position < 1 || position > this.size || !Number.isFinite(delta) || delta === 0) return;
		for (let i = position; i <= this.size; i += i & -i) this.tree[i] += delta;
	}

	/**
	 * The sum of the figures at every position before `position`: 0 for
	 * position 1 or below, the whole run for a position past its end.
	 *
	 * @param position - The 1-based position, itself excluded.
	 * @returns The sum.
	 */
	sumBefore(position: number): number {
		if (Number.isNaN(position)) return 0;
		let i = Math.min(Math.floor(position) - 1, this.size);
		let sum = 0;
		for (; i > 0; i -= i & -i) sum += this.tree[i];
		return sum;
	}
}
