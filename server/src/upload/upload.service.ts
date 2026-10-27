import { Injectable } from '@nestjs/common'
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { uploadLimits } from '../common/config'
import { StorageService } from '../storage/storage.service'
import { extractZip, ZipRejectedError } from './zip'
import { PackageType, type PackageType as PackageTypeValue } from '../shared'

export const ALLOWED_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'json', 'map', 'txt', 'csv', 'xml', 'svg',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp4', 'webm', 'ogv', 'mp3', 'wav', 'ogg',
  'pdf', 'wasm', 'md',
])

export interface StoredVersion {
  packageType: PackageTypeValue
  entryFile: string
  fileCount: number
  sizeBytes: number
}

export class UploadRejectedError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.name = 'UploadRejectedError'
    this.reason = reason
  }
}

function isZipUpload(file: Express.Multer.File): boolean {
  return file.originalname.toLowerCase().endsWith('.zip')
}

@Injectable()
export class UploadService {
  constructor(private readonly storage: StorageService) {}

  async storeVersion(pageId: string, versionId: string, file: Express.Multer.File): Promise<StoredVersion> {
    const limits = uploadLimits()
    if (file.size > limits.maxUploadBytes) {
      throw new UploadRejectedError(`上传文件超过上限 ${limits.maxUploadBytes} 字节`)
    }

    const targetDir = this.storage.versionDir(pageId, versionId)
    await rm(targetDir, { recursive: true, force: true })
    await mkdir(targetDir, { recursive: true })

    try {
      const packageType = isZipUpload(file)
        ? await this.storeBundle(file, targetDir)
        : await this.storeSingleFile(file, targetDir)
      const entryFile = await this.resolveEntryFile(targetDir)
      const sizeBytes = await this.storage.dirSize(targetDir)
      const fileCount = await this.storage.countFiles(targetDir)
      if (fileCount === 0) {
        throw new UploadRejectedError('上传内容为空')
      }
      return { packageType, entryFile, fileCount, sizeBytes }
    } catch (error) {
      await rm(targetDir, { recursive: true, force: true })
      if (error instanceof ZipRejectedError) throw new UploadRejectedError(error.reason)
      throw error
    }
  }

  private async storeSingleFile(
    file: Express.Multer.File,
    targetDir: string,
  ): Promise<PackageTypeValue> {
    await writeFile(join(targetDir, 'index.html'), file.buffer)
    return PackageType.SingleFile
  }

  private async storeBundle(file: Express.Multer.File, targetDir: string): Promise<PackageTypeValue> {
    const limits = uploadLimits()
    const tempZip = join(tmpdir(), `hmp-upload-${randomBytes(8).toString('hex')}.zip`)
    await writeFile(tempZip, file.buffer)
    try {
      await extractZip(tempZip, {
        targetDir,
        maxFileCount: limits.maxFileCount,
        maxSingleFileBytes: limits.maxSingleFileBytes,
        maxTotalBytes: limits.maxExtractedBytes,
        allowedExtensions: ALLOWED_EXTENSIONS,
      })
    } finally {
      await rm(tempZip, { force: true })
    }
    return PackageType.Bundle
  }

  private async resolveEntryFile(dir: string): Promise<string> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
    const htmlFiles = fileNames.filter((name) => /\.html?$/i.test(name))
    let entryFile: string | null = null

    if (htmlFiles.includes('index.html')) {
      entryFile = 'index.html'
    } else if (htmlFiles.length === 1) {
      entryFile = htmlFiles[0]
    } else {
      // 压缩包最外层只有一个文件夹时（Windows「压缩文件夹」的默认行为），
      // 把该文件夹的内容整体拍平到根目录。
      //
      // 必须递归复制子目录：早期实现只复制文件、跳过目录，随后又把整个
      // 顶层目录删掉，导致 images/、assets/ 里的图片全部丢失——页面能打开，
      // 但所有图片 404。见 verify-preview 的「外层带文件夹的 ZIP」断言。
      const dirs = entries.filter(
        (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('__'),
      )
      if (dirs.length === 1) {
        const inner = join(dir, dirs[0].name)
        const innerEntries = await readdir(inner, { withFileTypes: true }).catch(() => [])
        const indexEntry = innerEntries.find(
          (entry) => entry.isFile() && entry.name.toLowerCase() === 'index.html',
        )
        if (indexEntry) {
          for (const entry of innerEntries) {
            await cp(join(inner, entry.name), join(dir, entry.name), { recursive: true, force: true })
          }
          await rm(inner, { recursive: true, force: true })
          if (indexEntry.name !== 'index.html') {
            await cp(join(dir, indexEntry.name), join(dir, 'index.html'), { force: true })
          }
          entryFile = 'index.html'
        }
      }
    }

    if (!entryFile) {
      throw new UploadRejectedError('未找到入口页面，请确保根目录存在 index.html')
    }
    if (entryFile !== 'index.html') {
      await cp(join(dir, entryFile), join(dir, 'index.html'))
    }
    return 'index.html'
  }
}