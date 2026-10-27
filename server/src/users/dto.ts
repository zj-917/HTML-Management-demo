import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { ROLE_VALUES, type Role } from '../shared'

export class CreateUserDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string

  @IsString({ message: '姓名不能为空' })
  @MaxLength(40, { message: '姓名不能超过 40 个字符' })
  name!: string

  @IsString({ message: '角色不能为空' })
  @IsIn(ROLE_VALUES, { message: '角色只能是 admin 或 member' })
  role!: Role

  /** 部门可为空（例如尚未定岗的新人） */
  @IsOptional()
  @IsString()
  departmentId?: string | null
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(40, { message: '姓名不能超过 40 个字符' })
  name?: string

  @IsOptional()
  @IsString()
  @IsIn(ROLE_VALUES, { message: '角色只能是 admin 或 member' })
  role?: Role

  /**
   * 传字符串 = 调到该部门；传 null = 清空部门；不传 = 保持不变。
   * 注意这是**鉴权输入**（dept 档页面按 departmentId 放行），只能由管理员改。
   */
  @IsOptional()
  @IsString()
  departmentId?: string | null
}

export class SetActiveDto {
  @IsBoolean({ message: 'active 必须是布尔值' })
  active!: boolean
}

/** 列表筛选。沿用 pages/dto.ts 的约定：查询参数都按字符串收，service 里再解析数值 */
export class ListUsersQuery {
  @IsOptional() @IsString() q?: string
  @IsOptional() @IsString() role?: string
  @IsOptional() @IsString() departmentId?: string
  @IsOptional() @IsString() active?: string
  @IsOptional() @IsString() page?: string
  @IsOptional() @IsString() pageSize?: string
}
