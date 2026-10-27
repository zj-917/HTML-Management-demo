import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service'
import { dayKeyDaysAgo } from '../common/business-date'
import { PageStatus, Visibility, type StatsOverview, type StatsTrend } from '../shared'

const LIVE_STATUS = PageStatus.Published
const LIVE_ONLY = { deletedAt: null, status: LIVE_STATUS } as const
const VISIBLE_ONLY = (visibility: Visibility) => ({ deletedAt: null, visibility, status: LIVE_STATUS }) as const

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<StatsOverview> {
    const [
      totalPages,
      publishedPages,
      pendingReview,
      internalPages,
      publicPages,
      deptPages,
      viewsAggregate,
      topPages,
      categoryGroups,
      departmentGroups,
      categoryNames,
      departmentNames,
    ] = await Promise.all([
      this.prisma.page.count({ where: { deletedAt: null } }),
      this.prisma.page.count({ where: LIVE_ONLY }),
      this.prisma.page.count({ where: { deletedAt: null, status: PageStatus.Pending } }),
      this.prisma.page.count({ where: VISIBLE_ONLY(Visibility.Internal) }),
      this.prisma.page.count({ where: VISIBLE_ONLY(Visibility.Public) }),
      this.prisma.page.count({ where: VISIBLE_ONLY(Visibility.Dept) }),
      this.prisma.page.aggregate({ _sum: { viewCount: true }, where: LIVE_ONLY }),
      this.fetchTopPages(),
      this.prisma.page.groupBy({ by: ['categoryId'], _count: { _all: true }, where: LIVE_ONLY }),
      this.prisma.page.groupBy({ by: ['departmentId'], _count: { _all: true }, where: LIVE_ONLY }),
      this.prisma.category.findMany({ select: { id: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ])

    const categoryNameMap = new Map(categoryNames.map((item) => [item.id, item.name]))
    const departmentNameMap = new Map(departmentNames.map((item) => [item.id, item.name]))

    return {
      totalPages,
      publishedPages,
      pendingReview,
      internalPages,
      publicPages,
      deptPages,
      totalViews: viewsAggregate._sum.viewCount ?? 0,
      topPages,
      byCategory: categoryGroups
        .map((group) => ({
          categoryId: group.categoryId,
          categoryName: group.categoryId ? (categoryNameMap.get(group.categoryId) ?? '已删除分类') : '未分类',
          count: group._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      byDepartment: departmentGroups
        .map((group) => ({
          departmentId: group.departmentId,
          departmentName: group.departmentId
            ? (departmentNameMap.get(group.departmentId) ?? '已删除部门')
            : '未归属',
          count: group._count._all,
        }))
        .sort((a, b) => b.count - a.count),
    }
  }

  async trend(days = 30): Promise<StatsTrend[]> {
    const span = Math.max(1, Math.min(90, Math.trunc(days) || 30))
    // 与写入端 recordView 用同一个业务时区日期键，否则凌晨的访问会被算到前一天。
    const startDate = dayKeyDaysAgo(span - 1)

    const rows = await this.prisma.viewStat.findMany({
      where: { date: { gte: startDate } },
      orderBy: { date: 'asc' },
      select: { date: true, count: true },
    })
    // 同一天会有每个页面各一行，必须按日期求和。
    // 直接用 Map.set 会让后写的页面覆盖先写的，总数被压成单页数值。
    const byDate = new Map<string, number>()
    for (const row of rows) {
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.count)
    }

    const result: StatsTrend[] = []
    for (let offset = 0; offset < span; offset += 1) {
      const key = dayKeyDaysAgo(span - 1 - offset)
      result.push({ date: key, count: byDate.get(key) ?? 0 })
    }
    return result
  }

  async topPages(take = 10) {
    return this.fetchTopPages(take)
  }

  private async fetchTopPages(take = 10) {
    return this.prisma.page.findMany({
      where: LIVE_ONLY,
      orderBy: [{ viewCount: 'desc' }, { updatedAt: 'desc' }],
      take: Math.max(1, Math.min(50, take)),
      select: { id: true, slug: true, title: true, viewCount: true, visibility: true },
    })
  }
}