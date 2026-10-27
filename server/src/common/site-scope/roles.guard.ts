import { SetMetadata, type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ForbiddenException } from '@nestjs/common'
import type { SiteAwareRequest } from '../request'
import type { Role, SessionUser } from '../../shared'

export const ROLES_KEY = 'hmp:roles'

/**
 * 限制接口访问角色。
 *
 * 注意：@AllowManage() 只负责「是不是外网站点」，不校验角色。
 * 涉及管理数据（统计、审计、用户、配置、全量页面列表）的接口必须叠加 @Roles()。
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true

    const user = context.switchToHttp().getRequest<SiteAwareRequest>().currentUser as SessionUser | null
    if (!user) throw new ForbiddenException('需要登录后才能访问')
    if (!required.includes(user.role)) {
      throw new ForbiddenException('当前账号权限不足，无法访问该功能')
    }
    return true
  }
}
