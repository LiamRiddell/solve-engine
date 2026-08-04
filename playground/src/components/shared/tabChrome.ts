/**
 * The class strings every diagnostic tab builds its frame from.
 *
 * Constants rather than a wrapper component, because the tabs do not share a
 * shape so much as a rhythm: some scroll themselves, some pin a header and
 * scroll underneath it, and forcing both through one component would have meant
 * a prop for every difference. What they should share is the padding, the gap
 * between blocks and the scroll behaviour, and those are exactly what had
 * drifted. Half the tabs had `space-y-3` and half did not, so two tabs showing
 * the same kind of content had different vertical rhythm depending on which
 * neighbour each was copied from.
 */

/** Root of a tab that pins a header and scrolls its body underneath. */
export const TAB_ROOT = "flex min-h-0 flex-1 flex-col"

/** The scrolling body. Same padding and same gap between blocks, everywhere. */
export const TAB_BODY = "flex-1 space-y-3 overflow-y-auto p-4"

/**
 * A body whose content is a full-bleed table or list that draws its own edges.
 * Keeps the scroll behaviour and drops the padding, rather than each such tab
 * inventing its own combination.
 */
export const TAB_BODY_FLUSH = "flex-1 overflow-y-auto"
