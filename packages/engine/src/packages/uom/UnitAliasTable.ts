/**
 * The words packages declare for units the engine already has, through
 * `IEnginePackage.unitAliases` (#762): `Meile` for the mile, `Tage` for days.
 *
 * Per engine, like {@link UserUnitTable}, so one engine's language package is
 * invisible to another in the same process. Unlike a document's definition, an
 * alias lives as long as its package is registered, and is matched exactly as
 * written: no trailing-`s` plural is guessed, since a plural in another
 * language is rarely an `s` (`Meile`, `Meilen`), and a package lists each form
 * it reads.
 *
 * Keyed by a `Map`, so a word that names an `Object.prototype` property
 * (`constructor`, `__proto__`) is a word like any other and reaches nothing it
 * was not given.
 */

/** A package's claim on one word. */
interface AliasClaim {
	/** The package that declared it. */
	readonly owner: string;
	/** The built-in unit the word stands for, as the lexer spells it. */
	readonly unit: string;
}

/** Per-engine store of package unit aliases. */
export class UnitAliasTable {
	/** Every claim on each word, in registration order; the last one is in force. */
	private readonly claims = new Map<string, AliasClaim[]>();

	/** Whether no alias is registered, a cheap guard for the hot path. */
	get isEmpty(): boolean {
		return this.claims.size === 0;
	}

	/**
	 * Claim `word` for `unit` on behalf of `owner`. A second package claiming
	 * the same word takes it over; removing that package hands it back.
	 *
	 * @param owner - The declaring package's name.
	 * @param word - The alias, exactly as a reader writes it.
	 * @param unit - The built-in unit it stands for.
	 */
	add(owner: string, word: string, unit: string): void {
		const existing = this.claims.get(word);
		const claim: AliasClaim = { owner, unit };
		if (existing === undefined) this.claims.set(word, [claim]);
		else existing.push(claim);
	}

	/**
	 * Remove every claim `owner` made, handing each word back to the package
	 * that claimed it before, if any.
	 *
	 * @param owner - The package being unregistered.
	 * @returns How many words lost a claim.
	 */
	removeOwner(owner: string): number {
		let removed = 0;
		for (const [word, list] of this.claims) {
			const remaining = list.filter((claim) => claim.owner !== owner);
			if (remaining.length === list.length) continue;
			removed++;
			if (remaining.length === 0) this.claims.delete(word);
			else this.claims.set(word, remaining);
		}
		return removed;
	}

	/**
	 * The unit `word` stands for, or `undefined` when no package aliases it.
	 *
	 * @param word - A word as the reader wrote it; matched exactly.
	 */
	unitFor(word: string): string | undefined {
		const list = this.claims.get(word);
		return list === undefined ? undefined : list[list.length - 1].unit;
	}

	/** Every aliased word, for tests and diagnostics. */
	get words(): string[] {
		return [...this.claims.keys()];
	}
}
