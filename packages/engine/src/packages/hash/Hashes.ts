/**
 * Digest functions as pure, synchronous, dependency-free implementations: text
 * in, lower-case hex out. No Node `crypto` and no async Web Crypto, so a hash is
 * an ordinary value the VM produces on the spot, the same as every other
 * operation, and it works unchanged in the browser worker.
 *
 * Each algorithm is the textbook construction, and each is pinned in the tests
 * against its canonical vectors (`sha256("")` is `e3b0c442...`, `md5("")` is
 * `d41d8cd9...`, and so on), which is the only real guard against a
 * transcription slip in code like this.
 *
 * Input is measured in UTF-8 bytes, via `TextEncoder`, so a multi-byte
 * character hashes by its actual bytes and matches what `sha256sum` would give
 * the same text in a file.
 */

function bytesOf(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function toHex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

// ── CRC-32 (IEEE, the zip/png checksum) ──────────────────────────────────────

const CRC32_TABLE: Uint32Array = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

/** CRC-32 (IEEE 802.3), the short non-cryptographic checksum, as 8 hex digits. */
export function crc32(text: string): string {
	const bytes = bytesOf(text);
	let crc = 0xffffffff;
	for (const b of bytes) crc = CRC32_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
	crc = (crc ^ 0xffffffff) >>> 0;
	return crc.toString(16).padStart(8, "0");
}

// ── MD5 ──────────────────────────────────────────────────────────────────────

function md5Bytes(input: Uint8Array): Uint8Array {
	const S = [
		7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
		5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
		4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
		6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
	];
	const K = new Int32Array(64);
	for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

	const bitLen = input.length * 8;
	// Pad: a 0x80 byte, zeros, then the 64-bit little-endian length.
	const withPad = new Uint8Array((((input.length + 8) >> 6) + 1) * 64);
	withPad.set(input);
	withPad[input.length] = 0x80;
	const dv = new DataView(withPad.buffer);
	dv.setUint32(withPad.length - 8, bitLen >>> 0, true);
	dv.setUint32(withPad.length - 4, Math.floor(bitLen / 4294967296) >>> 0, true);

	let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
	const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));

	for (let off = 0; off < withPad.length; off += 64) {
		const M = new Int32Array(16);
		for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
		let A = a0, B = b0, C = c0, D = d0;
		for (let i = 0; i < 64; i++) {
			let F: number, g: number;
			if (i < 16) { F = (B & C) | (~B & D); g = i; }
			else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
			else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
			else { F = C ^ (B | ~D); g = (7 * i) % 16; }
			F = (F + A + K[i] + M[g]) | 0;
			A = D; D = C; C = B;
			B = (B + rotl(F, S[i])) | 0;
		}
		a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
	}

	const out = new Uint8Array(16);
	const odv = new DataView(out.buffer);
	odv.setUint32(0, a0 >>> 0, true);
	odv.setUint32(4, b0 >>> 0, true);
	odv.setUint32(8, c0 >>> 0, true);
	odv.setUint32(12, d0 >>> 0, true);
	return out;
}

/** MD5, as 32 hex digits. Not collision-resistant; offered for compatibility. */
export function md5(text: string): string {
	return toHex(md5Bytes(bytesOf(text)));
}

// ── SHA-1 ─────────────────────────────────────────────────────────────────────

function sha1Bytes(input: Uint8Array): Uint8Array {
	const bitLen = input.length * 8;
	const withPad = new Uint8Array((((input.length + 8) >> 6) + 1) * 64);
	withPad.set(input);
	withPad[input.length] = 0x80;
	const dv = new DataView(withPad.buffer);
	// 64-bit big-endian length in the final 8 bytes.
	dv.setUint32(withPad.length - 8, Math.floor(bitLen / 4294967296) >>> 0);
	dv.setUint32(withPad.length - 4, bitLen >>> 0);

	let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
	const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));
	const w = new Int32Array(80);

	for (let off = 0; off < withPad.length; off += 64) {
		for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
		for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
		let a = h0, b = h1, c = h2, d = h3, e = h4;
		for (let i = 0; i < 80; i++) {
			let f: number, k: number;
			if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
			else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
			else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
			else { f = b ^ c ^ d; k = 0xca62c1d6; }
			const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
			e = d; d = c; c = rotl(b, 30); b = a; a = t;
		}
		h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
	}

	const out = new Uint8Array(20);
	const odv = new DataView(out.buffer);
	[h0, h1, h2, h3, h4].forEach((h, i) => odv.setUint32(i * 4, h >>> 0));
	return out;
}

