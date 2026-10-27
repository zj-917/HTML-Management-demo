import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service'
import { Role, type CategoryItem, type DepartmentItem, type DepartmentOption, type SessionUser, type TagItem } from '../shared'

@Injectable()
export class MetaService {
  constructor(private readonly prisma: PrismaService) {}

  async listDepartmentOptions(): Promise<{ items: DepartmentOption[] }> {
    const departments = await this.prisma.department.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    })
    return { items: departments }
  }

  async listDepartments(): Promise<{ items: DepartmentItem[] }> {
    const departments = await this.prisma.department.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { users: true, pages: true } } },
    })
    return {
      items: departments.map((item) => ({
        id: item.id,
        name: item.name,
        code: item.code,
        sortOrder: item.sortOrder,
        userCount: item._count.users,
        pageCount: item._count.pages,
      })),
    }
  }

  async createDepartment(input: { name?: string; code?: string; sortOrder?: number }, actor: SessionUser) {
    this.assertAdmin(actor)
    const name = input.name?.trim()
    if (!name) throw new BadRequestException('请填写部门名称')
    const code = input.code?.trim() || slugCode(name)
    await this.assertUniqueDepartment({ name, code })
    const created = await this.prisma.department.create({
      data: { name, code, sortOrder: input.sortOrder ?? 0 },
    })
    return created
  }

  async updateDepartment(id: string, input: { name?: string; code?: string; sortOrder?: number }, actor: SessionUser) {
    this.assertAdmin(actor)
    const existing = await this.prisma.department.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('部门不存在')
    if (input.name !== undefined) {
      await this.assertUniqueDepartment({ name: input.name.trim(), code: input.code?.trim() }, id)
    }
    return this.prisma.department.update({
      where: { id },
      data: {
        name: input.name?.trim() ?? existing.name,
        code: input.code?.trim() ?? existing.code,
        sortOrder: input.sortOrder ?? existing.sortOrder,
      },
    })
  }

  async deleteDepartment(id: string, actor: SessionUser) {
    this.assertAdmin(actor)
    const [userCount, pageCount] = await Promise.all([
      this.prisma.user.count({ where: { departmentId: id } }),
      this.prisma.page.count({ where: { departmentId: id } }),
    ])
    if (userCount > 0) throw new BadRequestException('该部门下仍有员工，无法删除')
    if (pageCount > 0) throw new BadRequestException('该部门下仍有页面归属，无法删除')
    await this.prisma.department.delete({ where: { id } })
    return { ok: true }
  }

  async listCategories(): Promise<{ items: CategoryItem[] }> {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { pages: true } } },
    })
    return {
      items: categories.map((item) => ({
        id: item.id,
        name: item.name,
        sortOrder: item.sortOrder,
        pageCount: item._count.pages,
      })),
    }
  }

  async createCategory(input: { name?: string; sortOrder?: number }, actor: SessionUser) {
    this.assertAdmin(actor)
    const name = input.name?.trim()
    if (!name) throw new BadRequestException('请填写分类名称')
    await this.assertUniqueCategory(name)
    return this.prisma.category.create({ data: { name, sortOrder: input.sortOrder ?? 0 } })
  }

  async updateCategory(id: string, input: { name?: string; sortOrder?: number }, actor: SessionUser) {
    this.assertAdmin(actor)
    const existing = await this.prisma.category.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('分类不存在')
    if (input.name !== undefined) await this.assertUniqueCategory(input.name.trim(), id)
    return this.prisma.category.update({
      where: { id },
      data: { name: input.name?.trim() ?? existing.name, sortOrder: input.sortOrder ?? existing.sortOrder },
    })
  }

  async deleteCategory(id: string, actor: SessionUser) {
    this.assertAdmin(actor)
    await this.prisma.category.delete({ where: { id } })
    return { ok: true }
  }

  async listTags(): Promise<{ items: TagItem[] }> {
    const tags = await this.prisma.tag.findMany({ include: { _count: { select: { pages: true } } } })
    return {
      items: tags
        .map((item) => ({ id: item.id, name: item.name, pageCount: item._count.pages }))
        .sort((a, b) => b.pageCount - a.pageCount),
    }
  }

  private assertAdmin(actor: SessionUser): void {
    if (actor.role !== Role.Admin) throw new ForbiddenException('只有管理员可以执行该操作')
  }

  private async assertUniqueDepartment(
    where: { name?: string; code?: string },
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.department.findFirst({
      where: excludeId ? { AND: [where, { id: { not: excludeId } }] } : where,
    })
    if (existing) throw new BadRequestException('部门名称或编码已存在')
  }

  private async assertUniqueCategory(name: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.category.findFirst({
      where: excludeId ? { AND: [{ name }, { id: { not: excludeId } }] } : { name },
    })
    if (existing) throw new BadRequestException('分类名称已存在')
  }
}

function slugCode(name: string): string {
  const ascii = name
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return ascii || `dept-${Date.now().toString(36)}`
}