import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { loginRequestSchema, type Session, type TokenPair } from '@ssm/contracts';
import {
  CurrentUser,
  Public,
  ZodValidationPipe,
  type AppConfig,
  type AuthenticatedUser,
} from '@ssm/nest-common';
import { Inject } from '@nestjs/common';
import { CONFIG } from '@ssm/nest-common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto, SessionDto, TokenPairDto } from './auth.dto.js';

/** Name of the HttpOnly cookie carrying the refresh token. */
const REFRESH_COOKIE = 'ssm_rt';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Autentica e devolve o par de tokens',
    description:
      'O access token vai no corpo e deve ficar apenas em memória no cliente. O refresh token ' +
      'vai em cookie HttpOnly/SameSite=Strict e nunca é legível por JavaScript.',
  })
  @ApiResponse({ status: 200, type: TokenPairDto })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas.' })
  @ApiResponse({ status: 403, description: 'Conta bloqueada ou inativa.' })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<TokenPair, 'refreshToken'>> {
    const pair = await this.auth.login(dto, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });
    this.setRefreshCookie(res, pair.refreshToken);

    // The refresh token is deliberately absent from the body: if it never
    // reaches JavaScript, an XSS cannot exfiltrate it.
    const { refreshToken: _omitted, ...rest } = pair;
    return rest;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Renova o access token',
    description:
      'Rotaciona o refresh token. Apresentar um token já usado revoga toda a família de ' +
      'sessões daquele login — é o sinal de que ele vazou.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<TokenPair, 'refreshToken'>> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) {
      this.clearRefreshCookie(res);
      throw new Error('Sessão ausente.');
    }

    const pair = await this.auth.refresh(token, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });
    this.setRefreshCookie(res, pair.refreshToken);
    const { refreshToken: _omitted, ...rest } = pair;
    return rest;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerra a sessão e revoga a família de tokens' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (token) await this.auth.logout(token);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Sessão atual: usuário, permissões e módulos visíveis',
    description: 'O shell usa `modules` para montar a navegação.',
  })
  @ApiResponse({ status: 200, type: SessionDto })
  me(@CurrentUser() user: AuthenticatedUser): Promise<Session> {
    return this.auth.session(user.id);
  }

  // --- cookie handling -----------------------------------------------------

  private setRefreshCookie(res: Response, token: string): void {
    const prod = this.cfg.NODE_ENV === 'production' || this.cfg.NODE_ENV === 'staging';
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      // Strict, not Lax: this cookie is only ever sent by the app's own fetch
      // call to /auth/refresh — no navigation needs to carry it.
      sameSite: 'strict',
      secure: prod,
      // Scoped to the refresh endpoint so it is not attached to every API call.
      path: '/api/identity/v1/auth',
      maxAge: this.cfg.REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/identity/v1/auth' });
  }
}
