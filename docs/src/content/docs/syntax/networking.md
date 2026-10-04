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

## IPv6 addresses

IPv6 is the newer, longer kind of address: eight groups of up to four
hexadecimal digits (0 to 9 and a to f) joined by colons, such as
`2001:db8:85a3::8a2e:370:7334`. A double colon stands for a run of groups that
are all zero, so `fe80::1` is short for `fe80:0:0:0:0:0:0:1`.

The engine does not calculate with IPv6 addresses yet, but it does recognise
one, so an address pasted into a note says so rather than being read as
something else. The colons would otherwise look like a label (`fe80:` followed
by `1`) or a clock time:

```solve
fe80::1 // "fe80::1" is an IPv6 address, and only IPv4 addresses and subnets are covered so far.
2001:db8::/32 // "2001:db8::/32" is an IPv6 address, and only IPv4 addresses and subnets are covered so far.
::ffff:192.168.1.1 // "::ffff:192.168.1.1" is an IPv6 address, and only IPv4 addresses and subnets are covered so far.
fe80::1 + 2 // "fe80::1" is an IPv6 address, and only IPv4 addresses and subnets are covered so far.
```

Every written form is recognised: all eight groups, the shortened form with
`::` at the start, middle or end, an IPv4 address in the last two groups
(`::ffff:192.168.1.1`), a zone after a percent sign (`fe80::1%eth0`, the network
interface the address belongs to), and a prefix after a slash. The shape has to
be exact, so the other things a colon means keep their meaning: a clock time,
a timecode and a label are unchanged, and a word before `::` that is not
hexadecimal (`note::5`) is still read as a label. A clock time such as `12:30`,
or a timecode, has at most four fields and no double colon, so it is never read
as an address.

```solve
Note: 5 // 5
note::5 // 5
```

## The boundary

This covers IPv4, the dotted-quad addresses above. IPv6 addresses are
recognised and refused by name, as shown above; their 128-bit values, `hosts
in`, netmasks and membership are left for a later addition, since they need
their own arithmetic, and the dotted-quad form is the common case. A bare `::`
(the address with every group zero) is not recognised, because nothing in it
tells it apart from two colons.

A dotted address only reads as one when it is written as a single run, with no
spaces around the slash. That keeps ordinary division working: `192.168.1.0/24`
is a subnet, but `192.168.1.0 / 24`, with spaces, is a division, and a plain
`10 / 2` is always just `5`. A part above 255 is not a valid address either, so
it is never mistaken for one.
