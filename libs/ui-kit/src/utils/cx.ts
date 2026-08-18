/**
 * Joins truthy class names.
 *
 * Accepts `unknown` rather than `string | false | null | undefined` because the
 * common call shape is `cond && 'class'`, and when `cond` is a ReactNode that
 * expression can evaluate to `0`, `0n` or `''` — all falsy, none of them a
 * class name. Filtering on "is a non-empty string" is the predicate that
 * actually describes what belongs in the output.
 */
export function cx(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
