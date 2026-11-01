import { z } from 'zod';

/**
 * RFC 9457 Problem Details. Every non-2xx response in SSM has this shape,
 * with `application/problem+json`. `traceId` ties the response to the log line
 * and to the OpenTelemetry span.
 */
export const problemSchema = z.object({
  type: z.string().url().default('about:blank'),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  traceId: z.string().optional(),
  /** Field-level validation failures, keyed by JSON pointer. */
  errors: z.record(z.array(z.string())).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export const PROBLEM_TYPES = {
  validation: 'https://ssm.serigy.net/problems/validation-failed',
  notFound: 'https://ssm.serigy.net/problems/not-found',
  conflict: 'https://ssm.serigy.net/problems/conflict',
  forbidden: 'https://ssm.serigy.net/problems/forbidden',
  unauthenticated: 'https://ssm.serigy.net/problems/unauthenticated',
  rateLimited: 'https://ssm.serigy.net/problems/rate-limited',
  upstream: 'https://ssm.serigy.net/problems/upstream-unavailable',
  internal: 'https://ssm.serigy.net/problems/internal-error',
} as const;
