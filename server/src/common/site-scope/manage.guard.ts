import { Injectable, NotFoundException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ALLOW_MANAGE_KEY } from './decorators'
import type { SiteAwareRequest } from '../request'

@Injectable()
export class ManageGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true
    const manageEnabled = this.reflector.getAllAndOverride<boolean>(ALLOW_MANAGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!manageEnabled) return true
    const site = context.switchToHttp().getRequest<SiteAwareRequest>().site
    if (site && !site.manageEnabled) {
      throw new NotFoundException()
    }
    return true
  }
}