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
} from '@nestjs/common'
import { MetaService } from './meta.service'
import { AllowAnonymous, AllowManage, CurrentUser, Roles } from '../common/site-scope/decorators'
import { Role, type SessionUser } from '../shared'

interface DepartmentInput {
  name?: string
  code?: string
  sortOrder?: number
}

interface CategoryInput {
  name?: string
  sortOrder?: number
}

@Controller('api/meta')
export class MetaController {
  constructor(private readonly meta: MetaService) {}

  @Get('categories')
  @AllowAnonymous()
  categories() {
    return this.meta.listCategories()
  }

  @Get('tags')
  @AllowAnonymous()
  tags() {
    return this.meta.listTags()
  }

  @Get('departments/options')
  @AllowManage()
  async departmentOptions() {
    return this.meta.listDepartmentOptions()
  }

  @Get('departments')
  @AllowManage()
  @Roles(Role.Admin)
  departments() {
    return this.meta.listDepartments()
  }

  @Post('departments')
  @AllowManage()
  @Roles(Role.Admin)
  createDepartment(@Body() body: DepartmentInput, @CurrentUser() user: SessionUser) {
    return this.meta.createDepartment(body, user)
  }

  @Patch('departments/:id')
  @AllowManage()
  @Roles(Role.Admin)
  updateDepartment(@Param('id') id: string, @Body() body: DepartmentInput, @CurrentUser() user: SessionUser) {
    return this.meta.updateDepartment(id, body, user)
  }

  @Delete('departments/:id')
  @AllowManage()
  @Roles(Role.Admin)
  @HttpCode(HttpStatus.OK)
  deleteDepartment(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.meta.deleteDepartment(id, user)
  }

  @Post('categories')
  @AllowManage()
  @Roles(Role.Admin)
  createCategory(@Body() body: CategoryInput, @CurrentUser() user: SessionUser) {
    return this.meta.createCategory(body, user)
  }

  @Patch('categories/:id')
  @AllowManage()
  @Roles(Role.Admin)
  updateCategory(@Param('id') id: string, @Body() body: CategoryInput, @CurrentUser() user: SessionUser) {
    return this.meta.updateCategory(id, body, user)
  }

  @Delete('categories/:id')
  @AllowManage()
  @Roles(Role.Admin)
  @HttpCode(HttpStatus.OK)
  deleteCategory(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.meta.deleteCategory(id, user)
  }
}