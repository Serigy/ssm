import {
  Controller,
  Get,
  Inject,
  type OnApplicationBootstrap,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiExcludeController } from '@nestjs/swagger';
import { CONFIG, type AppConfig } from '../config/app-config.js';
import { EventBusService } from '../messaging/event-bus.service.js';
import { RedisService } from '../redis/redis.service.js';
import { Public } from '../auth/decorators.js';
import { normaliseCheck, type HealthCheck } from './health.module.js';

/**
 * Three probes with genuinely different meanings — conflating them is how a
 * cluster ends up restarting healthy pods during a broker blip.
 *
 *   /health/live    Is the process wedged? Never checks dependencies. A failure
 *                   here means Kubernetes kills the container, so a Postgres
 *                   outage must NOT be able to trigger it.
 *   /health/ready   Can it serve traffic right now? Checks dependencies.
 *                   A failure pulls the pod out of the Service endpoints.
 *   /health/startup Has it finished booting? Gives slow migrations room before
 *                   the liveness probe starts counting.
 */
@ApiExcludeController()
// VERSION_NEUTRAL: URI versioning would put these at /v1/health/live, but the
// kubelet probes, the Dockerfile HEALTHCHECK and the gateway's status check all
// hardcode /health/*. A probe is an infrastructure contract, not API surface,
// and it must not move when the API version does.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController implements OnApplicationBootstrap {
  private readonly startedAt = Date.now();
  private ready = false;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly bus: EventBusService,
    private readonly redis: RedisService,
    private readonly moduleRef: ModuleRef,
    @Inject('HEALTH_CHECKS') private readonly checks: Record<string, HealthCheck>,
  ) {}

  /**
   * Nest calls this once every module has finished initialising — which is
   * exactly what "startup finished" means. Relying on someone to call
   * markReady() by hand is how a startup probe stays 503 forever and the pod
   * is killed by the kubelet before it ever serves a request.
   */
  onApplicationBootstrap(): void {
    this.ready = true;
  }

  @Public()
  @Get('live')
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000) };
  }

  @Public()
  @Get('startup')
  startup(): { status: string } {
    if (!this.ready) throw new ServiceUnavailableException('starting');
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async readiness(): Promise<Record<string, unknown>> {
    const results: Record<string, 'up' | 'down'> = {};
    const failedCritical: string[] = [];
    const failedOptional: string[] = [];

    const record = (name: string, up: boolean, critical: boolean): void => {
      results[name] = up ? 'up' : 'down';
      if (up) return;
      (critical ? failedCritical : failedOptional).push(name);
    };

    // RabbitMQ and Redis are deliberately NOT critical. A service without them
    // still answers every request correctly: events wait in the outbox, rate
    // limiting counts per replica, revocation waits for the token TTL. Failing
    // readiness on either would pull every replica out of the Service at once
    // and turn a degradation into an outage.
    record('rabbitmq', this.bus.isHealthy(), false);
    record('redis', this.redis.isHealthy(), false);

    for (const [name, spec] of Object.entries(this.checks ?? {})) {
      const { check, critical } = normaliseCheck(spec);
      try {
        record(name, await check(this.moduleRef), critical);
      } catch {
        record(name, false, critical);
      }
    }

    const body = {
      status: failedCritical.length ? 'unavailable' : failedOptional.length ? 'degraded' : 'ok',
      service: this.cfg.SERVICE_NAME,
      version: process.env.SSM_VERSION ?? 'dev',
      checks: results,
      // Named explicitly so an operator reading the probe output knows whether
      // to page someone or to note it and go back to sleep.
      ...(failedOptional.length ? { degraded: failedOptional } : {}),
    };

    // 503 only when the service genuinely cannot serve. "degraded" answers 200,
    // because the pod is still the best thing available and removing it helps
    // nobody. The body carries which dependency is down; a bare 503 would send
    // whoever is on call to guess.
    if (failedCritical.length) throw new ServiceUnavailableException(body);
    return body;
  }
}
