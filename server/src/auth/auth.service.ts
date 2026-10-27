import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../common/prisma.service'
import type { SiteAwareRequest } from '../common/request'
import type { SessionUser } from '../shared'
import { SessionCacheService } from './session-cache.service'

export const SESSION_COOKIE = 'hmp_session'

interface JwtPayload {
  sub: string
  /**
   * 会话版本号，对应 User.sessionVersion。
   *
   * 重置密码 / 停用账号时自增，旧 token 即使没过期也无法再通过校验。
   * 升级前签发的 token 没有 sv，一律按失效处理（一次性全员重新登录）。
   */
  sv: number
}

interface UserWithDepartment {
  id: string
  name: string
  email: string
  role: string
  departmentId: string | null
  department: { id: string; name: string } | null
}

function toSessionUser(user: UserWithDepartment): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as SessionUser['role'],
    departmentId: user.departmentId,
    departmentName: user.department?.name ?? null,
  }
}

const USER_INCLUDE = { department: { select: { id: true, name: true } } } as const

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sessionCache: SessionCacheService,
  ) {}

  extractToken(req: SiteAwareRequest): string | null {
    const rawCookie = req.headers.cookie
    if (rawCookie) {
      for (const part of rawCookie.split(';')) {
        const [name, ...rest] = part.trim().split('=')
        if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='))
      }
    }
    const authorization = req.headers.authorization
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      return authorization.slice(7)
    }
    return null
  }

  private async sign(user: { id: string; sessionVersion: number }): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, sv: user.sessionVersion } satisfies JwtPayload)
  }

  async verifyToken(token: string): Promise<SessionUser | null> {
    let payload: JwtPayload
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token)
    } catch {
      return null
    }
    // 抽样兜底：本次升级前签发的 token 没有 sv，不能让它们继续通过
    if (typeof payload.sv !== 'number') return null

    const cached = this.sessionCache.get(payload.sub, payload.sv)
    if (cached) return cached

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, active: true },
      include: USER_INCLUDE,
    })
    if (!user) {
      this.sessionCache.invalidate(payload.sub)
      return null
    }
    // 密码被重置 / 账号被停用后自增过 sessionVersion，旧 token 到此为止
    if (user.sessionVersion !== payload.sv) {
      this.sessionCache.invalidate(payload.sub)
      return null
    }

    const sessionUser = toSessionUser(user)
    this.sessionCache.set(user.id, user.sessionVersion, sessionUser)
    return sessionUser
  }

  /**
   * 修改本人密码。
   *
   * 自增 sessionVersion：其它设备上的旧 cookie 立即失效（这是安全要求），
   * 同时返回一个新 token，让当前这端不用被自己踢下线。
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ token: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, active: true },
      include: USER_INCLUDE,
    })
    if (!user) throw new UnauthorizedException('账号不可用，请重新登录')

    const ok = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!ok) throw new BadRequestException('当前密码不正确')

    if (newPassword === currentPassword) throw new BadRequestException('新密码不能与当前密码相同')

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: bcrypt.hashSync(newPassword, 10),
        sessionVersion: { increment: 1 },
      },
    })

    this.sessionCache.invalidate(updated.id)
    return { token: await this.sign(updated) }
  }

  /**
   * 修改本人姓名。只开放这一个字段：角色 / 部门 / 邮箱 / 启停都影响鉴权或身份锚点，
   * 只能由管理员在「用户管理」里改（详见 docs/方案.md 账号字段矩阵）。
   */
  async updateProfile(
    userId: string,
    rawName: string,
  ): Promise<{ user: SessionUser; previousName: string }> {
    const name = rawName.trim()
    if (!name) throw new BadRequestException('姓名不能为空')
    if (name.length > 40) throw new BadRequestException('姓名不能超过 40 个字符')

    const existing = await this.prisma.user.findFirst({
      where: { id: userId, active: true },
      include: USER_INCLUDE,
    })
    if (!existing) throw new UnauthorizedException('账号不可用，请重新登录')

    if (existing.name === name) {
      return { user: toSessionUser(existing), previousName: existing.name }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name },
      include: USER_INCLUDE,
    })
    this.sessionCache.invalidate(userId)
    return { user: toSessionUser(updated), previousName: existing.name }
  }

  async login(email: string, password: string): Promise<{ token: string; user: SessionUser }> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim(), active: true },
      include: USER_INCLUDE,
    })
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false
    if (!user || !ok) {
      throw new UnauthorizedException('邮箱或密码不正确')
    }

    const token = await this.sign(user)
    return { token, user: toSessionUser(user) }
  }
}
