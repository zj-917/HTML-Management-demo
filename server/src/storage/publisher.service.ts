import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service'
import { BUCKETS, StorageService, bucketOf, type ContentBucket } from './storage.service'
import { PageStatus, type Visibility as VisibilityValue } from '../shared'

export interface PublishablePage {
  id: string
  slug: string
  visibility: VisibilityValue
  status: string
  publishedVersionId: string | null
  deletedAt?: Date | null
}

@Injectable()
export class PublisherService {
  private readonly logger = new Logger(PublisherService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  bucketFor(visibility: VisibilityValue): ContentBucket {
    return bucketOf(visibility)
  }

  async sync(page: PublishablePage): Promise<void> {
    const target = bucketOf(page.visibility)
    for (const bucket of BUCKETS) {
      if (bucket !== target) {
        await this.storage.unpublish(bucket, page.slug)
      }
    }
    if (page.deletedAt) {
      await this.storage.unpublish(target, page.slug)
      return
    }
    if (page.status !== PageStatus.Published) return
    if (!page.publishedVersionId) return
    await this.storage.publish(target, page.slug, this.storage.versionDir(page.id, page.publishedVersionId))
  }

  async publishVersion(pageId: string, versionId: string): Promise<void> {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } })
    if (!page) throw new Error(`page not found: ${pageId}`)
    await this.sync({
      id: page.id,
      slug: page.slug,
      visibility: page.visibility as VisibilityValue,
      status: page.status,
      publishedVersionId: versionId,
    })
  }

  async unpublishPage(slug: string): Promise<void> {
    for (const bucket of BUCKETS) {
      await this.storage.unpublish(bucket, slug)
    }
  }

  async unpublishAll(): Promise<void> {
    await this.storage.ensureLayout()
    const pages = await this.prisma.page.findMany({ select: { id: true, slug: true } })
    for (const page of pages) {
      for (const bucket of BUCKETS) {
        await this.storage.unpublish(bucket, page.slug)
      }
    }
    this.logger.log(`cleared published content for ${pages.length} pages`)
  }

  async rebuildAll(): Promise<void> {
    await this.unpublishAll()
    const pages = await this.prisma.page.findMany({ where: { status: PageStatus.Published } })
    for (const page of pages) {
      await this.sync({
        id: page.id,
        slug: page.slug,
        visibility: page.visibility as VisibilityValue,
        status: page.status,
        publishedVersionId: page.publishedVersionId,
      })
    }
    this.logger.log(`rebuilt published content for ${pages.length} pages`)
  }
}