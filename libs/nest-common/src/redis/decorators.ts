import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'ssm:idempotent';
export const CHECK_REVOCATION_KEY = 'ssm:check-revocation';

/**
 * Requires an `Idempotency-Key` header and replays the stored response when the
 * same key comes back.
 *
 * Put it on operations where a repeat causes damage rather than clutter:
 * recording a payment, issuing an invoice, offboarding a person. Not on
 * creating a draft, where a duplicate is visible and deletable.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

/**
 * Forces a token-revocation lookup on a route that would not otherwise get one.
 *
 * Mutating requests are checked anyway. This is for the rare GET that exposes
 * enough that a revoked token must not reach it — an export, a payroll figure.
 */
export const CheckRevocation = () => SetMetadata(CHECK_REVOCATION_KEY, true);
