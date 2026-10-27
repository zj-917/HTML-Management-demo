import { http } from './client'
import type {
  AuditListResponse,
  AuthSiteInfo,
  CategoryItem,
  DepartmentItem,
  DepartmentOption,
  PageDetail,
  PageListResponse,
  PageQuery,
  PageSummary,
  PageVersionItem,
  PublicPageDetail,
  Role,
  SessionUser,
  StatsOverview,
  StatsTrend,
  TagItem,
  UserItem,
  UserListResponse,
  UserQuery,
} from '@shared/types'

// 视图习惯从 '@/api' 取类型，这里原样转出去；
// 定义的唯一出处是 shared/types.ts（服务端同一份），不再是本文件手写。
export type {
  AuditItem,
  AuditListResponse,
  CategoryItem,
  DepartmentItem,
  DepartmentOption,
  PageQuery,
  TagItem,
  UserItem,
  UserListResponse,
  UserQuery,
} from '@shared/types'

export const api = {
  async siteInfo(): Promise<AuthSiteInfo> {
    const { data } = await http.get<AuthSiteInfo>('/auth/site')
    return data
  },

  async login(email: string, password: string): Promise<SessionUser> {
    const { data } = await http.post<{ user: SessionUser }>('/auth/login', { email, password })
    return data.user
  },

  async logout(): Promise<void> {
    await http.post('/auth/logout')
  },

  async me(): Promise<SessionUser> {
    const { data } = await http.get<{ user: SessionUser }>('/auth/me')
    return data.user
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await http.post('/auth/password', { currentPassword, newPassword })
  },

  async updateProfile(name: string): Promise<SessionUser> {
    const { data } = await http.patch<{ user: SessionUser }>('/auth/profile', { name })
    return data.user
  },

  async listPages(query: PageQuery): Promise<PageListResponse> {
    const { data } = await http.get<PageListResponse>('/pages', { params: clean(query) })
    return data
  },

  async pageDetail(slug: string): Promise<PublicPageDetail> {
    const { data } = await http.get<{ page: PublicPageDetail }>(`/pages/${encodeURIComponent(slug)}`)
    return data.page
  },

  async trackView(slug: string): Promise<void> {
    await http.post(`/pages/${encodeURIComponent(slug)}/view`)
  },

  async managePages(query: PageQuery): Promise<PageListResponse> {
    const { data } = await http.get<PageListResponse>('/manage/pages', { params: clean(query) })
    return data
  },

  async myPages(query: PageQuery): Promise<PageListResponse> {
    const { data } = await http.get<PageListResponse>('/my-pages', { params: clean(query) })
    return data
  },

  async managePage(id: string): Promise<PageDetail> {
    const { data } = await http.get<{ page: PageDetail }>(`/manage/pages/${encodeURIComponent(id)}`)
    return data.page
  },

  async createPage(form: FormData): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>('/manage/pages', form)
    return data
  },

  async addVersion(id: string, form: FormData): Promise<PageVersionItem> {
    const { data } = await http.post<PageVersionItem>(`/manage/pages/${encodeURIComponent(id)}/versions`, form)
    return data
  },

  async updatePage(id: string, payload: Record<string, unknown>): Promise<PageSummary> {
    const { data } = await http.patch<PageSummary>(`/manage/pages/${encodeURIComponent(id)}`, payload)
    return data
  },

  async submitPage(id: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(`/manage/pages/${encodeURIComponent(id)}/submit`)
    return data
  },

  async reviewPage(id: string, action: 'approve' | 'reject', comment?: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(`/manage/pages/${encodeURIComponent(id)}/review`, {
      action,
      comment,
    })
    return data
  },

  async unpublishPage(id: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(`/manage/pages/${encodeURIComponent(id)}/unpublish`)
    return data
  },

  async requestUnpublish(id: string, reason: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(
      `/manage/pages/${encodeURIComponent(id)}/unpublish-request`,
      { reason },
    )
    return data
  },

  async withdrawUnpublish(id: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(
      `/manage/pages/${encodeURIComponent(id)}/unpublish-request/withdraw`,
    )
    return data
  },

  async approveUnpublish(id: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(
      `/manage/pages/${encodeURIComponent(id)}/unpublish-request/approve`,
    )
    return data
  },

  async rejectUnpublish(id: string, note?: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(
      `/manage/pages/${encodeURIComponent(id)}/unpublish-request/reject`,
      { note },
    )
    return data
  },

  async archivePage(id: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(`/manage/pages/${encodeURIComponent(id)}/delete`)
    return data
  },

  async deletePage(id: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(`/manage/pages/${encodeURIComponent(id)}/delete`)
    return data
  },

  async restorePage(id: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(`/manage/pages/${encodeURIComponent(id)}/restore`)
    return data
  },

  async purgePage(id: string): Promise<{ ok: true }> {
    const { data } = await http.delete<{ ok: true }>(`/manage/pages/${encodeURIComponent(id)}`)
    return data
  },

  async rollbackPage(id: string, versionId: string): Promise<PageSummary> {
    const { data } = await http.post<PageSummary>(
      `/manage/pages/${encodeURIComponent(id)}/rollback/${encodeURIComponent(versionId)}`,
    )
    return data
  },

  async categories(): Promise<CategoryItem[]> {
    const { data } = await http.get<{ items: CategoryItem[] }>('/meta/categories')
    return data.items
  },

  async tags(): Promise<TagItem[]> {
    const { data } = await http.get<{ items: TagItem[] }>('/meta/tags')
    return data.items
  },

  async departments(): Promise<DepartmentItem[]> {
    const { data } = await http.get<{ items: DepartmentItem[] }>('/meta/departments')
    return data.items
  },

  async departmentOptions(): Promise<DepartmentOption[]> {
    const { data } = await http.get<{ items: DepartmentOption[] }>('/meta/departments/options')
    return data.items
  },

  async createDepartment(payload: { name: string; code?: string }): Promise<unknown> {
    const { data } = await http.post('/meta/departments', payload)
    return data
  },

  async updateDepartment(id: string, payload: { name?: string; code?: string; sortOrder?: number }): Promise<unknown> {
    const { data } = await http.patch(`/meta/departments/${encodeURIComponent(id)}`, payload)
    return data
  },

  async deleteDepartment(id: string): Promise<void> {
    await http.delete(`/meta/departments/${encodeURIComponent(id)}`)
  },

  async createCategory(payload: { name: string }): Promise<unknown> {
    const { data } = await http.post('/meta/categories', payload)
    return data
  },

  async updateCategory(id: string, payload: { name?: string; sortOrder?: number }): Promise<unknown> {
    const { data } = await http.patch(`/meta/categories/${encodeURIComponent(id)}`, payload)
    return data
  },

  async deleteCategory(id: string): Promise<void> {
    await http.delete(`/meta/categories/${encodeURIComponent(id)}`)
  },

  async users(query: UserQuery = {}): Promise<UserListResponse> {
    const { data } = await http.get<UserListResponse>('/manage/users', { params: clean(query) })
    return data
  },

  async createUser(payload: {
    email: string
    name: string
    role: Role
    departmentId?: string | null
  }): Promise<{ user: UserItem; initialPassword: string }> {
    const { data } = await http.post<{ user: UserItem; initialPassword: string }>(
      '/manage/users',
      payload,
    )
    return data
  },

  async updateUser(
    id: string,
    payload: { name?: string; role?: Role; departmentId?: string | null },
  ): Promise<{ user: UserItem }> {
    const { data } = await http.patch<{ user: UserItem }>(
      `/manage/users/${encodeURIComponent(id)}`,
      payload,
    )
    return data
  },

  async setUserActive(id: string, active: boolean): Promise<{ user: UserItem }> {
    const { data } = await http.post<{ user: UserItem }>(
      `/manage/users/${encodeURIComponent(id)}/active`,
      { active },
    )
    return data
  },

  async resetUserPassword(id: string): Promise<{ password: string }> {
    const { data } = await http.post<{ password: string }>(
      `/manage/users/${encodeURIComponent(id)}/reset-password`,
    )
    return data
  },

  async deleteUser(id: string): Promise<void> {
    await http.delete(`/manage/users/${encodeURIComponent(id)}`)
  },

  async statsOverview(): Promise<StatsOverview> {
    const { data } = await http.get<StatsOverview>('/stats/overview')
    return data
  },

  async statsTrend(days = 30): Promise<StatsTrend[]> {
    const { data } = await http.get<StatsTrend[]>('/stats/trend', { params: { days } })
    return data
  },

  async auditLogs(params: {
    page?: number
    pageSize?: number
    action?: string
    pageId?: string
  }): Promise<AuditListResponse> {
    const { data } = await http.get<AuditListResponse>('/audit-logs', { params: clean(params) })
    return data
  },
}

function clean(input: object): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') output[key] = value
  }
  return output
}

export function contentUrl(slug: string, file = ''): string {
  // 页面入口统一走 play：服务端鉴权后 302 到带「资源令牌」的地址。
  // 直接给 /p/{slug}/ 的话，页面处于 CSP 沙箱（不透明源），里面的图片请求
  // 不会带 SameSite=Lax 的登录 Cookie，内网/部门页会整页图裂。
  if (file) return `/p/${slug}/${file}`
  return `/api/pages/${slug}/play`
}