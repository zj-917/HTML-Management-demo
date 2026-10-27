import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { SiteAwareRequest } from '../request'
import type { SiteDefinition } from '../config'
import type { SessionUser } from '../../shared'

export { Roles, ROLES_KEY } from './roles.guard'

export const ALLOW_ANONYMOUS_KEY = 'hmp:allowAnonymous'
export const ALLOW_MANAGE_KEY = 'hmp:allowManage'

export const AllowAnonymous = () => SetMetadata(ALLOW_ANONYMOUS_KEY, true)
export const AllowManage = () => SetMetadata(ALLOW_MANAGE_KEY, true)

export const CurrentSite = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SiteDefinition => {
    return ctx.switchToHttp().getRequest<SiteAwareRequest>().site
  },
)

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser | null => {
    return ctx.switchToHttp().getRequest<SiteAwareRequest>().currentUser ?? null
  },
)

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest<SiteAwareRequest>().clientIp ?? 'unknown'
})

export const UserAgent = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<SiteAwareRequest>()
  return String(req.headers['user-agent'] ?? '')
})