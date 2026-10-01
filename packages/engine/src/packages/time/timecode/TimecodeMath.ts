/**
 * Video-timecode display formatting, converting a total frame count back
 * into `HH:MM:SS:FF` notation. The reverse direction (`HH:MM:SS:FF` ->
 * total frames) is simple arithmetic done inline in
 * `parselets/VideoTimecodeParselet.ts` (`((h*3600 + m*60 + s) * fps) + f`);
 * this file only has the "put the carry back" direction, matching
 * `timezones/ZoneMath.ts`'s "compute then return a formatted String Value"
 * pattern for the same kind of display-only conversion.
 */

/**
 * Convert a total frame count (at a given fps) into `HH:MM:SS:FF` display
 * notation.
 *
 * SCOPE DECISION: buckets frames-per-second by `Math.round(fps)`
 * regardless of whether fps is a whole number (e.g. NTSC's 29.97fps).
 * This is plain non-drop-frame timecode math, exact for integer fps
 * (24/25/30/60/...) and a reasonable, clearly-scoped-down approximation
 * for fractional fps. It does NOT implement SMPTE drop-frame timecode
 * notation, which periodically skips frame NUMBERS (not actual frames) to
 * keep 29.97fps timecode approximately in sync with wall-clock time
 * that's a real, separate piece of the SMPTE spec this pass doesn't take
 * on, matching this session's established pattern of documenting a
 * deliberate simplification rather than silently guessing.
 */
export function framesToTimecodeString(totalFrames: number, fps: number): string {
  const fpsWhole = Math.max(1, Math.round(fps));
  const pad = (n: number) => String(n).padStart(2, "0");

  const frameCount = Math.trunc(totalFrames);
  // Modulo can return a negative result in JS for a negative dividend
  // the double-modulo pattern keeps the frame field in [0, fpsWhole).
  const frames = ((frameCount % fpsWhole) + fpsWhole) % fpsWhole;
  const totalSeconds = Math.floor(frameCount / fpsWhole);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/**
 * A timecode as the reader writes one, with its frame rate: `01:02:03:14 at
 * 30 fps`. This is how a timecode answers, and the text reads back in as the
 * same value, which is why the rate is part of it (#759).
 *
 * Before this, a timecode had no display of its own and fell to the generic
 * amount-and-unit rendering, so `01:02:03:04 at 30 fps` answered `111,694.00
 * timecode@30`: the frame count under the engine's internal unit name.
 *
 * Three cases keep the text honest rather than tidy:
 * - A negative count (a timecode moved back past zero) is the timecode of its
 *   size with a minus sign, `-00:00:00:10 at 30 fps`, which reads back too.
 * - A count that is not a whole number of frames (half a second added at
 *   25 fps is 12.5 frames) has no `HH:MM:SS:FF` spelling, and rounding it
 *   would show a timecode the value is not. It is written as the count,
 *   `90012.5 frames at 25 fps`, which reads back as the same timecode.
 * - A count past 2^53, or one with no finite value, is written as the count
 *   for the same reason: its frame field could not be exact.
 *
 * @param totalFrames - The frame count since 00:00:00:00.
 * @param fps - The frame rate the timecode is read at.
 * @returns The display text, without the leading `= `.
 */
export function timecodeText(totalFrames: number, fps: number): string {
  const rate = `${String(fps)} fps`;
  const whole = Number.isInteger(totalFrames) && Math.abs(totalFrames) <= Number.MAX_SAFE_INTEGER;
  if (!whole) return `${String(totalFrames)} frames at ${rate}`;
  // Negative zero is zero frames: `-0` has no minus sign to show.
  if (totalFrames < 0) return `-${framesToTimecodeString(-totalFrames, fps)} at ${rate}`;
  return `${framesToTimecodeString(totalFrames, fps)} at ${rate}`;
}

/**
 * Whether a frame rate can carry a timecode: a finite rate that rounds to at
 * least one frame a second. `0 fps` has no frame field at all, and `0.4 fps`
 * rounds to none, so a timecode at either has no frame it could name.
 *
 * @param fps - The rate as written.
 */
export function isTimecodeRate(fps: number): boolean {
  return Number.isFinite(fps) && Math.round(fps) >= 1;
}

/**
 * A timecode's length in seconds of real time: its frame count over its frame
 * rate. At a whole rate this is the clock the fields show (`00:00:01:15 at
 * 30 fps` is 1.5 seconds); at 29.97 fps it is the elapsed time the frames
 * take, a little longer than the fields read, which is the gap drop-frame
 * notation exists to close and this engine does not implement.
 *
 * @param totalFrames - The frame count.
 * @param fps - The frame rate, already checked with {@link isTimecodeRate}.
 */
export function timecodeSeconds(totalFrames: number, fps: number): number {
  return totalFrames / fps;
}
