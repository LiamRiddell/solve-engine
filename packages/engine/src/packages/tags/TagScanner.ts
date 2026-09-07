/**
 * Pure `#tag` detection on a raw line, kept engine-free so it is unit-testable
 * in isolation, the same design {@link TableReader} draws.
 */

/** Escapes any regex-special character a tag name could carry. */
export function escapeTag(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The aggregate openers, immediately before the tag they read.
 *
 * `total of #food` names the group; it does not join it. Anchored at the end,
 * so it is asking what sits directly in front of this particular `#`.
 */
const AGGREGATE_OPENER = /(?:total|sum|average|count)\s+of\s+$/i;

/**
 * How much text before a `#` is examined for an opener.
 *
 * The pattern is anchored at its end, so only the characters immediately in
 * front of the `#` can match it, and testing a fixed window is the same answer
 * as testing the whole line up to the point where the whitespace runs long.
 * The longest opener is `average of `, eleven characters, which leaves
 * fifty-three here for whitespace between the words.
 *
 * Testing the whole prefix instead is what made this quadratic: the pattern is
 * anchored at the end but not the start, so the engine scans from every
 * position, and a line whose every occurrence is a query pays that once per
 * occurrence. A 192 KB line of repeated `total of #a` took 2.1 seconds.
 *
 * Past the window an opener is not recognised, so its line is read as a member
 * rather than as a query, which is what it was before any of this existed.
 */
const OPENER_WINDOW = 64;

/**
 * Whether `rawText` carries `#tag` as a mid-line annotation, case-insensitively.
 *
 * The tag must not be part of a longer word before (`a#tag`) or after
 * (`#housingcost` is not `#housing`), and must not be the line's first
 * non-whitespace token, since a line starting with `#` is a heading, not a
 * tagged data line.
 *
 * Nor may it be the object of an aggregate. A `#tag` after `total of` names the
 * group rather than joining it, and reading it as membership is what made two
 * aggregates over one tag unreadable: each walked the other, found a line still
 * being evaluated, and reported it. The querying line's own text was already
 * skipped by line number, so this only extends that to the other queries, and
 * says the same thing about all of them.
 *
 * Every occurrence is examined rather than only the first, since one line can
 * hold both: `total of #food #reviewed` asks about one group and joins another.
 */
export function lineCarriesTag(rawText: string, tag: string): boolean {
  if (tag === "") return false;
  const re = new RegExp(`(?:^|[^0-9A-Za-z_])#${escapeTag(tag)}(?![0-9A-Za-z_-])`, "gi");
  // Whether anything precedes a `#` is one property of the line, so it is found
  // once here rather than by copying the prefix at every occurrence.
  const firstContent = rawText.search(/\S/);
  for (let m = re.exec(rawText); m !== null; m = re.exec(rawText)) {
    // The `#` sits inside the match.
    const hashIndex = m.index + m[0].indexOf("#");
    // The line's first non-whitespace token: a heading, not a tagged data line.
    if (firstContent === hashIndex) continue;
    if (AGGREGATE_OPENER.test(rawText.slice(Math.max(0, hashIndex - OPENER_WINDOW), hashIndex))) continue;
    return true;
  }
  return false;
}
