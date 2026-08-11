import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { timecodeUnit } from "@solve-js/vm/Value";

/**
 * `HH:MM:SS:FF at <N> fps` / `HH:MM:SS:FF @ <N> fps`, a video-timecode
 * literal carrying its own fps context, constructed as
 * `Uom(totalFrames, "timecode@<fps>")` (see `vm/Value.ts`'s timecode
 * section for the representation, and why storing the TOTAL frame count
 * rather than four separate fields makes carry/borrow arithmetic free).
 *
 * Handles the fused `VIDEO_TIMECODE` token produced by
 * {@link videoTimecodeNormalizerRule} (the raw `HH:MM:SS:FF` shape) and
 * then looks ahead, the same pattern `ClockTimeParselet.ts` uses for its
 * optional trailing timezone suffix, for the REQUIRED frame-rate
 * specifier and an OPTIONAL trailing `in frames` query:
 *
 * - `at`/`@` (lexes as `RATE_AT`/`AT` respectively) followed by an `N fps`
 *   literal (already fused to `FPS_RATE` by `fpsRateNormalizerRule` before
 *   this parselet ever runs) is REQUIRED, a video timecode has no
 *   meaning without a frame rate. Both separators are accepted uniformly;
 *   "@" activates a previously-dormant lexer token (see
 *   `ExpressionLexer.ts`'s `OP_MAP` doc comment) specifically for this
 *   feature.
 * - An optional trailing `in frames` re-tags the value as a plain
 *   `Uom(totalFrames, "frames")` instead of `"timecode@<fps>"`, cheap
 *   since the NUMERIC value is identical either way; only the unit string
 *   differs (no runtime conversion opcode needed for this. See the
 *   `UOM_CONVERT` emission below, which just tags a number with a unit,
 *   the same "PUSH_NUMBER; PUSH_STRING; UOM_CONVERT" pattern
 *   `FpsRateParselet.ts`/`LaptimeParselet.ts` already use for their own
 *   literal construction).
 *
 * Once "at"/"@" is consumed, there's no backtracking (this parser doesn't
 * support it. See `ClockTimeParselet.ts`'s own doc comment for the same
 * accepted constraint), a malformed suffix throws rather than silently
 * reinterpreting the tokens some other way.
 */
export class VideoTimecodeParselet implements PrefixParselet {
  readonly category = "Time";

  parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    const [hours, minutes, seconds, frames] = token.value.split(",").map(Number);

    const separator = parser.peek();
    if (!separator || (separator.type !== "RATE_AT" && separator.type !== "AT")) {
      throw ErrorFactory.parsing(
        "TIMECODE_EXPECTED_FPS",
        `A video timecode must specify a frame rate, e.g. "${token.value.split(",").join(":")} at 30 fps" or "... @ 30 fps"`
      );
    }
    parser.consume();

    const fpsToken = parser.peek();
    if (!fpsToken || fpsToken.type !== "FPS_RATE") {
      throw ErrorFactory.parsing(
        "TIMECODE_EXPECTED_FPS",
        `Expected "<number> fps" after "${separator.value}" (e.g. "at 30 fps")`
      );
    }
    parser.consume();
    const fps = parseFloat(fpsToken.value);

    // Frames per timecode SECOND, which is the rounded frame rate rather
    // than the exact one: non-drop-frame timecode at 29.97 fps still
    // labels thirty frames per second (that mismatch with wall-clock time
    // is the whole reason drop-frame notation exists). This is the same
    // bucketing `framesToTimecodeString()` uses to go the other way, and
    // the two directions have to agree or a timecode does not survive a
    // round trip.
    //
    // Flooring instead, which is what this did, was wrong twice over at a
    // fractional rate: it rejected frame 29 at 29.97 fps as out of range
    // when 0-29 is exactly the valid set, and multiplying the elapsed
    // seconds by the raw 29.97 made "01:00:00:00 at 29.97 fps" come back
    // out as "00:59:56:12".
    const fpsWhole = Math.round(fps);
    if (frames >= fpsWhole) {
      throw ErrorFactory.parsing(
        "TIMECODE_FRAME_OUT_OF_RANGE",
        `Frame number ${frames} is out of range for ${fps} fps (must be 0-${fpsWhole - 1})`
      );
    }

    const totalFrames = (hours * 3600 + minutes * 60 + seconds) * fpsWhole + frames;

    // Optional trailing "in frames", query the total frame count directly
    // rather than tagging the result with its fps context.
    let unit = timecodeUnit(fps);
    if (parser.peek()?.type === "IN") {
      parser.consume();
      const framesWord = parser.peek();
      if (!framesWord || framesWord.type !== "IDENT" || framesWord.value.toLowerCase() !== "frames") {
        throw ErrorFactory.parsing(
          "TIMECODE_EXPECTED_FRAMES",
          `Expected "frames" after "in" (e.g. "... in frames") but got ${framesWord ? `"${framesWord.value}"` : "end of input"}`
        );
      }
      parser.consume();
      unit = "frames";
    }

    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(totalFrames);
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(unit);
    builder.emitOpcode(OpCode.UOM_CONVERT);
  }
}
