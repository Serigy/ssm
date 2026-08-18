/**
 * Aikido Zen — the in-app firewall.
 *
 * Zen instruments the Node runtime (SQL drivers, HTTP client, fs, child_process)
 * and blocks injection attempts using the *actual* user input that reached the
 * sink, rather than pattern-matching the request up front like a WAF. That is why
 * it must be loaded BEFORE any other module: it patches require/import hooks.
 *
 * Every service therefore starts with, as the very first line of main.ts:
 *
 *     import '@ssm/nest-common/zen-preload';
 *
 * This module holds the parts that run after Nest is up (identifying the user,
 * so Zen can rate-limit and block per-actor rather than per-IP).
 */
import { Logger } from '@nestjs/common';
import type { AppConfig } from '../config/app-config.js';

const log = new Logger('Zen');

type ZenModule = {
  setUser?: (user: { id: string; name?: string }) => void;
  addExpressMiddleware?: unknown;
};

let zen: ZenModule | undefined;

/**
 * Loads Zen if it is installed. Kept optional on purpose: a missing security
 * dependency must not stop the service from booting in a developer sandbox,
 * but it MUST be loud, and `assertZenInProduction` turns it into a hard failure
 * where it matters.
 */
export function loadZen(): ZenModule | undefined {
  if (zen) return zen;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    zen = require('@aikidosec/firewall') as ZenModule;
    return zen;
  } catch {
    return undefined;
  }
}

export function initZen(cfg: AppConfig): void {
  if (!cfg.ZEN_ENABLED) {
    log.warn('Zen is disabled by ZEN_ENABLED=false — do not ship this to production.');
    return;
  }
  const mod = loadZen();
  if (!mod) {
    log.warn(
      '@aikidosec/firewall is not installed; the in-app firewall is inactive. ' +
        'Run `pnpm add @aikidosec/firewall -w` to enable it.',
    );
    return;
  }
  // Zen loads its hooks but stays dormant unless it is given a token (to report
  // to the Aikido dashboard) or told to block outright. Reporting "active" when
  // it is dormant is worse than saying nothing — it is the kind of log line that
  // convinces a reviewer a control is in place when it is not.
  const armed = Boolean(process.env.AIKIDO_TOKEN) || cfg.ZEN_BLOCKING;
  if (armed) {
    log.log(`Zen armed (blocking=${cfg.ZEN_BLOCKING}).`);
  } else {
    log.warn(
      'Zen is loaded but dormant: no AIKIDO_TOKEN and ZEN_BLOCKING=false, so it ' +
        'will neither block nor report. Fill secrets/local/aikido_token, or set ' +
        'ZEN_BLOCKING=true, to arm it.',
    );
  }
}

/** Refuse to serve production traffic without the firewall. */
export function assertZenInProduction(cfg: AppConfig): void {
  const prod = cfg.NODE_ENV === 'production' || cfg.NODE_ENV === 'staging';
  if (!prod) return;
  if (!cfg.ZEN_ENABLED || !loadZen()) {
    throw new Error(
      'Zen (Aikido in-app firewall) is required in production but is disabled or missing. ' +
        'Set ZEN_ENABLED=true and install @aikidosec/firewall.',
    );
  }
  // Loaded but dormant is not protection. ADR 0009 makes blocking mode the
  // production requirement, so refuse to serve traffic without it.
  if (!cfg.ZEN_BLOCKING) {
    throw new Error(
      'Zen is loaded but ZEN_BLOCKING=false, so it will not block anything. ' +
        'Production runs in blocking mode — see docs/adr/0009-aikido-zen.md.',
    );
  }
}

/**
 * Tells Zen who the authenticated actor is, so its rate limiting and blocking
 * operate per user instead of per source IP (which is useless behind an Ingress).
 * Called by JwtAuthGuard once the token is verified.
 */
export function tagZenUser(id: string, name?: string): void {
  loadZen()?.setUser?.({ id, name });
}
