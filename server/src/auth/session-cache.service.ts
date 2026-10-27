import { Injectable } from '@nestjs/common'
import type { SessionUser } from '../shared'

interface CacheEntry {
  user: SessionUser
  sessionVersion: number
  expiresAt: number
}

/**
 * 已登录用户信息的进程内缓存。
 *
 * 缓存不能脱离 sessionVersion 使用：JWT 里带 `sv`，命中缓存时也要比对，
 * 否则「账号被停用 / 密码被重置」后，另一个持有旧 token 的请求可能靠
 * 别人刚写热的缓存继续通过校验（最长 60 秒的授权滞后窗口）。
 *
 * 任何用户字段变更（角色、部门、姓名、启停、重置密码）都必须 invalidate，
 * 停用 / 重置密码还要同时自增 User.sessionVersion 才能真正踢掉旧会话。
 */
@Injectable()
export class SessionCacheService {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly ttlMs = 60_000

  get(userId: string, sessionVersion: number): SessionUser | null {
    const entry = this.cache.get(userId)
    if (!entry) return null
    if (entry.expiresAt <= Date.now() || entry.sessionVersion !== sessionVersion) {
      this.cache.delete(userId)
      return null
    }
    return entry.user
  }

  set(userId: string, sessionVersion: number, user: SessionUser): void {
    this.cache.set(userId, { user, sessionVersion, expiresAt: Date.now() + this.ttlMs })
  }

  invalidate(userId: string): void {
    this.cache.delete(userId)
  }
}
