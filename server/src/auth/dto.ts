import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'

export class LoginDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string

  @IsString()
  @MinLength(4, { message: '密码至少 4 位' })
  password!: string
}

export class ChangePasswordDto {
  @IsString({ message: '当前密码不能为空' })
  currentPassword!: string

  /**
   * 新密码本身收紧到 8 位：这只约束「新设」的密码，不影响老密码登录
   * （登录仍是 4 位下限，seed 里的 hr123 是 5 位，属于演示遗留）。
   */
  @IsString({ message: '新密码不能为空' })
  @MinLength(8, { message: '新密码至少 8 位' })
  newPassword!: string
}

export class UpdateProfileDto {
  /** 本人可改的字段只有姓名：角色 / 部门 / 邮箱 / 启停都影响鉴权或身份锚点 */
  @IsString({ message: '姓名不能为空' })
  @MaxLength(40, { message: '姓名不能超过 40 个字符' })
  name!: string
}