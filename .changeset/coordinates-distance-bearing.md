---
"solve-engine": minor
---

Places written by latitude and longitude, with the great-circle distance and the initial bearing between them

A place on the globe can now be written by its latitude and longitude, and the engine answers how far apart two places are and which way to set off from one to reach the other. Angles can be written the way a map writes them, in degrees, minutes and seconds (`51°30'27"`) or with a compass letter (`51.5074°N`), and `as dms` writes an angle back that way. It is a new package, `GEO_PACKAGE` (`solve-geo`), on by default and removable.

| expression | before | now |
| --- | --- | --- |
| `distance from London to Tokyo` | error: unexpected token "from" | 9,558.57 km |
| `bearing from London to Tokyo` | error: unexpected token "from" | 31.73 degrees |
| `51°30'27"` | error: unterminated string literal | 51.51 degrees |
| `51.5°N` | error: undefined variable `°N` | 51.50 degrees |
| `51.5074° as dms` | error: unknown converter "as dms" | 51°30'26.64" |

The first two rows are read in a document where `London = 51.5074°N 0.1278°W` and `Tokyo = 35.6762°N 139.6503°E` are defined on earlier lines. A place is written as a signed pair in brackets, latitude first, or as two compass-lettered angles in either order, or held in a variable; inside `distance` and `bearing` a bare pair such as `51.5074, -0.1278`, which is what a map copies, needs no brackets.

```text
distance from (51.5074, -0.1278) to (48.8566, 2.3522)             343.56 km
distance between 51.5074, -0.1278 and 48.8566, 2.3522             343.56 km
distance from 51.5074°N 0.1278°W to 35.6762°N 139.6503°E in nmi   5,161.22 nmi
bearing from (51.5074, -0.1278) to (48.8566, 2.3522)              148.12 degrees
distance from (0, 179.5) to (0, -179.5)                           111.20 km
bearing from (90, 0) to (51.5074, -0.1278)                        180.00 degrees
(51.5074, -0.1278) as dms                                         51°30'26.64"N 0°07'40.08"W
```

The distance is the great-circle distance, the shortest path over the surface, worked with the haversine formula on a sphere of the Earth's mean radius, 6,371.0088 km, and returned in kilometres so it converts like any length. The sphere is a deliberate choice over Vincenty's method on the WGS-84 ellipsoid: it gives one answer for every pair of places, including exact antipodes, where Vincenty's iteration fails to converge, and its error (within about 0.5% of the ellipsoidal distance) is smaller than the uncertainty in which point stands for a city. A pair either side of the 180° meridian is measured the short way across it. The bearing is the initial heading in degrees clockwise from true north; from a pole it is due south or due north, whatever longitude the pole was written with.

The angle literal needed a lexer change. A `"` used to open a string, so `51°30'27"` failed as an unterminated string, and a letter after `°` joined it into an identifier. The lexer now reads a number followed directly by `°` and then minutes, or a compass letter, as one `GEO_ANGLE` token, which the geo package turns into an angle in degrees or, paired with a second lettered angle, a place. A bare `90°`, a temperature such as `20°C`, and every string literal lex as before. Without the geo package registered, the literal is a parse error, as the same text was.

Refusals are values on the line that name the part at fault, never a throw or a number: a latitude past a pole, a longitude past 180°, 60 or more minutes or seconds, two latitudes offered as a place, `as dms` of something that is not an angle, and a bearing between the same point or two exact antipodes, which has no single direction.

The boundary: there is no built-in list of cities and nothing reaches the network, so a place is the coordinates the reader gives it, typed or held in a variable. A city covers many square kilometres, and which point stands for it moves the answer by more than the method does, so that choice stays visible on the line. The distance is as the crow flies, not by road or flight route, and ignores height. A destination point (where a heading and a distance lead) and a midpoint are not included. The new "Coordinates, distance and bearing" page explains latitude, longitude, great circles and bearings before the syntax, with every example proven.

## Verification

New suites pin the distances and bearings for London, Paris, Tokyo, New York and Sydney against figures computed independently in Python with the atan2 form of the central angle, the analytic cases (antipodes and pole to pole at pi times the radius, a quarter circumference, one degree across the 180° meridian), the pole and antipode bearings, degrees-minutes-seconds rounding and carry, every refusal and its code, variables unaffected by the new phrases, the package's removal, and the lexer's boundary around strings, temperatures and the bare degree sign. `npm run verify:ci` passes: 10,709 tests across 517 suites.
