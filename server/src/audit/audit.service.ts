import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service'
import type { AuditAction, AuditItem, AuditListResponse } from '../shared'

export interface AuditEntry {
  userId?: string | null
  action: AuditAction
  pageId?: string | null
  versionId?: string | null
  ip?: string | null
  ua?: string | null
  detail?: Record<string, unknown> | null
}

export interface AuditQuery {
  page?: number
  pageSize?: number
  action?: string
  userId?: string
  pageId?: string
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    // 写入时把操作人姓名固定下来：本人改名、账号被删除都不会追溯改写历史留痕
    const actor = entry.userId
      ? await this.prisma.user.findUnique({ where: { id: entry.userId }, select: { name: true } })
      : null

    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        actorName: actor?.name ?? null,
        action: entry.action,
        pageId: entry.pageId ?? null,
        versionId: entry.versionId ?? null,
        ip: entry.ip ?? null,
        ua: entry.ua ? entry.ua.slice(0, 400) : null,
        detail: entry.detail ? JSON.stringify(entry.detail) : null,
      },
    })
  }

  async list(query: AuditQuery): Promise<AuditListResponse> {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
    const where: Record<string, unknown> = {}
    if (query.action) where.action = query.action
    if (query.userId) where.userId = query.userId
    if (query.pageId) where.pageId = query.pageId

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, name: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ])

    return {
      items: items.map((item) => ({
        id: item.id,
        action: item.action,
        pageId: item.pageId,
        userId: item.userId,
        userName: item.actorName ?? item.user?.name ?? '系统',
        ip: item.ip,
        detail: item.detail ? (JSON.parse(item.detail) as Record<string, unknown>) : null,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    }
  }
}