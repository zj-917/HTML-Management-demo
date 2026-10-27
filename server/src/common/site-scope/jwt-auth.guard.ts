import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthService } from '../../auth/auth.service'
import { ALLOW_ANONYMOUS_KEY } from './decorators'
import type { SiteAwareRequest } from '../request'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true
    const req = context.switchToHttp().getRequest<SiteAwareRequest>()
    const token = this.authService.extractToken(req)
    const user = token ? await this.authService.verifyToken(token) : null
    req.currentUser = user

    const allowAnonymous = this.reflector.getAllAndOverride<boolean>(ALLOW_ANONYMOUS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!user) {
      if (allowAnonymous) return true
      if (req.site?.anonymous) return true
      throw new UnauthorizedException('登录状态已失效，请重新登录')
    }
    return true
  }
}