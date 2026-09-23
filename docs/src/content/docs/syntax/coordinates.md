---
title: "Coordinates, distance and bearing"
description: Places on the globe by latitude and longitude, the distance between two of them, and the direction from one to the other.
---

> **Package:** `GEO_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Every place on Earth has a pair of **coordinates**. The **latitude** is how far
north or south of the equator it is, from 0° at the equator to 90° at each pole.
The **longitude** is how far east or west it is of the Greenwich meridian, the
line from pole to pole through London, from 0° there to 180° on the far side of
the world. London is about 51.5° north and 0.13° west; Tokyo is about 35.7° north
and 139.7° east. A map app gives the coordinates of any place, usually with a
long press.

With two places written that way, the engine answers the questions a travel or
flight-planning note asks: how far apart they are, and which way to set off.

## Writing a place

A place is written three ways. As a pair of signed numbers in brackets, latitude
first, where north and east are positive and south and west negative. With
compass letters instead of signs. Or in degrees, minutes and seconds, the way a
map or a GPS often prints it (explained in the next section).

```solve
(51.5074, -0.1278) // [51.51, -0.13]
51.5074°N 0.1278°W // [51.51, -0.13]
51°30'26.64"N 0°07'40.08"W // [51.51, -0.13]
```

All three are the same place, and the engine holds it the same way: two numbers
of degrees, latitude then longitude, which is what the answer shows. Latitude
comes first because that is how maps and GPS devices give it. A few data formats
(GeoJSON is the common one) put the longitude first, so a pair copied from one of
those needs swapping.

With compass letters the order does not matter, since the letters say which
number is which, and a comma between them is fine, which is how many websites
print a place:

```solve
0.1278°W 51.5074°N // [51.51, -0.13]
51.5072° N, 0.1276° W // [51.51, -0.13]
```

Give a place a name and later lines can use it. This is how `distance from
London to Tokyo` reads as it would in a sentence:

```solve
London = 51.5074°N 0.1278°W // [51.51, -0.13]
Tokyo = 35.6762°N 139.6503°E // [35.68, 139.65]
distance from London to Tokyo // 9,558.57 km
```

## Degrees, minutes and seconds

A degree is split into 60 **minutes** of arc, and a minute into 60 **seconds**,
the same way an hour splits into minutes and seconds. Maps, charts and GPS
devices often write an angle in those parts: `51°30'27"` is 51 degrees, 30
minutes and 27 seconds, which is 51.5075 degrees. The engine reads it as an angle
in degrees, and a compass letter of S or W makes it negative.

```solve
51°30'27" // 51.51 degrees
51°30.45' // 51.51 degrees
33°52'07.68"S // -33.87 degrees
```

The middle line is degrees and decimal minutes, the form many GPS devices show.
Spaces between the parts are fine (`51° 30' 27" N`), and so are the typographic
marks a word processor substitutes: `′` or `’` for the minutes, `″`, `”` or two
apostrophes for the seconds.

`as dms` goes the other way, writing an angle in degrees, minutes and seconds to
a hundredth of a second. A plain number is taken as degrees, any other angle unit
is converted first, and a place is written with its compass letters:

```solve
51.5074° as dms // 51°30'26.64"
1 rad as dms // 57°17'44.81"
(51.5074, -0.1278) as dms // 51°30'26.64"N 0°07'40.08"W
```

## Distance

The shortest path between two places on a globe is not the straight line a flat
map suggests but an arc of a **great circle**: a circle around the Earth whose
centre is the Earth's centre, as the equator and every meridian are. The length
of that arc is the **great-circle distance**, the distance as the crow flies, and
it is the figure usually quoted as the distance between two cities.

```solve
distance from (51.5074, -0.1278) to (48.8566, 2.3522) // 343.56 km
distance between (51.5074, -0.1278) and (48.8566, 2.3522) // 343.56 km
```