/** SHA-1, as 40 hex digits. Not collision-resistant; offered for compatibility. */
export function sha1(text: string): string {
	return toHex(sha1Bytes(bytesOf(text)));
}

// ── SHA-256 ───────────────────────────────────────────────────────────────────

const SHA256_K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(input: Uint8Array): Uint8Array {
	const bitLen = input.length * 8;
	const withPad = new Uint8Array((((input.length + 8) >> 6) + 1) * 64);
	withPad.set(input);
	withPad[input.length] = 0x80;
	const dv = new DataView(withPad.buffer);
	dv.setUint32(withPad.length - 8, Math.floor(bitLen / 4294967296) >>> 0);
	dv.setUint32(withPad.length - 4, bitLen >>> 0);

	const H = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	]);
	const rotr = (x: number, c: number) => (x >>> c) | (x << (32 - c));
	const w = new Uint32Array(64);

	for (let off = 0; off < withPad.length; off += 64) {
		for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
		}
		let [a, b, c, d, e, f, g, h] = H;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + maj) | 0;
			h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
		}
		H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
		H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
	}

	const out = new Uint8Array(32);
	const odv = new DataView(out.buffer);
	for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i] >>> 0);
	return out;
}

/** SHA-256, as 64 hex digits. */
export function sha256(text: string): string {
	return toHex(sha256Bytes(bytesOf(text)));
}

// ── SHA-512 (64-bit, via BigInt masked to 64 bits) ────────────────────────────

const MASK64 = (1n << 64n) - 1n;
const SHA512_K: bigint[] = [
	0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
	0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
	0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
	0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
	0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
	0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
	0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
	0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
	0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
	0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
	0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
	0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
	0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
	0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
	0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
	0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
	0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
	0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
	0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
	0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

/** SHA-512, as 128 hex digits. */
export function sha512(text: string): string {
	const input = bytesOf(text);
	// Pad to a multiple of 128 bytes; the length is a 128-bit big-endian count,
	// but a JS string never approaches 2^64 bits so the high 64 bits stay zero.
	const blocks = (((input.length + 16) >> 7) + 1) * 128;
	const withPad = new Uint8Array(blocks);
	withPad.set(input);
	withPad[input.length] = 0x80;
	const bitLen = BigInt(input.length) * 8n;
	const dv = new DataView(withPad.buffer);
	dv.setUint32(withPad.length - 4, Number(bitLen & 0xffffffffn));
	dv.setUint32(withPad.length - 8, Number((bitLen >> 32n) & 0xffffffffn));

	const H = [
		0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
		0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
	];
	const rotr = (x: bigint, c: bigint) => ((x >> c) | (x << (64n - c))) & MASK64;
	const w: bigint[] = new Array(80);

	for (let off = 0; off < withPad.length; off += 128) {
		for (let i = 0; i < 16; i++) {
			const hi = BigInt(dv.getUint32(off + i * 8));
			const lo = BigInt(dv.getUint32(off + i * 8 + 4));
			w[i] = (hi << 32n) | lo;
		}
		for (let i = 16; i < 80; i++) {
			const s0 = rotr(w[i - 15], 1n) ^ rotr(w[i - 15], 8n) ^ (w[i - 15] >> 7n);
			const s1 = rotr(w[i - 2], 19n) ^ rotr(w[i - 2], 61n) ^ (w[i - 2] >> 6n);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK64;
		}
		let [a, b, c, d, e, f, g, h] = H;
		for (let i = 0; i < 80; i++) {
			const S1 = rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n);
			const ch = (e & f) ^ (~e & MASK64 & g);
			const t1 = (h + S1 + ch + SHA512_K[i] + w[i]) & MASK64;
			const S0 = rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + maj) & MASK64;
			h = g; g = f; f = e; e = (d + t1) & MASK64; d = c; c = b; b = a; a = (t1 + t2) & MASK64;
		}
		H[0] = (H[0] + a) & MASK64; H[1] = (H[1] + b) & MASK64; H[2] = (H[2] + c) & MASK64; H[3] = (H[3] + d) & MASK64;
		H[4] = (H[4] + e) & MASK64; H[5] = (H[5] + f) & MASK64; H[6] = (H[6] + g) & MASK64; H[7] = (H[7] + h) & MASK64;
	}

	return H.map((h) => h.toString(16).padStart(16, "0")).join("");
}
