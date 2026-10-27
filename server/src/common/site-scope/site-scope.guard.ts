import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { resolveSite } from '../config'
import { SiteScopeService } from './site-scope.service'
import type { SiteAwareRequest } from '../request'

@Injectable()
export class SiteScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly siteScope: SiteScopeService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true
    const req = context.switchToHttp().getRequest<SiteAwareRequest>()
    const forwardedHost = req.headers['x-forwarded-host']
    const rawHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost ?? req.headers.host
    const site = resolveSite(this.siteScope.raw, rawHost)
    req.site = site
    req.siteHost = site.id
    req.clientIp = clientIpOf(req)
    req.currentUser = null
    return true
  }
}

function clientIpOf(req: SiteAwareRequest): string {
  const forwardedFor = req.headers['x-forwarded-for']
  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  if (value) return value.split(',')[0].trim()
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown'
}