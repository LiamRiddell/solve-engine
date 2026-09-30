import { BUILTIN_PACKAGES, createStocksPackage, createKnowledgePackage } from "@solve-js/packages/builtins";
import { OSRS_PACKAGE } from "@solve-js-examples/osrs/OsrsPackage";

/**
 * The packages every playground engine registers.
 *
 * OSRS is an example package (not a built-in) demonstrating the packages
 * framework, registered here so the playground demo keeps working.
 *
 * Stocks and Knowledge are opt-in, pluggable-provider packages (see their own
 * module docs), registered with no `fetchQuote`/`answerQuery` configured so the
 * demo's "stock(AAPL)" and "<query> = ?" gallery examples parse and evaluate to
 * the honest "provider not configured" error, rather than failing at parse time
 * with an unrelated "unknown token" error because the grammar was never
 * registered at all.
 */
export const PLAYGROUND_PACKAGES = [...BUILTIN_PACKAGES, OSRS_PACKAGE, createStocksPackage(), createKnowledgePackage()];
