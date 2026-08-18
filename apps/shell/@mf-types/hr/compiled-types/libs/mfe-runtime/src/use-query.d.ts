import { ApiError } from './api-client.js';
export interface QueryState<T> {
    data: T | null;
    error: ApiError | Error | null;
    loading: boolean;
    /** Re-runs the fetch, e.g. after a mutation. */
    refetch: () => void;
}
/**
 * Minimal data-fetching hook.
 *
 * Deliberately not TanStack Query: in a federated app every remote that bundles
 * a cache library ships its own copy unless it is declared a shared singleton,
 * and a *mismatched* singleton is worse than none. This covers fetch, loading,
 * error and refetch, which is the whole of what the module screens need. If a
 * module later needs real caching, add it as a shared singleton in the
 * federation config for all three at once.
 */
export declare function useQuery<T>(fetcher: () => Promise<T>, deps?: unknown[]): QueryState<T>;
/** Companion for mutations: tracks in-flight state and surfaces field errors. */
export declare function useMutation<TInput, TOutput>(mutator: (input: TInput) => Promise<TOutput>): {
    mutate: (input: TInput) => Promise<TOutput | null>;
    saving: boolean;
    error: ApiError | Error | null;
    fieldErrors: Record<string, string[]>;
};
//# sourceMappingURL=use-query.d.ts.map