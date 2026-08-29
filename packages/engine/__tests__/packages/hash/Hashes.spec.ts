/**
 * The hash implementations against their canonical published vectors. This is
 * the real guard on hand-written crypto: an off-by-one in a rotation or a bad
 * constant produces a plausible-looking digest that is simply wrong, and only a
 * known-answer test catches it.
 */
import { describe, expect, test } from "@jest/globals";
import { md5, sha1, sha256, sha512, crc32 } from "@solve-js/packages/hash/Hashes";

describe("md5", () => {
	test.each([
		["", "d41d8cd98f00b204e9800998ecf8427e"],
		["abc", "900150983cd24fb0d6963f7d28e17f72"],
		["hello", "5d41402abc4b2a76b9719d911017c592"],
		["The quick brown fox jumps over the lazy dog", "9e107d9d372bb6826bd81d3542a419d6"],
	])("md5(%p)", (input, expected) => expect(md5(input)).toBe(expected));
});

describe("sha1", () => {
	test.each([
		["", "da39a3ee5e6b4b0d3255bfef95601890afd80709"],
		["abc", "a9993e364706816aba3e25717850c26c9cd0d89d"],
		["hello", "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"],
	])("sha1(%p)", (input, expected) => expect(sha1(input)).toBe(expected));
});

describe("sha256", () => {
	test.each([
		["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
		["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
		["hello", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"],
	])("sha256(%p)", (input, expected) => expect(sha256(input)).toBe(expected));
});

describe("sha512", () => {
	test.each([
		["", "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"],
		["abc", "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"],
	])("sha512(%p)", (input, expected) => expect(sha512(input)).toBe(expected));
});

describe("crc32", () => {
	test.each([
		["", "00000000"],
		["hello", "3610a686"],
		["The quick brown fox jumps over the lazy dog", "414fa339"],
	])("crc32(%p)", (input, expected) => expect(crc32(input)).toBe(expected));
});
