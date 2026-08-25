import { uomValue, type Value } from "@solve-js/vm/Value";
import { OSRS_ITEM_NAME_TO_ID, osrsItemQueryKey } from "./OsrsItemVocabulary";
import { pluginFunctionRegistry, pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { OSRS_GAME_ITEM_QUALIFIED } from "./OsrsParselet";
import { getActiveQueryClient } from "@solve-js/services/DataQueryService";

/**
 * OSRS game item resolver — registered in pluginFunctionRegistry at the index
 * the engine assigns this package's `gameitem` function, and dispatched via the
 * CALL_PLUGIN opcode.
 *
 * Reads item prices from TanStack Query cache (stored by OsrsAsyncResolver
 * after the bulk fetch completes). Returns synchronously — the preflight
 * check ensures prices are cached before the VM runs.
 */
export function resolveGameItem(args: Value[]): Value {
  const itemName = args[0].value as string;
  const itemId = OSRS_ITEM_NAME_TO_ID.get(itemName.toLowerCase());

  if (itemId !== undefined) {
    const cached = getActiveQueryClient()?.getQueryData(osrsItemQueryKey(itemId));
    if (cached !== undefined) return cached as Value;
  }

  return uomValue(0, "gp");
}

export function registerOsrsPluginFunction(): void {
  pluginFunctionRegistry[pluginFunctionIndexFor(OSRS_GAME_ITEM_QUALIFIED)] = resolveGameItem;
}

export function unregisterOsrsPluginFunction(): void {
  delete pluginFunctionRegistry[pluginFunctionIndexFor(OSRS_GAME_ITEM_QUALIFIED)];
}
