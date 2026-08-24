/**
 * Pure `#tag` detection on a raw line, kept engine-free so it is unit-testable
 * in isolation, the same design {@link TableReader} draws.
 */

/** Escapes any regex-special character a tag name could carry. */
export function escapeTag(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `rawText` carries `#tag` as a mid-line annotation, case-insensitively.
 *
 * The tag must not be part of a longer word before (`a#tag`) or after
 * (`#housingcost` is not `#housing`), and must not be the line's first
 * non-whitespace token, since a line starting with `#` is a heading, not a
 * tagged data line.
 */
export function lineCarriesTag(rawText: string, tag: string): boolean {
  if (tag === "") return false;
  const re = new RegExp(`(?:^|[^0-9A-Za-z_])#${escapeTag(tag)}(?![0-9A-Za-z_-])`, "i");
  const m = re.exec(rawText);
  if (m === null) return false;
  // The `#` sits inside the match; reject one that is the line's first
  // non-whitespace token (a heading).
  const hashIndex = m.index + m[0].indexOf("#");
  return rawText.slice(0, hashIndex).trim().length > 0;
}
