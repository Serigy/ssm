import { z } from 'zod';

/**
 * Keyset pagination, not offset. `cursor` is an opaque, server-signed encoding
 * of the last row's sort key — clients must never construct or parse it.
 */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  cursor: z.string().optional(),
  sort: z.string().optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  /** Cursor to pass as `cursor` for the next page; null when exhausted. */
  nextCursor: string | null;
  /** Total is optional — counting is expensive and most callers do not need it. */
  total?: number;
}

export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().optional(),
  });
