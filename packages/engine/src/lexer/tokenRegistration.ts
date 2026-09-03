/**
 * tokenRegistration.ts, Bootstrap for building TokenLookup from locale, units, and phrases.
 *
 * This module centralizes the assembly of the TokenLookup consumed by ExpressionLexer.
 * It merges:
 *   1. Locale keywords (from ILocale.keywordMap)
 *   2. Built-in phrase patterns (to the power of, increase by, etc.)
 *   3. Known unit names (from units.ts)
 *
 * The resulting TokenLookup is frozen. Nothing in the engine consumes it any
 * more (see the deprecation on {@link buildTokenLookup}).
 */
import { TokenClassRegistry } from '@solve-js/lexer/TokenClassRegistry';
import type { TokenLookup } from '@solve-js/lexer/TokenClassRegistry';
import { getLocale, type ILocale } from '@solve-js/constants/locales';
import { knownUnits } from '@solve-js/lexer/units';
// The multi-word expressions handled as compound tokens, matched by the
// PhraseMatcher (trie-based) in ExpressionLexer.tryMatchPhrase(). The same
// table the normalizer's phrase trie reads, so the two cannot drift.
import { BUILTIN_PHRASES } from '@solve-js/lexer/BuiltinPhrases';

/**
 * Build a TokenLookup from locale keywords, known units, and built-in phrases.
 *
 * Merge order (later overrides earlier):
 *   1. Locale keywords (priority 0, lowest, can be overridden by providers)
 *   2. Built-in phrases (via locale phraseMap)
 *   3. Known units (checked AFTER keyword lookup fails, via unitNames set)
 *
 * @param localeCode - The locale code (e.g., "en", "de"). Defaults to "en".
 * @returns A frozen TokenLookup.
 * @deprecated The lexer never read the lookup it was handed: its keyword, unit
 *   and phrase tables are built from the locale and the packages registered
 *   with it, and the engine no longer builds one at construction. Kept for
 *   callers that build their own; removed in 3.0.
 */
export function buildTokenLookup(localeCode = 'en'): TokenLookup {
  const locale: ILocale = getLocale(localeCode);
  const registry = new TokenClassRegistry();

  // Layer 1: Locale keywords (priority 0, lowest)
  registry.setLocale(locale.keywordMap, BUILTIN_PHRASES);

  // Layer 2: Known units (checked after keyword lookup)
  registry.setUnits(knownUnits);

  // Build and return the lookup
  return registry.build();
}
