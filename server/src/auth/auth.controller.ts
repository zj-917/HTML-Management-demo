import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import type { CookieOptions, Response } from 'express'
import { AuthService, SESSION_COOKIE } from './auth.service'
import { ChangePasswordDto, LoginDto, UpdateProfileDto } from './dto'
import { AuditService } from '../audit/audit.service'
import { AllowAnonymous, ClientIp, CurrentSite, CurrentUser, UserAgent } from '../common/site-scope/decorators'
import type { SiteAwareRequest } from '../common/request'
import type { SiteDefinition } from '../common/config'
import type { AuthSiteInfo, SessionUser } from '../shared'
import { AuditAction } from '../shared'

const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000

function sessionCookieOptions(): CookieOptions {
  // 生产默认 Secure。但首次上线往往还没有证书，浏览器会直接丢弃
  // 「HTTP 响应里下发的 Secure Cookie」——表现为「提示登录成功，下一个请求又变未登录」。
  // 所以留一个显式降级开关：COOKIE_SECURE=false。
  // 配好 TLS 后必须改回 true（deploy.sh 每次部署都会提示）。
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  }
}

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Get('site')
  @AllowAnonymous()
  siteInfo(@CurrentSite() site: SiteDefinition, @Req() req: SiteAwareRequest): AuthSiteInfo {
    return {
      siteId: site.id,
      scope: site.scope,
      anonymous: site.anonymous,
      host: req.siteHost ?? site.id,
    }
  }

  @Post('login')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: SiteAwareRequest,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ): Promise<{ user: SessionUser }> {
    const { token, user } = await this.authService.login(dto.email, dto.password)
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions())
    await this.audit.log({
      userId: user.id,
      action: AuditAction.Login,
      ip,
      ua,
      detail: { siteId: req.site?.id },
    })
    return { user }
  }

  /**
   * 修改本人密码。必须已登录；旧密码错误回 400（不是 401，避免前端把人踹去登录页）。
   * 审计只记动作与 IP，绝不记任何密码内容。
   *
   * 改密会自增 sessionVersion（其它设备的旧 cookie 立即失效），
   * 因此这里顺手换发一个新 cookie，让当前这端不被自己踢下线。
   */
  @Post('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: SessionUser | null,
    @Res({ passthrough: true }) res: Response,
    @ClientIp() ip: string,
  ): Promise<{ ok: true }> {
    if (!user) throw new UnauthorizedException('未登录')
    const { token } = await this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    )
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions())
    await this.audit.log({
      userId: user.id,
      action: AuditAction.ChangePassword,
      ip,
      detail: { userId: user.id },
    })
    return { ok: true }
  }

  /**
   * 修改本人资料。目前只开放姓名。
   *
   * 姓名是审计日志里的操作人显示名，但日志写入时已快照 actorName，
   * 所以本人改名不会改写历史留痕（见 docs/方案.md「账号字段矩阵」）。
   */
  @Patch('profile')
  async updateProfile(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: SessionUser | null,
    @ClientIp() ip: string,
  ): Promise<{ user: SessionUser }> {
    if (!user) throw new UnauthorizedException('未登录')
    const { user: updated, previousName } = await this.authService.updateProfile(user.id, dto.name)
    if (updated.name !== previousName) {
      await this.audit.log({
        userId: user.id,
        action: AuditAction.ProfileUpdate,
        ip,
        detail: { name: { from: previousName, to: updated.name } },
      })
    }
    return { user: updated }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: SessionUser | null,
    @ClientIp() ip: string,
  ): Promise<{ ok: true }> {
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    await this.audit.log({ userId: user?.id ?? null, action: AuditAction.Logout, ip })
    return { ok: true }
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser | null): { user: SessionUser } {
    if (!user) throw new UnauthorizedException('未登录')
    return { user }
  }
}