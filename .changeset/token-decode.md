---
"solve-engine": minor
---

Decode a JSON Web Token or a URL query string, in the encoding package.

`jwt(...)` (also `... from jwt`) reads a JWT's payload, the claims it carries, and
returns them as JSON:

```
jwt("eyJhbGci…")    {"sub":"1234567890","name":"John Doe","iat":1516239022}
```

The signature is never checked, and that is deliberate: verifying it needs the
signing key, and a calculator is the wrong place to imply a token is genuine.
`jwt` reports what a token says, and a malformed one is an error rather than a
half-read result.

`query(...)` (also `... from query`) parses a URL query string into JSON,
decoding the percent-escapes and reading `+` as a space:

```
query("name=John+Doe&page=2")    {"name":"John Doe","page":"2"}
```

Both extend the existing encoding package, alongside base64, URL and hex bytes.
