export {
	LanguageService,
	type SemanticToken,
	type LanguageServiceOptions,
	type CompletionItem,
} from "./LanguageService";
export {
	DocumentReferences,
	applyTextEdits,
	type DocumentPosition,
	type LineSpan,
	type VariableReference,
	type TextEdit,
	type VariableHover,
	type LineResults,
	type RenameRefusalCode,
	type RenameResult,
	type LineShift,
	type DeletedLineReference,
	type LineShiftResult,
} from "./DocumentReferences";
export type { TokenCategory } from "./TokenCategory";
export {
	getTokenCategory,
	registerTokenCategory,
	unregisterTokenCategory,
	UNCATEGORIZED_TOKEN_TYPES,
} from "./TokenCategoryMap";
export { tokenClassName, createTokenClassName, DEFAULT_TOKEN_CLASS_PREFIX } from "./tokenClassName";
export { completionItemToOption } from "./adapters/codemirror";
