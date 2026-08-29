---
title: Hashing
description: "Turn text into its digest: sha256, sha1, sha512, md5 and a crc32 checksum."
---

> **Package:** `HASH_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A **hash** (or **digest**) is a short, fixed-length fingerprint of a piece of
text. Feed the same text in and you always get the same fingerprint out; change
one character and the fingerprint changes completely. It is what a download page
means by "SHA-256 checksum", the way a file is spotted as identical to another
without comparing every byte, and how a value is turned into a fixed-size key.
This page computes those fingerprints in the same note as the rest of your
working.

Each is written as a function, since a hash is a named transform of its input,
and each answers lowercase hexadecimal, the same form the `sha256sum` command and
its relatives print.

```solve
sha256("hello") // 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
sha1("hello") // aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
md5("hello") // 5d41402abc4b2a76b9719d911017c592
crc32("hello") // 3610a686
```

`sha512` is the longer, 512-bit member of the SHA-2 family:

```solve
sha512("abc") // ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f
```

## What each one is for

- **sha256** and **sha512** are the current cryptographic hashes, the ones a
  checksum on a download or a content fingerprint should use.
- **crc32** is a short non-cryptographic checksum (the one zip files and PNG
  images carry). It catches accidental corruption cheaply; it is not a security
  measure.
- **md5** and **sha1** are here for compatibility with older systems that still
  use them. Both have been broken for collision resistance for years, so a
  deliberately different input can be made to share a digest: do not rely on
  them where that matters.

## Notes

The input is measured in its actual UTF-8 bytes, so hashing a piece of text here
gives the same digest that hashing the same text in a file would, accents, emoji
and all. Give each function text in `"quotation marks"`; a number or other value
is reported as an error rather than quietly converted.
