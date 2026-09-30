---
title: Networking
description: "IPv4 and IPv6 subnet arithmetic: hosts, netmask, network and last address, broadcast and membership."
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
network of 192.168.1.10/24 // 192.168.1.0
last address of 192.168.1.10/24 // 192.168.1.255
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
- **network of** a block is its first address, the one that names the network.
  Written with a machine's own address (`192.168.1.10/24`, the way a network
  setting often shows it), it answers the block that machine is in.
- **last address of** a block is the last address in it. For IPv4 that is the
  broadcast address; the form also works for IPv6, which has no broadcast.
- **`<address> in <block>`** asks whether an address belongs to a block: it is
  `true` when the address shares the block's fixed bits. `192.168.1.10` is not in
  `10.0.0.0/8`, because that block only holds addresses starting with `10`.
- **as int** is the address as the single 32-bit number it really is, handy when
  a tool wants the integer form.

### Comparing addresses and blocks

`==` asks whether two addresses or blocks are the same, and `!=` whether they
differ. Two blocks are the same only when both the address and the prefix
match: `192.168.1.0/24` holds 256 addresses and `192.168.1.0/25` only the first
128, so they are different blocks even though they start at the same address.
For the same reason a bare address and the one-address block `/32` around it
are written differently and compare as different. An address never equals a
plain number, even the number `as int` gives for it; compare `as int` with
`as int` when the integer is what matters:

```solve
192.168.1.0/24 == 192.168.1.0/25 // false
192.168.1.0/24 == 192.168.1.0/24 // true
192.168.1.0/24 != 192.168.1.0/25 // true
192.168.1.1 == 192.168.1.1/32 // false
192.168.1.1 == 3232235777 // false
192.168.1.1 as int == 3232235777 // true
```

IPv4 and IPv6 follow the same rule, so `2001:db8::/32 == 2001:db8::/48` is
false as well. A [`check`](/syntax/checks/) line compares two addresses the same
way, so `check 192.168.1.0/24 != 192.168.1.0/25` passes.

### A block kept in a variable

A block a note uses more than once is easier to name once and ask about by
name. `in` followed by a variable holding a block is the same membership
question as `in` followed by the block itself:

```solve-doc
lab = 192.168.1.0/24
192.168.1.7 in lab // true
10.0.0.1 in lab // false
```

The name is read when the line runs, and only an address before `in` and a
block or address in the name make it a membership question. Any other value
after `in` keeps its meaning as the unit or zone to convert into, so a variable
that happens to share a unit's name (`m`, `h`) still converts a quantity into
that unit. A name holding a single address rather than a block is refused, as
`192.168.1.5 in 192.168.1.5` would be, since one address contains nothing:

```solve-doc
host = 192.168.1.5
192.168.1.5 in host // ERROR: "in" expects a subnet on the right, e.g. 10.0.0.0/8
```

## IPv6 addresses

IPv6 is the newer, longer kind of address, made because the four-number IPv4
addresses ran out. An IPv6 address is 128 bits, written as eight groups of up to
four **hexadecimal** digits (0 to 9, then a to f for ten to fifteen) joined by
colons, such as `2001:db8:85a3::8a2e:370:7334`. Two shortenings keep it
readable: zeros at the front of a group may be left off (`0db8` is `db8`), and a
double colon stands for a run of groups that are all zero, so `fe80::1` is short
for `fe80:0:0:0:0:0:0:1`.

Because of those shortenings one address can be written many ways. The engine
reads every one of them and answers in the single agreed form (RFC 5952): lower
case, no leading zeros, and the longest run of zero groups written as `::`.
That makes two notes easy to compare, and an address copied from a tool that
writes the long form comes back the way it is usually read:

```solve
2001:0DB8:0000:0000:0000:ff00:0042:8329 // 2001:db8::ff00:42:8329
fe80:0:0:0:0:0:0:1 // fe80::1
2001:db8:0:0:1:0:0:1 // 2001:db8::1:0:0:1
fe80::1 == fe80:0:0:0:0:0:0:1 // true
```

When two runs of zeros are the same length, the first is shortened, and a single
zero group stays `0`, since `::` only ever stands for two or more.

### IPv6 subnets

An IPv6 block is written the same way as an IPv4 one, with a prefix from `/0` to
`/128` after the address. The usual block for one network is a `/64`: the first
64 bits name the network and the other 64 number the machines on it. The same
questions work:

```solve
hosts in 2001:db8::/64 // 18446744073709551616
netmask of /64 // ffff:ffff:ffff:ffff::
netmask of 2001:db8::/32 // ffff:ffff::
network of 2001:db8:85a3::8a2e:370:7334/64 // 2001:db8:85a3::
last address of 2001:db8::/32 // 2001:db8:ffff:ffff:ffff:ffff:ffff:ffff
2001:db8::5 in 2001:db8::/32 // true
2001:db9::1 in 2001:db8::/32 // false
```

