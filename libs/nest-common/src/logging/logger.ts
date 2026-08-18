import { LoggerService } from '@nestjs/common';
import pino, { Logger as PinoLogger } from 'pino';
import { SecretsService } from '../secrets/secrets.service.js';
import type { AppConfig } from '../config/app-config.js';

/**
 * Keys whose values are stripped before anything reaches a log sink. This is a
 * denylist on top of SecretsService.redact()'s value-based scrub — belt and braces,
 * because a leaked credential in a log aggregator is effectively permanent.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwd',
  '*.secret',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.privateKey',
  '*.nationalId',
  '*.bankAccount',
  '*.salary',
  'body.password',
  'body.token',
];

export function createPinoLogger(cfg: AppConfig): PinoLogger {
  return pino({
    name: cfg.SERVICE_NAME,
    level: cfg.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '«redacted»' },
    base: { service: cfg.SERVICE_NAME, env: cfg.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    // Structured JSON in every environment except a developer's terminal.
    transport: cfg.LOG_PRETTY
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
      : undefined,
  });
}

/**
 * Adapts pino to Nest's LoggerService so framework logs and application logs
 * land in the same stream with the same shape.
 */
type Level = 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal';

export class SsmLogger implements LoggerService {
  constructor(private readonly pinoLogger: PinoLogger) {}

  private scrub(message: unknown): string {
    return typeof message === 'string' ? SecretsService.redact(message) : String(message);
  }

  /**
   * Nest's LoggerService is (message, ...optionalParams), but pino's is
   * (mergeObject, message) — and application code naturally reaches for the
   * pino shape when it has structured context to attach.
   *
   * Supporting both is not indulgence: getting it wrong logs the literal string
   * "[object Object]" and buries the real message in the `stack` field, which
   * is exactly the log line you cannot afford to lose during an incident.
   */
  private emit(level: Level, message: unknown, rest: unknown[]): void {
    if (message !== null && typeof message === 'object' && !(message instanceof Error)) {
      const text = typeof rest[0] === 'string' ? this.scrub(rest[0]) : undefined;
      this.pinoLogger[level](message as Record<string, unknown>, text);
      return;
    }

    // Nest shape. For error(), the first extra is the stack and the second the
    // context; for the rest, the first extra is the context.
    const [first, second] = rest as [string?, string?];
    const meta =
      level === 'error'
        ? { stack: first ? SecretsService.redact(first) : undefined, context: second }
        : { context: first };

    this.pinoLogger[level](meta, this.scrub(message));
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.emit('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('trace', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    this.emit('fatal', message, rest);
  }
}
