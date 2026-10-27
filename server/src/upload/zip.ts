import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import yauzl from 'yauzl'

export interface ExtractOptions {
  targetDir: string
  maxFileCount: number
  maxSingleFileBytes: number
  maxTotalBytes: number
  allowedExtensions: Set<string>
}

export interface ExtractResult {
  fileCount: number
  totalBytes: number
}

export class ZipRejectedError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.name = 'ZipRejectedError'
    this.reason = reason
  }
}

const SYMLINK_MODE = 0xa000
const UNIX_MODE_MASK = 0xf000

function normalizeEntryName(rawName: string): string {
  return rawName.replace(/\\/g, '/').replace(/^\/+/, '')
}

function isUnsafeName(normalized: string): boolean {
  if (!normalized || normalized === '.') return true
  if (normalized.includes('\0')) return true
  if (/^[a-zA-Z]:/.test(normalized)) return true
  return normalized.split('/').some((segment) => segment === '..')
}

function isSymlinkEntry(entry: yauzl.Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  return (unixMode & UNIX_MODE_MASK) === SYMLINK_MODE
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, decodeStrings: true }, (err, zipFile) => {
      if (err || !zipFile) rejectPromise(new ZipRejectedError(`无法读取压缩包: ${err?.message ?? '未知错误'}`))
      else resolvePromise(zipFile)
    })
  })
}

export async function extractZip(zipPath: string, options: ExtractOptions): Promise<ExtractResult> {
  const zipFile = await openZip(zipPath)
  const targetRoot = resolve(options.targetDir)
  const writableRoot = targetRoot + sep

  return new Promise<ExtractResult>((resolvePromise, rejectPromise) => {
    let fileCount = 0
    let totalBytes = 0
    let settled = false

    const cleanupDir = async () => {
      await rm(targetRoot, { recursive: true, force: true })
    }

    const fail = async (reason: string) => {
      if (settled) return
      settled = true
      zipFile.close()
      await cleanupDir()
      rejectPromise(new ZipRejectedError(reason))
    }

    zipFile.on('error', (err) => {
      void fail(`压缩包读取失败: ${err.message}`)
    })

    zipFile.on('end', async () => {
      if (settled) return
      settled = true
      resolvePromise({ fileCount, totalBytes })
    })

    zipFile.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        const normalized = normalizeEntryName(entry.fileName)

        if (normalized.endsWith('/')) {
          zipFile.readEntry()
          return
        }

        if (isUnsafeName(normalized)) {
          await fail(`压缩包包含非法路径: ${entry.fileName}`)
          return
        }

        if (isSymlinkEntry(entry)) {
          await fail(`压缩包不允许包含符号链接: ${entry.fileName}`)
          return
        }

        fileCount += 1
        if (fileCount > options.maxFileCount) {
          await fail(`压缩包文件数超过上限 ${options.maxFileCount}`)
          return
        }

        const extension = normalized.includes('.')
          ? normalized.slice(normalized.lastIndexOf('.') + 1).toLowerCase()
          : ''
        if (extension && !options.allowedExtensions.has(extension)) {
          await fail(`压缩包包含不支持的文件类型: .${extension}`)
          return
        }

        if (entry.uncompressedSize > options.maxSingleFileBytes) {
          await fail(`单文件超过上限 ${options.maxSingleFileBytes} 字节`)
          return
        }

        const destination = resolve(targetRoot, normalized)
        if (!destination.startsWith(writableRoot)) {
          await fail(`压缩包包含越界路径: ${entry.fileName}`)
          return
        }

        await mkdir(dirname(destination), { recursive: true })
        zipFile.openReadStream(entry, (err, stream) => {
          if (err || !stream) {
            void fail(`无法解压 ${entry.fileName}: ${err?.message ?? '未知错误'}`)
            return
          }
          let written = 0
          const out = createWriteStream(destination)
          stream.on('data', (chunk: Buffer) => {
            written += chunk.length
            totalBytes += chunk.length
            if (written > options.maxSingleFileBytes) {
              stream.destroy()
              out.destroy()
              void fail(`单文件超过上限 ${options.maxSingleFileBytes} 字节`)
              return
            }
            if (totalBytes > options.maxTotalBytes) {
              stream.destroy()
              out.destroy()
              void fail(`解压后总大小超过上限 ${options.maxTotalBytes} 字节`)
              return
            }
          })
          stream.on('error', (streamErr) => {
            out.destroy()
            void fail(`解压失败: ${streamErr.message}`)
          })
          out.on('error', (outErr) => {
            void fail(`写入失败: ${outErr.message}`)
          })
          out.on('close', () => {
            zipFile.readEntry()
          })
          stream.pipe(out)
        })
      })()
    })

    zipFile.readEntry()
  })
}