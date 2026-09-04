//#region ─── Module Overview ───────────────────────────────────────────────────

/**
 * RuleIndex, a conjunctive bitmask prefilter over the normalizer's rules.
 *
 * ## Problem
 * The normalizer tries every rule eligible at a position, at every position.
 * The `startTokenTypes` hint buckets rules by the type of the token they start
 * at, which helps only where that type is selective. It is not: the thirteen
 * call-fusion rules all declare `["IDENT"]`, the commonest token in prose, and
 * the rules firing on a bare `NUMBER` all share that one type too. Measured
 * against the built-in package set, the `IDENT` bucket held 53 of 57 rules and
 * the `NUMBER` bucket 45, because a rule declaring no hint has to be tried
 * everywhere.
 *
 * ## Solution
 * Rules discriminate on different things, so no single axis separates them.
 * A rule declares its leading {@link RuleSlot} shape, and this builds one
 * lookup plane per slot: a flat `Uint32Array` of rule bitmasks indexed by token
 * type id, so a lookup is an array load rather than a hash. A position ANDs the
 * planes together and iterates only the surviving bits, which for most
 * positions is none at all.
 *
 * Rejecting a position therefore costs a few loads and ANDs instead of
 * forty-odd closure calls, and one AND tests 32 rules at once. That the common
 * answer is "no rule can fire here" is the point.
 *
 * ## Why planes rather than a fingerprint
 * A superimposed code (OR the hashed types of a window into one word, AND
 * against a per-rule required fingerprint) looks like the cheaper way to reach
 * depth, but it is a per-RULE test with no way to invert it into a lookup, so
 * it stays O(rules) per position. These planes are the same conjunctive test
 * done exactly, at O(rules / 32) and with no false positives. Token types
 * number a couple of hundred, small enough to table, so there is nothing to
 * gain by approximating.
 *
 * ## Ordering
 * Bit `i` is the rule at index `i` of the priority-sorted rule list, so
 * iterating bits from low to high visits rules in exactly the order the
 * unindexed scan did. Ties keep registration order, because the sort is stable.
 * This is what makes the index a pure filter rather than a behaviour change,
 * and `NormalizerIndexFidelity.spec` pins it.
 *
 * ## Safety
 * The contract runs one way: a slot admitting MORE than the rule can match
 * costs a `match()` that returns null, which is what happens today; a slot
 * admitting LESS makes the rule unreachable, a silent bug. So indexing fewer
 * planes than were declared is always safe, which is why {@link MAX_PLANES}
 * can be tuned on evidence rather than being a correctness decision. Only
 * over-narrow declarations are dangerous, and those are what the fidelity spec
 * hunts for.
 *
 * @module RuleIndex
 */

//#endregion
//#region ─── Imports ──────────────────────────────────────────────────────────

import type { NormalizerRule, RuleSlot } from "./NormalizerRule";
import { tokenTypeId } from "@solve-js/lexer/Token";

//#endregion
//#region ─── Constants ────────────────────────────────────────────────────────

/** Bits per word in the masks below. */
const WORD_BITS = 32;

/**
 * How many leading slots are indexed, however many a rule declares.
 *
 * Each plane costs a load and an AND at every position, unconditionally, while
 * only positions surviving the earlier planes can benefit from a later one.
 * After two planes most positions have no candidates left, so a third would tax
 * every token to save a couple of `match()` calls on the few that reach it.
 *
 * Two is a measured default, not a limit of the design: raising it is a
 * one-line change, and lowering it can never break a rule (see this module's
 * Safety note). Rules may declare deeper shapes freely; the extra slots simply
 * go unindexed and are checked by `match()` as before.
 */
const MAX_PLANES = 2;

//#endregion
//#region ─── Shape normalisation ──────────────────────────────────────────────

/**
 * A rule's effective shape, folding the older {@link NormalizerRule.startTokenTypes}
 * into the general form. `shape` wins when both are present.
 */
export function effectiveShape(rule: NormalizerRule): readonly RuleSlot[] {
	if (rule.shape !== undefined) return rule.shape;
	if (rule.startTokenTypes !== undefined) return [{ types: rule.startTokenTypes }];
	return [];
}

//#endregion
//#region ─── RuleIndex ────────────────────────────────────────────────────────

