import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { SiteScope } from '../shared'

export interface SiteDefinition {
  id: string
  label: string
  hostPatterns: string[]
  scope: SiteScope
  anonymous: boolean
  contentRoots: string[]
  manageEnabled: boolean
}

export interface SitesConfig {
  sites: SiteDefinition[]
  defaultSiteId: string
  /**
   * Host 落不到任何 hostPatterns 时使用的站点，缺省回退到 defaultSiteId。
   *
   * 与 defaultSiteId 分开，是因为两者语义不同：
   * - defaultSiteId 是「默认站点」（进程身份、缺省展示），历史上是 intranet；
   * - fallbackSiteId 是「Host 无法识别时的安全兜底」，必须是权限最小的站点。
   * 若这里也回退到 intranet，任何未知 Host（例如直接用公网 IP 访问、
   * 或伪造 Host 头）都会拿到 scope=full + 管理接口开放的内网站点。
   */
  fallbackSiteId?: string
  prodHosts: Record<string, string>
  ports: Record<string, number>
}

export type HeaderSet = Record<string, string>
export interface SecurityHeadersConfig {
  content: HeaderSet
  api: HeaderSet
  web: HeaderSet
}

const MAX_WALK_UP = 10

function* candidateDirs(): Generator<string> {
  const starts = [process.cwd(), __dirname]
  for (const start of starts) {
    let dir = start
    for (let level = 0; level < MAX_WALK_UP; level += 1) {
      yield dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
}

function resolveConfigFile(relative: string, envOverride?: string): string {
  const explicit = envOverride ?? process.env.APP_CONFIG_DIR
  if (explicit) {
    const base = isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit)
    const path = resolve(base, relative)
    if (!existsSync(path)) throw new Error(`config file not found: ${path}`)
    return path
  }
  for (const dir of candidateDirs()) {
    const path = resolve(dir, relative)
    if (existsSync(path)) return path
  }
  throw new Error(
    `config file "${relative}" not found. Set APP_CONFIG_DIR to the directory containing config/.`,
  )
}

let repoRootCache: string | null = null

export function repoRoot(): string {
  if (repoRootCache) return repoRootCache
  repoRootCache = resolve(dirname(resolveConfigFile('config/sites.json')), '..')
  return repoRootCache
}

export function loadSitesConfig(): SitesConfig {
  const parsed = JSON.parse(readFileSync(resolveConfigFile('config/sites.json', process.env.SITES_CONFIG_PATH), 'utf8')) as SitesConfig
  if (!parsed.sites?.length) {
    throw new Error('config/sites.json has no sites')
  }
  if (!parsed.sites.some((site) => site.id === parsed.defaultSiteId)) {
    throw new Error(`defaultSiteId "${parsed.defaultSiteId}" does not match any site in config/sites.json`)
  }
  if (parsed.fallbackSiteId !== undefined) {
    const fallback = parsed.sites.find((site) => site.id === parsed.fallbackSiteId)
    if (!fallback) {
      throw new Error(`fallbackSiteId "${parsed.fallbackSiteId}" does not match any site in config/sites.json`)
    }
    if (fallback.manageEnabled) {
      throw new Error(
        `fallbackSiteId "${parsed.fallbackSiteId}" has manageEnabled=true. ` +
          'Host 无法识别时只能落到权限最小的站点，否则未知 Host / 伪造 Host 会拿到管理接口。',
      )
    }
  }
  return parsed
}

export function loadSecurityHeaders(): SecurityHeadersConfig {
  return JSON.parse(
    readFileSync(resolveConfigFile('config/security-headers.json', process.env.SECURITY_HEADERS_PATH), 'utf8'),
  ) as SecurityHeadersConfig
}

function hostMatches(pattern: string, host: string): boolean {
  const normalized = pattern.toLowerCase()
  if (normalized === '*') return true
  if (!normalized.includes('*')) return normalized === host
  const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(host)
}

export function resolveSite(config: SitesConfig, rawHost: string | undefined): SiteDefinition {
  if (rawHost) {
    const host = rawHost.toLowerCase()
    const candidates = [...new Set([host, host.replace(/:\d+$/, '')])]
    for (const candidate of candidates) {
      const matched = config.sites.find((site) =>
        site.hostPatterns.some((pattern) => hostMatches(pattern, candidate)),
      )
      if (matched) return matched
    }
  }
  // Host 无法识别时落到权限最小的站点（见 SitesConfig.fallbackSiteId 注释）。
  const fallbackId = config.fallbackSiteId ?? config.defaultSiteId
  const fallback = config.sites.find((site) => site.id === fallbackId)
  if (!fallback) throw new Error(`fallback site not found for host "${rawHost ?? ''}"`)
  return fallback
}

export function storageRoot(): string {
  const configured = process.env.STORAGE_ROOT ?? './data'
  return isAbsolute(configured) ? configured : resolve(repoRoot(), configured)
}

export function uploadLimits() {
  return {
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 104857600),
    maxExtractedBytes: Number(process.env.MAX_EXTRACTED_BYTES ?? 209715200),
    maxFileCount: Number(process.env.MAX_FILE_COUNT ?? 500),
    maxSingleFileBytes: Number(process.env.MAX_SINGLE_FILE_BYTES ?? 52428800),
  }
}

/**
 * 业务时区相对 UTC 的偏移分钟数，默认 480（UTC+8）。
 *
 * 访问统计按「业务时区的自然日」归档，服务器时区/UTC 与业务时区不一致时，
 * 会把凌晨的访问算到前一天。用固定偏移而非命名时区，是因为国内无夏令时。
 */
export function businessTzOffsetMinutes(): number {
  const raw = process.env.BUSINESS_TZ_OFFSET
  if (raw === undefined || raw === '') return 480
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 480
}