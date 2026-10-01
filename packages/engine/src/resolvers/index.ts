export { ResolverRegistry } from "./ResolverRegistry";
export type { AsyncCheckResult, IAsyncResolver } from "./ResolverRegistry";
// The helper the async data source guide builds a resolver with: a fetch, a
// cache, a concurrency limit and a timeout behind one call (#779).
export { createQueryResolver } from "./QueryResolver";
export type { QueryResolverOptions, QueryResolverPackage } from "./QueryResolver";
