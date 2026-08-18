import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CONFIG, Public, type AppConfig } from '@ssm/nest-common';
import { PROXY_ROUTES, upstreamFor } from './proxy/routes.js';

@ApiTags('gateway')
@Controller({ path: 'status', version: '1' })
export class StatusController {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Estado agregado dos módulos',
    description:
      'Consulta o /health/ready de cada serviço. É o que o shell usa para avisar que um ' +
      'módulo está fora do ar antes de o usuário clicar nele.',
  })
  async status(): Promise<Record<string, unknown>> {
    const checks = await Promise.all(
      PROXY_ROUTES.map(async (route) => {
        const target = upstreamFor(route);
        try {
          // Short timeout on purpose: this endpoint must stay fast even when a
          // module is hanging, or the status page becomes the next outage.
          const res = await fetch(`${target}/health/ready`, {
            signal: AbortSignal.timeout(2_000),
          });
          return [route.prefix.replace('/api/', ''), res.ok ? 'up' : 'degraded'] as const;
        } catch {
          return [route.prefix.replace('/api/', ''), 'down'] as const;
        }
      }),
    );

    const modules = Object.fromEntries(checks);
    return {
      status: Object.values(modules).every((v) => v === 'up') ? 'ok' : 'degraded',
      env: this.cfg.NODE_ENV,
      version: process.env.SSM_VERSION ?? 'dev',
      modules,
    };
  }
}
