import { createZodDto } from 'nestjs-zod';
import { loginRequestSchema, sessionSchema, tokenPairSchema } from '@ssm/contracts';

export class LoginDto extends createZodDto(loginRequestSchema) {}
export class TokenPairDto extends createZodDto(tokenPairSchema.omit({ refreshToken: true })) {}
export class SessionDto extends createZodDto(sessionSchema) {}
