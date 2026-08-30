---
title: Text encoding
description: Turn text into base64, a URL-safe form or hex bytes, decode a JWT or a query string, and back again.
---

> **Package:** `ENCODING_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Sometimes a piece of text has to travel somewhere that will not accept it as it
is: a field that only tolerates letters and digits, a web address that gives
`&` and `=` their own meaning, a place where you need to see the raw byte
values. **Encoding** rewrites the text into a safe, plain form for that journey;
**decoding** reads it back. This page does both, in the same note as the rest of
your working, so you can encode a value on one line and check it decodes on the
next.

`as` encodes and `from` decodes. Three encodings are covered, each a round trip:

```solve
"hello" as base64 // aGVsbG8=
"aGVsbG8=" from base64 // hello
"a b&c=1" as url // a%20b%26c%3D1
"a%20b%26c%3D1" from url // a b&c=1
"Hi" as hex bytes // 48 69
"48 69" from hex bytes // Hi
```

- **base64** packs text into a compact run of letters, digits and a little
  punctuation, the form data fields and tokens usually expect.
- **url** escapes the characters that have a special job in a web address, so a
  space becomes `%20`, an ampersand `%26`, an equals `%3D`.
- **hex bytes** shows each byte of the text as a two-digit hex number, useful
  when you want to read the bytes themselves.

base64 also has a function spelling, for when that reads more naturally:

```solve
base64("Hello, World!") // SGVsbG8sIFdvcmxkIQ==
```

## Reading a token apart

Two forms read an existing token rather than make one. `jwt` decodes a JSON Web
Token: a JWT is three base64url parts joined by dots
(`header.payload.signature`), and this returns the payload, the claims the token
carries, as JSON.

```solve
jwt("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c") // {"sub":"1234567890","name":"John Doe","iat":1516239022}
```

The signature is never checked, and that is deliberate. Reading a token is not
the same as trusting it: verifying the signature needs the signing key, and a
calculator is the wrong place to imply a token is genuine. `jwt` tells you what a
token *says*; a malformed one is reported as an error rather than half read.

`query` parses a URL query string into JSON, decoding the percent-escapes and
reading `+` as a space:

```solve
query("name=John+Doe&page=2") // {"name":"John Doe","page":"2"}
```

Both also have a `from` spelling, `"..." from jwt` and `"..." from query`, to
match the decoders above.

## Notes

`hex bytes` is two words on purpose. `as hex` already means something different,
a number shown in base 16, so the byte encoding is kept separate and neither
reading is ambiguous:

```solve
255 as hex // 0xFF
```

Encoding expects text, so give it a `"quoted string"`; a number or other value
is reported as an error rather than quietly turned into something. Decoding
checks its input, so a string that is not valid base64 (or url, or hex bytes) is
reported too, rather than handed back as mangled text. Multi-byte characters
(accents, emoji) survive the round trip, because the text is encoded by its
actual bytes.
