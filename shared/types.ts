export const Role = {
  Admin: 'admin',
  Member: 'member',
} as const
export type Role = (typeof Role)[keyof typeof Role]

export const Visibility = {
  Public: 'public',
  Internal: 'internal',
  Dept: 'dept',
} as const
export type Visibility = (typeof Visibility)[keyof typeof Visibility]

export const PageStatus = {
  Draft: 'draft',
  Pending: 'pending',
  Published: 'published',
  Rejected: 'rejected',
} as const
export type PageStatus = (typeof PageStatus)[keyof typeof PageStatus]

export const PackageType = {
  SingleFile: 'single_file',
  Bundle: 'bundle',
} as const
export type PackageType = (typeof PackageType)[keyof typeof PackageType]

export const SiteScope = {
  Full: 'full',
  PublicOnly: 'public-only',
} as const
export type SiteScope = (typeof SiteScope)[keyof typeof SiteScope]

export const AuditAction = {
  Login: 'login',
  Logout: 'logout',
  ChangePassword: 'change_password',
  ProfileUpdate: 'profile_update',
  UserCreate: 'user_create',
  UserUpdate: 'user_update',
  UserResetPassword: 'user_reset_password',
  UserDelete: 'user_delete',
  Upload: 'upload',
  NewVersion: 'new_version',
  Submit: 'submit',
  Approve: 'approve',
  Reject: 'reject',
  Publish: 'publish',
  Unpublish: 'unpublish',
  Delete: 'delete',
  Restore: 'restore',
  Purge: 'purge',
  Rollback: 'rollback',
  VisibilityChange: 'visibility_change',
  RequestUnpublish: 'request_unpublish',
  WithdrawUnpublish: 'withdraw_unpublish',
  RejectUnpublish: 'reject_unpublish',
} as const
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction]

export const VISIBILITY_VALUES = Object.values(Visibility) as Visibility[]
export const STATUS_VALUES = Object.values(PageStatus) as PageStatus[]
export const ROLE_VALUES = Object.values(Role) as Role[]

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  [Visibility.Public]: '外网公开',
  [Visibility.Internal]: '仅内网全员',
  [Visibility.Dept]: '指定部门可见',
}

export const STATUS_LABEL: Record<PageStatus, string> = {
  [PageStatus.Draft]: '草稿',
  [PageStatus.Pending]: '待审核',
  [PageStatus.Published]: '已发布',
  [PageStatus.Rejected]: '已驳回',
}

export const ROLE_LABEL: Record<Role, string> = {
  [Role.Admin]: '管理员',
  [Role.Member]: '普通员工',
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  departmentId: string | null
  departmentName: string | null
}

export interface PageSummary {
  id: string
  slug: string
  title: string
  summary: string | null
  visibility: Visibility
  status: PageStatus
  packageType: PackageType
  categoryId: string | null
  categoryName: string | null
  tags: string[]
  versionNo: number
  sizeBytes: number
  viewCount: number
  lastViewedAt: string | null
  publishedAt: string | null
  updatedAt: string
  ownerName?: string | null
  departmentName?: string | null
  allowedDepartmentIds?: string[]
  allowedDepartmentNames?: string[]
  unpublishRequestedAt?: string | null
  unpublishReason?: string | null
  unpublishDecisionNote?: string | null
  unpublishRequestedByName?: string | null
  deletedAt?: string | null
  deletedByName?: string | null
}

export interface PageListResponse {
  items: PageSummary[]
  total: number
  page: number
  pageSize: number
  scope: SiteScope
}

/**
 * 管理端/所有者「页面详情」契约：GET /api/manage/pages/:id 与 /api/my-pages/:id 的 page 体。
 * 列表接口的形状见 PageSummary。两端共用本类型，
 * 服务端漏映射/前端漏声明都会被 pnpm typecheck 抓到。
 */
export interface PageDetail {
  id: string
  slug: string
  title: string
  summary: string | null
  visibility: Visibility
  status: PageStatus
  packageType: PackageType
  entryFile: string
  categoryId: string | null
  categoryName: string | null
  tags: string[]
  ownerId: string
  ownerName: string | null
  departmentName: string | null
  rejectionComment: string | null
  unpublishRequestedAt: string | null
  unpublishReason: string | null
  unpublishDecisionNote: string | null
  unpublishRequestedByName: string | null
  deletedAt: string | null
  deletedByName: string | null
  publishedAt: string | null
  updatedAt: string
  allowedDepartmentIds: string[]
  allowedDepartmentNames: string[]
  versions: PageVersionItem[]
}

