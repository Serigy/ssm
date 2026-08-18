import { describe, expect, it } from 'vitest';
import { TokenDenylistService } from './token-denylist.service.js';

describe('TokenDenylistService.shouldCheck', () => {
  it('verifica toda requisição que muda estado', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(TokenDenylistService.shouldCheck(method, false), method).toBe(true);
    }
  });

  it('não verifica leitura por padrão', () => {
    // The documented trade: reads are the bulk of the traffic, and a Redis hop
    // in front of every list endpoint would undo the offline authorisation of
    // ADR 0002. The residual risk — a revoked token can still read until its
    // TTL expires — is stated in docs/adr/0010.
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(TokenDenylistService.shouldCheck(method, false), method).toBe(false);
    }
  });

  it('verifica leitura marcada com @CheckRevocation', () => {
    // Used on the endpoints that return payroll data or mint a presigned URL.
    expect(TokenDenylistService.shouldCheck('GET', true)).toBe(true);
  });
});
