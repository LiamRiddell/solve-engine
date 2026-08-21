---
"solve-engine": minor
---

Business-day arithmetic. Deadlines count working days, and now the engine can say so.

Date arithmetic counts calendar days, which is the wrong unit for an invoice term, an SLA or a notice period. `20/12/2024 + 5 workdays` already skipped weekends, but the deadline phrasing a person actually writes was not recognised, and there was no way to count the working days in a window:

```
5 working days after 20/12/2024              was not recognised, now 27/12/2024
3 business days from today                    was not recognised, now a working day
2 working days before 25/12/2024              was not recognised, now counts back
working days between 01/01/2024 and 31/01/2024   was not recognised, now 23
```

`working` and `business` days are synonyms, and either reads in the singular for a count of one. The offset walks to a working day the same way `<date> + N workdays` always has, so the two spellings can never disagree; the count is inclusive of both endpoints and independent of the order the dates are written.

Weekends are decidable from a date, but public holidays are not: they depend on the region and change year to year. So holidays are excluded only when the host supplies a calendar, the same "bring your own data source" shape stocks and weather already use, and left unconfigured the arithmetic skips weekends only rather than guessing a holiday it was never told about:

```ts
new ExpressionEngine("en", false, {
  date: { holidays: ["2024-12-25", "2024-12-26"] },
  // or holidays: (date) => isPublicHoliday(date)
});
```

With that calendar, `1 working day after 24/12/2024` steps over Christmas and Boxing Day to the 27th, and `working days between ...` leaves them out of the count. The offset forms, `between`, and `<date> + N workdays` all consult it. `workdays in <span>` and the `is a workday` / `is a weekend` questions stay weekends-only by design: the first has no date to look a holiday up on, and the second reports the shape of the week, not whether a particular office is open.
