---
title: Weather
description: Current conditions and temperature for a place, from a keyless service.
---

> **Package:** `WEATHER_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Weather is built in and on by default, because the service behind it (Open-Meteo)
needs no key. Name a place and ask for its conditions, or for one figure. The
block below is live: each line reaches the network, so its answer arrives a moment
after the page loads, and editing a place name fetches the new one.

```solve
weather in London
temperature in Tokyo
feels like in Paris
high in Berlin
```

These forms read the current day: today's conditions, and today's high and low.
There is no dated or multi-day forecast form, and a place the service cannot
find returns a clearly named `WEATHER_CITY_NOT_FOUND` error rather than a guess.

A weather lookup reaches the network, so its first result is a pending value (the
`…` you see for an instant above) and the real answer replaces it once the
request returns. See [async and live data](/guide/async-and-live-data/) for how a
host drives that loop itself.

The values are live and change with the weather, so they are not pinned as
build-time assertions the way a fixed calculation is.
