import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { PageVersion, Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../common/prisma.service'
import { generateSlug } from '../common/slug'
import type { SiteDefinition } from '../common/config'
import { dayKey } from '../common/business-date'
import { StorageService } from '../storage/storage.service'
import { PublisherService } from '../storage/publisher.service'
import { UploadRejectedError, UploadService } from '../upload/upload.service'
import { AuditService } from '../audit/audit.service'
import { CreatePageDto, DecideUnpublishDto, NewVersionDto, PageQueryDto, RequestUnpublishDto, ReviewDto, UpdatePageDto, parseList } from './dto'
import {
  AuditAction,
  PageStatus,
  Role,
  SiteScope,
  Visibility,
  VISIBILITY_VALUES,
  type PageSummary,
  type PageVersionItem,
  type SessionUser,
  type Visibility as VisibilityValue,
} from '../shared'

const PAGE_INCLUDE = {
  owner: { select: { id: true, name: true, email: true } },
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  tags: { include: { tag: { select: { id: true, name: true } } } },
  deptDeps: { include: { department: { select: { id: true, name: true } } } },
  unpublishRequestedBy: { select: { id: true, name: true } },
  deletedBy: { select: { id: true, name: true } },
} satisfies Prisma.PageInclude

type PageFull = Prisma.PageGetPayload<{ include: typeof PAGE_INCLUDE }>
type PageWithVersions = PageFull & { versions: PageVersion[] }

interface SummaryOptions {
  versionNo: number
  sizeBytes: number
  exposePrivate: boolean
}

export interface RequestContext {
  ip: string
  ua: string
}

const CLEAR_UNPUBLISH_REQUEST = {
  unpublishRequestedAt: null,
  unpublishRequestedBy: { disconnect: true },
  unpublishReason: null,
  unpublishDecisionNote: null,
} satisfies Prisma.PageUpdateInput

/**
 * 未删除过滤条件。
 *
 * 所有列表查询都必须叠加它，否则回收站里的页面会重新出现在门户、
 * 统计或审核队列里。新增查询时务必记得带上。
 */
export const NOT_DELETED = { deletedAt: null } satisfies Prisma.PageWhereInput
export const IS_DELETED = { deletedAt: { not: null } } satisfies Prisma.PageWhereInput

function requireFullSite(): SiteDefinition {
  return {
    id: 'intranet',
    label: '内网站点',
    hostPatterns: [],
    scope: SiteScope.Full,
    anonymous: false,
    contentRoots: [],
    manageEnabled: true,
  }
}

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly publisher: PublisherService,
    private readonly upload: UploadService,
    private readonly audit: AuditService,
  ) {}

  private accessWhere(site: SiteDefinition, user: SessionUser | null): Prisma.PageWhereInput {
    if (site.scope === SiteScope.PublicOnly || !user) {
      return { ...NOT_DELETED, status: PageStatus.Published, visibility: Visibility.Public }
    }
    return {
      ...NOT_DELETED,
      status: PageStatus.Published,
      OR: [
        { visibility: { in: [Visibility.Public, Visibility.Internal] } },
        {
          visibility: Visibility.Dept,
          deptDeps: { some: { departmentId: user.departmentId ?? '__no_department__' } },
        },
      ],
    }
  }

  private manageWhere(user: SessionUser, query: PageQueryDto): Prisma.PageWhereInput {
    const conditions: Prisma.PageWhereInput[] = []
    if (user.role === Role.Member) {
      conditions.push({ OR: [{ ownerId: user.id }, { status: PageStatus.Published }] })
    }
    conditions.push(query.deleted === 'true' ? IS_DELETED : NOT_DELETED)
    if (query.status) conditions.push({ status: query.status })
    if (query.visibility) conditions.push({ visibility: query.visibility })
    if (query.categoryId) conditions.push({ categoryId: query.categoryId })
    if (query.departmentId) conditions.push({ departmentId: query.departmentId })
    if (query.ownerId) conditions.push({ ownerId: query.ownerId })
    if (query.tag) conditions.push({ tags: { some: { tag: { name: query.tag } } } })
    if (query.unpublishRequested === 'true') {
      conditions.push({ unpublishRequestedAt: { not: null } })
    } else if (query.unpublishRequested === 'false') {
      conditions.push({ unpublishRequestedAt: null })
    }
    if (query.q) {
      const keyword = query.q.trim()
      if (keyword) {
        conditions.push({
          OR: [
            { title: { contains: keyword } },
            { summary: { contains: keyword } },
            { slug: { contains: keyword } },
          ],
        })
      }
    }
    return conditions.length ? { AND: conditions } : {}
  }

  private toSummary(page: PageFull, options: SummaryOptions): PageSummary {
    const base: PageSummary = {
      id: page.id,
      slug: page.slug,
      title: page.title,
      summary: page.summary,
      visibility: page.visibility as PageSummary['visibility'],
      status: page.status as PageSummary['status'],
      packageType: page.packageType as PageSummary['packageType'],
      categoryId: page.categoryId,
      categoryName: page.category?.name ?? null,
      tags: page.tags.map((item) => item.tag.name),
      versionNo: options.versionNo,
      sizeBytes: options.sizeBytes,
      viewCount: options.exposePrivate ? page.viewCount : 0,
      lastViewedAt: options.exposePrivate ? (page.lastViewedAt?.toISOString() ?? null) : null,
      publishedAt: page.publishedAt?.toISOString() ?? null,
      updatedAt: page.updatedAt.toISOString(),
      unpublishRequestedAt: page.unpublishRequestedAt?.toISOString() ?? null,
      unpublishReason: page.unpublishReason,
      unpublishDecisionNote: page.unpublishDecisionNote,
      deletedAt: page.deletedAt?.toISOString() ?? null,
    }
    if (!options.exposePrivate) return base
    return {
      ...base,
      ownerName: page.owner?.name ?? null,
      departmentName: page.department?.name ?? null,
      unpublishRequestedByName: page.unpublishRequestedBy?.name ?? null,
      deletedByName: page.deletedBy?.name ?? null,
      allowedDepartmentIds: page.deptDeps.map((item) => item.departmentId),
      allowedDepartmentNames: page.deptDeps.map((item) => item.department.name),
    }
  }

  private summaryOf(page: PageFull, site: SiteDefinition): PageSummary {
    const versions = (page as Partial<PageWithVersions>).versions
    const latest = versions?.[0]
    return this.toSummary(page, {
      versionNo: latest?.versionNo ?? 1,
      sizeBytes: latest?.sizeBytes ?? 0,
      exposePrivate: site.scope !== SiteScope.PublicOnly,
    })
  }

  async listPortal(query: PageQueryDto, site: SiteDefinition, user: SessionUser | null) {
    const page = Math.max(1, Number(query.page ?? 1) || 1)
    const pageSize = Math.min(60, Math.max(1, Number(query.pageSize ?? 12) || 12))
    const conditions: Prisma.PageWhereInput[] = [this.accessWhere(site, user)]

    if (query.categoryId) conditions.push({ categoryId: query.categoryId })
    if (query.tag) conditions.push({ tags: { some: { tag: { name: query.tag } } } })
    if (query.departmentId) conditions.push({ departmentId: query.departmentId })
    if (query.q?.trim()) {
      const keyword = query.q.trim()
      conditions.push({
        OR: [
          { title: { contains: keyword } },
          { summary: { contains: keyword } },
          { tags: { some: { tag: { name: { contains: keyword } } } } },
        ],
      })
    }

    const where: Prisma.PageWhereInput = { AND: conditions }
    const [items, total] = await Promise.all([
      this.prisma.page.findMany({
        where,
        include: { ...PAGE_INCLUDE, versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
        orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.page.count({ where }),
    ])

    return {
      items: items.map((item) => this.summaryOf(item, site)),
      total,
      page,
      pageSize,
      scope: site.scope,
    }
  }

  async listForManage(query: PageQueryDto, site: SiteDefinition, user: SessionUser) {
    const page = Math.max(1, Number(query.page ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20))
    const where = this.manageWhere(user, query)
    const [items, total] = await Promise.all([
      this.prisma.page.findMany({
        where,
        include: { ...PAGE_INCLUDE, versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.page.count({ where }),
    ])

    return {
      items: items.map((item) => this.summaryOf(item, site)),
      total,
      page,
      pageSize,
      scope: site.scope,
    }
  }

  async listMine(query: PageQueryDto, site: SiteDefinition, user: SessionUser) {
    const page = Math.max(1, Number(query.page ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20))

    const conditions: Prisma.PageWhereInput[] = [
      { ownerId: user.id },
      query.deleted === 'true' ? IS_DELETED : NOT_DELETED,
    ]
    if (query.status) conditions.push({ status: query.status })
    if (query.unpublishRequested === 'true') {
      conditions.push({ unpublishRequestedAt: { not: null } })
    }
    if (query.q?.trim()) {
      const keyword = query.q.trim()
      conditions.push({
        OR: [{ title: { contains: keyword } }, { summary: { contains: keyword } }],
      })
    }

    const where: Prisma.PageWhereInput = { AND: conditions }
    const [items, total] = await Promise.all([
      this.prisma.page.findMany({
        where,
        include: { ...PAGE_INCLUDE, versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.page.count({ where }),
    ])

    return {
      items: items.map((item) => this.summaryOf(item, site)),
      total,
      page,
      pageSize,
      scope: site.scope,
    }
  }

  async findVisibleBySlug(slug: string, site: SiteDefinition, user: SessionUser | null): Promise<PageWithVersions> {
    const page = await this.prisma.page.findUnique({
      where: { slug },
      include: { ...PAGE_INCLUDE, versions: { orderBy: { versionNo: 'desc' } } },
    })
    if (!page) throw new NotFoundException('页面不存在')
    if (page.deletedAt) throw new NotFoundException('页面不存在')
    if (page.status !== PageStatus.Published) throw new NotFoundException('页面不存在')
    if (site.scope === SiteScope.PublicOnly) {
      if (page.visibility !== Visibility.Public) throw new NotFoundException('页面不存在')
      return page
    }
    if (page.visibility === Visibility.Public) return page
    if (!user) throw new NotFoundException('页面不存在')
    if (page.visibility === Visibility.Internal) return page
    const allowed = page.deptDeps.some((item) => item.departmentId === user.departmentId)
    if (!allowed) throw new NotFoundException('页面不存在')
    return page
  }

  async getForManage(slugOrId: string, user: SessionUser): Promise<PageWithVersions> {
    const page = await this.prisma.page.findFirst({
      where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
      include: { ...PAGE_INCLUDE, versions: { orderBy: { versionNo: 'desc' } } },
    })
    if (!page) throw new NotFoundException('页面不存在，或已被删除')
    if (page.deletedAt && user.role !== Role.Admin && page.ownerId !== user.id) {
      throw new ForbiddenException('页面已在回收站中')
    }

    if (user.role !== Role.Admin) {
      const isOwner = page.ownerId === user.id
      const isPublished = page.status === PageStatus.Published
      const deptAllowed = page.deptDeps.some((item) => item.departmentId === user.departmentId)
      const publicVisible =
        page.visibility === Visibility.Public ||
        (page.visibility === Visibility.Internal && !isOwner) ||
        (page.visibility === Visibility.Dept && deptAllowed)
      if (!isOwner && !(isPublished && publicVisible)) {
        throw new ForbiddenException('当前账号无权查看该页面')
      }
    }
    return page
  }

  async create(dto: CreatePageDto, file: Express.Multer.File, user: SessionUser, ctx: RequestContext) {
    const departmentIds = parseList(dto.departmentIds)
    this.assertVisibilityPayload(dto.visibility, departmentIds)

    const pageId = randomUUID()
    const versionId = randomUUID()
    const slug = await this.allocateSlug()
    const stored = await this.storeUpload(pageId, versionId, file)

    const page = await this.prisma.$transaction(async (tx) => {
      await tx.page.create({
        data: {
          id: pageId,
          slug,
          title: dto.title.trim(),
          summary: dto.summary?.trim() || null,
          visibility: dto.visibility,
          status: PageStatus.Draft,
          packageType: stored.packageType,
          entryFile: stored.entryFile,
          categoryId: dto.categoryId || null,
          ownerId: user.id,
          departmentId: user.departmentId,
          currentVersionId: versionId,
        },
      })
      await tx.pageVersion.create({
        data: {
          id: versionId,
          pageId,
          versionNo: 1,
          storagePath: this.storage.versionDir(pageId, versionId),
          sizeBytes: stored.sizeBytes,
          fileCount: stored.fileCount,
          changelog: dto.changelog?.trim() || null,
          uploadedById: user.id,
        },
      })
      if (departmentIds.length) {
        await tx.pageDept.createMany({ data: departmentIds.map((departmentId) => ({ pageId, departmentId })) })
      }
      await this.syncTags(tx, pageId, parseList(dto.tags))
      return tx.page.findUniqueOrThrow({ where: { id: pageId }, include: PAGE_INCLUDE })
    })

    await this.audit.log({
      userId: user.id,
      action: AuditAction.Upload,
      pageId,
      versionId,
      ip: ctx.ip,
      ua: ctx.ua,
      detail: { title: page.title, visibility: page.visibility, sizeBytes: stored.sizeBytes },
    })

    return this.toSummary(page, {
      versionNo: 1,
      sizeBytes: stored.sizeBytes,
      exposePrivate: true,
    })
  }

  async addVersion(
    page: PageWithVersions,
    dto: NewVersionDto,
    file: Express.Multer.File,
    user: SessionUser,
    ctx: RequestContext,
  ): Promise<PageVersionItem> {
    this.assertOwnerOrAdmin(page, user)
    if (page.deletedAt) throw new BadRequestException('回收站中的页面不能上传新版本，请先恢复')

    const versionId = randomUUID()
    const versionNo = (page.versions[0]?.versionNo ?? 0) + 1
    const stored = await this.storeUpload(page.id, versionId, file)

    const created = await this.prisma.$transaction(async (tx) => {
      const version = await tx.pageVersion.create({
        data: {
          id: versionId,
          pageId: page.id,
          versionNo,
          storagePath: this.storage.versionDir(page.id, versionId),
          sizeBytes: stored.sizeBytes,
          fileCount: stored.fileCount,
          changelog: dto.changelog?.trim() || null,
          uploadedById: user.id,
        },
      })
      await tx.page.update({
        where: { id: page.id },
        data: {
          currentVersionId: versionId,
          packageType: stored.packageType,
          entryFile: stored.entryFile,
          status: page.status === PageStatus.Published ? PageStatus.Draft : page.status,
          ...(page.status === PageStatus.Published ? CLEAR_UNPUBLISH_REQUEST : {}),
        },
      })
      return version
    })

    await this.audit.log({
      userId: user.id,
      action: AuditAction.NewVersion,
      pageId: page.id,
      versionId,
      ip: ctx.ip,
      ua: ctx.ua,
      detail: { versionNo, sizeBytes: stored.sizeBytes },
    })

    return {
      id: created.id,
      versionNo: created.versionNo,
      sizeBytes: created.sizeBytes,
      changelog: created.changelog,
      createdAt: created.createdAt.toISOString(),
      uploadedByName: user.name,
      isCurrent: created.id === page.currentVersionId,
    }
  }

  async updateMeta(page: PageWithVersions, dto: UpdatePageDto, user: SessionUser, ctx: RequestContext) {
    this.assertOwnerOrAdmin(page, user)

    const departmentIds = dto.departmentIds === undefined ? undefined : parseList(dto.departmentIds)
    const nextVisibility = dto.visibility ?? (page.visibility as VisibilityValue)
    const effectiveDepartments = departmentIds ?? page.deptDeps.map((item) => item.departmentId)
    this.assertVisibilityPayload(nextVisibility, effectiveDepartments)

    const data: Prisma.PageUpdateInput = {}
    if (dto.title !== undefined) data.title = dto.title.trim()
    if (dto.summary !== undefined) data.summary = dto.summary.trim() || null
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId ? { connect: { id: dto.categoryId } } : { disconnect: true }
    }

    const visibilityChanged = Boolean(dto.visibility && dto.visibility !== page.visibility)
    if (dto.visibility !== undefined) data.visibility = dto.visibility
    if (visibilityChanged && page.status === PageStatus.Published) {
      data.status = PageStatus.Pending
    }

    if (departmentIds) {
      await this.prisma.pageDept.deleteMany({ where: { pageId: page.id } })
      if (departmentIds.length) {
        await this.prisma.pageDept.createMany({
          data: departmentIds.map((departmentId) => ({ pageId: page.id, departmentId })),
        })
      }
    }
    if (dto.tags !== undefined) {
      await this.syncTags(this.prisma, page.id, parseList(dto.tags))
    }

    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data:
        page.status === PageStatus.Published && data.status && data.status !== PageStatus.Published
          ? { ...data, ...CLEAR_UNPUBLISH_REQUEST }
          : data,
      include: PAGE_INCLUDE,
    })

    if (visibilityChanged) {
      await this.publisher.unpublishPage(updated.slug)
      await this.audit.log({
        userId: user.id,
        action: AuditAction.VisibilityChange,
        pageId: page.id,
        ip: ctx.ip,
        ua: ctx.ua,
        detail: { from: page.visibility, to: updated.visibility, wentOffline: page.status === PageStatus.Published },
      })
    }

    return this.toSummary(updated, {
      versionNo: page.versions[0]?.versionNo ?? 1,
      sizeBytes: page.versions[0]?.sizeBytes ?? 0,
      exposePrivate: true,
    })
  }

  async submit(page: PageWithVersions, user: SessionUser, ctx: RequestContext) {
    this.assertOwnerOrAdmin(page, user)
    if (page.deletedAt) throw new BadRequestException('回收站中的页面不能提交审核，请先恢复')
    if (page.status === PageStatus.Pending) throw new BadRequestException('页面已在审核队列中')

    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: { status: PageStatus.Pending, rejectionComment: null },
      include: PAGE_INCLUDE,
    })
    await this.audit.log({
      userId: user.id,
      action: AuditAction.Submit,
      pageId: page.id,
      ip: ctx.ip,
      ua: ctx.ua,
    })
    return this.toSummary(updated, {
      versionNo: page.versions[0]?.versionNo ?? 1,
      sizeBytes: page.versions[0]?.sizeBytes ?? 0,
      exposePrivate: true,
    })
  }

  async review(page: PageWithVersions, dto: ReviewDto, user: SessionUser, ctx: RequestContext) {
    if (user.role !== Role.Admin) throw new ForbiddenException('只有管理员可以审核发布')
    if (page.status !== PageStatus.Pending) throw new BadRequestException('只有待审核的页面可以审核')

    if (dto.action === 'reject') {
      const comment = dto.comment?.trim()
      if (!comment) throw new BadRequestException('驳回时必须填写意见')
      const updated = await this.prisma.page.update({
        where: { id: page.id },
        data: { status: PageStatus.Rejected, rejectionComment: comment, ...CLEAR_UNPUBLISH_REQUEST },
        include: PAGE_INCLUDE,
      })
      await this.audit.log({
        userId: user.id,
        action: AuditAction.Reject,
        pageId: page.id,
        ip: ctx.ip,
        ua: ctx.ua,
        detail: { comment },
      })
      return this.toSummary(updated, { versionNo: 1, sizeBytes: 0, exposePrivate: true })
    }

    const versionId = page.currentVersionId
    if (!versionId) throw new BadRequestException('页面缺少可发布版本')

    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: {
        status: PageStatus.Published,
        publishedVersionId: versionId,
        publishedAt: page.publishedAt ?? new Date(),
        rejectionComment: null,
      },
      include: PAGE_INCLUDE,
    })
    await this.publisher.sync(this.publishTarget(updated, versionId))
    await this.audit.log({
      userId: user.id,
      action: AuditAction.Approve,
      pageId: page.id,
      versionId,
      ip: ctx.ip,
      ua: ctx.ua,
    })
    return this.toSummary(updated, {
      versionNo: page.versions[0]?.versionNo ?? 1,
      sizeBytes: page.versions[0]?.sizeBytes ?? 0,
      exposePrivate: true,
    })
  }

  async requestUnpublish(
    page: PageWithVersions,
    dto: RequestUnpublishDto,
    user: SessionUser,
    ctx: RequestContext,
  ) {
    this.assertOwnerOrAdmin(page, user)
    if (page.status !== PageStatus.Published) {
      throw new BadRequestException('只有当前处于「已发布」状态的页面才需要申请下线')
    }
    if (page.unpublishRequestedAt) {
      throw new BadRequestException('该页面已有进行中的下线申请，如需修改原因请先撤回')
    }

    const reason = dto.reason.trim()
    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: {
        unpublishRequestedAt: new Date(),
        unpublishRequestedBy: { connect: { id: user.id } },
        unpublishReason: reason,
        unpublishDecisionNote: null,
      },
      include: PAGE_INCLUDE,
    })
    await this.audit.log({
      userId: user.id,
      action: AuditAction.RequestUnpublish,
      pageId: page.id,
      ip: ctx.ip,
      ua: ctx.ua,
      detail: { reason },
    })
    return this.summaryOf(updated, requireFullSite())
  }

  async withdrawUnpublish(page: PageWithVersions, user: SessionUser, ctx: RequestContext) {
    this.assertOwnerOrAdmin(page, user)
    if (!page.unpublishRequestedAt) {
      throw new BadRequestException('该页面当前没有进行中的下线申请')
    }

    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: CLEAR_UNPUBLISH_REQUEST,
      include: PAGE_INCLUDE,
    })
    await this.audit.log({
      userId: user.id,
      action: AuditAction.WithdrawUnpublish,
      pageId: page.id,
      ip: ctx.ip,
      ua: ctx.ua,
    })
    return this.summaryOf(updated, requireFullSite())
  }

  async approveUnpublish(page: PageWithVersions, user: SessionUser, ctx: RequestContext) {
    this.assertAdminOnly(user)
    if (!page.unpublishRequestedAt) {
      throw new BadRequestException('该页面当前没有进行中的下线申请')
    }

    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: { status: PageStatus.Draft, ...CLEAR_UNPUBLISH_REQUEST },
      include: PAGE_INCLUDE,
    })
    await this.publisher.sync(this.publishTarget(updated, updated.publishedVersionId))
    await this.audit.log({
      userId: user.id,
      action: AuditAction.Unpublish,
      pageId: page.id,
      ip: ctx.ip,
      ua: ctx.ua,
      detail: { viaUnpublishRequest: true, requestedReason: page.unpublishReason },
    })
    return this.summaryOf(updated, requireFullSite())
  }

  async rejectUnpublish(
    page: PageWithVersions,
    dto: DecideUnpublishDto,
    user: SessionUser,
    ctx: RequestContext,
  ) {
    this.assertAdminOnly(user)
    if (!page.unpublishRequestedAt) {
      throw new BadRequestException('该页面当前没有进行中的下线申请')
    }

    const note = dto.note?.trim() || '管理员未填写处理意见，页面维持在线'
    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: {
        unpublishRequestedAt: null,
        unpublishRequestedBy: { disconnect: true },
        unpublishReason: null,
        unpublishDecisionNote: note,
      },
      include: PAGE_INCLUDE,
    })
    await this.audit.log({
      userId: user.id,
      action: AuditAction.RejectUnpublish,
      pageId: page.id,
      ip: ctx.ip,
      ua: ctx.ua,
      detail: { note, requestedReason: page.unpublishReason },
    })
    return this.summaryOf(updated, requireFullSite())
  }

  async unpublish(page: PageWithVersions, user: SessionUser, ctx: RequestContext) {
    this.assertOwnerOrAdmin(page, user)
    if (page.status !== PageStatus.Published) throw new BadRequestException('页面当前不是已发布状态')

    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: { status: PageStatus.Draft, ...CLEAR_UNPUBLISH_REQUEST },
      include: PAGE_INCLUDE,
    })
    await this.publisher.sync(this.publishTarget(updated, updated.publishedVersionId))
    await this.audit.log({
      userId: user.id,
      action: AuditAction.Unpublish,
      pageId: page.id,
      ip: ctx.ip,
      ua: ctx.ua,
    })
    return this.summaryOf(updated, requireFullSite())
  }

  /**
   * 软删除：页面从所有列表和内容入口消失，但记录与文件保留，可在回收站恢复。
   *
   * 仅限未发布页面。已发布页面必须先走下线流程，避免绕过管理员审批直接下线：
   * - 成员：申请下线 → 管理员批准 → 变回 draft → 才能删除
   * - 管理员：直接下线 → 变回 draft → 才能删除
   */
  async softDelete(page: PageWithVersions, user: SessionUser, ctx: RequestContext) {
    this.assertOwnerOrAdmin(page, user)
    if (page.deletedAt) throw new BadRequestException('该页面已在回收站中')
    if (page.status === PageStatus.Published) {
      throw new BadRequestException(
        user.role === Role.Admin
          ? '已发布的页面不能直接删除，请先「下线」'
          : '已发布的页面不能删除，请先提交下线申请',
      )
    }

    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: {
        deletedAt: new Date(),
        deletedBy: { connect: { id: user.id } },
        ...CLEAR_UNPUBLISH_REQUEST,
      },
      include: PAGE_INCLUDE,
    })
    await this.publisher.sync(this.publishTarget(updated, updated.publishedVersionId))
    await this.audit.log({
      userId: user.id,
      action: AuditAction.Delete,
      pageId: page.id,
      ip: ctx.ip,
      ua: ctx.ua,
      detail: { title: page.title, previousStatus: page.status },
    })
    return this.summaryOf(updated, requireFullSite())
  }

  async restore(page: PageWithVersions, user: SessionUser, ctx: RequestContext) {
    this.assertOwnerOrAdmin(page, user)
    if (!page.deletedAt) throw new BadRequestException('该页面不在回收站中')

    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: { deletedAt: null, deletedBy: { disconnect: true } },
      include: PAGE_INCLUDE,
    })
    await this.publisher.sync(this.publishTarget(updated, updated.publishedVersionId))
    await this.audit.log({
      userId: user.id,
      action: AuditAction.Restore,
      pageId: page.id,
      ip: ctx.ip,
      ua: ctx.ua,
    })
    return this.summaryOf(updated, requireFullSite())
  }

  /** 彻底删除：清空记录与磁盘文件，不可恢复。 */
  async purge(page: PageWithVersions, user: SessionUser, ctx: RequestContext) {
    this.assertAdminOnly(user)
    if (!page.deletedAt) throw new BadRequestException('只能彻底删除回收站中的页面')

    await this.storage.removePageArtifacts(page.id, page.slug)
    await this.prisma.page.delete({ where: { id: page.id } })
    await this.audit.log({
      userId: user.id,
      action: AuditAction.Purge,
      pageId: page.id,
      ip: ctx.ip,
      ua: ctx.ua,
      detail: { title: page.title, slug: page.slug },
    })
    return { ok: true, id: page.id }
  }

  /** 回收站保留期清理：删除超期页面的记录与文件。 */
  async purgeExpired(retentionDays: number): Promise<number> {
    const threshold = new Date()
    threshold.setDate(threshold.getDate() - Math.max(1, retentionDays))

    const expired = await this.prisma.page.findMany({
      where: { deletedAt: { not: null, lte: threshold } },
      select: { id: true, slug: true, title: true },
    })
    for (const page of expired) {
      await this.storage.removePageArtifacts(page.id, page.slug)
      await this.prisma.page.delete({ where: { id: page.id } }).catch(() => undefined)
    }
    if (expired.length) {
      await this.audit.log({
        action: AuditAction.Purge,
        detail: { reason: 'retention_expired', count: expired.length, retentionDays },
      })
    }
    return expired.length
  }

  async rollback(page: PageWithVersions, versionId: string, user: SessionUser, ctx: RequestContext) {
    if (user.role !== Role.Admin) throw new ForbiddenException('只有管理员可以回滚版本')
    const target = page.versions.find((item) => item.id === versionId)
    if (!target) throw new NotFoundException('版本不存在')
    if (!(await this.storage.exists(this.storage.versionDir(page.id, versionId)))) {
      throw new BadRequestException('该版本的文件已丢失，无法回滚')
    }

    const stayLive = page.status === PageStatus.Published
    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: {
        currentVersionId: versionId,
        publishedVersionId: stayLive ? versionId : page.publishedVersionId,
      },
      include: PAGE_INCLUDE,
    })
    await this.publisher.sync(this.publishTarget(updated, updated.publishedVersionId))
    await this.audit.log({
      userId: user.id,
      action: AuditAction.Rollback,
      pageId: page.id,
      versionId,
      ip: ctx.ip,
      ua: ctx.ua,
      detail: { versionNo: target.versionNo },
    })
    return this.toSummary(updated, { versionNo: target.versionNo, sizeBytes: target.sizeBytes, exposePrivate: true })
  }

  async listVersions(page: PageWithVersions, user: SessionUser): Promise<PageVersionItem[]> {
    this.assertOwnerOrAdmin(page, user)
    return page.versions.map((item) => ({
      id: item.id,
      versionNo: item.versionNo,
      sizeBytes: item.sizeBytes,
      changelog: item.changelog,
      createdAt: item.createdAt.toISOString(),
      isCurrent: item.id === page.currentVersionId,
    }))
  }

  async recordView(slug: string, site: SiteDefinition, user: SessionUser | null): Promise<void> {
    const page = await this.findVisibleBySlug(slug, site, user).catch(() => null)
    if (!page) return
    const today = dayKey()
    await this.prisma.$transaction([
      this.prisma.page.update({
        where: { id: page.id },
        data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
      }),
      this.prisma.viewStat.upsert({
        where: { pageId_date: { pageId: page.id, date: today } },
        create: { pageId: page.id, date: today, count: 1 },
        update: { count: { increment: 1 } },
      }),
    ])
  }

  async contentGuard(slug: string, site: SiteDefinition, user: SessionUser | null) {
    const page = await this.prisma.page.findUnique({ where: { slug }, include: { deptDeps: true } })
    if (!page) return { allow: false, status: 404 }
    if (page.deletedAt) return { allow: false, status: 404 }
    if (page.status !== PageStatus.Published) return { allow: false, status: 404 }

    if (site.scope === SiteScope.PublicOnly) {
      return page.visibility === Visibility.Public
        ? { allow: true, status: 204, entryFile: page.entryFile }
        : { allow: false, status: 404 }
    }
    if (page.visibility === Visibility.Public) return { allow: true, status: 204, entryFile: page.entryFile }
    if (!user) return { allow: false, status: 401 }
    if (page.visibility === Visibility.Internal) return { allow: true, status: 204, entryFile: page.entryFile }
    const allowed = page.deptDeps.some((item) => item.departmentId === user.departmentId)
    return allowed ? { allow: true, status: 204, entryFile: page.entryFile } : { allow: false, status: 403 }
  }

  private publishTarget(
    page: { id: string; slug: string; visibility: string; status: string; publishedVersionId: string | null; deletedAt: Date | null },
    publishedVersionIdOverride?: string | null,
  ) {
    return {
      id: page.id,
      slug: page.slug,
      visibility: page.visibility as VisibilityValue,
      status: page.status,
      publishedVersionId: publishedVersionIdOverride ?? page.publishedVersionId,
      deletedAt: page.deletedAt,
    }
  }

  private assertAdminOnly(user: SessionUser): void {
    if (user.role !== Role.Admin) throw new ForbiddenException('只有管理员可以处理下线申请')
  }

  private assertOwnerOrAdmin(page: PageFull, user: SessionUser): void {
    if (user.role === Role.Admin) return
    if (page.ownerId === user.id) return
    throw new ForbiddenException('只能操作自己创建的页面')
  }

  private assertVisibilityPayload(visibility: string, departmentIds: string[]): void {
    if (!VISIBILITY_VALUES.includes(visibility as VisibilityValue)) {
      throw new BadRequestException('可见性取值不合法')
    }
    if (visibility === Visibility.Dept && departmentIds.length === 0) {
      throw new BadRequestException('选择「指定部门可见」时必须至少勾选一个部门')
    }
    if (visibility !== Visibility.Dept && departmentIds.length > 0) {
      throw new BadRequestException('只有「指定部门可见」才需要选择部门')
    }
  }

  private async storeUpload(pageId: string, versionId: string, file: Express.Multer.File) {
    try {
      return await this.upload.storeVersion(pageId, versionId, file)
    } catch (error) {
      if (error instanceof UploadRejectedError) throw new BadRequestException(error.reason)
      throw error
    }
  }

  private async syncTags(tx: Prisma.TransactionClient | PrismaService, pageId: string, names: string[]): Promise<void> {
    const cleaned = names.map((name) => name.trim()).filter(Boolean).slice(0, 12)
    await tx.pageTag.deleteMany({ where: { pageId } })
    for (const name of cleaned) {
      const tag = await tx.tag.upsert({ where: { name }, create: { name }, update: {} })
      await tx.pageTag.upsert({
        where: { pageId_tagId: { pageId, tagId: tag.id } },
        create: { pageId, tagId: tag.id },
        update: {},
      })
    }
  }

  private async allocateSlug(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const slug = generateSlug()
      const exists = await this.prisma.page.findUnique({ where: { slug }, select: { id: true } })
      if (!exists) return slug
    }
    throw new Error('无法生成唯一 slug')
  }
}