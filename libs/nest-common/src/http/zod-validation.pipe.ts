import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodObject } from 'zod';
import type { ZodTypeAny, z } from 'zod';

/**
 * Validates and *narrows* a payload with a Zod schema from @ssm/contracts.
 *
 * Zod is the single source of truth rather than class-validator decorators,
 * because the same schema is reused by the micro-frontends for client-side
 * validation and by the consumers for event payloads. One definition, three users.
 *
 *   @Post()
 *   create(@Body(new ZodValidationPipe(createInvoiceSchema)) dto: CreateInvoice) {}
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.infer<T> {
    // Bodies are validated strictly: an unknown property is almost always a
    // typo or a client built against a different version, and silently dropping
    // it turns a broken request into a no-op that nobody notices.
    //
    // Query strings are not. They legitimately pick up extra parameters —
    // cache-busters, analytics tags, things proxies add — and rejecting a
    // request because of `?_=1712345` would be hostile for no benefit. Zod's
    // default behaviour of stripping unknown keys is right there.
    const schema =
      metadata.type === 'body' && this.schema instanceof ZodObject
        ? this.schema.strict()
        : this.schema;

    // Throws ZodError, which ProblemDetailsFilter renders as a 422 with
    // per-field messages.
    return schema.parse(value) as z.infer<T>;
  }
}

/** Terser form for the common case. */
export const zodPipe = <T extends ZodTypeAny>(schema: T) => new ZodValidationPipe(schema);
