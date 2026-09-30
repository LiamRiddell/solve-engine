/**
 * A shareable playground link that carries the document in the URL fragment.
 *
 * The fragment is the part of a URL after `#`, and a browser never sends it to
 * a server: the document travels inside the link itself, so sharing a note
 * uploads it nowhere. The text is compressed (raw DEFLATE, through the
 * platform's `CompressionStream`) and written in base64url, the base64
 * alphabet that needs no escaping in a URL, behind a versioned prefix:
 * `#doc=v1.<data>`.
 *
 * Reading a link is where the care goes, because a link is whatever someone
 * chose to put in it. {@link readShareFragment} refuses, with a message a
 * reader can act on, a fragment that is too long, one that is not base64url,
 * data that does not decompress, data that decompresses to more than the
 * playground accepts (a small link can expand enormously, so the output is
 * counted as it is produced and the read stops at the limit), and bytes that
 * are not text. A document opened from a link starts with live data off, so a
 * link cannot make a reader's browser fetch anything they did not ask for.
 */

/** The prefix a playground link's fragment starts with. */
export const SHARE_PREFIX = "#doc=v1.";

/** The longest document a link carries, in characters. */
export const MAX_SHARED_CHARACTERS = 100_000;

/** The longest fragment read, in characters; anything longer is refused before it is decoded. */
export const MAX_FRAGMENT_LENGTH = 200_000;

/** What reading a fragment gave: the document, with live data off, or the reason it was refused. */
export type SharedDocument =
	| { ok: true; text: string; liveData: false }
	| { ok: false; message: string };

/** Bytes as base64url, with no padding. */
function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url (padded or not) as bytes, or null when it is not base64url. */
function fromBase64Url(data: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]*={0,2}$/.test(data)) return null;
	const padded = data.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
	if (padded.length % 4 === 1) return null;
	try {
		const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return null;
	}
}

/** Run `bytes` through a compression or decompression stream, stopping once more than `limit` bytes have come out. */
async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array | "too-large"> {
	const writer = stream.writable.getWriter();
	// Written and closed without awaiting: the reader below drains the other
	// end, and a write awaited first would wait on a reader that has not begun.
	void writer.write(bytes as Uint8Array<ArrayBuffer>).catch(() => undefined);
	void writer.close().catch(() => undefined);
	const reader = stream.readable.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > limit) {
			await reader.cancel().catch(() => undefined);
			return "too-large";
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

/**
 * The fragment for a link that opens `text`: `#doc=v1.` and the compressed
 * text in base64url.
 *
 * @throws Error for a document longer than {@link MAX_SHARED_CHARACTERS}, which
 * a link will not carry.
 */
export async function makeShareFragment(text: string): Promise<string> {
	if (text.length > MAX_SHARED_CHARACTERS) {
		throw new Error(`This document is ${text.length.toLocaleString("en")} characters, and a link carries at most ${MAX_SHARED_CHARACTERS.toLocaleString("en")}.`);
	}
	const encoded = new TextEncoder().encode(text);
	const compressed = await transform(encoded, new CompressionStream("deflate-raw"), Number.MAX_SAFE_INTEGER);
	if (compressed === "too-large") throw new Error("The document could not be compressed.");
	return SHARE_PREFIX + toBase64Url(compressed);
}

/**
 * Read a link's fragment back into a document. Answers `{ ok: false,
 * message }`, never a throw, for a fragment that is not a playground link or
 * cannot be read, and a document read from one always has live data off.
 *
 * @param fragment - `location.hash`, with its `#`.
 */
export async function readShareFragment(fragment: string): Promise<SharedDocument> {
	if (!fragment.startsWith(SHARE_PREFIX)) {
		return { ok: false, message: "This link does not carry a playground document." };
	}
	if (fragment.length > MAX_FRAGMENT_LENGTH) {
		return { ok: false, message: `This link is ${fragment.length.toLocaleString("en")} characters long, past the ${MAX_FRAGMENT_LENGTH.toLocaleString("en")} the playground reads, so it was not opened.` };
	}
	const bytes = fromBase64Url(fragment.slice(SHARE_PREFIX.length));
	if (bytes === null || bytes.length === 0) {
		return { ok: false, message: "This link's document is damaged: it is not in the form a playground link uses. Ask for the link again." };
	}
	let inflated: Uint8Array | "too-large";
	try {
		// UTF-8 is at most four bytes a character, so a document within the
		// limit never decompresses past four times it.
		inflated = await transform(bytes, new DecompressionStream("deflate-raw"), MAX_SHARED_CHARACTERS * 4);
	} catch {
		return { ok: false, message: "This link's document is damaged and could not be unpacked. Ask for the link again." };
	}
	if (inflated === "too-large") {
		return { ok: false, message: `This link's document unpacks to more than the ${MAX_SHARED_CHARACTERS.toLocaleString("en")} characters the playground opens, so it was not opened.` };
	}
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(inflated);
	} catch {
		return { ok: false, message: "This link's document is not text, so it was not opened." };
	}
	if (text.length > MAX_SHARED_CHARACTERS) {
		return { ok: false, message: `This link's document is longer than the ${MAX_SHARED_CHARACTERS.toLocaleString("en")} characters the playground opens, so it was not opened.` };
	}
	return { ok: true, text, liveData: false };
}
