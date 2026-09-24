import { Parser } from "@solve-js/parser/Parser";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { Token } from "@solve-js/lexer/Token";
import { ZONE_LOOKUP } from "../../timezones/CityZones";
import { encodeFixedOffset, zoneLabel } from "../../timezones/ZoneMath";

/** A resolved zone reference plus the display text the user actually typed. */
export interface ZoneReference {
  /** IANA zone identifier, or a fixed-offset encoding. See `ZoneMath.ts`. */
  zoneRef: string;
  /**
   * What to show the user for this zone, e.g. in "time difference"
   * output. The user's OWN raw text, title-cased, when they named a
   * city/abbreviation/country (so "Seattle" and "Los Angeles", both
   * `America/Los_Angeles`, each keep their own label instead of
   * collapsing to whichever one the IANA identifier happens to be named
   * after). Falls back to `zoneLabel(zoneRef)`'s derived label
   * (e.g. "UTC+8") for the numeric GMT/UTC-offset form, where there's no
   * more specific name to prefer.
   */
  displayName: string;
}

/**
 * Consume a "zone reference" from the parser if one is present, a city
 * country, or standard-abbreviation name (`ZONE_LOOKUP`, matched by raw
 * token text regardless of whether it's a bare `IDENT` or a phrase-fused
 * `CITY_NAME` token. See `TimePackage.ts`'s `phrases` field for the
 * multi-word cities), or a numeric `GMT+N`/`UTC-N[:MM]` offset (a
 * multi-token form: an IDENT "gmt"/"utc", then an optional sign +
 * number + optional `:MM`).
 *
 * Returns `null` and consumes NOTHING if the next token doesn't match
 * either shape, callers must check for `null` before assuming a zone
 * reference was found, since (unlike most of this codebase's phrase
 * parsing) this helper is deliberately speculative: it only commits
 * (consumes tokens) once it's confident, so a caller can safely use it to
 * decide "is a zone-conversion suffix present at all" without needing
 * backtracking (this parser has none, `BytecodeBuilder` is append-only).
 */
export function tryConsumeZoneReference(parser: Parser): ZoneReference | null {
  const token = parser.peek();
  if (!token) return null;

  const rawText = token.value;
  const lowerText = rawText.toLowerCase();

  if (lowerText === "gmt" || lowerText === "utc") {
    parser.consume();
    const signToken = parser.peek();
    if (signToken?.type === "PLUS" || signToken?.type === "MINUS") {
      const isNegative = signToken.type === "MINUS";
      parser.consume();

      // "8:30" between the sign and a following word (e.g. "in Paris") has
      // already been fused into a single CLOCK_TIME token by the lexer's
      // clock-time normalizer (see ClockTimeNormalizerRule.ts) before this
      // parselet ever runs, so a bare NUMBER never appears in that case
      // the fused token's value IS already hour*60+minute, matching
      // `totalMinutes` below exactly, so it can be used as-is.
      const offsetToken = parser.peek();
      let totalMinutes: number;
      if (offsetToken?.type === "CLOCK_TIME") {
        parser.consume();
        totalMinutes = parseInt(offsetToken.value, 10);
      } else {
        const hourToken = parser.consume("NUMBER");
        totalMinutes = parseInt(hourToken.value, 10) * 60;
        if (parser.peek()?.type === "COLON") {
          parser.consume();
          const minuteToken = parser.consume("NUMBER");
          totalMinutes += parseInt(minuteToken.value, 10);
        }
      }
      const zoneRef = encodeFixedOffset(isNegative ? -totalMinutes : totalMinutes);
      return { zoneRef, displayName: zoneLabel(zoneRef) };
    }
    const zoneRef = encodeFixedOffset(0); // bare "GMT"/"UTC" = zero offset
    return { zoneRef, displayName: zoneLabel(zoneRef) };
  }

  const zoneRef = Object.prototype.hasOwnProperty.call(ZONE_LOOKUP, lowerText) ? ZONE_LOOKUP[lowerText] : undefined;
  if (zoneRef) {
    parser.consume();
    const displayName = rawText.replace(/\b\w/g, (c) => c.toUpperCase());
    return { zoneRef, displayName };
  }

  return null;
}

