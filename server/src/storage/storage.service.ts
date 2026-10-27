import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { constants } from 'node:fs'
import { access, cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { storageRoot } from '../common/config'
import type { Visibility } from '../shared'

export type ContentBucket = 'public' | 'internal' | 'dept'

export const BUCKETS: ContentBucket[] = ['public', 'internal', 'dept']

export function bucketOf(visibility: Visibility): ContentBucket {
  if (visibility === 'public') return 'public'
  if (visibility === 'internal') return 'internal'
  return 'dept'
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name)
  readonly root: string = storageRoot()

  get versionsDir(): string {
    return join(this.root, 'versions')
  }

  get bucketsDir(): string {
    return this.root
  }

  async onModuleInit(): Promise<void> {
    await this.ensureLayout()
  }

  async ensureLayout(): Promise<void> {
    await mkdir(this.versionsDir, { recursive: true })
    for (const bucket of BUCKETS) {
      await mkdir(join(this.root, bucket), { recursive: true })
    }
  }

  versionDir(pageId: string, versionId: string): string {
    return join(this.versionsDir, pageId, versionId)
  }

  bucketDir(bucket: ContentBucket, slug: string): string {
    return join(this.root, bucket, slug)
  }

  async exists(dir: string): Promise<boolean> {
    try {
      await access(dir, constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  async listVersions(pageId: string): Promise<string[]> {
    try {
      return await readdir(join(this.versionsDir, pageId))
    } catch {
      return []
    }
  }

  async dirSize(dir: string): Promise<number> {
    let total = 0
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return 0
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      const info = await stat(full)
      if (info.isDirectory()) {
        total += await this.dirSize(full)
      } else {
        total += info.size
      }
    }
    return total
  }

  async countFiles(dir: string): Promise<number> {
    let total = 0
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return 0
    }
    for (const entry of entries) {
      const info = await stat(join(dir, entry))
      total += info.isDirectory() ? await this.countFiles(join(dir, entry)) : 1
    }
    return total
  }

  async publish(bucket: ContentBucket, slug: string, sourceDir: string): Promise<void> {
    if (!(await this.exists(sourceDir))) {
      throw new Error(`version directory not found: ${sourceDir}`)
    }
    const target = this.bucketDir(bucket, slug)
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    await cp(sourceDir, target, { recursive: true })
    this.logger.log(`published ${bucket}/${slug} from ${sourceDir}`)
  }

  async unpublish(bucket: ContentBucket, slug: string): Promise<void> {
    const target = this.bucketDir(bucket, slug)
    await rm(target, { recursive: true, force: true })
    this.logger.log(`unpublished ${bucket}/${slug}`)
  }

  async removePageArtifacts(pageId: string, slug: string): Promise<void> {
    await rm(join(this.versionsDir, pageId), { recursive: true, force: true })
    for (const bucket of BUCKETS) {
      await rm(this.bucketDir(bucket, slug), { recursive: true, force: true })
    }
  }

  resolveInsideBucket(bucket: ContentBucket, relativePath: string): string | null {
    const target = resolve(this.bucketDir(bucket, ''), relativePath)
    const bucketRoot = resolve(this.bucketDir(bucket, ''))
    if (target !== bucketRoot && !target.startsWith(bucketRoot + sep)) return null
    return target
  }
}