import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

// Starlight stopped registering the docs collection implicitly, so it has to be
// declared here. Without it every page still builds but the sidebar cannot
// resolve a single slug, which surfaces as "the slug specified in the Starlight
// sidebar config does not exist" rather than as a missing-collection error.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
