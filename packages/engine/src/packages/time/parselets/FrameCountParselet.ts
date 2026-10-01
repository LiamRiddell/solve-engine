import { readLocaleNumber } from "@solve-js/parser/LocaleNumberLiteral";
import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { timecodeUnit } from "@solve-js/vm/Value";
import { isTimecodeRate } from "../timecode/TimecodeMath";

/**
 * The refusal for a frame rate no timecode can be read at (`0 fps`), shared
 * with {@link VideoTimecodeParselet}.
 *
 * @param written - The rate as the line wrote it.
 */
export function noFrameRate(written: string): Error {
  return ErrorFactory.parsing(
    "TIMECODE_EXPECTED_FPS",
    `A timecode needs a frame rate of at least one frame a second, as in "at 30 fps", and ${written} fps has none.`,
  );
}

/**
 * `<N> frames`, a plain frame-count duration, `Uom(N, "frames")`. Also
 * the reverse of {@link VideoTimecodeParselet}: `<N> frames @ <fps>` (or
 * `... at <fps>`) is the timecode that many frames from zero, the same
 * value `HH:MM:SS:FF at <fps>` builds, so it answers in that notation and
 * still takes arithmetic (#759).
 *
 * Handles the fused `FRAME_COUNT` token produced by
 * {@link frameCountNormalizerRule}. Both `N` and the fps are always
 * parse-time-literal numbers by construction of that fusion rule (mirrors
 * `FpsRateParselet.ts`'s "NUMBER fps" fusion, which has the same
 * restriction), so the timecode is a literal: a number tagged with the
 * timecode unit, the same three opcodes the timecode literal emits.
 */
export class FrameCountParselet implements PrefixParselet {
  readonly category = "Time";

  parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    const frameCount = parseFloat(token.value);

    const separator = parser.peek();
    if (separator && (separator.type === "RATE_AT" || separator.type === "AT")) {
      parser.consume();
      const fpsToken = parser.peek();
      if (!fpsToken || fpsToken.type !== "FPS_RATE") {
        throw ErrorFactory.parsing(
          "TIMECODE_EXPECTED_FPS",
          `Expected "<number> fps" after "${separator.value}" (e.g. "@ 30 fps")`
        );
      }
      parser.consume();
      // Read in the engine's locale, as a bare number is (#806).
      const fps = readLocaleNumber(fpsToken.value, parser.getLocaleCode());
      if (!isTimecodeRate(fps)) throw noFrameRate(fpsToken.value);

      // The timecode itself, not its text: `(111694 frames at 30 fps) + 1`
      // was refused as text plus a number, because this used to push the
      // `HH:MM:SS:FF` string. The value now answers as that string anyway
      // (see timecodeText()) and still takes arithmetic (#759).
      builder.emitOpcode(OpCode.PUSH_NUMBER);
      builder.emitNumber(frameCount);
      builder.emitOpcode(OpCode.PUSH_STRING);
      builder.emitString(timecodeUnit(fps));
      builder.emitOpcode(OpCode.UOM_CONVERT);
      return;
    }

    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(frameCount);
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString("frames");
    builder.emitOpcode(OpCode.UOM_CONVERT);
  }
}
