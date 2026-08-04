import { describe, expect, test } from "@jest/globals";
import { LanguageService } from "@solve-js/language/LanguageService";
import { newTrackedEngine } from "@tools/trackedEngine";
import { HIGHLIGHT_LEGEND } from "../../../../docs/src/data/highlightLegend";

/**
 * Holds the landing page's highlighting key to what the language service does.
 *
 * The key is a promise: this fragment is that colour, in your editor. It was
 * wrong twice while it was hand-written markup, and both times the wrong entry
 * was completely believable. `[1, 2]` looks like a vector and is categorised as
 * punctuation and numbers; `friday` looks like a date and is categorised as
 * nothing at all.
 *
 * Running the real service is the only way to know. Everything here goes
 * through `getSemanticTokens`, which is the same call an editor integration
 * makes, so a swatch that stops being true fails a test rather than teaching a
 * reader a colour that never appears.
 */

describe("landing page highlighting key", () => {
  for (const entry of HIGHLIGHT_LEGEND) {
    test(`${entry.token} is ${entry.category}`, () => {
      const engine = newTrackedEngine();
      const language = new LanguageService(engine);
      const tokens = language.getSemanticTokens(entry.line, 1);

      const match = tokens.find(
        (token) => entry.line.slice(token.from, token.to) === entry.token,
      );

      expect(match).toBeDefined();
      expect(match?.category).toBe(entry.category);
    });
  }

  test("every entry names a distinct category", () => {
    const categories = HIGHLIGHT_LEGEND.map((entry) => entry.category);
    expect(new Set(categories).size).toBe(categories.length);
  });
});
