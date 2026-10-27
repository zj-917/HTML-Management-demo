import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * 用户页面的「静态资源令牌」。
 *
 * 为什么需要它：内容响应带 `Content-Security-Policy: sandbox`（不含
 * allow-same-origin），浏览器会把页面放进不透明源，页面里 <img>/<video>/字体
 * 这些子资源请求就被判定为跨站，`SameSite=Lax` 的登录 Cookie 不会下发。
 * 结果是：内网/部门页面的 HTML 能打开（顶层导航带 Cookie），但图片全部 401。
 *
 * 解法：HTML 仍然走登录校验（按人、按站点、按部门），只有静态资源允许用
 * URL 里的令牌放行。令牌放在路径里，页面内的相对路径会自动继承它。
 *
 * 令牌 = `{过期秒}.{HMAC-SHA256(secret, "asset\n{slug}\n{过期秒}")}`
 *
 * 安全性：令牌只对静态资源生效。内容服务器/nginx 对 `.html` 与目录（index.html）
 * 一律仍然要求登录，所以把带令牌的 URL 发给别人，对方依然要自己登录且有权限。
 */

const DEV_FALLBACK_SECRET = 'hmp-dev-content-token-secret'
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

function secret(): string {
  return process.env.CONTENT_TOKEN_SECRET ?? DEV_FALLBACK_SECRET
}

function sign(slug: string, expires: number): string {
  return createHmac('sha256', secret()).update(`asset\n${slug}\n${expires}`).digest('base64url')
}

/** 生成令牌。now 仅用于测试注入。 */
export function mintContentToken(slug: string, now: number = Date.now()): string {
  const expires = Math.floor(now / 1000) + TOKEN_TTL_SECONDS
  return `${expires}.${sign(slug, expires)}`
}

/** 校验令牌：格式、过期时间、签名，三者都对才放行。 */
export function verifyContentToken(slug: string, token: string, now: number = Date.now()): boolean {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{16,64})$/.exec(token)
  if (!match) return false

  const expires = Number(match[1])
  if (!Number.isFinite(expires) || expires * 1000 <= now) return false

  const expected = Buffer.from(sign(slug, expires))
  const actual = Buffer.from(match[2])
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
