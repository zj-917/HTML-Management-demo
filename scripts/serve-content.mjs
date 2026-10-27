import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '..')

const sitesConfig = JSON.parse(await readFile(join(repoRoot, 'config/sites.json'), 'utf8'))
const securityHeaders = JSON.parse(await readFile(join(repoRoot, 'config/security-headers.json'), 'utf8'))

const argSite = process.argv.find((item) => item.startsWith('--site='))?.split('=')[1]
const portArg = process.argv.find((item) => item.startsWith('--port='))?.split('=')[1]
const requestedPort = portArg ? Number(portArg) : null

const site = argSite
  ? sitesConfig.sites.find((item) => item.id === argSite)
  : sitesConfig.sites.find((item) => item.id === sitesConfig.defaultSiteId)

if (!site) {
  console.error(`[content] unknown site: ${argSite}`)
  process.exit(1)
}

const port = requestedPort ?? sitesConfig.ports[site.id === 'external' ? 'contentExternal' : 'contentInternal']
const storageRoot = resolve(process.env.STORAGE_ROOT ?? join(repoRoot, 'data'))
const apiBase = `http://127.0.0.1:${process.env.PORT ?? sitesConfig.ports.api}`
const buckets = site.contentRoots

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8',
}

function applyHeaders(res) {
  for (const [key, value] of Object.entries(securityHeaders.content)) res.setHeader(key, value)
}

function sendText(res, status, message) {
  applyHeaders(res)
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(message)
}

/**
 * 静态资源令牌校验。必须与 server/src/common/content-token.ts 的算法一致：
 *   `{过期秒}.{base64url(HMAC-SHA256(secret, "asset\n{slug}\n{过期秒}"))}`
 *
 * 令牌只用于非 HTML 文件。页面本身仍然要登录（见 handler 里的 isDocument 分支），
 * 所以把带令牌的链接发给别人，对方依然要自己有会话、有部门权限。
 */
const TOKEN_SECRET = process.env.CONTENT_TOKEN_SECRET ?? 'hmp-dev-content-token-secret'

function verifyContentToken(slug, token) {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{16,64})$/.exec(token)
  if (!match) return false

  const expires = Number(match[1])
  if (!Number.isFinite(expires) || expires * 1000 <= Date.now()) return false

  const expected = Buffer.from(
    createHmac('sha256', TOKEN_SECRET).update(`asset\n${slug}\n${expires}`).digest('base64url'),
  )
  const actual = Buffer.from(match[2])
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

async function guard(slug, req) {
  const headers = { 'X-Forwarded-Host': req.headers.host ?? '' }
  const cookie = req.headers.cookie
  if (cookie) headers.cookie = cookie

  try {
    const response = await fetch(`${apiBase}/api/guard/content/${encodeURIComponent(slug)}`, {
      headers,
      redirect: 'manual',
    })
    return response.status
  } catch {
    return 503
  }
}

async function resolveFile(slug, relativePath) {
  const safeRelative = normalize(relativePath).replace(/^([/\\])+/, '')
  if (safeRelative.split(/[/\\]/).includes('..')) return null

  for (const bucket of buckets) {
    const bucketRoot = resolve(storageRoot, bucket)
    const slugRoot = resolve(bucketRoot, slug)
    if (slugRoot !== bucketRoot && !slugRoot.startsWith(bucketRoot + sep)) continue

    const candidate = resolve(slugRoot, safeRelative)
    if (candidate !== slugRoot && !candidate.startsWith(slugRoot + sep)) continue

    try {
      const info = await stat(candidate)
      if (info.isFile()) return { path: candidate, size: info.size, mtime: info.mtimeMs }
    } catch {
      continue
    }
  }
  return null
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method Not Allowed')
    return
  }

  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const match = /^\/p\/([A-Za-z0-9_-]+)\/?(.*)$/.exec(requestUrl.pathname)
  if (!match) {
    sendText(res, 404, 'Not Found')
    return
  }

  const slug = match[1]
  let rest = match[2]
  let token = null

  // 资源令牌通道：/p/{slug}/_a/{token}/images/x.png
  const tokenMatch = /^_a\/([A-Za-z0-9_.-]+)(?:\/(.*))?$/.exec(rest)
  if (tokenMatch) {
    token = tokenMatch[1]
    rest = tokenMatch[2] ?? ''
  }

  const relativePath = rest === '' ? 'index.html' : rest
  const isDocument = rest === '' || /\.html?$/i.test(rest)

  /**
   * 沙箱页面（CSP sandbox，不透明源）发出的子资源请求不会带 SameSite=Lax 的
   * 登录 Cookie。所以静态资源允许用 URL 里的令牌放行；
   * 但 HTML 文档一律仍然走登录校验 —— 否则令牌就成了可转发的越权链接。
   */
  if (token && !isDocument) {
    if (!verifyContentToken(slug, token)) {
      sendText(res, 403, 'Forbidden')
      return
    }
  } else {
    const guardStatus = await guard(slug, req)
    if (guardStatus === 401) {
      sendText(res, 401, 'Unauthorized')
      return
    }
    if (guardStatus === 403) {
      sendText(res, 403, 'Forbidden')
      return
    }
    if (guardStatus === 404 || guardStatus === 503) {
      sendText(res, guardStatus === 503 ? 503 : 404, guardStatus === 503 ? 'Service Unavailable' : 'Not Found')
      return
    }
  }

  const file = await resolveFile(slug, relativePath)
  if (!file) {
    sendText(res, 404, 'Not Found')
    return
  }

  applyHeaders(res)

  /**
   * 音视频必配 Range/206：没有它浏览器能播但拖动进度条/seek 会失效。
   * 只支持单区间 bytes=a-b；多区间或非法区间按 200 全量返回（RFC 允许忽略）。
   */
  const range = req.method === 'GET' ? parseRange(req.headers.range, file.size) : null
  if (range?.unsatisfiable) {
    res.writeHead(416, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Range': `bytes */${file.size}`,
      'Accept-Ranges': 'bytes',
    })
    res.end()
    return
  }

  const mime = MIME[extname(file.path).toLowerCase()] ?? 'application/octet-stream'
  if (range) {
    const { start, end } = range
    res.writeHead(206, {
      'Content-Type': mime,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${file.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=60',
    })
    createReadStream(file.path, { start, end })
      .on('error', () => res.destroy())
      .pipe(res)
    return
  }

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': file.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=60',
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  createReadStream(file.path)
    .on('error', () => res.destroy())
    .pipe(res)
})

server.listen(port, '0.0.0.0', () => {
  console.log(
    `[content] site=${site.id} port=${port} buckets=${buckets.join(',')} storage=${storageRoot} ` +
      `token-secret=${process.env.CONTENT_TOKEN_SECRET ? 'env' : 'dev-default'}`,
  )
})

/** 解析 Range 头。返回 null=忽略该头(200 全量)，unsatisfiable=应回 416 */
function parseRange(header, size) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return null

  let start
  let end
  if (match[1] === '') {
    // 后缀式：bytes=-N 表示取最后 N 字节
    const suffix = Number(match[2])
    if (suffix === 0) return { unsatisfiable: true }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }

  if (start >= size) return { unsatisfiable: true }
  if (start > end) return null
  return { start, end }
}