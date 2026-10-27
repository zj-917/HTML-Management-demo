import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { uploadLimits } from '../common/config'
import { PagesService, type RequestContext } from './pages.service'
import { CreatePageDto, DecideUnpublishDto, NewVersionDto, PageQueryDto, RequestUnpublishDto, ReviewDto, UpdatePageDto } from './dto'
import { toPageDetail } from './page-mapper'
import {
  AllowManage,
  ClientIp,
  CurrentSite,
  CurrentUser,
  Roles,
  UserAgent,
} from '../common/site-scope/decorators'
import type { SiteDefinition } from '../common/config'
import { Role, type SessionUser } from '../shared'

@Controller('api/manage/pages')
@AllowManage()
export class ManagePagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  @Roles(Role.Admin)
  async list(
    @Query() query: PageQueryDto,
    @CurrentSite() site: SiteDefinition,
    @CurrentUser() user: SessionUser,
  ) {
    return this.pages.listForManage(query, site, user)
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    const page = await this.pages.getForManage(id, user)
    return { page: toPageDetail({ ...page, tags: page.tags.map((item) => ({ tag: item.tag })) }) }
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: uploadLimits().maxUploadBytes } }))
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreatePageDto,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    this.assertFile(file)
    return this.pages.create(dto, file, user, { ip, ua })
  }

  @Post(':id/versions')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: uploadLimits().maxUploadBytes } }))
  async addVersion(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: NewVersionDto,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    this.assertFile(file)
    const page = await this.pages.getForManage(id, user)
    return this.pages.addVersion(page, dto, file, user, { ip, ua })
  }

  @Get(':id/versions')
  async versions(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    const page = await this.pages.getForManage(id, user)
    return { items: await this.pages.listVersions(page, user) }
  }

  @Patch(':id')
  @Roles(Role.Admin)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePageDto,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.updateMeta(page, dto, user, { ip, ua })
  }

  @Post(':id/submit')
  async submit(@Param('id') id: string, @CurrentUser() user: SessionUser, @ClientIp() ip: string, @UserAgent() ua: string) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.submit(page, user, { ip, ua })
  }

  @Post(':id/review')
  @Roles(Role.Admin)
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewDto,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.review(page, dto, user, { ip, ua })
  }

  @Post(':id/unpublish-request')
  async requestUnpublish(
    @Param('id') id: string,
    @Body() dto: RequestUnpublishDto,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.requestUnpublish(page, dto, user, { ip, ua })
  }

  @Post(':id/unpublish-request/withdraw')
  async withdrawUnpublish(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.withdrawUnpublish(page, user, { ip, ua })
  }

  @Post(':id/unpublish-request/approve')
  @Roles(Role.Admin)
  async approveUnpublish(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.approveUnpublish(page, user, { ip, ua })
  }

  @Post(':id/unpublish-request/reject')
  @Roles(Role.Admin)
  async rejectUnpublish(
    @Param('id') id: string,
    @Body() dto: DecideUnpublishDto,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.rejectUnpublish(page, dto, user, { ip, ua })
  }

  @Post(':id/unpublish')
  @Roles(Role.Admin)
  async unpublish(@Param('id') id: string, @CurrentUser() user: SessionUser, @ClientIp() ip: string, @UserAgent() ua: string) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.unpublish(page, user, { ip, ua })
  }

  @Post(':id/delete')
  async softDelete(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.softDelete(page, user, { ip, ua })
  }

  @Post(':id/restore')
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.restore(page, user, { ip, ua })
  }

  @Post(':id/rollback/:versionId')
  @Roles(Role.Admin)
  async rollback(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.rollback(page, versionId, user, { ip, ua })
  }

  @Delete(':id')
  @Roles(Role.Admin)
  @HttpCode(HttpStatus.OK)
  async purge(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @ClientIp() ip: string,
    @UserAgent() ua: string,
  ) {
    const page = await this.pages.getForManage(id, user)
    return this.pages.purge(page, user, { ip, ua })
  }

  private assertFile(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
    if (!file) throw new BadRequestException('请选择要上传的 HTML 文件或 ZIP 压缩包')
    if (file.size === 0) throw new BadRequestException('上传文件为空')
  }
}

export type { RequestContext }