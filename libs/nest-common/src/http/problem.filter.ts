import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PROBLEM_TYPES, type Problem } from '@ssm/contracts';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { correlationId } from './correlation.middleware.js';

/**
 * Turns every thrown thing into RFC 9457 `application/problem+json`.
 *
 * The rule that matters: an unexpected error never leaks its message to the
 * client. It is logged in full with the correlation id, and the caller gets a
 * generic 500 plus that id — enough for support to find the log line, nothing
 * for an attacker to enumerate.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = correlationId();

    const problem = this.toProblem(exception, req, traceId);

    // 5xx only. A 503 from a readiness probe is expected traffic, not an
    // incident, and logging every one of them at error level buries the real
    // failures under kubelet noise.
    if (problem.status >= 500 && !req.url.startsWith('/health')) {
      this.log.error(
        { traceId, path: req.url, method: req.method, err: exception },
        `Unhandled error on ${req.method} ${req.url}`,
      );
    } else if (problem.status !== 404 && problem.status < 500) {
      this.log.warn({ traceId, path: req.url, status: problem.status }, problem.title);
    }

    res.status(problem.status).type('application/problem+json').send(problem);
  }

  private toProblem(exception: unknown, req: Request, traceId: string): Problem {
    if (exception instanceof ZodError) {
      const errors: Record<string, string[]> = {};
      for (const issue of exception.issues) {
        const key = issue.path.length ? issue.path.join('.') : '_';
        (errors[key] ??= []).push(issue.message);
      }
      return {
        type: PROBLEM_TYPES.validation,
        title: 'Request validation failed',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        detail: `${exception.issues.length} field(s) rejected.`,
        instance: req.url,
        traceId,
        errors,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>)?.message as string | undefined);

      // Anything else the thrower attached is carried through. RFC 9457 allows
      // extension members, and this is what lets /health/ready say which
      // dependency is down instead of just failing.
      const extensions =
        typeof body === 'object' && body !== null
          ? Object.fromEntries(
              Object.entries(body as Record<string, unknown>).filter(
                ([k]) => !['statusCode', 'message', 'error'].includes(k),
              ),
            )
          : {};

      return {
        ...extensions,
        type: TYPE_BY_STATUS[status] ?? 'about:blank',
        title: exception.name.replace(/Exception$/, '') || 'Error',
        status,
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
        instance: req.url,
        traceId,
      };
    }

    return {
      type: PROBLEM_TYPES.internal,
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      // Deliberately generic. The real message is in the log under `traceId`.
      detail: 'An unexpected error occurred. Quote the traceId when reporting this.',
      instance: req.url,
      traceId,
    };
  }
}

const TYPE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: PROBLEM_TYPES.validation,
  [HttpStatus.UNAUTHORIZED]: PROBLEM_TYPES.unauthenticated,
  [HttpStatus.FORBIDDEN]: PROBLEM_TYPES.forbidden,
  [HttpStatus.NOT_FOUND]: PROBLEM_TYPES.notFound,
  [HttpStatus.CONFLICT]: PROBLEM_TYPES.conflict,
  [HttpStatus.UNPROCESSABLE_ENTITY]: PROBLEM_TYPES.validation,
  [HttpStatus.TOO_MANY_REQUESTS]: PROBLEM_TYPES.rateLimited,
  [HttpStatus.BAD_GATEWAY]: PROBLEM_TYPES.upstream,
  [HttpStatus.SERVICE_UNAVAILABLE]: PROBLEM_TYPES.upstream,
};
