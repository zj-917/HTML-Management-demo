import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { PageStatus, Visibility, VISIBILITY_VALUES, type Visibility as VisibilityValue } from '../shared'

export function parseList(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === '') return []
  const value = Array.isArray(raw) ? raw.map(String) : [String(raw)]
  const flat: string[] = []
  for (const item of value) {
    const trimmed = item.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            const text = String(entry).trim()
            if (text) flat.push(text)
          }
          continue
        }
      } catch {
        throw new Error(`无法解析列表字段: ${trimmed.slice(0, 40)}`)
      }
    }
    for (const part of trimmed.split(',')) {
      const text = part.trim()
      if (text) flat.push(text)
    }
  }
  return Array.from(new Set(flat))
}

export class CreatePageDto {
  @IsString()
  @IsNotEmpty({ message: '请填写页面标题' })
  @MaxLength(120)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string

  @IsOptional()
  @IsString()
  categoryId?: string

  @IsIn(VISIBILITY_VALUES, { message: '请选择可见性：外网公开 / 仅内网全员 / 指定部门可见' })
  @IsNotEmpty({ message: '必须选择可见性，不提供默认值' })
  visibility!: VisibilityValue

  @IsOptional()
  @IsString()
  tags?: string

  @IsOptional()
  @IsString()
  departmentIds?: string

  @IsOptional()
  @IsString()
  @MaxLength(300)
  changelog?: string
}

export class UpdatePageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string

  @IsOptional()
  @IsString()
  categoryId?: string

  @IsOptional()
  @IsIn(VISIBILITY_VALUES)
  visibility?: VisibilityValue

  @IsOptional()
  @IsString()
  tags?: string

  @IsOptional()
  @IsString()
  departmentIds?: string
}

export class NewVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  changelog?: string
}

export class ReviewDto {
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject'

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string
}

/**
 * 查询参数基类。
 *
 * 必须为每个字段声明验证装饰器：ValidationPipe 启用了 whitelist: true，
 * 会静默移除所有没有装饰器的属性，导致前端传的筛选条件全部失效
 * （例如 status / visibility / categoryId 被丢弃，列表过滤形同虚设）。
 *
 * 新增查询字段时请继承本类并写明装饰器，同时在 scripts/verify-isolation.mjs
 * 中补一条对应的行为断言。
 */
export class BaseQueryDto {
  @IsOptional() @IsString() q?: string
  @IsOptional() @IsString() categoryId?: string
  @IsOptional() @IsString() tag?: string
  @IsOptional() @IsString() departmentId?: string
  @IsOptional() @IsString() visibility?: string
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsString() ownerId?: string
  @IsOptional() @IsString() deleted?: string
  @IsOptional() @IsString() unpublishRequested?: string
  @IsOptional() @IsString() page?: string
  @IsOptional() @IsString() pageSize?: string
}

export class PageQueryDto extends BaseQueryDto {}

export class RequestUnpublishDto {
  @IsString()
  @IsNotEmpty({ message: '请填写下线原因，便于管理员判断' })
  @MinLength(5, { message: '下线原因至少 5 个字' })
  @MaxLength(300, { message: '下线原因最多 300 个字' })
  reason!: string
}

export class DecideUnpublishDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string
}

export const PORTAL_STATUSES = [PageStatus.Published]
export const VISIBILITY_OPTIONS = Object.values(Visibility)