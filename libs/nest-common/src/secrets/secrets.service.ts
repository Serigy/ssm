import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Reads file-based secrets. One file per secret, the file's whole content is
 * the value. This is the same interface a Kubernetes Secret volume presents,
 * so there is no dev-only code path — see secrets/README.md.
 *
 * Resolution order for a secret named `foo`:
 *   1. env SSM_SECRET_FOO         (CI escape hatch)
 *   2. env FOO_FILE -> read path  (Docker Swarm convention)
 *   3. ${SSM_SECRETS_DIR}/foo     (the normal path)
 *
 * Values are cached after first read with a short TTL so that rotating a file
 * takes effect without a restart, without hammering the filesystem either.
 */
@Injectable()
export class SecretsService implements OnModuleInit {
  private readonly log = new Logger(SecretsService.name);
  private readonly dir: string;
  private readonly cache = new Map<string, { value: string; readAt: number; mtimeMs: number }>();
  private readonly ttlMs = 30_000;

  /** Every value ever handed out, so the logger can redact them. */
  private static readonly seen = new Set<string>();

  constructor(dir?: string) {
    this.dir = resolve(dir ?? process.env.SSM_SECRETS_DIR ?? '/run/secrets');
  }

  onModuleInit(): void {
    if (!existsSync(this.dir)) {
      this.log.warn(
        `Secrets directory ${this.dir} does not exist. ` +
          `Set SSM_SECRETS_DIR or run 'make secrets'.`,
      );
    } else {
      this.log.log(`Secrets directory: ${this.dir}`);
    }
  }

  /** Returns the secret, or undefined when it is absent or empty. */
  get(name: string): string | undefined {
    const key = name.toLowerCase();

    const inline = process.env[`SSM_SECRET_${key.toUpperCase()}`];
    if (inline) return SecretsService.remember(inline);

    const fileEnv = process.env[`${key.toUpperCase()}_FILE`];
    const path = fileEnv ? resolve(fileEnv) : join(this.dir, key);

    let mtimeMs = 0;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      return undefined;
    }

    const hit = this.cache.get(path);
    if (hit && hit.mtimeMs === mtimeMs && Date.now() - hit.readAt < this.ttlMs) {
      return hit.value || undefined;
    }

    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }

    // A trailing newline is almost always an artefact of how the file was
    // written, never part of the secret. PEM blocks keep their internal ones.
    const value = raw.replace(/\r?\n$/, '');
    this.cache.set(path, { value, readAt: Date.now(), mtimeMs });
    return value ? SecretsService.remember(value) : undefined;
  }

  /** Returns the secret or throws — use for anything the service cannot run without. */
  require(name: string): string {
    const value = this.get(name);
    if (!value) {
      throw new Error(
        `Required secret "${name}" is missing or empty. Expected ${join(this.dir, name)} ` +
          `(or env SSM_SECRET_${name.toUpperCase()}). Run 'make secrets'.`,
      );
    }
    return value;
  }

  /** True when the secret exists and is non-empty. */
  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /** Fail fast at boot rather than on the first request that needs the value. */
  requireAll(names: readonly string[]): void {
    const missing = names.filter((n) => !this.has(n));
    if (missing.length) {
      throw new Error(
        `Missing required secrets: ${missing.join(', ')}. ` +
          `Expected files in ${this.dir}. Run 'make secrets'.`,
      );
    }
  }

  private static remember(value: string): string {
    if (value.length >= 8) SecretsService.seen.add(value);
    return value;
  }

  /** Replaces every known secret value in a string with ***. Used by the logger. */
  static redact(input: string): string {
    let out = input;
    for (const secret of SecretsService.seen) {
      if (out.includes(secret)) out = out.split(secret).join('«redacted»');
    }
    return out;
  }
}