/** One indexed slot position: the type plane, plus the value axis for it. */
interface Plane {
	/** `[typeId * words + w]`, rules whose slot admits `typeId`. */
	readonly byType: Uint32Array;
	/** Rules constraining no type here, admitted at a type with no row. */
	readonly typeAny: Uint32Array;
	/**
	 * Rules constraining no type here, and so the only ones still admissible
	 * when the stream ends before this slot.
	 */
	readonly atEnd: Uint32Array;
	/** `[typeId]`, 1 when a value-constraining rule admits this type here. */
	readonly typeHasValues: Uint8Array;
	/** Lower-cased word to the rules naming it at this slot. */
	readonly byValue: Map<string, Uint32Array>;
	/** Rules constraining no value here. */
	readonly valueAny: Uint32Array;
}

/**
 * A conjunctive bitmask prefilter over a priority-sorted rule list.
 *
 * Built once per rule-set mutation (registration time), then read only. See
 * this module's overview for the shape and the ordering guarantee.
 */
export class RuleIndex {
	/** The priority-sorted rules. Bit `i` of every mask refers to `rules[i]`. */
	readonly rules: readonly NormalizerRule[];

	/** Words per mask, `ceil(rules.length / 32)`. */
	readonly words: number;

	/** Number of token type ids with their own row, exclusive upper bound. */
	private readonly typeRows: number;

	/** One per indexed slot, at most {@link MAX_PLANES}. */
	private readonly planes: readonly Plane[];

	/** Reused across positions so the hot path allocates nothing. */
	private readonly scratch: Uint32Array;

	/**
	 * Every rule's bit set.
	 *
	 * Returned when there are no planes at all, which happens when no rule
	 * declares a shape. Without it {@link candidates} would hand back an
	 * unwritten scratch buffer, i.e. "no rule can fire anywhere", and every
	 * rule would silently stop running. The all-admitted answer is the correct
	 * one: a rule that constrains nothing can match anywhere.
	 */
	private readonly allRules: Uint32Array;

	constructor(sortedRules: readonly NormalizerRule[]) {
		this.rules = sortedRules;
		const n = sortedRules.length;
		const w = Math.max(1, Math.ceil(n / WORD_BITS));
		this.words = w;
		this.scratch = new Uint32Array(w);

		const shapes = sortedRules.map(effectiveShape);

		// Size the type-indexed rows to cover every type any rule names. A token
		// whose id lands past this (a plugin type minted after the index was
		// built, say) falls back to the "constrains nothing" masks, which is
		// correct rather than merely safe: a rule naming types cannot match a
		// type it did not name, and a rule naming none can match anywhere.
		let maxTypeId = 0;
		for (const shape of shapes) {
			for (const slot of shape) {
				for (const t of slot.types ?? []) maxTypeId = Math.max(maxTypeId, tokenTypeId(t));
			}
		}
		this.typeRows = maxTypeId + 1;

		let depth = 0;
		for (const shape of shapes) depth = Math.max(depth, shape.length);
		depth = Math.min(depth, MAX_PLANES);

		this.allRules = new Uint32Array(w);
		for (let i = 0; i < n; i++) {
			this.allRules[(i / WORD_BITS) | 0] |= 1 << (i % WORD_BITS);
		}

		const planes: Plane[] = [];
		for (let k = 0; k < depth; k++) {
			planes.push(this.buildPlane(shapes, k, w));
		}
		this.planes = planes;
	}

	/** Build the lookup plane for slot `k`. */
	private buildPlane(shapes: readonly (readonly RuleSlot[])[], k: number, w: number): Plane {
		const plane: Plane = {
			byType: new Uint32Array(this.typeRows * w),
			typeAny: new Uint32Array(w),
			atEnd: new Uint32Array(w),
			typeHasValues: new Uint8Array(this.typeRows),
			byValue: new Map<string, Uint32Array>(),
			valueAny: new Uint32Array(w),
		};

		for (let i = 0; i < shapes.length; i++) {
			const slot: RuleSlot | undefined = shapes[i][k];
			const word = (i / WORD_BITS) | 0;
			const bit = 1 << (i % WORD_BITS);

			// ── Types ──
			const types = slot?.types;
			if (types === undefined) {
				// Constrains nothing here, so admitted at every type, at a type
				// with no row, and past the end of the stream.
				//
				// Deliberately NOT written into every row of `byType`. Doing that
				// made construction O(rules x tokenTypes), tens of thousands of
				// writes for a table most of which is the same bit, and the
				// engine builds an index per instance: a cold parse of a short
				// document paid for it without ever amortising it. The lookup
				// ORs `typeAny` in instead, which is one extra operation per word
				// on a path that already does several.
				plane.typeAny[word] |= bit;
				plane.atEnd[word] |= bit;
			} else {
				for (const t of types) plane.byType[tokenTypeId(t) * w + word] |= bit;
			}

			// ── Values ──
			const values = slot?.values;
			if (values === undefined) {
				plane.valueAny[word] |= bit;
			} else {
				for (const raw of values) {
					const value = raw.toLowerCase();
					let mask = plane.byValue.get(value);
					if (mask === undefined) {
						mask = new Uint32Array(w);
						plane.byValue.set(value, mask);
					}
					mask[word] |= bit;
				}
				// The value axis is only worth a map lookup at a type some
				// value-constraining rule admits here.
				if (types === undefined) {
					plane.typeHasValues.fill(1);
				} else {
					for (const t of types) {
						const id = tokenTypeId(t);
						if (id < this.typeRows) plane.typeHasValues[id] = 1;
					}
				}
			}
		}

		return plane;
	}

