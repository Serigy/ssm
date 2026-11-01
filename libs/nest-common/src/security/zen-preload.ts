/**
 * Side-effect-only entrypoint. Must be the FIRST import of every service's
 * main.ts, before @nestjs/core and before any database driver, so that Zen can
 * patch the module loader.
 *
 *     import '@ssm/nest-common/zen-preload';
 *     import { NestFactory } from '@nestjs/core';
 */
const enabled = process.env.ZEN_ENABLED !== 'false';

if (enabled) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@aikidosec/firewall');
    if (process.env.ZEN_BLOCKING === 'true') process.env.AIKIDO_BLOCK = 'true';
  } catch {
    // Reported properly by initZen() once the Nest logger exists.
  }
}
export {};
