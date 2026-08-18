import { Injectable, NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  actorId?: string;
}

/**
 * One correlation id per causal chain, propagated across HTTP calls and onto
 * every event published while handling the request. Without it, debugging a
 * five-service call path means grepping five log streams by timestamp.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export const CORRELATION_HEADER = 'x-correlation-id';

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function correlationId(): string {
  return storage.getStore()?.correlationId ?? randomUUID();
}

/** Runs `fn` inside a fresh context — used by message consumers and cron jobs. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function setContextActor(actorId: string, tenantId?: string): void {
  const store = storage.getStore();
  if (store) {
    store.actorId = actorId;
    if (tenantId) store.tenantId = tenantId;
  }
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(CORRELATION_HEADER);
    // Only accept a client-supplied id if it is a well-formed UUID; otherwise
    // a caller could poison the log index with arbitrary strings.
    const id = incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID();
    res.setHeader(CORRELATION_HEADER, id);
    storage.run({ correlationId: id }, () => next());
  }
}
