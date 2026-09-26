/**
 * Extended unit categories not supported by the `convert` npm package (v7.0.0).
 *
 * `convert` only ships 16 measure kinds (Angle, Area, Data, Energy, Force,
 * Frequency, Illuminance, Length, Luminance, LuminousIntensity, Mass, Power,
 * Pressure, Temperature, Time, Volume. See MEASURE_KIND_NAMES in
 * UomConverter.ts). The project's own wiki documents several more
 * (Volume Flow Rate, Speed, Pace, Voltage, Current, Apparent Power,
 * Reactive Power, Reactive Energy, Parts-Per) that the library has no
 * concept of at all.
 *
 * A hand-rolled table is deliberately used instead of pulling in a bigger
 * unit-conversion library (e.g. js-quantities, convert-units, mathjs's unit
 * system): every category here is a pure linear ratio scale (no
 * Temperature-style offset formula needed), so the whole extension is a
 * `{ measure, toBase }` lookup plus a couple of arithmetic call sites in
 * UomConverter.ts. Pulling in a heavier dependency for ~30 extra unit
 * symbols would undo the earlier deliberate migration to `convert` for its
 * small size, and would reintroduce the aliasing/normalization behavior
 * this project explicitly moved away from (units here are case-sensitive,
 * no aliasing, matching UomConverter.ts's existing design).
 *
 * Unit symbols are restricted to what the lexer can tokenize as a single
 * UNIT token: `tokenizeIdentifier()` (ExpressionLexer.ts) only reads
 * `[a-zA-Z0-9_]` (plus Unicode), no `/`, no `-`. That rules out
 * slash-notation like "km/h" or "min/km" as literal unit text. Every
 * category below uses a plain-letters abbreviation where a standard one
 * exists (mph, kn, gpm, cfs, ...); Pace has no standard non-slash
 * abbreviation, so it uses an underscore instead ("min_km", "min_mi")
 * the one place in this table where that's necessary.
 */

export interface ExtendedUnitDef {
  /** Category name, matching the style of UomConverter.ts's MEASURE_KIND_NAMES (lowerCamelCase). */
  measure: string;
  /** Multiply a value in this unit by this factor to get the value in the category's base unit. */
  toBase: number;
}

