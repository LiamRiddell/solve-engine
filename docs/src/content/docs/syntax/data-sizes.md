---
title: "Data sizes"
description: Byte and bit units, with decimal and binary prefixes kept distinct.
---

> **Packages:** `ARITHMETIC_PACKAGE`, `FUNCTION_PACKAGE`, `CONVERTERS_PACKAGE`, `UOM_PACKAGE`, `BIGINT_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

A data size is measured in bytes and bits, with prefixes like kilo, mega and giga
that come in two flavours: decimal (a kilobyte is 1,000 bytes) and binary (a
kibibyte is 1,024). Solve treats them as ordinary units and keeps the two apart,
so a conversion means exactly what it says.

Byte and bit units are ordinary units, so they convert like any other
measurement. Decimal and binary prefixes are both there and are kept distinct:
`kB` is 1,000 bytes and `KiB` is 1,024.

```solve
1 kB in bytes // 1,000.00 bytes
1 KiB in bytes // 1,024.00 bytes
1 GB in MB // 1,000.00 MB
1 TiB in GiB // 1,024.00 GiB
1 byte in bits // 8.00 bits
1.5 MB in KB // 1,500.00 KB
```

Case matters, and it matters more here than almost anywhere: `MB` is megabytes
and `Mb` is megabits, a factor of eight apart.

```solve
1 GB in bits // 8,000,000,000.00 bits
1 Gb in Mb // 1,000.00 Mb
```

## Bandwidth and transfer time

Bandwidth is a data rate, bits (or bytes) a second: `Mbps`, `Gbps`, `kbps`, and
the byte forms `MBps`, `GBps`. A data size *at* a bandwidth is the time the
transfer takes.

```solve
4 GB at 50 Mbps // 10.67 min
2 GB at 1 Gbps // 16.00 s
```

The bit/byte distinction rides the unit's case here too: `50 Mbps` is megabits a
second, `50 MBps` megabytes, eight times as fast.

See [units and conversions](/syntax/unit-arithmetic/) for the full list.
