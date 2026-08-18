import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Refresh tokens are stored hashed and rotated on every use.
 *
 * Rotation plus reuse detection is what makes a stolen refresh token
 * survivable: when an old token is presented again, the whole family is
 * revoked, because either the attacker or the legitimate user is replaying —
 * and there is no way to tell which, so both are logged out.
 */
@Entity({ name: 'refresh_tokens' })
@Index('refresh_tokens_user_idx', ['userId'])
@Index('refresh_tokens_family_idx', ['familyId'])
export class RefreshTokenEntity {
  /** SHA-256 of the token. The token itself is never stored. */
  @PrimaryColumn({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** All tokens descending from one login share this. Revoked as a unit. */
  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  /** Recorded for the audit trail, not for authorisation decisions. */
  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