/** Units beyond the base set, added to whatever the locale already recognises. */
export const EXTENDED_UNITS: Record<string, ExtendedUnitDef> = {
  // ── Speed (base: mps, meters per second) ──────────────────────────────
  mps: { measure: "speed", toBase: 1 },
  kph: { measure: "speed", toBase: 1000 / 3600 },
  mph: { measure: "speed", toBase: 0.44704 }, // 1 mile (1609.344m) / 3600s
  kn: { measure: "speed", toBase: 1852 / 3600 }, // 1 nautical mile = 1852m exactly
  // The knot in words, beside its symbol (#706). `kt` is not a spelling of it:
  // the generated table holds `kt` as the kilotonne.
  knot: { measure: "speed", toBase: 1852 / 3600 },
  knots: { measure: "speed", toBase: 1852 / 3600 },
  // "fps" (feet per second) deliberately NOT used, confirmed via a real
  // regression (20 failures in VideoTimecode.spec.ts) that it collides with
  // the Time package's "fps" (frames per second), which FpsRateNormalizerRule
  // requires to lex as a plain IDENT token. "ft_s" avoids the collision,
  // following the same underscore convention as Pace below.
  ft_s: { measure: "speed", toBase: 0.3048 }, // 1 ft = 0.3048m exactly

  // ── Pace (base: seconds per meter, time/distance, the reciprocal of speed) ──
  // Pace and Speed are deliberately separate measures: converting between them
  // is a reciprocal (1/x) relationship, not a linear scale, so they can't share
  // this table's plain factor-ratio conversion.
  min_km: { measure: "pace", toBase: 60 / 1000 },
  min_mi: { measure: "pace", toBase: 60 / 1609.344 },

  // ── Data rate (base: bps, bits per second) ─────────────────────────────
  // Network bandwidth, the denominator being a second. Decimal (SI) prefixes,
  // matching how a connection is advertised: 50 Mbps is 50 million bits per
  // second, not 2^20. The bit/byte distinction rides the case of the unit,
  // exactly as it does for the data sizes: `Mbps` is megabits, `MBps` megabytes
  // (eight times as many bits). These are what make `4 GB at 50 Mbps` a time.
  bps: { measure: "dataRate", toBase: 1 },
  kbps: { measure: "dataRate", toBase: 1_000 },
  Mbps: { measure: "dataRate", toBase: 1_000_000 },
  Gbps: { measure: "dataRate", toBase: 1_000_000_000 },
  Tbps: { measure: "dataRate", toBase: 1_000_000_000_000 },
  kBps: { measure: "dataRate", toBase: 8_000 },
  MBps: { measure: "dataRate", toBase: 8_000_000 },
  GBps: { measure: "dataRate", toBase: 8_000_000_000 },

  // ── CSS length (base: px, with rem against a 16px root) ────────────────
  // A front-end staple: `16px in rem`, `1.5rem in px`. These are kept in their
  // own measure, deliberately disjoint from physical length: a CSS pixel is a
  // reference pixel, not a fixed slice of a centimetre a reader would want to
  // convert to. `rem` is "root em", 16px by the CSS default root font size; the
  // 16 is a convention, not a measurement, and a configurable root is a possible
  // later addition. `em` is left out on purpose: it is relative to the element's
  // own font size, not the root, so a single fixed value would be a quiet lie.
  px: { measure: "cssLength", toBase: 1 },
  rem: { measure: "cssLength", toBase: 16 },

  // ── Voltage (base: V) ───────────────────────────────────────────────────
  // `V` is registered so `230 V * 13 A` reads as volts times amperes (issue
  // #191). It does collide with the Visa stock ticker, but the bare-ticker form
  // is opt-in (the stocks package is not a default), and volts is the more
  // broadly useful reading of `V` after a number.
  V: { measure: "voltage", toBase: 1 },
  mV: { measure: "voltage", toBase: 0.001 },
  kV: { measure: "voltage", toBase: 1000 },
  // The word forms, so `12 volts` is `12 V` (#706). The word is a unit only
  // straight after a number; a variable of the same name still reads as the
  // variable at the start of a line and after an operator, as `b` and `N` do.
  volt: { measure: "voltage", toBase: 1 },
  volts: { measure: "voltage", toBase: 1 },

  // ── Current (base: A) ───────────────────────────────────────────────
  mA: { measure: "current", toBase: 0.001 },
  A: { measure: "current", toBase: 1 },
  kA: { measure: "current", toBase: 1000 },
  // The word forms (#706). `amp` is also short for an amplifier, but only a
  // number in front of it makes it a unit, so `5 amps` is a current while a
  // sentence about an amp with no number before it is left alone.
  amp: { measure: "current", toBase: 1 },
  amps: { measure: "current", toBase: 1 },
  ampere: { measure: "current", toBase: 1 },
  amperes: { measure: "current", toBase: 1 },

  // ── Resistance (base: ohm), a voltage over a current (#706) ──────────
  // `12 V / 2 A` composes onto the ohm (see Dimensions.ts), and the ohm is
  // written as a word or as its symbol. The symbol arrives as one of two code
  // points: U+03A9 GREEK CAPITAL LETTER OMEGA, which keyboards and character
  // pickers give, and U+2126 OHM SIGN, the compatibility character a pasted
  // datasheet can carry. Both are admitted, as both micro signs are (#666).
  //
  // These are the only non-ASCII spellings in this table. The non-ASCII gate
  // in lexer/units.ts filters the generated table, where most such spellings
  // hold a space, a dot or a prime and cannot be one token; this table's
  // spellings join the vocabulary as written, and the lexer reads the omega as
  // part of a word, so `10 Ω`, `10Ω` and `4.7 kΩ` are each one UNIT token.
  ohm: { measure: "resistance", toBase: 1 },
  ohms: { measure: "resistance", toBase: 1 },
  Ω: { measure: "resistance", toBase: 1 },
  kΩ: { measure: "resistance", toBase: 1000 },
  MΩ: { measure: "resistance", toBase: 1_000_000 },
  "\u2126": { measure: "resistance", toBase: 1 }, // the OHM SIGN
  "k\u2126": { measure: "resistance", toBase: 1000 },
  "M\u2126": { measure: "resistance", toBase: 1_000_000 },

  // ── Charge (base: coulomb), a current times a time (#706) ────────────
  // The amp-hour is the unit a battery is rated in: `3000 mAh * 3.7 V` is the
  // battery's energy, 11.1 Wh. The coulomb (one ampere for one second) is the
  // measure's base and is spelled only as a word, since `C` is Celsius.
  coulomb: { measure: "charge", toBase: 1 },
  coulombs: { measure: "charge", toBase: 1 },
  Ah: { measure: "charge", toBase: 3600 },
  mAh: { measure: "charge", toBase: 3.6 },

  // ── Apparent Power (base: VA), S = V × I, not real power ─────────────
  VA: { measure: "apparentPower", toBase: 1 },
  kVA: { measure: "apparentPower", toBase: 1000 },
  MVA: { measure: "apparentPower", toBase: 1_000_000 },

  // ── Reactive Power (base: var, expressed in kvar/Mvar only) ────────────
  // The bare IEC symbol "var" is deliberately NOT registered as a unit
  // confirmed via a real regression (ExpressionLexer.identifiers-keywords.spec.ts's
  // "$var" test) that it collides with "var" as an extremely common variable
  // name (and former JS keyword). "kvar"/"Mvar" don't collide with anything
  // and cover the practically useful range.
  kvar: { measure: "reactivePower", toBase: 1000 },
  Mvar: { measure: "reactivePower", toBase: 1_000_000 },

  // ── Reactive Energy (base: varh), IEC standard symbol "varh" ─────────
  varh: { measure: "reactiveEnergy", toBase: 1 },
  kvarh: { measure: "reactiveEnergy", toBase: 1000 },
  Mvarh: { measure: "reactiveEnergy", toBase: 1_000_000 },

  // ── Volume Flow Rate (base: m3s, cubic meters per second) ─────────────
  m3s: { measure: "volumeFlowRate", toBase: 1 },
  m3h: { measure: "volumeFlowRate", toBase: 1 / 3600 },
  lps: { measure: "volumeFlowRate", toBase: 0.001 }, // 1 L/s = 0.001 m3/s
  lpm: { measure: "volumeFlowRate", toBase: 0.001 / 60 },
  gpm: { measure: "volumeFlowRate", toBase: 0.003785411784 / 60 }, // US gallon = 3.785411784 L exactly
  cfs: { measure: "volumeFlowRate", toBase: 0.028316846592 }, // 1 ft3 = 0.028316846592 m3 exactly

  // ── Fuel economy: distance per volume (base: km/l) ────────────────────
  // The reciprocal pairing (economy vs consumption below) is handled by the
  // converter, not this linear ratio (see UomConverter.ts's convertRate). mpg
  // is miles per US gallon (issue #190). These display as themselves and expand
  // to a km/l or l/km rate for conversion.
  mpg: { measure: "fuelEconomy", toBase: 1.609344 / 3.785411784 }, // 1 mi/US-gal in km/l
  kmpl: { measure: "fuelEconomy", toBase: 1 },

  // ── Fuel consumption: volume per distance (base: l/km) ────────────────
  l100km: { measure: "fuelConsumption", toBase: 0.01 }, // 1 l/100km = 0.01 l/km

  // ── Parts-Per (base: dimensionless fraction, 1 = whole) ───────────────
  // "%" is intentionally excluded, it's owned by the project's dedicated
  // Percentage provider, not the UoM system.
  ppm: { measure: "partsPer", toBase: 1e-6 },
  ppb: { measure: "partsPer", toBase: 1e-9 },
  ppt: { measure: "partsPer", toBase: 1e-12 }, // parts per trillion (chemistry/environmental convention)
  permille: { measure: "partsPer", toBase: 1e-3 },
  // ── Length, extending the base table rather than replacing it ─────────
  //
  // These share the `length` measure with the generated table, so they convert
  // against metres and everything derived from them. Ratios are the exact
  // international definitions, all of which are whole multiples of the inch
  // (0.0254 m exactly) except the mil, which is a thousandth of one.
  mil: { measure: "length", toBase: 0.0000254 },
  mils: { measure: "length", toBase: 0.0000254 },
  hand: { measure: "length", toBase: 0.1016 }, // 4 in
  hands: { measure: "length", toBase: 0.1016 },
  rod: { measure: "length", toBase: 5.0292 }, // 16.5 ft
  rods: { measure: "length", toBase: 5.0292 },
  chain: { measure: "length", toBase: 20.1168 }, // 66 ft, 4 rods
  chains: { measure: "length", toBase: 20.1168 },
  furlong: { measure: "length", toBase: 201.168 }, // 10 chains
  furlongs: { measure: "length", toBase: 201.168 },
  cable: { measure: "length", toBase: 185.2 }, // a tenth of a nautical mile
  cables: { measure: "length", toBase: 185.2 },
  league: { measure: "length", toBase: 4828.032 }, // 3 miles
  leagues: { measure: "length", toBase: 4828.032 },

  // ── Mass ──────────────────────────────────────────────────────────────
  // The metric carat is exactly 200 mg by definition, not the older and
  // variable gemstone carat, and not the karat that measures gold purity.
  carat: { measure: "mass", toBase: 0.2 },
  carats: { measure: "mass", toBase: 0.2 },
  // The metric centner, 100 kg, as used across continental Europe. The
  // Imperial hundredweight is a different quantity and is already `cwt`.
  centner: { measure: "mass", toBase: 100000 },
  centners: { measure: "mass", toBase: 100000 },

  // ── Length, astronomical (#706) ──────────────────────────────────────
  // The astronomical unit, fixed by the IAU in 2012 at exactly 149,597,870,700
  // metres (roughly the Earth's distance from the Sun). Only the capitals are
  // admitted: the IAU's own lower-case `au` is also the start of `au pair` and
  // `au revoir`.
  AU: { measure: "length", toBase: 149_597_870_700 },

  // ── Energy, extending the base table's joules (#706) ──────────────────
  //
  // The calorie is two units a factor of a thousand apart, and the spelling
  // decides which. The small calorie, `cal`, is roughly the energy that warms a
  // gram of water by one degree; the food Calorie on a nutrition label, `Cal`, is a
  // thousand of them, the kilocalorie. The lexer is case-sensitive, so the
  // capital is the food Calorie, as a label prints it, and every lower-case
  // spelling is the small calorie, as a physics text writes it. `kcal` is the
  // unambiguous spelling of the food figure and is the one the docs lead with.
  //
  // The calorie is the thermochemical one, exactly 4.184 J, which is the size
  // food energy is reckoned in (the FAO converts food energy at 1 kcal =
  // 4.184 kJ). The International Table calorie of steam tables, 4.1868 J, is not
  // offered: two calories a twentieth of a percent apart under one name would
  // make the answer depend on a choice nobody writing `cal` knows they made.
  cal: { measure: "energy", toBase: 4.184 },
  calorie: { measure: "energy", toBase: 4.184 },
  calories: { measure: "energy", toBase: 4.184 },
  kcal: { measure: "energy", toBase: 4184 },
  kilocalorie: { measure: "energy", toBase: 4184 },
  kilocalories: { measure: "energy", toBase: 4184 },
  Cal: { measure: "energy", toBase: 4184 },
  Calorie: { measure: "energy", toBase: 4184 },
  Calories: { measure: "energy", toBase: 4184 },
  // The British thermal unit, International Table, exactly 1055.05585262 J: a
  // boiler's or an air conditioner's rating. `Btu` is the spelling standards
  // bodies use, `BTU` the one most people type.
  BTU: { measure: "energy", toBase: 1055.05585262 },
  Btu: { measure: "energy", toBase: 1055.05585262 },
  // The therm, 100,000 BTU, the unit a gas bill is charged in. Built on the
  // International Table BTU above, as the EU and UK therm is; the US therm uses
  // an older BTU and is about 0.02% smaller (105,480,400 J).
  therm: { measure: "energy", toBase: 105_505_585.262 },
  therms: { measure: "energy", toBase: 105_505_585.262 },
  // The electronvolt, the energy one electron gains across one volt, exactly
  // 1.602176634e-19 J since the 2019 SI redefinition, with the prefixes
  // particle physics writes it in.
  eV: { measure: "energy", toBase: 1.602176634e-19 },
  keV: { measure: "energy", toBase: 1.602176634e-16 },
  MeV: { measure: "energy", toBase: 1.602176634e-13 },
  GeV: { measure: "energy", toBase: 1.602176634e-10 },

  // ── Pressure (#706) ───────────────────────────────────────────────────
  // The millimetre of mercury, the unit blood pressure is read in, at its
  // conventional value of exactly 133.322387415 Pa. The torr in the generated
  // table is 101325/760 Pa, less than one part in seven million smaller, so the
  // two are kept as the separate units they are defined to be.
  mmHg: { measure: "pressure", toBase: 133.322387415 },

  // ── Frequency (#706) ──────────────────────────────────────────────────
  // Revolutions per minute, an engine's or a drill's speed of rotation, as a
  // frequency: one revolution a minute is a sixtieth of a hertz, so `3000 rpm`
  // is 50 Hz. Both cases, since a dashboard prints `RPM`.
  rpm: { measure: "frequency", toBase: 1 / 60 },
  RPM: { measure: "frequency", toBase: 1 / 60 },

  // ── Amount of substance (base: mol, #706) ─────────────────────────────
  // The mole, chemistry's count of particles (6.02214076e23 of them). It is a
  // conversion unit only: the dimensions in Dimensions.ts track mass, length,
  // time and current, and the mole is a fifth base quantity outside them, so
  // `2 mol * 3 kg` is refused rather than composed. Growing that vector would
  // change every named unit's key for a quantity no named unit here needs.
  // The word `mole` is left out: it is also an animal, a spy and a mark on the
  // skin.
  mol: { measure: "amountOfSubstance", toBase: 1 },
  mmol: { measure: "amountOfSubstance", toBase: 0.001 },

};
