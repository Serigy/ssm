import { DynamicModule, Module } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { HealthController } from './health.controller.js';

/**
 * A dependency probe.
 *
 * It receives the ModuleRef rather than closing over an imported singleton,
 * because the thing worth probing is the connection Nest actually opened. The
 * obvious-looking alternative — importing the exported DataSource and checking
 * `isInitialized` — probes a *second*, never-initialised instance and reports
 * "down" forever, which is a readiness check that can only ever be wrong.
 */
export type HealthCheckFn = (ref: ModuleRef) => Promise<boolean>;

export interface HealthCheckSpec {
  check: HealthCheckFn;
  /**
   * Whether this dependency being down means the service cannot serve.
   *
   * This distinction is load-bearing, and getting it wrong is worse than having
   * no probe at all. Readiness failing removes the pod from the Service — so if
   * a dependency that every replica shares is marked critical, its outage takes
   * the entire platform offline rather than degrading it.
   *
   *   critical: the primary datastore. No database, no answers.
   *
   *   non-critical: RabbitMQ and Redis. Requests are still served correctly
   *     without them — events accumulate in the transactional outbox and the
   *     relay drains them later; rate limiting falls back to per-replica
   *     counting and revocation waits for the token TTL. Marking either
   *     critical would convert a degradation into an outage, which is precisely
   *     what the fail-open design in docs/adr/0010 exists to avoid.
   */
  critical: boolean;
}

export type HealthCheck = HealthCheckFn | HealthCheckSpec;

export interface HealthModuleOptions {
  /** Dependency probes, keyed by the name shown in /health/ready. */
  checks?: Record<string, HealthCheck>;
}

/** A bare function defaults to critical — the safe reading of an unqualified probe. */
export function normaliseCheck(check: HealthCheck): HealthCheckSpec {
  return typeof check === 'function' ? { check, critical: true } : check;
}

@Module({})
export class HealthModule {
  static forRoot(options: HealthModuleOptions = {}): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [{ provide: 'HEALTH_CHECKS', useValue: options.checks ?? {} }],
    };
  }
}