/**
 * 公开门户「页面详情」契约：GET /api/pages/:slug 的 page 体。
 * 匿名可访问，因此只含展示字段，禁带上传人/部门授权等敏感信息。
 */
export interface PublicPageDetail {
  id: string
  slug: string
  title: string
  summary: string | null
  visibility: Visibility
  status: PageStatus
  packageType: PackageType
  entryFile: string
  categoryName: string | null
  tags: string[]
  publishedAt: string | null
  updatedAt: string
}

export interface PageVersionItem {
  id: string
  versionNo: number
  sizeBytes: number
  changelog: string | null
  createdAt: string
  uploadedByName?: string
  isCurrent: boolean
  /** 仅详情接口返回（列表 /versions 不带） */
  isLive?: boolean
}

export interface AuthSiteInfo {
  scope: SiteScope
  anonymous: boolean
  siteId: string
  host: string
}

export interface StatsOverview {
  totalPages: number
  publishedPages: number
  pendingReview: number
  internalPages: number
  publicPages: number
  deptPages: number
  totalViews: number
  topPages: Array<{ id: string; slug: string; title: string; viewCount: number }>
  byCategory: Array<{ categoryId: string | null; categoryName: string; count: number }>
  byDepartment: Array<{ departmentId: string | null; departmentName: string; count: number }>
}

export interface StatsTrend {
  date: string
  count: number
}

/**
 * 以下为**响应契约**：服务端负责产出，前端负责消费。
 *
 * 约定：响应字段一旦出现在这里，服务端就必须显式声明返回类型（见
 * users.service.ts / meta.service.ts / audit.service.ts 的 `: Promise<...>`），
 * 否则"服务端改了字段名、前端还按旧名字取值"这类问题 typecheck 抓不到，
 * 只会在运行时白屏（PageDetail 曾经就是这样漏的）。
 *
 * 请求参数放这里只是为了"一处查阅"：axios 会把数字序列化成字符串，
 * 服务端仍以 class-validator 的 DTO 为准，两者不共享类型是刻意的。
 */

// ── 参考数据（GET /api/meta/*）──────────────────────────────

export interface CategoryItem {
  id: string
  name: string
  sortOrder: number
  pageCount: number
}

export interface DepartmentItem {
  id: string
  name: string
  code: string
  sortOrder: number
  userCount: number
  pageCount: number
}

/** GET /api/meta/departments/options：只含下拉需要的字段 */
export interface DepartmentOption {
  id: string
  name: string
}

export interface TagItem {
  id: string
  name: string
  pageCount: number
}

// ── 用户管理（GET /api/manage/users）────────────────────────

/** 列表行。新增/改名请同步 server/src/users/users.service.ts 的 mapUser() */
export interface UserItem {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
  departmentId: string | null
  departmentName: string | null
  /** 名下页面数（含回收站），非 0 时不允许删除账号 */
  pageCount: number
  createdAt: string
}

export interface UserListResponse {
  items: UserItem[]
  total: number
  page: number
  pageSize: number
}

export interface UserQuery {
  q?: string
  role?: string
  departmentId?: string
  active?: 'true' | 'false' | 'all'
  page?: number
  pageSize?: number
}

// ── 审计（GET /api/audit-logs）──────────────────────────────

export interface AuditItem {
  id: string
  /** 字符串而非枚举：历史数据可能含已下线动作，前端按 label 兜底展示 */
  action: string
  pageId: string | null
  userId: string | null
  /** 写入时的姓名快照，账号改名/删除后不追溯 */
  userName: string
  ip: string | null
  detail: Record<string, unknown> | null
  createdAt: string
}

export interface AuditListResponse {
  items: AuditItem[]
  total: number
  page: number
  pageSize: number
}

// ── 页面列表筛选参数（GET /api/pages、/api/manage/pages、/api/my-pages）──

export interface PageQuery {
  q?: string
  categoryId?: string
  tag?: string
  departmentId?: string
  visibility?: string
  status?: string
  unpublishRequested?: string
  deleted?: string
  page?: number
  pageSize?: number
}