/**
 * Whether a token begins a zone reference {@link tryConsumeZoneReference}
 * would accept: a zone name from the table, or the `GMT`/`UTC` that starts the
 * offset form. A pure look, for deciding whether a separator is followed by
 * another zone before consuming the separator.
 */
export function startsZoneReference(token: Token | undefined): boolean {
  if (!token) return false;
  const lowerText = token.value.toLowerCase();
  return lowerText === "gmt" || lowerText === "utc" || Object.prototype.hasOwnProperty.call(ZONE_LOOKUP, lowerText);
}

/**
 * How many separator tokens stand between here and a following zone: 1 for a
 * comma or an `and`, 2 for the `, and` of a list written with a serial comma,
 * and 0 when what follows is not a separator and a zone.
 */
function separatorBeforeZone(parser: Parser): number {
  const first = parser.peek();
  if (first?.type !== "COMMA" && first?.type !== "AND_CONJ") return 0;
  if (first.type === "COMMA" && parser.peekAt(1)?.type === "AND_CONJ") {
    return startsZoneReference(parser.peekAt(2)) ? 2 : 0;
  }
  return startsZoneReference(parser.peekAt(1)) ? 1 : 0;
}

/**
 * Consume a list of zone references, `Tokyo, New York and Sydney`: one zone,
 * then any number more, each after a comma, an `and`, or both.
 *
 * A separator is consumed only when a zone follows it, so a list ends cleanly
 * where the line goes on to something else: `3pm London in Tokyo and 2` leaves
 * the `and 2` for the parser, as it always did. Returns an empty list, having
 * consumed nothing, when no zone starts here at all.
 *
 * The one thing refused is an `and` followed by a word that is not a zone,
 * `in London and Atlantis`: that is a misspelt or unlisted place, and left to
 * the parser it would surface as an undefined variable named after it, which
 * says nothing about zones. A comma followed by a word is left alone, because
 * inside a function call's arguments that is the next argument.
 */
export function consumeZoneList(parser: Parser): ZoneReference[] {
  const first = tryConsumeZoneReference(parser);
  if (first === null) return [];
  const zones = [first];
  for (let separators = separatorBeforeZone(parser); separators > 0; separators = separatorBeforeZone(parser)) {
    for (let i = 0; i < separators; i++) parser.consume();
    const next = tryConsumeZoneReference(parser);
    // `startsZoneReference` said a zone begins here, and it recognises exactly
    // what `tryConsumeZoneReference` consumes, so this is always found.
    if (next !== null) zones.push(next);
  }

  const afterAnd = parser.peek()?.type === "AND_CONJ" ? parser.peekAt(1) : undefined;
  if (afterAnd?.type === "IDENT") {
    throw ErrorFactory.parsing(
      "TIME_ZONE_UNKNOWN",
      `"${afterAnd.value}" is not a time zone this engine knows. Name a city ("Tokyo"), a standard abbreviation ("JST") or an offset ("UTC+9")`,
    );
  }
  return zones;
}

/**
 * The most zones one line takes. A plugin call's argument count is a single
 * bytecode byte and each zone takes two, so without a cap a long enough list
 * would fail as a bytecode fault that reads like the package's mistake rather
 * than the line's. Far past any list a person writes.
 */
export const MAX_ZONES_PER_LINE = 50;

/** Refuse a zone list too long for one line. See {@link MAX_ZONES_PER_LINE}. */
export function checkZoneCount(zones: ZoneReference[]): void {
  if (zones.length > MAX_ZONES_PER_LINE) {
    throw ErrorFactory.parsing(
      "TIME_ZONE_TOO_MANY",
      `One line takes at most ${MAX_ZONES_PER_LINE} time zones; this one names ${zones.length}`,
    );
  }
}

/**
 * Push each zone as the `(zoneRef, label)` string pair the timezone plugin
 * functions read back with `namedZonesFrom`, in the order the reader wrote
 * them.
 */
export function emitNamedZones(builder: BytecodeBuilder, zones: ZoneReference[]): void {
  for (const zone of zones) {
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(zone.zoneRef);
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(zone.displayName);
  }
}