- **hosts in** an IPv6 block counts every address in it, 2 to the power of the
  host bits. IPv6 keeps back no broadcast address, so there is nothing to take
  away: a `/64` holds 18,446,744,073,709,551,616 addresses, shown in full since
  the count is exact.
- **netmask of** a bare prefix longer than 32 (`/64`) is an IPv6 netmask, since
  no IPv4 prefix is that long. A shorter IPv6 prefix is asked about with its
  block (`netmask of 2001:db8::/32`), because `/24` on its own is read as IPv4.
- **network of** and **last address of** give the first and last address of the
  block.
- **`<address> in <block>`** works as it does for IPv4. The two sides have to be
  the same kind of address, so an IPv4 address in an IPv6 block is refused
  rather than answered `false`.

IPv6 has no broadcast address (it reaches a group of machines another way,
called multicast), so `broadcast of` an IPv6 block says so and points at `last
address of`:

```solve
broadcast of 2001:db8::/32 // An IPv6 block has no broadcast address: IPv6 reaches a group of machines another way (multicast). For the block's last address, write "last address of".
```

### IPv4 inside IPv6, and zones

Two more written forms come from the IPv6 standards (RFC 4291 and RFC 4007).
The last 32 bits of an address may be written as an IPv4 dotted quad, which is
how an IPv4 address is carried inside IPv6: `::ffff:192.168.1.1` is the IPv4
address `192.168.1.1` as an IPv6 one (an **IPv4-mapped** address). The engine
keeps the dotted quad when it shows a mapped address, and writes any other
address in hexadecimal. A **zone**, written after a percent sign, names the
network connection (the interface) a local address is used on, as in
`fe80::1%eth0`. It is kept with the address and shown with it, and it plays no
part in `in`, since it says where an address is used, not which address it is.

```solve
::ffff:192.168.1.1 // ::ffff:192.168.1.1
::ffff:c0a8:101 // ::ffff:192.168.1.1
64:ff9b::192.0.2.33 // 64:ff9b::c000:221
fe80::1%eth0 // fe80::1%eth0
fe80::1%eth0 in fe80::/10 // true
::/0 // ::/0
```

`::/0` is the block of every IPv6 address (a default route). A bare `::`, the
address of all zeros, is only read with a prefix after it, since on its own
nothing tells it apart from two colons.

### An IPv6 address as a number

An IPv6 address is a 128-bit number, far more than an ordinary number in the
engine holds exactly (about 16 digits). `as int` gives the address as one exact
whole number, and `in hex` or `in binary` writes out its bits:

```solve
fe80::1 as int // 338288524927261089654018896841347694593
fe80::1 in hex // 0xFE800000000000000000000000000001
::1 as int // 1
```

Arithmetic straight on an address is refused rather than rounded, because the
nearest ordinary number would change its last digits and so name a different
address. Convert first with `as int` to work with the number:

```solve
fe80::1 + 2 // An IPv6 address cannot be added: its 128 bits are more than a number holds exactly. For the address as one whole number, write "as int".
fe80::1 as int + 2 // 338288524927261089654018896841347694595
```

### What is not an address

A colon means other things in a note, so an address is only read when the whole
run is one: eight groups, or fewer with a single `::`, each group one to four
hexadecimal digits, written with no spaces. A clock time such as `12:30`, or a
timecode, has at most four fields and no double colon, so it is never read as an
address. A label (`Note: 5`) ends in a single colon, and a word before `::` that
is not hexadecimal (`note::5`) is still read as a label, since `n`, `o` and `t`
are not hexadecimal digits:

```solve
Note: 5 // 5
note::5 // 5
cafe::1 // cafe::1
```

A word that happens to be spelled in hexadecimal (`cafe`, `dead`, `add`) does
read as an address when it stands before `::`, because that is what the text is.

## The boundary

This covers IPv4 and IPv6 addresses and subnets and the questions above.
Arithmetic straight on an IPv6 address (adding, comparing with a number,
rounding) is refused by name, since the answer would not be exact; `as int` is
the way to its number, and two IPv6 addresses compare with `==`, `<` and `>` on
their bits. A bare prefix of 32 or less (`netmask of /24`) is read as IPv4;
write the block for an IPv6 prefix that short. Only an IPv4-mapped address is
shown with a dotted quad: the other forms that embed IPv4 (such as the
`64:ff9b::/96` translation block) are shown in hexadecimal, which is what RFC
5952 recommends when nothing else says the quad is meant. `hosts in` an IPv6
block counts every address, including the first one, which some networks keep
back for their routers.

A dotted address only reads as one when it is written as a single run, with no
spaces around the slash. That keeps ordinary division working: `192.168.1.0/24`
is a subnet, but `192.168.1.0 / 24`, with spaces, is a division, and a plain
`10 / 2` is always just `5`. A part above 255 is not a valid address either, so
it is never mistaken for one.
