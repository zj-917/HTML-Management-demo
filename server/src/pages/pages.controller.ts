import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common'
import type { Response } from 'express'
import { PagesService } from './pages.service'
import { PageQueryDto } from './dto'
import { AllowAnonymous, CurrentSite, CurrentUser } from '../common/site-scope/decorators'
import { mintContentToken, verifyContentToken } from '../common/content-token'
import type { SiteDefinition } from '../common/config'
import type { PackageType, PageStatus, PublicPageDetail, SessionUser } from '../shared'
import { Visibility } from '../shared'

@Controller('api')
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get('pages')
  @AllowAnonymous()
  async list(
    @Query() query: PageQueryDto,
    @CurrentSite() site: SiteDefinition,
    @CurrentUser() user: SessionUser | null,
  ) {
    return this.pages.listPortal(query, site, user)
  }

  @Get('pages/:slug')
  @AllowAnonymous()
  async detail(
    @Param('slug') slug: string,
    @CurrentSite() site: SiteDefinition,
    @CurrentUser() user: SessionUser | null,
  ): Promise<{ page: PublicPageDetail }> {
    const page = await this.pages.findVisibleBySlug(slug, site, user)
    // 匿名（外网）也能访问本接口，因此必须保持 PublicPageDetail 的裁剪契约，
    // 不得加入上传人/部门授权等敏感字段。
    const body: PublicPageDetail = {
      id: page.id,
      slug: page.slug,
      title: page.title,
      summary: page.summary,
      visibility: page.visibility as Visibility,
      status: page.status as PageStatus,
      packageType: page.packageType as PackageType,
      entryFile: page.entryFile,
      categoryName: page.category?.name ?? null,
      tags: page.tags.map((item) => item.tag.name),
      publishedAt: page.publishedAt?.toISOString() ?? null,
      updatedAt: page.updatedAt.toISOString(),
    }
    return { page: body }
  }

  /**
   * 打开页面入口。前端不再直接跳 `/p/{slug}/`，而是走这里：
   * 鉴权通过后 302 到带资源令牌的地址，页面里的图片/字体/视频才能取到。
   *
   * 公开页面不需要令牌（内容服务器本来就放行），保持原地址。
   */
  @Get('pages/:slug/play')
  @AllowAnonymous()
  async play(
    @Param('slug') slug: string,
    @CurrentSite() site: SiteDefinition,
    @CurrentUser() user: SessionUser | null,
    @Res() res: Response,
  ): Promise<void> {
    const page = await this.pages.findVisibleBySlug(slug, site, user)

    if (page.visibility === Visibility.Public) {
      res.redirect(HttpStatus.FOUND, `/p/${page.slug}/`)
      return
    }

    res.redirect(HttpStatus.FOUND, `/p/${page.slug}/_a/${mintContentToken(page.slug)}/`)
  }

  @Post('pages/:slug/view')
  @AllowAnonymous()
  @HttpCode(HttpStatus.NO_CONTENT)
  async trackView(
    @Param('slug') slug: string,
    @CurrentSite() site: SiteDefinition,
    @CurrentUser() user: SessionUser | null,
  ): Promise<void> {
    await this.pages.recordView(slug, site, user)
  }

  @Get('guard/content/:slug')
  @AllowAnonymous()
  async contentGuard(
    @Param('slug') slug: string,
    @CurrentSite() site: SiteDefinition,
    @CurrentUser() user: SessionUser | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const result = await this.pages.contentGuard(slug, site, user)
    res.status(result.status)
    if (result.allow) {
      res.setHeader('X-Entry-File', result.entryFile ?? 'index.html')
    }
  }

  /**
   * 静态资源令牌校验（生产环境由 nginx 的 auth_request 调用）。
   * 只校验签名与有效期，不查库：文件本身由发布目录（public/internal/dept）
   * 决定可见范围，外网容器里根本没有 internal/dept 的文件。
   *
   * 注意：本接口只用于非 HTML 资源。HTML 仍然走 `guard/content`，否则等于
   * 把「登录 + 部门权限」换成了一个可转发的链接。
   */
  @Get('guard/asset/:slug')
  @AllowAnonymous()
  @HttpCode(HttpStatus.NO_CONTENT)
  async assetGuard(
    @Param('slug') slug: string,
    @Headers('x-hmp-token') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!token || !verifyContentToken(slug, token)) {
      res.status(HttpStatus.FORBIDDEN)
    }
  }
}