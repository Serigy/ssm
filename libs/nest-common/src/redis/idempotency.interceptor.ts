import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { IDEMPOTENT_KEY } from './decorators.js';
import { IdempotencyService } from './idempotency.service.js';
import type { AuthenticatedUser } from '../auth/decorators.js';

const HEADER = 'idempotency-key';

/**
 * Applies idempotency to routes marked @Idempotent().
 *
 * Opt-in rather than blanket, because the guarantee only makes sense where a
 * repeat would do damage. Creating a draft twice is untidy; recording a payment
 * twice is a reconciliation failure. Marking the routes makes that judgement
 * explicit and reviewable.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly log = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header(HEADER);

    // No key, no guarantee. Rejecting rather than silently proceeding: on these
    // routes the client asked for a promise the server cannot keep blind.
    if (!key) {
      throw new BadRequestException(
        `Esta operação exige o cabeçalho ${HEADER}. Gere um identificador único por ` +
          'tentativa e reenvie-o em cada nova tentativa da mesma operação.',
      );
    }
    if (key.length > 200) {
      throw new BadRequestException(`O cabeçalho ${HEADER} deve ter no máximo 200 caracteres.`);
    }

    const tenantId = req.user?.tenantId ?? 'anonymous';
    const fingerprint = IdempotencyService.fingerprint(req.method, req.path, req.body);
    const lookup = await this.idempotency.claim(tenantId, key, fingerprint);

    switch (lookup.state) {
      case 'replay':
        this.log.log(`Repetindo resposta gravada para ${req.method} ${req.path} (chave ${key}).`);
        res.status(lookup.result.status);
        res.setHeader('Idempotency-Replayed', 'true');
        return of(lookup.result.body);

      case 'in-flight':
        throw new ConflictException(
          'Uma requisição com esta chave de idempotência ainda está em andamento. ' +
            'Aguarde a resposta antes de tentar de novo.',
        );

      case 'conflict':
        throw new UnprocessableEntityException(
          'Esta chave de idempotência já foi usada com um conteúdo diferente. ' +
            'Use uma chave nova para uma operação nova.',
        );

      case 'fresh':
        break;
    }

    return next.handle().pipe(
      tap((body) => {
        void this.idempotency.complete(tenantId, key, {
          status: res.statusCode,
          body,
          fingerprint,
        });
      }),
      catchError((err: unknown) => {
        // Release on failure so the client may retry at once. Storing the error
        // would turn a transient 500 into a permanent one for that key.
        void this.idempotency.release(tenantId, key);
        throw err;
      }),
    );
  }
}
