/**
 * A minimal TextMate grammar for Solve expressions.
 *
 * This exists so that ```solve blocks in the documentation are highlighted
 * rather than rendered as plain text. It is deliberately small: it covers the
 * token classes a reader benefits from seeing distinguished, and does not try
 * to mirror the engine's real lexer. The engine remains the only authority on
 * what actually parses, and the documentation test suite is what proves the
 * examples are correct.
 */
const solvePatterns = [
    // Expected-result annotations and ordinary comments share one marker.
    { match: "//.*$", name: "comment.line.double-slash.solve" },

    // Strings, before anything that might match their contents.
    { match: '"[^"]*"', name: "string.quoted.double.solve" },

    // Hexadecimal and binary literals, ahead of the decimal rule so the
    // prefix is not consumed as a bare zero.
    { match: "\\b0[xX][0-9a-fA-F]+\\b", name: "constant.numeric.hex.solve" },
    { match: "\\b0[bB][01]+\\b", name: "constant.numeric.binary.solve" },

    // Numbers, including big-integer and magnitude suffixes.
    { match: "\\b\\d[\\d,]*\\.?\\d*(n|[kKMGT])?\\b", name: "constant.numeric.solve" },

    // Currency symbols read as part of the value.
    { match: "[$£€¥₽₩₹₺₴₪₫₦₱]", name: "constant.numeric.currency.solve" },

    // Phrase keywords. These are not reserved words in the language, but
    // showing them as keywords is what makes a natural-language expression
    // legible at a glance.
    {
      match:
        "\\b(of|to|in|as|at|from|by|between|and|or|not|if|then|else|true|false|is|what|over|on|off|until|since|above|next|last|per)\\b",
      name: "keyword.control.solve",
    },
    {
      match:
        "\\b(now|today|tomorrow|yesterday|prev|line|total|sum|average|median|count|larger|smaller|half|midpoint|clamp|random|increase|decrease|tax|vat|interest|weather|temperature|stock|search|ask|roll|map|reduce|prod|workdays?)\\b",
      name: "support.function.solve",
    },
    {
      match: "\\b(mod|modulo|times|multiply|divide|plus|minus)\\b",
      name: "keyword.operator.word.solve",
    },

    // Function calls, so the name reads differently from a bare variable.
    { match: "\\b([a-zA-Z_][a-zA-Z0-9_]*)(?=\\()", name: "entity.name.function.solve" },

    // Variable references and definitions.
    { match: ":[a-zA-Z_][a-zA-Z0-9_]*", name: "variable.other.solve" },

    // Operators. The arrow is listed first so it is not split into its parts.
    { match: "=>", name: "keyword.operator.symbolic.solve" },
    { match: "(==|!=|<=|>=|&&|\\|\\|)", name: "keyword.operator.comparison.solve" },
    { match: "[+\\-*/^%<>=]", name: "keyword.operator.solve" },

    // Structure.
    { match: "[\\[\\]();,]", name: "punctuation.separator.solve" },
];

export const solveGrammar = {
  name: "solve",
  scopeName: "source.solve",
  patterns: solvePatterns,
};

/**
 * The same grammar under a second language name, for ```solve-doc blocks.
 *
 * A `solve-doc` block is a whole-document example: its lines are evaluated
 * together, not one at a time, which is what the cross-line forms (line
 * references, category tags, table columns, goal seek) need. The distinct
 * language name is what lets `solve-embeds.ts` tell the two apart in the
 * rendered page (one notepad over the whole block, rather than one per
 * blank-line group), while the shared patterns keep the highlighting identical.
 */
export const solveDocGrammar = {
  name: "solve-doc",
  scopeName: "source.solve-doc",
  patterns: solvePatterns,
};
