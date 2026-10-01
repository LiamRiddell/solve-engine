/**
 * The codes the time forms answer with at parse time: times in zones, time differences, working-hours overlaps and video timecodes. What they refuse while running is in `TimezoneErrorCodes`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const TimeFormErrorCodes = {
	/** `time in` not followed by a city or a zone. */
	TIME_ZONE_EXPECTED_CITY: "TIME_ZONE_EXPECTED_CITY",
	/** A time in one zone not followed by `in <city>` for the zone to convert to. */
	TIME_ZONE_EXPECTED_IN: "TIME_ZONE_EXPECTED_IN",
	/** `in` not followed by a city or a zone to convert to. */
	TIME_ZONE_EXPECTED_TARGET: "TIME_ZONE_EXPECTED_TARGET",
	/** A place named as a time zone that the engine does not know. The message says what it reads: a city, an abbreviation or an offset. */
	TIME_ZONE_UNKNOWN: "TIME_ZONE_UNKNOWN",
	/** One line naming more time zones than a line takes. */
	TIME_ZONE_TOO_MANY: "TIME_ZONE_TOO_MANY",
	/** `on` not followed by a date, in a time converted on a given day. */
	TIME_ZONE_MISSING_DATE: "TIME_ZONE_MISSING_DATE",
	/** `time difference between` not followed by a city or a zone. */
	TIME_DIFFERENCE_EXPECTED_CITY: "TIME_DIFFERENCE_EXPECTED_CITY",
	/** `time difference between <a> and` not followed by a second city or zone. */
	TIME_DIFFERENCE_EXPECTED_SECOND_CITY: "TIME_DIFFERENCE_EXPECTED_SECOND_CITY",
	/** `overlap of` not followed by hours, as in `9am to 5pm`. */
	OVERLAP_EXPECTED_HOURS: "OVERLAP_EXPECTED_HOURS",
	/** The hours of an overlap not followed by `in` and the places. */
	OVERLAP_EXPECTED_IN: "OVERLAP_EXPECTED_IN",
	/** `in` not followed by a city or a zone, in an overlap. */
	OVERLAP_EXPECTED_CITY: "OVERLAP_EXPECTED_CITY",
	/** A video timecode or frame count without its frame rate, as in `at 30 fps`. */
	TIMECODE_EXPECTED_FPS: "TIMECODE_EXPECTED_FPS",
	/** A timecode followed by `in` and something other than `frames`. */
	TIMECODE_EXPECTED_FRAMES: "TIMECODE_EXPECTED_FRAMES",
	/** A timecode whose frame number is not below the frame rate. */
	TIMECODE_FRAME_OUT_OF_RANGE: "TIMECODE_FRAME_OUT_OF_RANGE",
	/** `time in Tokyo on 1 March 2027`: the time in a place is the time there now, not on another day. The message points at converting a time on that day instead. */
	TIME_IN_ZONE_UNDATED: "TIME_IN_ZONE_UNDATED",
	/** An identifier shaped like an ISO 8601 duration that breaks its grammar, as `P1H` (a time part before the `T`) or `P1D1D`. The message says which rule it breaks. */
	ISO_DURATION_MALFORMED: "ISO_DURATION_MALFORMED",
} as const;
