import { Controller, Get, Query } from '@nestjs/common'
import { StatsService } from './stats.service'
import { AllowManage, Roles } from '../common/site-scope/decorators'
import { Role } from '../shared'

@Controller('api/stats')
@AllowManage()
@Roles(Role.Admin)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  overview() {
    return this.stats.overview()
  }

  @Get('trend')
  trend(@Query('days') days?: string) {
    return this.stats.trend(Number(days ?? 30))
  }

  @Get('top')
  top(@Query('take') take?: string) {
    return { items: this.stats.topPages(Number(take ?? 10)) }
  }
}