import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { FunctionCallParselet } from "./parselets/FunctionCallParselet";
import { FactorialParselet, ChooseParselet } from "./parselets/FactorialAndChooseParselets";

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
};
