import { Controller, Get, Query } from '@nestjs/common'
import { AuditService, type AuditQuery } from './audit.service'
import { AllowManage, Roles } from '../common/site-scope/decorators'
import { Role } from '../shared'

@Controller('api/audit-logs')
@AllowManage()
@Roles(Role.Admin)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('pageId') pageId?: string,
  ) {
    const query: AuditQuery = { page: Number(page ?? 1), pageSize: Number(pageSize ?? 20) }
    if (action) query.action = action
    if (userId) query.userId = userId
    if (pageId) query.pageId = pageId
    return this.audit.list(query)
  }
}