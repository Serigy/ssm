import { useCallback, useEffect, useRef, useState } from 'react';
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
export function useQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Guards against a resolved response from a superseded request overwriting a
  // newer one, and against setting state after unmount.
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (mine === generation.current) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (mine === generation.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => {
      // Bumping the generation invalidates any in-flight response.
      generation.current++;
    };
  }, [...deps, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, loading, refetch };
}

/** Companion for mutations: tracks in-flight state and surfaces field errors. */
export function useMutation<TInput, TOutput>(
  mutator: (input: TInput) => Promise<TOutput>,
): {
  mutate: (input: TInput) => Promise<TOutput | null>;
  saving: boolean;
  error: ApiError | Error | null;
  fieldErrors: Record<string, string[]>;
} {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const mutate = useCallback(
    async (input: TInput): Promise<TOutput | null> => {
      setSaving(true);
      setError(null);
      try {
        return await mutator(input);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [mutator],
  );

  return {
    mutate,
    saving,
    error,
    fieldErrors: error instanceof ApiError ? error.fieldErrors : {},
  };
}
