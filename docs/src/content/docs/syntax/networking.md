---
title: Networking
description: "IPv4 subnet arithmetic: hosts, netmask, broadcast and membership."
---

> **Package:** `IP_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Every device on a network has an **IP address**, four numbers from 0 to 255
written with dots, like `192.168.1.10`. Addresses are handed out in blocks called
**subnets**, written as an address followed by a slash and a number, like
`192.168.1.0/24`. That number, the **prefix**, says how many of the address's
bits are fixed to name the block; the rest are free to number the machines
inside it. A `/24` fixes the first 24 bits (the first three numbers), leaving the
last for hosts, so `192.168.1.0/24` is the block from `192.168.1.0` to
`192.168.1.255`.

These are the questions a network note keeps asking, answered in place rather
than worked out elsewhere and pasted back:

```solve
hosts in 192.168.1.0/24 // 254
netmask of /24 // 255.255.255.0
broadcast of 192.168.1.0/24 // 192.168.1.255
192.168.1.10 in 10.0.0.0/8 // false
10.0.0.0/8 as int // 167,772,160
```

- **hosts in** a block is how many machines fit in it. It is two fewer than the
  block's size, because the first address names the network itself and the last
  is the **broadcast** address, so neither is given to a machine.
- **netmask of** a prefix is the same split shown as an address: the fixed bits
  as 1s. `/24` fixes three numbers, so its netmask is `255.255.255.0`. You can
  ask about a bare prefix (`/24`) or a whole block.
- **broadcast of** a block is its last address, the one that reaches every host
  at once.
- **`<address> in <block>`** asks whether an address belongs to a block: it is
  `true` when the address shares the block's fixed bits. `192.168.1.10` is not in
  `10.0.0.0/8`, because that block only holds addresses starting with `10`.
- **as int** is the address as the single 32-bit number it really is, handy when
  a tool wants the integer form.

## The boundary

This covers IPv4, the dotted-quad addresses above. IPv6, the longer addresses
written with colons, is left for a later addition: its 128-bit addresses need
their own notation and their own arithmetic, and the dotted-quad form is the
common case.

A dotted address only reads as one when it is written as a single run, with no
spaces around the slash. That keeps ordinary division working: `192.168.1.0/24`
is a subnet, but `192.168.1.0 / 24`, with spaces, is a division, and a plain
`10 / 2` is always just `5`. A part above 255 is not a valid address either, so
it is never mistaken for one.