	/** Number of indexed rules. */
	get size(): number { return this.rules.length; }

	/** How many slot positions are indexed. */
	get depth(): number { return this.planes.length; }

	/**
	 * The candidate mask for a position, written into a reused scratch buffer
	 * and returned. Bits are rule indices, ascending bit order being descending
	 * priority. The buffer is overwritten by the next call, so read it before
	 * calling again.
	 *
	 * @param tokens - The stream being walked
	 * @param pos    - The position to test
	 */
	candidates(tokens: readonly { typeId: number; value: string }[], pos: number): Uint32Array {
		const w = this.words;
		const scratch = this.scratch;
		const planes = this.planes;
		const len = tokens.length;

		if (planes.length === 0) {
			scratch.set(this.allRules);
			return scratch;
		}

		for (let k = 0; k < planes.length; k++) {
			const plane = planes[k];
			const at = pos + k;

			if (at >= len) {
				// The stream ends before this slot, so only rules that constrain
				// nothing here remain admissible.
				if (k === 0) { scratch.set(plane.atEnd); }
				else { for (let i = 0; i < w; i++) scratch[i] &= plane.atEnd[i]; }
				continue;
			}

			const token = tokens[at];
			const typeId = token.typeId;
			const base = typeId >= 0 && typeId < this.typeRows ? typeId * w : -1;

			// `typeAny` holds the rules that constrain no type at this slot, so
			// they are admitted whatever the token is; see the construction note.
			if (k === 0) {
				if (base >= 0) { for (let i = 0; i < w; i++) scratch[i] = plane.byType[base + i] | plane.typeAny[i]; }
				else { scratch.set(plane.typeAny); }
			} else {
				if (base >= 0) { for (let i = 0; i < w; i++) scratch[i] &= plane.byType[base + i] | plane.typeAny[i]; }
				else { for (let i = 0; i < w; i++) scratch[i] &= plane.typeAny[i]; }
			}

			// The value axis costs a map lookup and possibly a lower-casing, so
			// it is consulted only at a type some value-constraining rule names.
			if (base >= 0 && plane.typeHasValues[typeId] === 1) {
				const value = token.value;
				const lowered = hasUpper(value) ? value.toLowerCase() : value;
				const named = plane.byValue.get(lowered);
				for (let i = 0; i < w; i++) {
					scratch[i] &= (named === undefined ? 0 : named[i]) | plane.valueAny[i];
				}
			}

			if (isEmptyMask(scratch)) return scratch;
		}

		return scratch;
	}
}

/** Whether every bit of a mask returned by {@link RuleIndex.candidates} is clear. */
export function isEmptyMask(mask: Uint32Array): boolean {
	for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) return false;
	return true;
}

/**
 * Whether a string contains an ASCII upper-case letter.
 *
 * `toLowerCase()` allocates even when it changes nothing, and identifiers in
 * running prose are overwhelmingly already lower case, so this scan pays for
 * itself by skipping the allocation in the common case.
 */
export function hasUpper(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		// A-Z, or anything outside ASCII: `Ü` lowers to `ü`, and the keys this
		// guards were built with a full toLowerCase(), so a non-ASCII word takes
		// the slow path and meets its key in the case the key was built in.
		if ((c >= 65 && c <= 90) || c >= 128) return true;
	}
	return false;
}

/** `value` in the case the index and the phrase trie key on: lowered only when it has to be. */
export function lowerCased(value: string): string {
	return hasUpper(value) ? value.toLowerCase() : value;
}

//#endregion
