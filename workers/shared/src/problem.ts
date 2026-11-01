import type { Context } from 'hono';
import { PROBLEM_TYPES, type Problem } from '@ssm/contracts';
import { captureUnexpected } from './monitoring.js';

/**
 * RFC 9457, igual ao ProblemDetailsFilter do NestJS.
 *
 * O contrato com o cliente não muda ao trocar de plataforma: as mesmas telas
 * consomem estas respostas, e mudar o formato aqui obrigaria a mudar o
 * ApiClient — que não faz parte desta migração.
 */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
  }

  static notFound(detail: string) {
    return new HttpProblem(404, 'NotFound', detail);
  }
  static conflict(detail: string) {
    return new HttpProblem(409, 'Conflict', detail);
  }
  static badRequest(detail: string) {
    return new HttpProblem(400, 'BadRequest', detail);
  }
  static unauthorized(detail = 'Missing bearer token') {
    return new HttpProblem(401, 'Unauthorized', detail);
  }
  static forbidden(detail: string) {
    return new HttpProblem(403, 'Forbidden', detail);
  }
  static unprocessable(detail: string) {
    return new HttpProblem(422, 'UnprocessableEntity', detail);
  }
}

const TYPE_BY_STATUS: Record<number, string> = {
  400: PROBLEM_TYPES.validation,
  401: PROBLEM_TYPES.unauthenticated,
  403: PROBLEM_TYPES.forbidden,
  404: PROBLEM_TYPES.notFound,
  409: PROBLEM_TYPES.conflict,
  422: PROBLEM_TYPES.validation,
  429: PROBLEM_TYPES.rateLimited,
};

export function problemResponse(
  c: Context,
  err: unknown,
  traceId: string,
): Response {
  if (err instanceof HttpProblem) {
    const body: Problem = {
      ...err.extensions,
      type: TYPE_BY_STATUS[err.status] ?? 'about:blank',
      title: err.title,
      status: err.status,
      detail: err.detail,
      instance: new URL(c.req.url).pathname,
      traceId,
    };
    return c.json(body, err.status as never, {
      'Content-Type': 'application/problem+json',
    });
  }

  // Erro inesperado nunca vaza a mensagem: ela vai para o log com o traceId, e
  // o chamador recebe o id. Mesma regra do filtro do NestJS, mesma razão.
  console.error(JSON.stringify({ traceId, path: new URL(c.req.url).pathname, err: String(err) }));
  captureUnexpected(err, traceId);
  const body: Problem = {
    type: PROBLEM_TYPES.internal,
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred. Quote the traceId when reporting this.',
    instance: new URL(c.req.url).pathname,
    traceId,
  };
  return c.json(body, 500, { 'Content-Type': 'application/problem+json' });
}
