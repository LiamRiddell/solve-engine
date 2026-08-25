import { PrefixParselet, InfixParselet } from "@solve-js/parser/Parselet";
import { Value } from "@solve-js/vm/Value";
import type { LexerVocabulary } from "@solve-js/lexer/ExpressionLexer";
import type { IAsyncResolver } from "@solve-js/resolvers/ResolverRegistry";
import type { NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import type { TokenCategory } from "@solve-js/language/TokenCategory";
import type { CompletionItem } from "@solve-js/language/LanguageService";
import type { PluginFunctionHandler } from "@solve-js/engine/EngineContext";

/**
 * Package descriptor for registering a complete provider with the engine.
 *
 * A package bundles all the pieces needed for a domain-specific provider:
 * lexer plugins for custom token recognition, parselets for Pratt parsing,
 * plugin functions dispatched via CALL_PLUGIN bytecode, and optional async
 * resolvers for data that loads asynchronously (e.g., exchange rates, game
 * prices).
 *
 * @example
 * ```typescript
 * const myPackage: IEnginePackage = {
 *   name: "MyProvider",
 *   lexerVocabulary: myLexerVocabulary,
 *   prefixParselets: { MY_FUNC: new MyParselet() },
 *   pluginFunctions: { myFn: myHandler },
 *   asyncResolvers: [myAsyncResolver],
 * };
 * const engine = createEngine({ extraPackages: [myPackage] });
 * ```
 */
export interface IEnginePackage {
  /** Human-readable name for debugging and error attribution. */
  name: string;
  /**
   * Semver range of `solve-engine` versions this package is compatible with
   * (e.g. `"^0.1.0"`, `">=0.1.0 <0.3.0"`), checked against the engine's own
   * running version ({@link ENGINE_VERSION}, `@solve-js/constants/version`)
   * via `checkEngineVersionCompatibility()`/`assertEngineVersionCompatible()`
   * (`@solve-js/api/EngineVersionCompatibility`) at registration time.
   *
   * Optional, omitted means "no declared constraint," so every package
   * that predates this field (all built-ins, `examples/osrs`) keeps
   * registering exactly as before.
   *
   * Unlike every other compatibility signal in this codebase (e.g.
   * `checkPackageCompatibility()`'s sibling-package collision warnings,
   * which always log and proceed. See `api/PackageCompatibility.ts`), a
   * declared `engineVersion` range the running engine does NOT satisfy is
   * a deliberate, hard REJECTION: `registerPackage()` throws rather than
   * warning. See `ARCHITECTURE.md` §5.3.
   */
  engineVersion?: string;
  /** Optional lexer vocabulary (keywords/operators/units) for recognizing custom tokens (e.g., `GE`, `£`). */
  lexerVocabulary?: LexerVocabulary;
  /** Prefix parselets for this package's custom functions/operators, keyed by token type. */
  prefixParselets?: Record<string, PrefixParselet>;
  /** Infix parselets for this package's custom binary operators, keyed by token type. */
  infixParselets?: Record<string, InfixParselet>;
  /**
   * Functions dispatched via `CALL_PLUGIN` bytecode, keyed by a package-local
   * name. The engine assigns each a registry index at registration, so a
   * parselet emits the call by that name (`builder.emitPluginCall(name, argCount)`)
   * and never touches a numeric index. Two packages naming a function the same
   * is a `checkPackageCompatibility` warning, the later registration wins.
   *
   * The handler's optional second parameter, `context`, carries the current
   * line's `LineExecutionContext` (line number, and, only inside a real
   * document, never `evaluateExpression()`'s single-shot path, closures for
   * reading another line's cached result). Every handler that doesn't need
   * cross-line data can ignore it entirely.
   *
   * @example
   * ```ts
   * // In a parselet's parse(): builder.emitPluginCall("myFn", argCount);
   * pluginFunctions: { myFn: myHandler }
   * ```
   */
  pluginFunctions?: Record<string, PluginFunctionHandler>;
  /**
   * Async resolvers for this package's domain.
   * When set, the ExpressionEngine runs preflight() before VM execution
   * for each resolver. If async data is needed, a Pending result is
   * returned immediately and the line re-evaluates when the data resolves.
   *
   * Each resolver must have a unique `namespace`, the ResolverRegistry
   * is keyed by namespace. Multiple resolvers let a package handle
   * distinct async operations (e.g., `fetch`, `wait`, `poll`) in
   * separate, focused classes rather than one monolithic preflight().
   */
  asyncResolvers?: IAsyncResolver[];
  /**
   * Multi-word phrases to fuse into single compound tokens.
   * Each key is a space-separated phrase (e.g., "to the power of"),
   * each value is the target token type after fusion (e.g., "CARET").
   *
   * Registered into the engine's {@link PhraseTrie} for single-pass
   * O(depth) matching, no separate rule scanning per phrase.
   *
   * @example
   * ```ts
   * phrases: {
   *   "to the power of": "CARET",
   *   "abyssal whip": "ITEM",
   * }
   * ```
   */
  phrases?: Record<string, string>;
  /**
   * Normalizer rules for post-lexer token transformation.
   * Applied by the TokenNormalizer between lexing and parsing.
   * For phrase fusion, prefer the declarative {@link phrases} field
   * which uses the faster PhraseTrie. Use this for non-phrase rules
   * like implicit operator insertion.
   */
  normalizerRules?: NormalizerRule[];
  /**
   * Semantic highlight categories for this package's custom token types
   * (introduced via {@link lexerVocabulary} or {@link normalizerRules}), the
   * plugin-facing half of solve-js's editor-agnostic language service (see
   * `language/TokenCategoryMap.ts`). Without an entry here, a package's
   * custom tokens (e.g. a game-item name fused from several identifiers)
   * are still lexed and parsed correctly, but render with no highlight
   * category in any editor integration.
   *
   * @example
   * ```ts
   * tokenCategories: { MY_KEYWORD: "keyword", MY_ITEM: "my-plugin-item" }
   * ```
   */
  tokenCategories?: Record<string, TokenCategory>;
  /**
   * Completion candidates for this package, the plugin-facing half of
   * solve-js's editor-agnostic completions API
   * (`LanguageService.getCompletions()`). A package's single-word
   * keywords (via {@link lexerVocabulary}) already flow into completions
   * automatically; this field is for candidates that AREN'T lexer
   * keywords, such as a vocabulary of item/entity names. A plain,
   * pre-built list, not a callback, completion candidate lists are
   * meant to be cheap and static within one engine configuration.
   *
   * @example
   * ```ts
   * completionItems: [{ label: "Abyssal whip", category: "my-plugin-item", detail: "Item" }]
   * ```
   */
  completionItems?: CompletionItem[];
  /**
   * Custom `as <name>` converters, the extension point for the
   * Converters package's general `<expr> as <type>` grammar (e.g.
   * `50% as decimal`, `255 as hex`). The built-in converter names
   * (`percent`, `decimal`, `hex`, `fraction`, `multiplier`, `sci`,
   * `binary`, `octal`, ...) dispatch to dedicated fast opcodes; anything
   * else, including any name a third-party package registers here
   * resolves through `OpCode.CALL_AS_CONVERTER` against
   * `vm/VMBuiltins.ts`'s `asConverterRegistry` at runtime. No lexer
   * keyword registration is needed for a custom name: the AS parselet
   * accepts any bare-word token after "as" and reads its raw text.
   *
   * Each handler is a pure, synchronous `(value: Value) => Value`, for
   * async conversions (e.g. a live currency-style lookup), use
   * {@link asyncResolvers} instead.
   *
   * @example
   * ```ts
   * asConverters: { roman: (v) => stringValue(toRomanNumeral(v.toNumber())) }
   * ```
   */
  asConverters?: Record<string, (value: Value) => Value>;
}

