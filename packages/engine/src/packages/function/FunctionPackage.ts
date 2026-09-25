import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { FunctionCallParselet } from "./parselets/FunctionCallParselet";
import { FactorialParselet, ChooseParselet } from "./parselets/FactorialAndChooseParselets";
import { explainFunctionCall } from "./FunctionExplain";

/** Built-in function call syntax, e.g. `sqrt(2)`, `sin(pi)`, dispatches recognized function names to CALL_BUILTIN opcodes. */
export const FUNCTION_PACKAGE: IEnginePackage = {
  name: "solve-function",
  prefixParselets: {
    FUNC: new FunctionCallParselet(),
  },
  // `5!` and `10 choose 3`, the mathematical spellings of fact and
  // combination (#514).
  lexerVocabulary: {
    keywords: { choose: "CHOOSE" },
  },
  infixParselets: {
    BANG: new FactorialParselet(),
    CHOOSE: new ChooseParselet(),
  },
  tokenCategories: {
    CHOOSE: "operator",
  },
  // `ln(x)`, the natural logarithm `log` already is (#667). A call word rather
  // than a keyword: `log` is a keyword and cannot be assigned, and `ln` was a
  // free name that documents use (`ln = 4`), so it becomes the call only where
  // `(` follows it.
  callFusions: { ln: "FUNC" },
  completionItems: [{ label: "ln", category: "function", detail: "natural logarithm" }],
  // `sqrt(16)` explains as "the square root of 16". See FunctionExplain.ts.
  explain: explainFunctionCall,
};
