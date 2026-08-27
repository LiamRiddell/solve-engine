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
