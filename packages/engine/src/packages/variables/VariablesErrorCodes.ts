/**
 * The codes the variables and global variables packages answer with.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const VariablesErrorCodes = {
	/** A `:` or `global :` not followed by a name, as in `:= 5`. */
	EXPECTED_IDENTIFIER: "EXPECTED_IDENTIFIER",
	/** A name of several words holding a word the engine already reads: an operator spelled as a word, first or last (`take home = 5`, `monthly take = 4000`), or a phrase (`tax on = 5`). The message names the word. */
	NAME_HAS_RESERVED_WORD: "NAME_HAS_RESERVED_WORD",
	/** A name of several words with a quote mark that is not an apostrophe in a word (`Alice‘s food = 3`), or an apostrophe before a word's first letter (`’tis rate = 5`). The message names the mark. */
	NAME_HAS_QUOTE_MARK: "NAME_HAS_QUOTE_MARK",
} as const;
