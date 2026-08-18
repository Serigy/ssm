import { describe, expect, it } from 'vitest';
import { IdempotencyService } from './idempotency.service.js';

describe('IdempotencyService.fingerprint', () => {
  it('é estável para a mesma requisição', () => {
    const a = IdempotencyService.fingerprint('POST', '/pay', { amount: 100 });
    const b = IdempotencyService.fingerprint('POST', '/pay', { amount: 100 });
    expect(a).toBe(b);
  });

  it('muda quando o corpo muda', () => {
    // This is what stops a client reusing a key for a different payload from
    // receiving the previous response as if it answered the new request.
    const a = IdempotencyService.fingerprint('POST', '/pay', { amount: 100 });
    const b = IdempotencyService.fingerprint('POST', '/pay', { amount: 500 });
    expect(a).not.toBe(b);
  });

  it('muda quando o caminho muda', () => {
    // Same key on a different resource is a different operation, even with an
    // identical body — voiding invoice A must not replay the void of invoice B.
    const a = IdempotencyService.fingerprint('POST', '/invoices/a/void', { reason: 'x' });
    const b = IdempotencyService.fingerprint('POST', '/invoices/b/void', { reason: 'x' });
    expect(a).not.toBe(b);
  });

  it('trata corpo ausente sem quebrar', () => {
    expect(() => IdempotencyService.fingerprint('POST', '/x', undefined)).not.toThrow();
    expect(IdempotencyService.fingerprint('POST', '/x', undefined)).toBe(
      IdempotencyService.fingerprint('POST', '/x', null),
    );
  });
});
