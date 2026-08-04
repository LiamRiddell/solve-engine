/**
 * The worked examples behind the animated pipeline walkthrough.
 *
 * Every token, opcode, constant and answer here came out of the real engine
 * rather than out of someone's head, and `PipelineWalkthrough.spec.ts` in the
 * engine package re-derives all of it on every test run. If a change to the
 * lexer, the normaliser or the compiler moves any of it, that test goes red and
 * this file is what has to be updated. A hand-drawn diagram of a pipeline is
 * worth very little the day it stops matching the pipeline.
 *
 * The walkthrough deliberately does not import the engine. An architecture page
 * is often the third or fourth tab someone has open while reading, and the
 * runtime is a megabyte. Verified data plus a failing test is the same
 * guarantee for none of the weight.
 */

/** A token as the lexer produced it, with the span of source it came from. */
export interface LexedToken {
  /** The token's own text. */
  text: string;
  /** The lexer's type name, shown as the chip's label. */
  type: string;
  /**
   * The semantic category the language service assigns this type.
   *
   * Present so the chips are coloured by the same palette an editor gets from
   * `tokenClassName`, rather than being a monochrome diagram of a thing whose
   * whole point is that it is coloured. Verified against the engine's own
   * `getTokenCategory`, so a recategorised token type fails a test.
   */
  category: string;
  /** Start offset into the expression, inclusive. */
  from: number;
  /** End offset into the expression, exclusive. */
  to: number;
}

/** A token after normalisation, tagged with what the rewrite did to it. */
export interface NormalisedToken {
  text: string;
  type: string;
  /** As on {@link LexedToken}. */
  category: string;
  /**
   * `fused` covers tokens the normaliser merged into one, `inserted` covers an
   * operator it made explicit, and `null` means the token came through
   * untouched. Drives both the animation and the colour.
   */
  change: "fused" | "inserted" | null;
}

/** One node of the tree the parser built. */
export interface TreeNode {
  /** What the node is, usually an operator or a literal. */
  label: string;
  /** A short line about why the parser produced it, shown under the label. */
  detail?: string;
  children?: TreeNode[];
}

/** One compiled instruction, as it appears in the listing. */
export interface Instruction {
  op: string;
  /** Present only for instructions that carry an operand byte. */
  operand?: number;
  /** Which pool the operand indexes, for the line that links them. */
  pool?: "numbers" | "strings" | "variables";
  comment: string;
}

/** One turn of the dispatch loop, with the stack it left behind. */
export interface VmStep {
  /** The instruction being executed, as displayed. */
  instruction: string;
  /** The whole stack after this instruction, bottom first. */
  stack: string[];
  note: string;
}

/** One expression, walked from text to answer. */
export interface PipelineExample {
  id: string;
  expression: string;
  /** The one-line reason this example is in the set. */
  blurb: string;
  lexed: LexedToken[];
  normalised: NormalisedToken[];
  /** What the normaliser did, in a sentence. */
  normalisationNote: string;
  tree: TreeNode;
  parseNote: string;
  code: Instruction[];
  numbers: number[];
  strings: string[];
  compileNote: string;
  steps: VmStep[];
  /** The answer, formatted the way the engine formats it. */
  answer: string;
}

/** The five stages, in order, as the rail presents them. */
export const STAGES = [
  {
    id: "lexing",
    title: "Lexing",
    summary: "Characters become tokens.",
  },
  {
    id: "normalisation",
    title: "Normalisation",
    summary: "The token stream is rewritten.",
  },
  {
    id: "parsing",
    title: "Parsing",
    summary: "Tokens become a structure, by precedence.",
  },
  {
    id: "compilation",
    title: "Compilation",
    summary: "The structure becomes a flat program.",
  },
  {
    id: "execution",
    title: "Execution",
    summary: "The program runs on a stack machine.",
  },
] as const;

