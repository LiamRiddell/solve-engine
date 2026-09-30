import manifest from "../package.json";

/** This package's version, from its package.json, for `solve-mcp --version` and the MCP handshake. */
export const SERVER_VERSION: string = manifest.version;
