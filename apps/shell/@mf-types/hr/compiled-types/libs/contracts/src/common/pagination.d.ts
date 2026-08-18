import { z } from 'zod';
/**
 * Keyset pagination, not offset. `cursor` is an opaque, server-signed encoding
 * of the last row's sort key — clients must never construct or parse it.
 */
export declare const pageQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
    sort: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    sort?: string | undefined;
    cursor?: string | undefined;
}, {
    sort?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
}>;
export type PageQuery = z.infer<typeof pageQuerySchema>;
export interface Page<T> {
    items: T[];
    /** Cursor to pass as `cursor` for the next page; null when exhausted. */
    nextCursor: string | null;
    /** Total is optional — counting is expensive and most callers do not need it. */
    total?: number;
}
export declare const pageSchema: <T extends z.ZodTypeAny>(item: T) => z.ZodObject<{
    items: z.ZodArray<T, "many">;
    nextCursor: z.ZodNullable<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    items: T["_output"][];
    nextCursor: string | null;
    total?: number | undefined;
}, {
    items: T["_input"][];
    nextCursor: string | null;
    total?: number | undefined;
}>;
//# sourceMappingURL=pagination.d.ts.map