export const EXAMPLES: PipelineExample[] = [
  {
    id: "half-of",
    expression: "half of 250",
    blurb: "Two words the parser never learns, fused into one token.",
    lexed: [
      { text: "half", type: "IDENT", from: 0, to: 4 , category: "variable" },
      { text: "of", type: "OF", from: 5, to: 7 , category: "keyword" },
      { text: "250", type: "NUMBER", from: 8, to: 11 , category: "number" },
    ],
    normalised: [
      { text: "half of", type: "HALF_OF", change: "fused" , category: "keyword" },
      { text: "250", type: "NUMBER", change: null , category: "number" },
    ],
    normalisationNote:
      "Phrase fusion collapses IDENT and OF into a single HALF_OF token. Neither half nor of is a reserved word, so both stay ordinary English anywhere else on the line.",
    tree: {
      label: "÷",
      detail: "what the half of parselet emits",
      children: [
        { label: "250", detail: "the operand it was given" },
        { label: "2", detail: "supplied by the parselet, not by the text" },
      ],
    },
    parseNote:
      "There is no half node in the tree. The parselet registered for HALF_OF turns the token straight into a division, which is why nothing downstream has to know the word exists.",
    code: [
      { op: "PUSH_NUMBER", operand: 0, pool: "numbers", comment: "250" },
      { op: "PUSH_NUMBER", operand: 1, pool: "numbers", comment: "2" },
      { op: "DIV", comment: "divide" },
    ],
    numbers: [250, 2],
    strings: [],
    compileNote:
      "Three instructions and a two-entry number pool. The 2 is a constant the parselet contributed, sitting in the pool beside the one the reader typed.",
    steps: [
      { instruction: "PUSH_NUMBER 0", stack: ["250"], note: "Constant 0 pushed." },
      { instruction: "PUSH_NUMBER 1", stack: ["250", "2"], note: "Constant 1 pushed." },
      { instruction: "DIV", stack: ["125"], note: "Both operands popped, the result pushed." },
    ],
    answer: "125",
  },
  {
    id: "implicit-multiply",
    expression: "5(3 + 2)",
    blurb: "A multiplication nobody typed, made explicit before parsing.",
    lexed: [
      { text: "5", type: "NUMBER", from: 0, to: 1 , category: "number" },
      { text: "(", type: "LPAREN", from: 1, to: 2 , category: "punctuation" },
      { text: "3", type: "NUMBER", from: 2, to: 3 , category: "number" },
      { text: "+", type: "PLUS", from: 4, to: 5 , category: "operator" },
      { text: "2", type: "NUMBER", from: 6, to: 7 , category: "number" },
      { text: ")", type: "RPAREN", from: 7, to: 8 , category: "punctuation" },
    ],
    normalised: [
      { text: "5", type: "NUMBER", change: null , category: "number" },
      { text: "*", type: "STAR", change: "inserted" , category: "operator" },
      { text: "(", type: "LPAREN", change: null , category: "punctuation" },
      { text: "3", type: "NUMBER", change: null , category: "number" },
      { text: "+", type: "PLUS", change: null , category: "operator" },
      { text: "2", type: "NUMBER", change: null , category: "number" },
      { text: ")", type: "RPAREN", change: null , category: "punctuation" },
    ],
    normalisationNote:
      "A number followed by an opening parenthesis implies a multiplication. Inserting the operator here means the parser needs no special case for it, and the same rule covers 2x and 50%.",
    tree: {
      label: "×",
      children: [
        { label: "5" },
        {
          label: "+",
          detail: "inside parentheses, so it binds first",
          children: [{ label: "3" }, { label: "2" }],
        },
      ],
    },
    parseNote:
      "Precedence climbing puts the addition below the multiplication because the parentheses raise its binding power. No grammar was consulted, only each token's parselet and its binding power.",
    code: [
      { op: "PUSH_NUMBER", operand: 0, pool: "numbers", comment: "5" },
      { op: "PUSH_NUMBER", operand: 1, pool: "numbers", comment: "3" },
      { op: "PUSH_NUMBER", operand: 2, pool: "numbers", comment: "2" },
      { op: "ADD", comment: "3 + 2" },
      { op: "MUL", comment: "5 × the result" },
    ],
    numbers: [5, 3, 2],
    strings: [],
    compileNote:
      "The parentheses are gone. Order of evaluation is now carried by the order of the instructions, which is the whole point of compiling rather than walking a tree.",
    steps: [
      { instruction: "PUSH_NUMBER 0", stack: ["5"], note: "Constant 0 pushed." },
      { instruction: "PUSH_NUMBER 1", stack: ["5", "3"], note: "Constant 1 pushed." },
      { instruction: "PUSH_NUMBER 2", stack: ["5", "3", "2"], note: "Constant 2 pushed." },
      { instruction: "ADD", stack: ["5", "5"], note: "3 and 2 popped, 5 pushed." },
      { instruction: "MUL", stack: ["25"], note: "Both popped, 25 pushed." },
    ],
    answer: "25",
  },
  {
    id: "units",
    expression: "5km + 3km",
    blurb: "Units ride along on the stack instead of being stripped off.",
    lexed: [
      { text: "5", type: "NUMBER", from: 0, to: 1 , category: "number" },
      { text: "km", type: "UNIT", from: 1, to: 3 , category: "unit" },
      { text: "+", type: "PLUS", from: 4, to: 5 , category: "operator" },
      { text: "3", type: "NUMBER", from: 6, to: 7 , category: "number" },
      { text: "km", type: "UNIT", from: 7, to: 9 , category: "unit" },
    ],
    normalised: [
      { text: "5", type: "NUMBER", change: null , category: "number" },
      { text: "km", type: "UNIT", change: null , category: "unit" },
      { text: "+", type: "PLUS", change: null , category: "operator" },
      { text: "3", type: "NUMBER", change: null , category: "number" },
      { text: "km", type: "UNIT", change: null , category: "unit" },
    ],
    normalisationNote:
      "Nothing to rewrite. The lexer already recognised km as a unit rather than as an identifier, because packages contribute their vocabulary to it directly.",
    tree: {
      label: "+",
      children: [
        { label: "5 km", detail: "a value with a unit, not a number" },
        { label: "3 km" },
      ],
    },
    parseNote:
      "Each operand is a unit-carrying value. Addition does not know what a kilometre is; it asks the unit system to reconcile the two operands before it adds them.",
    code: [
      { op: "PUSH_NUMBER", operand: 0, pool: "numbers", comment: "5" },
      { op: "PUSH_STRING", operand: 0, pool: "strings", comment: "km" },
      { op: "UOM_CONVERT", comment: "attach the unit" },
      { op: "PUSH_NUMBER", operand: 1, pool: "numbers", comment: "3" },
      { op: "PUSH_STRING", operand: 0, pool: "strings", comment: "km" },
      { op: "UOM_CONVERT", comment: "attach the unit" },
      { op: "ADD", comment: "add two unit values" },
    ],
    numbers: [5, 3],
    strings: ["km"],
    compileNote:
      "Two number constants and one string constant. Both kilometres index the same pool entry, because the pool is deduplicated at compile time.",
    steps: [
      { instruction: "PUSH_NUMBER 0", stack: ["5"], note: "Constant 0 pushed." },
      { instruction: "PUSH_STRING 0", stack: ["5", "km"], note: "The unit name pushed." },
      { instruction: "UOM_CONVERT", stack: ["5 km"], note: "One value now, carrying its unit." },
      { instruction: "PUSH_NUMBER 1", stack: ["5 km", "3"], note: "Constant 1 pushed." },
      { instruction: "PUSH_STRING 0", stack: ["5 km", "3", "km"], note: "Same pool entry as before." },
      { instruction: "UOM_CONVERT", stack: ["5 km", "3 km"], note: "Second value built." },
      { instruction: "ADD", stack: ["8 km"], note: "Units reconciled, then added." },
    ],
    answer: "8 km",
  },
];
