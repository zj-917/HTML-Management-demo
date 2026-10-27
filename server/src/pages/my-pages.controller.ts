import { Controller, Get, Param, Query } from '@nestjs/common'
import { PagesService } from './pages.service'
import { PageQueryDto } from './dto'
import { toPageDetail } from './page-mapper'
import { AllowManage, CurrentSite, CurrentUser } from '../common/site-scope/decorators'
import type { SiteDefinition } from '../common/config'
import type { SessionUser } from '../shared'

@Controller('api/my-pages')
@AllowManage()
export class MyPagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  list(@Query() query: PageQueryDto, @CurrentSite() site: SiteDefinition, @CurrentUser() user: SessionUser) {
    return this.pages.listMine(query, site, user)
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return { page: toPageDetail(await this.pages.getForManage(id, user)) }
  }
}
