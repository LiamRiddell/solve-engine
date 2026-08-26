---
title: Weather
description: Current conditions and temperature for a place, from a keyless service.
---

> **Package:** `WEATHER_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Weather is built in and on by default, because the service behind it (Open-Meteo)
needs no key. Name a place and ask for its conditions, or for one figure.

| Expression | Result |
| --- | --- |
| `weather in Paris` | a description and the current temperature |
| `temperature in Tokyo` | the current temperature |
| `feels like in London` | the apparent temperature |
| `high in Berlin` | the day's maximum |
| `low in Oslo` | the day's minimum |

These forms read the current day: today's conditions, and today's high and low.
There is no dated or multi-day forecast form, and a place the service cannot
find returns a clearly named `WEATHER_CITY_NOT_FOUND` error rather than a guess.

A weather lookup reaches the network, so its first result is a pending value and
the real answer arrives once the request returns. See
[async and live data](/guide/async-and-live-data/) for how a host waits on that.

The results depend on the live service and the day, so they are shown here rather
than asserted.
