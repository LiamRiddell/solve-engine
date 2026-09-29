/**
 * The codes the date forms answer with: timestamps, weekdays, `workdays in` and the other questions asked of a date. A date literal that names no real day has its own codes, in `DatetimeErrorCodes`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const DateFormErrorCodes = {
	/** A date form (`2nd Tuesday of`, `age of`) given something that is not a date, as in `age of 5`. */
	DATE_EXPECTED: "DATE_EXPECTED",
	/** A question asked of a date (`day of the week on`, `week number of`) given something that is not a date. */
	DATE_FIELD_EXPECTED_DATE: "DATE_FIELD_EXPECTED_DATE",
	/** A timestamp outside the dates the engine can hold, about 273,000 years either side of 1970. */
	DATE_OUT_OF_RANGE: "DATE_OUT_OF_RANGE",
	/** `as iso8601` given something that is not a date, a Unix timestamp or ISO 8601 text. */
	AS_ISO8601_NEEDS_DATE: "AS_ISO8601_NEEDS_DATE",
	/** Text given as an ISO 8601 date or time that does not read as one. */
	INVALID_ISO8601_STRING: "INVALID_ISO8601_STRING",
	/** A weekday given as a number that is not a day of the week. */
	INVALID_WEEKDAY: "INVALID_WEEKDAY",
	/** `next` or `last` with no day of the week after it. */
	MISSING_WEEKDAY: "MISSING_WEEKDAY",
	/** An ordinal weekday the month does not have, such as the fifth Monday of a month with four. */
	NTH_WEEKDAY_OUT_OF_RANGE: "NTH_WEEKDAY_OUT_OF_RANGE",
	/** `days in` followed by something that is not a month, a quarter or a year. */
	DAYS_IN_EXPECTED_PERIOD: "DAYS_IN_EXPECTED_PERIOD",
	/** `workdays in` given a quantity that is not a length of time. */
	WORKDAYS_IN_EXPECTED_DURATION: "WORKDAYS_IN_EXPECTED_DURATION",
	/** `workdays until` or `workdays since`, which are not counted on the calendar. The message points at `workdays between`. */
	WORKDAYS_UNTIL_UNSUPPORTED: "WORKDAYS_UNTIL_UNSUPPORTED",
} as const;
