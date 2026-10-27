import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { randomInt } from 'node:crypto'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../common/prisma.service'
import { SessionCacheService } from '../auth/session-cache.service'
import { AuditService } from '../audit/audit.service'
import { AuditAction, ROLE_VALUES, Role, type SessionUser, type UserItem, type UserListResponse } from '../shared'
import type { CreateUserDto, ListUsersQuery, UpdateUserDto } from './dto'

/**
 * 初始 / 重置密码由服务端生成，管理员只负责"一次性转达"。
 *
 * 去掉容易看错的 0/O、1/l/I 等字符，避免当面念密码时出错；
 * 12 位 × 57 字符表约 70 bit 熵，足够抵抗离线爆破。
 */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const PASSWORD_LENGTH = 12
const BCRYPT_ROUNDS = 10

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  departmentId: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  // 含回收站：删除账号前必须确认名下没有任何页面（Page.ownerId 是必填外键）
  _count: { select: { pagesOwned: true } },
} satisfies Prisma.UserSelect

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>

export interface AuditMeta {
  ip: string
  ua: string
}

function generateInitialPassword(): string {
  let out = ''
  for (let index = 0; index < PASSWORD_LENGTH; index += 1) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  }
  return out
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionCache: SessionCacheService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQuery): Promise<UserListResponse> {
    const page = Math.max(1, Number(query.page ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20))

    const where: Prisma.UserWhereInput = {}
    const keyword = query.q?.trim()
    if (keyword) {
      where.OR = [{ name: { contains: keyword } }, { email: { contains: keyword.toLowerCase() } }]
    }
    if (query.role) {
      if (!ROLE_VALUES.includes(query.role as Role)) throw new BadRequestException('角色筛选值不合法')
      where.role = query.role
    }
    if (query.departmentId) where.departmentId = query.departmentId
    if (query.active === 'true') where.active = true
    else if (query.active === 'false') where.active = false
    else if (query.active && query.active !== 'all') throw new BadRequestException('状态筛选值不合法')

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        // 管理员排前面，其次按姓名
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: USER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ])

    return { items: rows.map((row) => this.mapUser(row)), total, page, pageSize }
  }

  async create(
    input: CreateUserDto,
    actor: SessionUser,
    meta: AuditMeta,
  ): Promise<{ user: UserItem; initialPassword: string }> {
    const email = input.email.toLowerCase().trim()
    const name = input.name.trim()
    if (!name) throw new BadRequestException('姓名不能为空')

    const duplicated = await this.prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (duplicated) throw new BadRequestException('该邮箱已被使用')

    const departmentId = input.departmentId?.trim() || null
    if (departmentId) await this.assertDepartmentExists(departmentId)

    const initialPassword = generateInitialPassword()
    const created = await this.prisma.user.create({
      data: {
        email,
        name,
        role: input.role,
        departmentId,
        passwordHash: bcrypt.hashSync(initialPassword, BCRYPT_ROUNDS),
      },
      select: USER_SELECT,
    })

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.UserCreate,
      ip: meta.ip,
      ua: meta.ua,
      detail: {
        targetId: created.id,
        targetEmail: created.email,
        targetName: created.name,
        role: created.role,
        departmentId: created.departmentId,
      },
    })

    // 明文密码只出现在这一次响应里，不落库、不进审计
    return { user: this.mapUser(created), initialPassword }
  }

  async update(
    id: string,
    input: UpdateUserDto,
    actor: SessionUser,
    meta: AuditMeta,
  ): Promise<{ user: UserItem }> {
    const target = await this.findRow(id)
    const data: Prisma.UserUpdateInput = {}
    const changes: Record<string, { from: string | null; to: string | null }> = {}

    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name) throw new BadRequestException('姓名不能为空')
      if (name !== target.name) {
        data.name = name
        changes.name = { from: target.name, to: name }
      }
    }

    if (input.role !== undefined && input.role !== target.role) {
      // 护栏 1：不能改自己的角色（否则等于自我提权 / 自我降权把系统锁死）
      if (id === actor.id) throw new BadRequestException('不能修改自己的角色，请让其他管理员操作')
      // 护栏 3：不能把最后一个管理员降级
      if (target.role === Role.Admin) await this.assertNotLastAdmin(id)
      data.role = input.role
      changes.role = { from: target.role, to: input.role }
    }

    if (input.departmentId !== undefined) {
      const nextDepartmentId = input.departmentId?.trim() || null
      if (nextDepartmentId !== target.departmentId) {
        const department = nextDepartmentId
          ? await this.prisma.department.findUnique({
              where: { id: nextDepartmentId },
              select: { id: true, name: true },
            })
          : null
        if (nextDepartmentId && !department) throw new BadRequestException('部门不存在')
        data.department = nextDepartmentId ? { connect: { id: nextDepartmentId } } : { disconnect: true }
        changes.department = {
          from: target.department?.name ?? null,
          to: department?.name ?? null,
        }
      }
    }

    if (Object.keys(data).length === 0) return { user: this.mapUser(target) }

    const updated = await this.prisma.user.update({ where: { id }, data, select: USER_SELECT })
    // 角色 / 部门 / 姓名都会进 SessionUser，缓存必须立刻失效，否则最多 60 秒的授权滞后
    this.sessionCache.invalidate(id)

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.UserUpdate,
      ip: meta.ip,
      ua: meta.ua,
      detail: { targetId: id, targetEmail: target.email, changes },
    })

    return { user: this.mapUser(updated) }
  }

  async setActive(
    id: string,
    active: boolean,
    actor: SessionUser,
    meta: AuditMeta,
  ): Promise<{ user: UserItem }> {
    const target = await this.findRow(id)
    if (target.active === active) return { user: this.mapUser(target) }

    if (!active) {
      // 护栏 2：不能停用自己
      if (id === actor.id) throw new BadRequestException('不能停用自己的账号')
      // 护栏 3：不能停用最后一个管理员
      if (target.role === Role.Admin) await this.assertNotLastAdmin(id)
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: active ? { active } : { active, sessionVersion: { increment: 1 } },
      select: USER_SELECT,
    })
    this.sessionCache.invalidate(id)

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.UserUpdate,
      ip: meta.ip,
      ua: meta.ua,
      detail: {
        targetId: id,
        targetEmail: target.email,
        changes: { active: { from: String(target.active), to: String(active) } },
      },
    })

    return { user: this.mapUser(updated) }
  }

  async resetPassword(
    id: string,
    actor: SessionUser,
    meta: AuditMeta,
  ): Promise<{ password: string }> {
    const target = await this.findRow(id)
    const password = generateInitialPassword()

    // 自增 sessionVersion：该账号在所有设备上的旧 cookie 立即失效
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: bcrypt.hashSync(password, BCRYPT_ROUNDS),
        sessionVersion: { increment: 1 },
      },
    })
    this.sessionCache.invalidate(id)

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.UserResetPassword,
      ip: meta.ip,
      ua: meta.ua,
      detail: { targetId: id, targetEmail: target.email },
    })

    // 同样只在此次响应里出现一次
    return { password }
  }

  async remove(
    id: string,
    actor: SessionUser,
    meta: AuditMeta,
  ): Promise<{ ok: true }> {
    const target = await this.findRow(id)

    if (id === actor.id) throw new BadRequestException('不能删除自己的账号')
    if (target.active) throw new BadRequestException('请先停用该账号，确认无人使用后再删除')
    if (target._count.pagesOwned > 0) {
      throw new BadRequestException(
        `该用户名下还有 ${target._count.pagesOwned} 个页面（含回收站），请先彻底删除这些页面再删除账号`,
      )
    }

    await this.prisma.user.delete({ where: { id } })
    this.sessionCache.invalidate(id)

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.UserDelete,
      ip: meta.ip,
      ua: meta.ua,
      detail: { targetId: id, targetEmail: target.email, targetName: target.name },
    })

    return { ok: true }
  }

  /** 响应形状以 shared/types.ts 的 UserItem 为准：漏字段/改名会在这里 typecheck 失败 */
  private mapUser(row: UserRow): UserItem {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      // 数据库列是字符串，写入侧只允许 admin / member（见 CreateUserDto / UpdateUserDto）
      role: row.role as Role,
      active: row.active,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
      pageCount: row._count.pagesOwned,
      createdAt: row.createdAt.toISOString(),
    }
  }

  private async findRow(id: string): Promise<UserRow> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT })
    if (!row) throw new NotFoundException('用户不存在')
    return row
  }

  private async assertDepartmentExists(departmentId: string): Promise<void> {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { id: true },
    })
    if (!department) throw new BadRequestException('部门不存在')
  }

  /** 护栏 3：系统必须始终保留至少一个启用中的管理员 */
  private async assertNotLastAdmin(targetId: string): Promise<void> {
    const remaining = await this.prisma.user.count({
      where: { role: Role.Admin, active: true, id: { not: targetId } },
    })
    if (remaining === 0) throw new BadRequestException('系统至少需要保留一个启用中的管理员')
  }
}
