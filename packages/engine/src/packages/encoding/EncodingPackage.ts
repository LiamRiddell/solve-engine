import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { stringValue, errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import {
	base64Encode, base64Decode,
	urlEncode, urlDecode,
	hexBytesEncode, hexBytesDecode,
	jwtDecodePayload, parseQueryString,
} from "./Encoding";
import { FromEncodingParselet } from "./parselets/FromEncodingParselet";
import { EncodingCallParselet } from "./parselets/EncodingCallParselet";

/** The text of a String value, or null when it is not text. */
function asText(value: Value): string | null {
	return value.type === ValueType.String ? (value.value as string) : null;
}

/** An encode converter: text in, encoded text out, a clear error for a non-text input. */
function encoder(name: string, encode: (t: string) => string): (value: Value) => Value {
	return (value: Value): Value => {
		const text = asText(value);
		if (text === null) return errorValue("ENCODING_EXPECTED_TEXT", `"as ${name}" expects text (a "quoted string")`);
		return stringValue(encode(text));
	};
}

/** The decoders, keyed by the same names the encoders use. */
const DECODERS: Record<string, (encoded: string) => string | null> = {
	base64: base64Decode,
	url: urlDecode,
	"hex bytes": hexBytesDecode,
	hexbytes: hexBytesDecode,
	jwt: jwtDecodePayload,
	query: parseQueryString,
};

/**
 * Text encodings for developers: base64, URL and hex bytes, each with an
 * encode (`as`) and a decode (`from`) direction (issue #188).
 *
 * Encoding turns a piece of text into a safe, plain form for somewhere it has to
 * travel, and decoding reads it back. `as` encodes, `from` decodes, so a value
 * can be turned into a form on one line and recovered on the next, in the same
 * note as the rest of the working. On by default and removable, like the other
 * developer-facing packages.
 *
 * `hex bytes` is spelled as two words on purpose: `as hex` already means a
 * number shown in base 16, a different thing, so the byte encoding is kept
 * separate and neither reading is ambiguous.
 *
 * Two developer conveniences read a token apart rather than encode one: `jwt(...)`
 * (also `... from jwt`) decodes a JSON Web Token's claims, and `query(...)` (also
 * `... from query`) parses a URL query string into JSON. `jwt` reads what a token
 * says and never checks its signature, since verifying one needs the signing key
 * and a calculator is the wrong place to imply a token is genuine.
 */
export const ENCODING_PACKAGE: IEnginePackage = {
	name: "solve-encoding",
	// So `as hex bytes` / `from hex bytes` arrive as one converter-name token,
	// rather than the word "hex" (which is also the base-16 number converter)
	// followed by a stray "bytes".
	phrases: {
		"hex bytes": "CONVERTER_NAME",
		// The decode forms, fused so the bare `from` (used by plot/clamp) is
		// untouched. Each carries its own name, read back by the parselet.
		"from base64": "FROM_ENCODING",
		"from url": "FROM_ENCODING",
		"from hex bytes": "FROM_ENCODING",
		"from jwt": "FROM_ENCODING",
		"from query": "FROM_ENCODING",
	},
	asConverters: {
		base64: encoder("base64", base64Encode),
		url: encoder("url", urlEncode),
		"hex bytes": encoder("hex bytes", hexBytesEncode),
	},
	infixParselets: {
		FROM_ENCODING: new FromEncodingParselet(),
	},
	prefixParselets: {
		BASE64_FN: new EncodingCallParselet("base64"),
		JWT_FN: new EncodingCallParselet("jwt"),
		QUERY_FN: new EncodingCallParselet("query"),
	},
	// `base64(...)`/`jwt(...)`/`query(...)`, fused to their `*_FN` token by the
	// engine's shared call-fusion rule (so the words stay usable as variables).
	callFusions: { base64: "BASE64_FN", jwt: "JWT_FN", query: "QUERY_FN" },
	pluginFunctions: {
		// `base64("...")`, the function spelling of `"..." as base64`.
		base64: (args: Value[]): Value => encoder("base64", base64Encode)(args[0]),
		// `jwt("...")`, the decode-a-token function; payload claims only.
		jwt: (args: Value[]): Value => {
			const text = asText(args[0]);
			if (text === null) return errorValue("ENCODING_EXPECTED_TEXT", `jwt(...) expects text (a "quoted string")`);
			const decoded = jwtDecodePayload(text);
			if (decoded === null) return errorValue("ENCODING_DECODE_FAILED", "jwt(...): the input is not a valid JSON Web Token");
			return stringValue(decoded);
		},
		// `query("a=1&b=2")`, parse a URL query string into JSON.
		query: (args: Value[]): Value => {
			const text = asText(args[0]);
			if (text === null) return errorValue("ENCODING_EXPECTED_TEXT", `query(...) expects text (a "quoted string")`);
			const decoded = parseQueryString(text);
			if (decoded === null) return errorValue("ENCODING_DECODE_FAILED", "query(...): the input is not a valid query string");
			return stringValue(decoded);
		},
		// `<value> from <name>`, dispatched by the decode name the parselet pushes.
		fromEncoding: (args: Value[]): Value => {
			const text = asText(args[0]);
			const name = String(args[1].value ?? "");
			if (text === null) return errorValue("ENCODING_EXPECTED_TEXT", `"from ${name}" expects text (a "quoted string")`);
			const decode = DECODERS[name];
			if (!decode) return errorValue("UNKNOWN_ENCODING", `"from ${name}" is not a known encoding (try base64, url or hex bytes)`);
			const decoded = decode(text);
			if (decoded === null) return errorValue("ENCODING_DECODE_FAILED", `"from ${name}": the input is not valid ${name}`);
			return stringValue(decoded);
		},
	},
	tokenCategories: {
		BASE64_FN: "function",
		JWT_FN: "function",
		QUERY_FN: "function",
	},
};
