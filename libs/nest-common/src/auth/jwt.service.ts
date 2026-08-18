import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { jwtClaimsSchema, type JwtClaims } from '@ssm/contracts';
import { createPrivateKey, createPublicKey, randomUUID, type KeyObject } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { SecretsService } from '../secrets/secrets.service.js';
import type { AppConfig } from '../config/app-config.js';

/**
 * RS256, not HS256, on purpose: only identity-svc holds the private key, so a
 * compromise of any other service cannot mint tokens. Every other service gets
 * the public key and can verify offline — no network call on the hot path.
 */
@Injectable()
export class JwtService implements OnModuleInit {
  private readonly log = new Logger(JwtService.name);
  private privateKey?: KeyObject;
  private publicKey!: KeyObject;

  constructor(
    private readonly secrets: SecretsService,
    private readonly cfg: AppConfig,
  ) {}

  onModuleInit(): void {
    const pub = this.secrets.get('jwt_public_key.pem');
    if (!pub) {
      throw new Error(
        'Secret "jwt_public_key.pem" is missing — every service needs it to verify tokens. ' +
          "Run 'make secrets'.",
      );
    }
    this.publicKey = createPublicKey(pub);

    // Only the issuer holds this. Its absence elsewhere is correct, not an error.
    const priv = this.secrets.get('jwt_private_key.pem');
    if (priv) {
      this.privateKey = createPrivateKey(priv);
      this.log.log('Signing key loaded — this service can issue tokens.');
    }
  }

  canSign(): boolean {
    return this.privateKey !== undefined;
  }

  async sign(
    claims: Omit<JwtClaims, 'iss' | 'aud' | 'iat' | 'exp' | 'jti'>,
    ttlSeconds = this.cfg.ACCESS_TOKEN_TTL_SECONDS,
  ): Promise<string> {
    if (!this.privateKey) {
      throw new Error('This service holds no signing key; only identity-svc may issue tokens.');
    }
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.cfg.JWT_ISSUER)
      .setAudience(this.cfg.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .setJti(randomUUID())
      .sign(this.privateKey);
  }

  /** Verifies signature, issuer, audience and expiry, then validates the shape. */
  async verify(token: string): Promise<JwtClaims> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      issuer: this.cfg.JWT_ISSUER,
      audience: this.cfg.JWT_AUDIENCE,
      algorithms: ['RS256'],
      clockTolerance: 5,
    });
    return jwtClaimsSchema.parse(payload);
  }
}
