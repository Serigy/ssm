import { z } from 'zod';
/**
 * RFC 9457 Problem Details. Every non-2xx response in SSM has this shape,
 * with `application/problem+json`. `traceId` ties the response to the log line
 * and to the OpenTelemetry span.
 */
export declare const problemSchema: z.ZodObject<{
    type: z.ZodDefault<z.ZodString>;
    title: z.ZodString;
    status: z.ZodNumber;
    detail: z.ZodOptional<z.ZodString>;
    instance: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
    /** Field-level validation failures, keyed by JSON pointer. */
    errors: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
    type: string;
    status: number;
    title: string;
    detail?: string | undefined;
    instance?: string | undefined;
    traceId?: string | undefined;
    errors?: Record<string, string[]> | undefined;
}, {
    status: number;
    title: string;
    type?: string | undefined;
    detail?: string | undefined;
    instance?: string | undefined;
    traceId?: string | undefined;
    errors?: Record<string, string[]> | undefined;
}>;
export type Problem = z.infer<typeof problemSchema>;
export declare const PROBLEM_TYPES: {
    readonly validation: "https://ssm.serigy.io/problems/validation-failed";
    readonly notFound: "https://ssm.serigy.io/problems/not-found";
    readonly conflict: "https://ssm.serigy.io/problems/conflict";
    readonly forbidden: "https://ssm.serigy.io/problems/forbidden";
    readonly unauthenticated: "https://ssm.serigy.io/problems/unauthenticated";
    readonly rateLimited: "https://ssm.serigy.io/problems/rate-limited";
    readonly upstream: "https://ssm.serigy.io/problems/upstream-unavailable";
    readonly internal: "https://ssm.serigy.io/problems/internal-error";
};
//# sourceMappingURL=problem.d.ts.map