The answer is a length in kilometres, so it converts like any other. A
**nautical mile** (`nmi`) is one minute of arc of latitude, 1.852 km, which is
why pilots and sailors measure in them:

```solve
distance from 51.5074°N 0.1278°W to 35.6762°N 139.6503°E // 9,558.57 km
distance from 51.5074°N 0.1278°W to 35.6762°N 139.6503°E in miles // 5,939.42 miles
distance from 51.5074°N 0.1278°W to 35.6762°N 139.6503°E in nmi // 5,161.22 nmi
```

Two numbers and a comma, which is what a map copies to the clipboard, need no
brackets here:

```solve
distance from 51.5074, -0.1278 to 48.8566, 2.3522 // 343.56 km
```

A trip across the 180° meridian, in the Pacific where east meets west, is
measured the short way across it, not the long way round:

```solve
distance from (0, 179.5) to (0, -179.5) // 111.20 km
```

## Bearing

The **initial bearing** is the compass direction to set off in: degrees
clockwise from true north, so 0° is north, 90° east, 180° south and 270° west.
It is the *initial* bearing because the heading along a great circle changes as
you go: London to Tokyo sets off at about 32°, between north and north-east, and
arrives heading about 156°, south-south-east.

```solve
bearing from (51.5074, -0.1278) to (48.8566, 2.3522) // 148.12 degrees
bearing from (51.5074, -0.1278) to (48.8566, 2.3522) as dms // 148°06'56.22"
bearing from (0, 179.5) to (0, -179.5) // 90.00 degrees
```

From a pole every direction is the same one: due south from the North Pole and
due north from the South Pole, whatever longitude the pole was written with.

```solve
bearing from (90, 0) to (51.5074, -0.1278) // 180.00 degrees
```

## When it cannot answer

A place off the globe, an angle whose parts do not add up, or two places with no
single direction between them is refused with a sentence that names the part,
rather than answered with a number.

```solve
distance from (91, 0) to (0, 0) // latitude 91° is past a pole: latitudes run from -90° (the South Pole) to 90° (the North Pole)
51°75' // 51°75' has 75 minutes: minutes of arc run from 0 to 59, and 60 of them make a degree
51°N 48°N // 51°N and 48°N are both latitudes (N or S): a place is one latitude and one longitude, as in 51.5074°N 0.1278°W
bearing from (0, 0) to (0, 0) // the two places are the same point, so there is no direction from one to the other
bearing from (0, 0) to (0, 180) // the two places are on exactly opposite sides of the Earth, so every direction reaches the second and there is no single bearing
5 kg as dms // "as dms" writes an angle in degrees, minutes and seconds, and 5 kg is not an angle
```

## The boundary

The Earth is treated as a sphere with the mean radius, 6,371.0088 km, and the
distance is worked out with the haversine formula. The real Earth is slightly
flattened at the poles, and a surveyor measures on that flattened shape (the
WGS-84 ellipsoid a GPS uses); a spherical distance is within about 0.5% of that
everywhere, and usually much closer. The sphere is chosen deliberately: it gives
one well-defined answer for every pair of places, including two on exactly
opposite sides of the world, where the usual ellipsoidal method (Vincenty's)
fails to settle on an answer at all, and half a percent is less than the
uncertainty in which point stands for a city.

The distance is as the crow flies. It is not a road, rail or flight-route
distance, and it ignores height above sea level.

There is no built-in list of cities, and nothing reaches the network to look one
up: a place is the coordinates you give it, typed on the line or held in a
variable. A city covers many square kilometres, and which point in it stands for
the city changes the answer by more than the method does, so that choice stays
on the line where the reader can see it. A variable name is one word, so New York
is written `NewYork` or `nyc`.

A compass letter is read only when it follows the degree sign directly or after
spaces, as a single letter: `51.5°N` is a latitude, but `51.5° north` is not
recognised. A bare `90°` is still just an angle of ninety degrees, and `20°C` is
still a temperature.
