import manifest from "../package.json";

/** This package's version, from its package.json, for `solve --version`. */
export const CLI_VERSION: string = manifest.version;
