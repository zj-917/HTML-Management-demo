import type { PackageType, PageDetail, PageStatus, Visibility } from '../shared'

export interface DetailPageSource {
  id: string
  slug: string
  title: string
  summary: string | null
  visibility: string
  status: string
  packageType: string
  entryFile: string
  categoryId: string | null
  category: { name: string } | null
  ownerId: string
  owner: { name: string } | null
  department: { name: string } | null
  tags: { tag: { name: string } }[]
  deptDeps: { departmentId: string; department: { name: string } }[]
  currentVersionId: string | null
  publishedVersionId: string | null
  rejectionComment: string | null
  unpublishRequestedAt: Date | null
  unpublishRequestedBy: { name: string } | null
  unpublishReason: string | null
  unpublishDecisionNote: string | null
  deletedAt: Date | null
  deletedBy: { name: string } | null
  publishedAt: Date | null
  updatedAt: Date
  versions: { id: string; versionNo: number; sizeBytes: number; changelog: string | null; createdAt: Date }[]
}

/**
 * 列表接口的形状见 PagesService#toSummary。
 * 修改字段时必须同步 shared/types.ts 的 PageDetail 契约，漏字段 typecheck 会直接报错。
 */
export function toPageDetail(page: DetailPageSource): PageDetail {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    visibility: page.visibility as Visibility,
    status: page.status as PageStatus,
    packageType: page.packageType as PackageType,
    entryFile: page.entryFile,
    categoryId: page.categoryId,
    categoryName: page.category?.name ?? null,
    tags: page.tags.map((item) => item.tag.name),
    ownerId: page.ownerId,
    ownerName: page.owner?.name ?? null,
    departmentName: page.department?.name ?? null,
    rejectionComment: page.rejectionComment,
    unpublishRequestedAt: page.unpublishRequestedAt?.toISOString() ?? null,
    unpublishRequestedByName: page.unpublishRequestedBy?.name ?? null,
    unpublishReason: page.unpublishReason,
    unpublishDecisionNote: page.unpublishDecisionNote,
    deletedAt: page.deletedAt?.toISOString() ?? null,
    deletedByName: page.deletedBy?.name ?? null,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    updatedAt: page.updatedAt.toISOString(),
    allowedDepartmentIds: page.deptDeps.map((item) => item.departmentId),
    allowedDepartmentNames: page.deptDeps.map((item) => item.department.name),
    versions: page.versions.map((item) => ({
      id: item.id,
      versionNo: item.versionNo,
      sizeBytes: item.sizeBytes,
      changelog: item.changelog,
      createdAt: item.createdAt.toISOString(),
      isCurrent: item.id === page.currentVersionId,
      isLive: item.id === page.publishedVersionId,
    })),
  }
}
