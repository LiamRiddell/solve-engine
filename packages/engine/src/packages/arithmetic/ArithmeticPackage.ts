import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { OpCode } from "@solve-js/parser/OpCode";
import { NumberParselet } from "./parselets/NumberParselet";
import { PrefixOpParselet } from "./parselets/PrefixOpParselet";
import { BinaryOpParselet } from "./parselets/BinaryOpParselet";
import { GroupParselet } from "./parselets/GroupParselet";
import { ConstantParselet } from "./parselets/ConstantParselet";
import { largeNumberSuffixNormalizerRule } from "./normalizer/LargeNumberSuffixNormalizerRule";

/** Core arithmetic: numbers, `()` grouping, `pi`/`e` constants, `+ - * / % ^`, bitwise `<< >> & | ^`, and their `*_by` word forms. */
export const ARITHMETIC_PACKAGE: IEnginePackage = {
  name: "solve-arithmetic",
  prefixParselets: [
    { tokenType: "NUMBER", parselet: new NumberParselet() },
    { tokenType: "LPAREN", parselet: new GroupParselet() },
    { tokenType: "PI", parselet: new ConstantParselet() },
    { tokenType: "E", parselet: new ConstantParselet() },
    { tokenType: "PLUS", parselet: new PrefixOpParselet(OpCode.POS) },
    { tokenType: "MINUS", parselet: new PrefixOpParselet(OpCode.NEG) },
    // `~x`. The opcode and the lexer token both already existed; without this
    // registration the token reached the parser and stopped there, so `~5`
    // reported "no prefix parselet found" rather than -6.
    { tokenType: "BIT_NOT", parselet: new PrefixOpParselet(OpCode.BIT_NOT) },
  ],
  infixParselets: [
    { tokenType: "PLUS", parselet: new BinaryOpParselet(BindingPower.Sum, OpCode.ADD) },
    // The word "and", which adds exactly like "+" but at a looser binding
    // power so a phrase parselet can use it as a list separator. See
    // Token.ts's AND_CONJ comment for why it is not simply mapped to PLUS.
    { tokenType: "AND_CONJ", parselet: new BinaryOpParselet(BindingPower.Conjunction, OpCode.ADD) },
    { tokenType: "MINUS", parselet: new BinaryOpParselet(BindingPower.Sum, OpCode.SUB) },
    { tokenType: "STAR", parselet: new BinaryOpParselet(BindingPower.Product, OpCode.MUL) },
    { tokenType: "SLASH", parselet: new BinaryOpParselet(BindingPower.Product, OpCode.DIV) },
    { tokenType: "MOD", parselet: new BinaryOpParselet(BindingPower.Product, OpCode.MOD) },
    { tokenType: "CARET", parselet: new BinaryOpParselet(BindingPower.Exponent, OpCode.EXP) },
    { tokenType: "TIMES_BY", parselet: new BinaryOpParselet(BindingPower.Product, OpCode.MUL) },
    { tokenType: "MULTIPLY_BY", parselet: new BinaryOpParselet(BindingPower.Product, OpCode.MUL) },
    { tokenType: "DIVIDE_BY", parselet: new BinaryOpParselet(BindingPower.Product, OpCode.DIV) },
    { tokenType: "LSHIFT", parselet: new BinaryOpParselet(BindingPower.Sum, OpCode.LSHIFT) },
    { tokenType: "RSHIFT", parselet: new BinaryOpParselet(BindingPower.Sum, OpCode.RSHIFT) },
    { tokenType: "URSHIFT", parselet: new BinaryOpParselet(BindingPower.Sum, OpCode.URSHIFT) },
    { tokenType: "BIT_AND", parselet: new BinaryOpParselet(BindingPower.Product, OpCode.BIT_AND) },
    { tokenType: "BIT_OR", parselet: new BinaryOpParselet(BindingPower.Sum, OpCode.BIT_OR) },
    { tokenType: "BIT_XOR", parselet: new BinaryOpParselet(BindingPower.BitwiseXor, OpCode.BIT_XOR) },
  ],
  normalizerRules: [largeNumberSuffixNormalizerRule()],
};
