/**
 * Text encodings, as pure functions (issue #188). Each is a plain
 * string-to-string transform, so they carry no engine import and are trivially
 * testable. Bytes come from `TextEncoder`/`TextDecoder`, which every supported
 * runtime has, so a multi-byte character (an accent, an emoji) round-trips
 * correctly rather than being mangled the way the old `btoa` would.
 *
 * Encoding is turning a piece of text into a safe, plain form for somewhere it
 * has to travel: base64 for a data field that only tolerates letters and digits,
 * URL encoding for a value dropped into a web address, hex bytes for reading the
 * raw byte values out. Decoding reverses each.
 */

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Text to base64, e.g. `hello` becomes `aGVsbG8=`. */
export function base64Encode(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
		const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
		out += BASE64_ALPHABET[b0 >> 2];
		out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
		out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
		out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f] : "=";
	}
	return out;
}

/** base64 back to text, or null when the input is not valid base64. */
export function base64Decode(encoded: string): string | null {
	const clean = encoded.replace(/\s+/g, "");
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
	const body = clean.replace(/=+$/, "");
	const bytes: number[] = [];
	let bits = 0;
	let accumulator = 0;
	for (const char of body) {
		const index = BASE64_ALPHABET.indexOf(char);
		if (index < 0) return null;
		accumulator = (accumulator << 6) | index;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((accumulator >> bits) & 0xff);
		}
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
	} catch {
		return null;
	}
}

/** Text to a URL-safe form, e.g. `a b&c=1` becomes `a%20b%26c%3D1`. */
export function urlEncode(text: string): string {
	// encodeURIComponent leaves a few sub-delimiters unescaped that a URL
	// component is safer without, but it does escape the space, ampersand and
	// equals the examples turn on, which is the common case a note wants.
	return encodeURIComponent(text);
}

/** A URL-encoded string back to text, or null when it is malformed. */
export function urlDecode(encoded: string): string | null {
	try {
		return decodeURIComponent(encoded);
	} catch {
		return null;
	}
}

/** Text to its bytes in hex, space-separated, e.g. `Hi` becomes `48 69`. */
export function hexBytesEncode(text: string): string {
	return Array.from(new TextEncoder().encode(text))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join(" ");
}

/** Space- or comma-separated hex bytes back to text, or null when malformed. */
export function hexBytesDecode(encoded: string): string | null {
	const tokens = encoded.trim().split(/[\s,]+/).filter((t) => t.length > 0);
	const bytes: number[] = [];
	for (const token of tokens) {
		if (!/^[0-9a-fA-F]{1,2}$/.test(token)) return null;
		bytes.push(parseInt(token, 16));
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
	} catch {
		return null;
	}
}

/**
 * base64url (the JOSE/JWT variant) to standard base64: `-` and `_` stand in for
 * `+` and `/`, and the trailing `=` padding is dropped. Restoring both lets the
 * ordinary {@link base64Decode} read it.
 */
function base64UrlToStandard(segment: string): string {
	const swapped = segment.replace(/-/g, "+").replace(/_/g, "/");
	const remainder = swapped.length % 4;
	return remainder === 0 ? swapped : swapped + "=".repeat(4 - remainder);
}

/**
 * Read a JSON Web Token's claims. A JWT is three base64url parts joined by dots
 * (`header.payload.signature`); this decodes the middle part, the payload, and
 * returns its claims as compact JSON. Returns null when the input is not a
 * well-formed JWT payload.
 *
 * The signature is deliberately never checked. Verifying it needs the signing
 * key, and a calculator is the wrong place to imply a token is trustworthy: this
 * reads what a token *says*, not whether it is genuine.
 */
export function jwtDecodePayload(token: string): string | null {
	const parts = token.trim().split(".");
	if (parts.length < 2 || parts[1] === "") return null;
	const json = base64Decode(base64UrlToStandard(parts[1]));
	if (json === null) return null;
	try {
		const claims = JSON.parse(json);
		// A bare number or string is valid JSON but not a claim set; a JWT payload
		// is an object.
		if (claims === null || typeof claims !== "object" || Array.isArray(claims)) return null;
		return JSON.stringify(claims);
	} catch {
		return null;
	}
}

/**
 * Parse a URL query string (`a=1&b=2`, with or without a leading `?`) into
 * compact JSON. Percent-escapes are decoded and `+` reads as a space, the way a
 * form-encoded value does. Returns null when a component is not valid encoding.
 */
export function parseQueryString(input: string): string | null {
	const body = input.trim().replace(/^\?/, "");
	if (body === "") return "{}";
	// A null-prototype object, so a key spelt `__proto__` or `constructor` is
	// an ordinary entry that appears in the output rather than a write to the
	// prototype that silently vanishes from it.
	const out: Record<string, string> = Object.create(null);
	for (const pair of body.split("&")) {
		if (pair === "") continue;
		const eq = pair.indexOf("=");
		const rawKey = eq === -1 ? pair : pair.slice(0, eq);
		const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
		try {
			out[decodeURIComponent(rawKey.replace(/\+/g, " "))] = decodeURIComponent(rawValue.replace(/\+/g, " "));
		} catch {
			return null;
		}
	}
	return JSON.stringify(out);
}
