import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { CreateUserDto, ListUsersQuery, SetActiveDto, UpdateUserDto } from './dto'
import { UsersService } from './users.service'
import { AllowManage, ClientIp, CurrentUser, Roles, UserAgent } from '../common/site-scope/decorators'
import { Role, type SessionUser } from '../shared'

/**
 * 用户管理（管理员专用）。
 *
 * 放在 /api/manage 命名域而不是 /api/meta：这是管理业务实体，不是参考数据；
 * @AllowManage() 保证外网站点整体 404，@Roles(Admin) 保证员工 403。
 */
@Controller('api/manage/users')
@AllowManage()
@Roles(Role.Admin)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersQuery) {
    return this.users.list(query)
  }

  @Post()
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    return this.users.create(dto, actor, { ip, ua })
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    return this.users.update(id, dto, actor, { ip, ua })
  }

  @Post(':id/active')
  @HttpCode(HttpStatus.OK)
  setActive(
    @Param('id') id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() actor: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    return this.users.setActive(id, dto.active, actor, { ip, ua })
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Param('id') id: string,
    @CurrentUser() actor: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    return this.users.resetPassword(id, actor, { ip, ua })
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    return this.users.remove(id, actor, { ip, ua })
  }
}
