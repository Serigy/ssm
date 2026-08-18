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
export type HealthCheck = (ref: ModuleRef) => Promise<boolean>;

export interface HealthModuleOptions {
  /** Dependency probes, keyed by the name shown in /health/ready. */
  checks?: Record<string, HealthCheck>;
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
