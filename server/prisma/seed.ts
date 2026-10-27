import '../src/load-env'
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { repoRoot } from '../src/common/config'
import { dayKeyDaysAgo } from '../src/common/business-date'

const prisma = new PrismaClient()

const REPO_ROOT = repoRoot()
const STORAGE_ROOT = resolve(REPO_ROOT, process.env.STORAGE_ROOT ?? './data')
const SAMPLES = join(REPO_ROOT, 'sample-pages')

function cuid(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest()
  let out = ''
  for (let i = 0; i < 25; i += 1) out += alphabet[bytes[i] % alphabet.length]
  return out
}

function slugOf(length = 8): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz'
  const bytes = createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest()
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length]
  return out
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry)
    const info = await stat(full)
    if (info.isDirectory()) out.push(...(await listFiles(full)).map((rel) => join(entry, rel)))
    else out.push(entry)
  }
  return out
}

async function writeVersionFiles(
  pageId: string,
  versionId: string,
  sourceDir: string,
): Promise<{ fileCount: number; sizeBytes: number }> {
  const target = join(STORAGE_ROOT, 'versions', pageId, versionId)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(sourceDir, target, { recursive: true })

  let sizeBytes = 0
  for (const rel of await listFiles(target)) {
    sizeBytes += (await stat(join(target, rel))).size
  }
  return { fileCount: (await listFiles(target)).length, sizeBytes }
}

async function writeVersionFromBuffer(
  pageId: string,
  versionId: string,
  content: Buffer,
): Promise<{ fileCount: number; sizeBytes: number }> {
  const target = join(STORAGE_ROOT, 'versions', pageId, versionId)
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'index.html'), content)
  return { fileCount: 1, sizeBytes: content.length }
}

async function publish(bucket: string, slug: string, pageId: string, versionId: string): Promise<void> {
  const source = join(STORAGE_ROOT, 'versions', pageId, versionId)
  const target = join(STORAGE_ROOT, bucket, slug)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(source, target, { recursive: true })
}

async function ensureLayout(): Promise<void> {
  for (const dir of ['versions', 'public', 'internal', 'dept']) {
    await mkdir(join(STORAGE_ROOT, dir), { recursive: true })
  }
}

interface SeedPageInput {
  title: string
  summary: string
  source: string
  isDirectory: boolean
  visibility: 'public' | 'internal' | 'dept'
  status: 'published' | 'pending'
  categoryId?: string
  departmentIds?: string[]
  tags: string[]
  ownerId: string
  departmentId: string | null
  changelog: string
  views: number
  deleted?: boolean
}

async function seedPage(input: SeedPageInput): Promise<string> {
  const pageId = cuid()
  const versionId = cuid()
  const slug = slugOf()
  const sourceDir = join(SAMPLES, input.source)

  const stats = input.isDirectory
    ? await writeVersionFiles(pageId, versionId, sourceDir)
    : await writeVersionFromBuffer(pageId, versionId, await readFile(sourceDir))

  const publishedAt = input.status === 'published' ? daysAgo(3) : null

  await prisma.page.create({
    data: {
      id: pageId,
      slug,
      title: input.title,
      summary: input.summary,
      visibility: input.visibility,
      status: input.status,
      packageType: input.isDirectory ? 'bundle' : 'single_file',
      entryFile: 'index.html',
      categoryId: input.categoryId ?? null,
      ownerId: input.ownerId,
      departmentId: input.departmentId,
      currentVersionId: versionId,
      publishedVersionId: input.status === 'published' ? versionId : null,
      publishedAt,
    },
  })

  await prisma.pageVersion.create({
    data: {
      id: versionId,
      pageId,
      versionNo: 1,
      storagePath: join(STORAGE_ROOT, 'versions', pageId, versionId),
      sizeBytes: stats.sizeBytes,
      fileCount: stats.fileCount,
      changelog: input.changelog,
      uploadedById: input.ownerId,
      createdAt: daysAgo(4),
    },
  })

  for (const name of input.tags) {
    const tag = await prisma.tag.upsert({ where: { name }, create: { name }, update: {} })
    await prisma.pageTag.create({ data: { pageId, tagId: tag.id } })
  }

  for (const departmentId of input.departmentIds ?? []) {
    await prisma.pageDept.create({ data: { pageId, departmentId } })
  }

  if (input.status === 'published') {
    const bucket = input.visibility === 'public' ? 'public' : input.visibility === 'internal' ? 'internal' : 'dept'
    await publish(bucket, slug, pageId, versionId)
  }

  if (input.deleted) {
    const bucket = input.visibility === 'public' ? 'public' : input.visibility === 'internal' ? 'internal' : 'dept'
    await rm(join(STORAGE_ROOT, bucket, slug), { recursive: true, force: true })
    await prisma.page.update({
      where: { id: pageId },
      data: { deletedAt: daysAgo(3), viewCount: input.views, lastViewedAt: daysAgo(1) },
    })
  } else {
    await prisma.page.update({
      where: { id: pageId },
      data: { viewCount: input.views, lastViewedAt: daysAgo(1) },
    })
  }

  for (let offset = 0; offset < 30; offset += 1) {
    // 必须用业务时区的日期键，与 recordView 写入口径一致，否则演示数据会整体错位一天。
    const date = dayKeyDaysAgo(offset)
    const wave = Math.max(0, Math.round(input.views / 30) + ((offset * 7) % 5) - 2)
    if (wave <= 0) continue
    await prisma.viewStat.create({ data: { pageId, date, count: wave } })
  }

  return slug
}

function daysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

async function main(): Promise<void> {
  await ensureLayout()
  console.log('[seed] storage root:', STORAGE_ROOT)

  console.log('[seed] clearing existing data')
  await prisma.viewStat.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.pageTag.deleteMany()
  await prisma.pageDept.deleteMany()
  await prisma.pageVersion.deleteMany()
  await prisma.page.deleteMany()
  await prisma.tag.deleteMany()
  await prisma.category.deleteMany()
  await prisma.user.deleteMany()
  await prisma.department.deleteMany()

  console.log('[seed] creating departments')
  const deptSales = await prisma.department.create({ data: { name: '销售部', code: 'sales', sortOrder: 1 } })
  const deptFinance = await prisma.department.create({ data: { name: '财务部', code: 'finance', sortOrder: 2 } })
  const deptHr = await prisma.department.create({ data: { name: '人力资源部', code: 'hr', sortOrder: 3 } })
  const deptRd = await prisma.department.create({ data: { name: '研发中心', code: 'rd', sortOrder: 4 } })
  const deptMarket = await prisma.department.create({ data: { name: '市场部', code: 'market', sortOrder: 5 } })

  console.log('[seed] creating categories')
  const catReport = await prisma.category.create({ data: { name: '数据报表', sortOrder: 1 } })
  const catProduct = await prisma.category.create({ data: { name: '产品介绍', sortOrder: 2 } })
  const catInternal = await prisma.category.create({ data: { name: '内部资料', sortOrder: 3 } })
  const catRecruit = await prisma.category.create({ data: { name: '招聘', sortOrder: 4 } })

  console.log('[seed] creating users')
  const password = (value: string) => bcrypt.hashSync(value, 10)
  const admin = await prisma.user.create({
    data: {
      name: '系统管理员',
      email: 'admin@hmp.local',
      passwordHash: password('admin123'),
      role: 'admin',
      departmentId: deptRd.id,
    },
  })
  const reviewer = await prisma.user.create({
    data: {
      name: '李管理',
      email: 'admin2@hmp.local',
      passwordHash: password('admin2_123'),
      role: 'admin',
      departmentId: deptRd.id,
    },
  })
  const salesUser = await prisma.user.create({
    data: {
      name: '李销售',
      email: 'sales@hmp.local',
      passwordHash: password('sales123'),
      role: 'member',
      departmentId: deptSales.id,
    },
  })
  const financeUser = await prisma.user.create({
    data: {
      name: '王财务',
      email: 'finance@hmp.local',
      passwordHash: password('finance123'),
      role: 'member',
      departmentId: deptFinance.id,
    },
  })
  const hrUser = await prisma.user.create({
    data: {
      name: '赵人力',
      email: 'hr@hmp.local',
      passwordHash: password('hr123'),
      role: 'member',
      departmentId: deptHr.id,
    },
  })

  console.log('[seed] creating pages')
  const publicReport = await seedPage({
    title: '2026 Q1 销售战报',
    summary: '销售部季度回款、大区完成率与重点客户进展的对外公开版本。',
    source: 'sales-q1-report.html',
    isDirectory: false,
    visibility: 'public',
    status: 'published',
    categoryId: catReport.id,
    tags: ['销售', '季度', '报表'],
    ownerId: salesUser.id,
    departmentId: deptSales.id,
    changelog: '首次上传',
    views: 486,
  })

  const productLaunch = await seedPage({
    title: 'NOVA X1 新品发布页',
    summary: '市场部制作的新品介绍站点，包含首页与关于页两个文件。',
    source: 'product-launch',
    isDirectory: true,
    visibility: 'public',
    status: 'published',
    categoryId: catProduct.id,
    tags: ['产品', '市场', '官网'],
    ownerId: admin.id,
    departmentId: deptMarket.id,
    changelog: '首次上传',
    views: 312,
  })

  const costAnalysis = await seedPage({
    title: '成本结构分析（内部）',
    summary: '含未公开财务数据，仅限内网登录用户访问。',
    source: 'finance-cost-analysis.html',
    isDirectory: false,
    visibility: 'internal',
    status: 'published',
    categoryId: catInternal.id,
    tags: ['财务', '内部'],
    ownerId: financeUser.id,
    departmentId: deptFinance.id,
    changelog: '首次上传',
    views: 97,
  })

  const recruitment = await seedPage({
    title: '招聘需求看板',
    summary: '人力资源部专属，含编制与薪酬相关信息。',
    source: 'hr-recruitment-board.html',
    isDirectory: false,
    visibility: 'dept',
    status: 'published',
    categoryId: catRecruit.id,
    departmentIds: [deptHr.id],
    tags: ['招聘', '人力'],
    ownerId: hrUser.id,
    departmentId: deptHr.id,
    changelog: '首次上传',
    views: 54,
  })

  await seedPage({
    title: '客户满意度调研（待审核）',
    summary: '市场部提交，包含外部问卷链接，等待审核后发布到外网。',
    source: 'sales-q1-report.html',
    isDirectory: false,
    visibility: 'public',
    status: 'pending',
    categoryId: catReport.id,
    tags: ['调研'],
    ownerId: admin.id,
    departmentId: deptMarket.id,
    changelog: '首次上传',
    views: 0,
  })

  await seedPage({
    title: '2025 年度总结（已删除示例）',
    summary: '用于演示回收站：已进回收站，保留 30 天后自动彻底删除，可在此恢复。',
    source: 'finance-cost-analysis.html',
    isDirectory: false,
    visibility: 'internal',
    status: 'published',
    categoryId: catInternal.id,
    tags: ['年度', '已删除'],
    ownerId: admin.id,
    departmentId: deptRd.id,
    changelog: '首次上传',
    views: 0,
    deleted: true,
  })

  console.log('[seed] creating audit trail')
  const auditEntries = [
    { userId: admin.id, action: 'login', pageId: null },
    { userId: salesUser.id, action: 'upload', pageId: publicReport },
    { userId: reviewer.id, action: 'approve', pageId: publicReport },
    { userId: admin.id, action: 'upload', pageId: productLaunch },
    { userId: reviewer.id, action: 'approve', pageId: productLaunch },
    { userId: financeUser.id, action: 'upload', pageId: costAnalysis },
    { userId: reviewer.id, action: 'approve', pageId: costAnalysis },
    { userId: hrUser.id, action: 'upload', pageId: recruitment },
    { userId: reviewer.id, action: 'approve', pageId: recruitment },
  ]
  for (const [index, entry] of auditEntries.entries()) {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        pageId: entry.pageId,
        ip: '192.168.1.100',
        ua: 'seed',
        createdAt: daysAgo(4 - Math.floor(index / 3)),
        detail: JSON.stringify({ seeded: true }),
      },
    })
  }

  const pageCount = await prisma.page.count()
  const deletedCount = await prisma.page.count({ where: { deletedAt: { not: null } } })
  console.log(`[seed] done. pages=${pageCount} (recycle-bin=${deletedCount}) departments=5 categories=4 users=5`)
  console.log('[seed] demo accounts:')
  console.log('  admin@hmp.local / admin123      管理员（主）')
  console.log('  admin2@hmp.local / admin2_123   管理员（兼审核）')
  console.log('  sales@hmp.local / sales123      销售部成员')
  console.log('  finance@hmp.local / finance123  财务部成员')
  console.log('  hr@hmp.local / hr123            人力资源部成员')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error('[seed] failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })