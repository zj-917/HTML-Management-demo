import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const sites = JSON.parse(readFileSync(join(root, 'config/sites.json'), 'utf8'))

const INTERNAL_WEB = `http://127.0.0.1:${sites.ports.webInternal}`
const INTERNAL_CONTENT = `http://127.0.0.1:${sites.ports.contentInternal}`
const EXTERNAL_WEB = `http://127.0.0.1:${sites.ports.webExternal}`

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const PROBE_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>probe</title></head>
<body style="font:13px monospace;padding:16px"><pre id="o">PENDING</pre>
<script>
var L = [];
function safe(label, fn) {
  try { L.push(label + ' = ' + fn()); }
  catch (e) { L.push(label + ' = BLOCKED(' + (e && e.name ? e.name : 'Error') + ')'); }
}
safe('origin', function () { return String(window.origin); });
safe('opaque', function () { return String(window.origin === 'null'); });
safe('localStorage', function () { window.localStorage.setItem('t', '1'); return 'OK'; });
safe('cookie', function () { return '[' + document.cookie + ']'; });
safe('isTopLevel', function () { return String(window.top === window); });
safe('scriptRan', function () { return 'YES'; });
document.getElementById('o').textContent = L.join('\\n');
</script></body></html>`

/**
 * ZIP 包探针：验证包内相对路径资源（外链 CSS / 外链 JS / 外链图片）在
 * CSP sandbox（不透明源）下能加载。
 * 曾因两处静默失效而丢样式/脚本/图片：
 *   1) CSP 用 'self' 声明 -> 不透明源下匹配不到任何同宿主资源
 *   2) 内容子资源带 Cross-Origin-Resource-Policy: same-site -> 不透明源一律拒载
 */
const BUNDLE_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><link rel="stylesheet" href="assets/probe.css"><title>bundle probe</title></head>
<body style="font:13px monospace;padding:16px"><div id="box" class="probe-box">PENDING</div>
<img id="pic" src="assets/pic.png" alt="" width="64">
<pre id="o">NOJS</pre>
<script>
var parts = [];
try { parts.push('inline=YES'); } catch (e) { parts.push('inline=ERR'); }
try { parts.push('css=' + getComputedStyle(document.getElementById('box')).backgroundColor); } catch (e) { parts.push('css=ERR'); }
document.getElementById('o').textContent = parts.join(' ');
</script>
<script src="assets/probe.js"></script>
<script>
// img 在 load 事件后才解码完成，naturalWidth>0 即图片真实渲染
window.addEventListener('load', function () {
  var el = document.getElementById('o');
  var pic = document.getElementById('pic');
  el.textContent = el.textContent + ' pic=' + pic.naturalWidth;
});
</script>
</body></html>`

const BUNDLE_CSS = `.probe-box { background-color: rgb(10, 200, 30); }`
const BUNDLE_JS = `document.getElementById('o').textContent += ' external=YES';`

/** 运行时生成的 2x2 纯色 PNG（真字节，浏览器能真实解码），避免手拼错误字节导致假阴性 */
function buildPng(width, height, rgb) {
  const bytes = []
  const push = (...items) => items.forEach((item) => bytes.push(item))
  push(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  const chunk = (type, data) => {
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, data.length)
    const body = [...type, ...data]
    push(...len, ...body)
    const crcInput = new Uint8Array(body)
    const crc = crc32(crcInput)
    const crcBytes = new Uint8Array(4)
    new DataView(crcBytes.buffer).setUint32(0, crc)
    push(...crcBytes)
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  chunk([0x49, 0x48, 0x44, 0x52], ihdr) // IHDR

  const raw = new Uint8Array(height * (1 + width * 3))
  let position = 0
  for (let y = 0; y < height; y += 1) {
    raw[position] = 0 // filter: none
    position += 1
    for (let x = 0; x < width; x += 1) {
      raw[position] = rgb[0]
      raw[position + 1] = rgb[1]
      raw[position + 2] = rgb[2]
      position += 3
    }
  }
  chunk([0x49, 0x44, 0x41, 0x54], new Uint8Array(deflateSync(raw))) // IDAT
  chunk([0x49, 0x45, 0x4e, 0x44], new Uint8Array(0)) // IEND
  return new Uint8Array(bytes)
}

const BUNDLE_PNG = () => buildPng(2, 2, [200, 30, 10])
const BUNDLE_MP4 = new Uint8Array(64).fill(0x21) // 内容字节不重要：只断言服务端 MIME 与 Range 行为

const results = []
let failed = 0

function record(name, ok, detail = '') {
  results.push({ name, ok })
  if (!ok) failed += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`)
}

function findBrowser() {
  const found = BROWSERS.find((path) => existsSync(path))
  if (!found) throw new Error('未找到 Chrome 或 Edge，无法执行内容校验')
  return found
}

function render(browser, pageDir, name, url) {
  return execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${join(pageDir, name)}`,
      '--window-size=1280,900',
      '--virtual-time-budget=8000',
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 },
  )
}

async function login() {
  const response = await fetch(`${INTERNAL_WEB}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@hmp.local', password: 'admin123' }),
  })
  if (!response.ok) throw new Error(`登录失败 HTTP ${response.status}`)
  const cookie = (response.headers.getSetCookie?.() ?? []).find((raw) => raw.startsWith('hmp_session='))
  if (!cookie) throw new Error('登录未返回会话 cookie')
  return cookie.split(';')[0]
}

async function createProbe(cookie) {
  const form = new FormData()
  form.append('file', new Blob([PROBE_HTML], { type: 'text/html' }), 'probe.html')
  form.append('title', `内容沙箱探针 ${Date.now()}`)
  form.append('summary', '自动化校验用，脚本结束后自动归档')
  form.append('visibility', 'public')

  const created = await (
    await fetch(`${INTERNAL_WEB}/api/manage/pages`, {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
  ).json()

  for (const step of ['submit', 'review']) {
    const response = await fetch(`${INTERNAL_WEB}/api/manage/pages/${created.id}/${step}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: step === 'review' ? JSON.stringify({ action: 'approve' }) : undefined,
    })
    if (!response.ok && response.status !== 404) {
      throw new Error(`${step} 失败 HTTP ${response.status}`)
    }
  }
  return created
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 组装探针 zip：index.html + assets/probe.css + assets/probe.js */
function buildProbeZip(entries) {
  const encoder = new TextEncoder()
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    // 支持二进制素材（PNG/MP4 等不能用 TextEncoder 编码）
    const dataBytes = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content
    const crc = crc32(dataBytes)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // 通用标志位 11：文件名按 UTF-8 编码
    lv.setUint32(14, crc, true)
    lv.setUint32(18, dataBytes.length, true)
    lv.setUint32(22, dataBytes.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true) // 与本地头一致：文件名按 UTF-8 编码
    cv.setUint32(16, crc, true)
    cv.setUint32(20, dataBytes.length, true)
    cv.setUint32(24, dataBytes.length, true)
    cv.setUint32(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    locals.push(local, dataBytes)
    centrals.push(central)
    offset += local.length + dataBytes.length
  }
  const centralSize = centrals.reduce((sum, chunk) => sum + chunk.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const chunks = [...locals, ...centrals, end]
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let position = 0
  for (const chunk of chunks) {
    out.set(chunk, position)
    position += chunk.length
  }
  return out
}

async function createBundleProbe(cookie, title, options = {}) {
  const prefix = options.prefix ?? ''
  const filename = options.filename ?? 'bundle-probe.zip'
  const entry = (name) => `${prefix}${name}`
  const zip = buildProbeZip([
    { name: entry('index.html'), content: BUNDLE_HTML },
    { name: entry('assets/probe.css'), content: BUNDLE_CSS },
    { name: entry('assets/probe.js'), content: BUNDLE_JS },
    { name: entry('assets/pic.png'), content: BUNDLE_PNG() },
    { name: entry('assets/demo.mp4'), content: BUNDLE_MP4 },
  ])
  const form = new FormData()
  form.append('file', new Blob([zip], { type: 'application/zip' }), filename)
  form.append('title', title)
  form.append('summary', '自动化校验用，脚本结束后自动归档')
  form.append('visibility', options.visibility ?? 'public')
  const response = await fetch(`${INTERNAL_WEB}/api/manage/pages`, { method: 'POST', headers: { cookie }, body: form })
  if (!response.ok) {
    throw new Error(`创建 ZIP 探针失败 HTTP ${response.status}: ${await response.text()}`)
  }
  const created = await response.json()
  for (const step of ['submit', 'review']) {
    const response = await fetch(`${INTERNAL_WEB}/api/manage/pages/${created.id}/${step}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: step === 'review' ? JSON.stringify({ action: 'approve' }) : undefined,
    })
    if (!response.ok && response.status !== 404) {
      throw new Error(`${step} 失败 HTTP ${response.status}`)
    }
  }
  return created
}

function parseProbe(html) {
  const match = html.match(/<pre id="o">([\s\S]*?)<\/pre>/)
  if (!match) return null
  const map = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf('=')
    if (separator === -1) continue
    map[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return map
}

async function main() {
  const browser = findBrowser()
  const pageDir = mkdtempSync(join(tmpdir(), 'hmp-preview-'))

  console.log('\n用户内容沙箱与可执行性校验')
  console.log(`内网入口 ${INTERNAL_WEB}    外网入口 ${EXTERNAL_WEB}\n`)

  const cookie = await login()
  const probe = await createProbe(cookie)
  console.log(`探针页面 slug=${probe.slug}\n`)

  console.log('1. 用户页面脚本必须能真正执行')
  const internalDom = render(browser, pageDir, 'internal', `${INTERNAL_WEB}/p/${probe.slug}/`)
  const probeResult = parseProbe(internalDom)

  if (!probeResult) {
    record('探针页面渲染', false, '未找到探针输出节点')
  } else {
    record(
      '内联脚本真实执行（未被 CSP 拦截）',
      probeResult.scriptRan === 'YES' && probeResult.origin !== undefined,
      `输出: ${Object.entries(probeResult).map(([k, v]) => `${k}=${v}`).join(' ')}`,
    )
    record('页面以顶层文档方式打开', probeResult.isTopLevel === 'true', `isTopLevel=${probeResult.isTopLevel}`)
    record(
      '顶层文档仍处于不透明源（无法读取平台数据）',
      probeResult.opaque === 'true',
      `origin=${probeResult.origin}`,
    )
    record(
      '无法读取 localStorage',
      probeResult.localStorage?.startsWith('BLOCKED'),
      `localStorage=${probeResult.localStorage}`,
    )
    record(
      '无法读取平台 Cookie',
      probeResult.cookie?.startsWith('BLOCKED'),
      `cookie=${probeResult.cookie}`,
    )
  }

  console.log('\n1b. ZIP 包内相对路径资源必须可加载（多文件包页面）')
  {
    const bundle = await createBundleProbe(cookie, `内容包资源探针 ${Date.now()}`)
    const bundleDom = render(browser, pageDir, 'bundle', `${INTERNAL_WEB}/p/${bundle.slug}/`)
    const bundleOut = parseProbe(bundleDom)
    const output = bundleOut ? Object.values(bundleOut).join(' ') : ''
    record(
      '包内外链 JS 真实执行（assets/probe.js 未被 CSP 拦截）',
      output.includes('external=YES'),
      `输出: ${output || '(空)'}`,
    )
    record(
      '包内外链 CSS 生效（assets/probe.css 未被 CSP 拦截）',
      output.includes('css=rgb(10, 200, 30)'),
      `输出: ${output || '(空)'}`,
    )
    record(
      '包内图片真实解码渲染（assets/pic.png：解码成功 naturalWidth>0）',
      output.includes('pic=2'),
      `输出: ${output || '(空)'}`,
    )
    const pic = await fetch(`${INTERNAL_WEB}/p/${bundle.slug}/assets/pic.png`)
    record(
      '图片素材以正确 MIME 返回（image/png，防 octet-stream+nosniff 退化）',
      pic.ok && pic.headers.get('content-type') === 'image/png',
      `HTTP ${pic.status}，Content-Type ${pic.headers.get('content-type')}`,
    )
    const mp4 = await fetch(`${INTERNAL_WEB}/p/${bundle.slug}/assets/demo.mp4`)
    record(
      '视频素材以正确 MIME 返回（video/mp4）',
      mp4.ok && mp4.headers.get('content-type') === 'video/mp4',
      `HTTP ${mp4.status}，Content-Type ${mp4.headers.get('content-type')}`,
    )
    const ranged = await fetch(`${INTERNAL_WEB}/p/${bundle.slug}/assets/demo.mp4`, {
      headers: { range: 'bytes=0-9' },
    })
    record(
      '媒体支持 Range/206（否则浏览器能播但拖动进度失效）',
      ranged.status === 206
        && ranged.headers.get('content-range') === `bytes 0-9/${BUNDLE_MP4.length}`
        && ranged.headers.get('accept-ranges') === 'bytes',
      `HTTP ${ranged.status}，Content-Range ${ranged.headers.get('content-range')}`,
    )
    const beyond = await fetch(`${INTERNAL_WEB}/p/${bundle.slug}/assets/demo.mp4`, {
      headers: { range: 'bytes=999999-' },
    })
    record('越界 Range 回 416', beyond.status === 416, `HTTP ${beyond.status}`)
    // 注意：平台没有 /archive 路由，清理必须走「下线 → 删除 → 彻底删除」
    const cleaned = await cleanupProbePage(cookie, bundle.id)
    record('包资源探针已彻底清除', cleaned, `id=${bundle.id}`)
  }

  console.log('\n1c. 外层多一层文件夹的 ZIP 必须自动拍平且保留资源目录')
  {
    // Windows「压缩文件夹」的默认结果就是这种结构：包内多一层同名目录。
    // 目录名带点（版本v1.2）同时覆盖「按真实类型判断目录」的修复。
    const wrapped = await createBundleProbe(cookie, `拍平探针 ${Date.now()}`, {
      prefix: '版本v1.2/',
      filename: 'wrapped-bundle.zip',
    })
    const wrappedDom = render(browser, pageDir, 'wrapped', `${INTERNAL_WEB}/p/${wrapped.slug}/`)
    const wrappedResult = parseProbe(wrappedDom)
    const output = wrappedResult ? Object.values(wrappedResult).join(' ') : ''
    record(
      '外层带文件夹时图片仍能解码（assets/pic.png：naturalWidth>0）',
      output.includes('pic=2'),
      `输出: ${output || '(空)'}`,
    )
    record(
      '外层带文件夹时外链 CSS 仍生效',
      output.includes('css=rgb(10, 200, 30)'),
      `输出: ${output || '(空)'}`,
    )
    const cleaned = await cleanupProbePage(cookie, wrapped.id)
    record('拍平探针已彻底清除', cleaned, `id=${wrapped.id}`)
  }

  console.log('\n1d. 内网/部门页面的静态资源要走「令牌通道」（沙箱页面不带 Cookie）')
  {
    // 背景：内容响应带 CSP sandbox（不透明源），页面里的 <img> 请求属于跨站，
    // SameSite=Lax 的会话 Cookie 不会下发。公开页面本来就不需要登录，所以
    // 之前的探针全绿；内网页面则会整页图裂。这里锁死修复后的行为。
    const secured = await createBundleProbe(cookie, `令牌探针 ${Date.now()}`, { visibility: 'internal' })

    const play = await fetch(`${INTERNAL_WEB}/api/pages/${secured.slug}/play`, {
      headers: { cookie },
      redirect: 'manual',
    })
    const location = play.headers.get('location') ?? ''
    record(
      '打开入口 302 到带资源令牌的地址',
      play.status === 302 && new RegExp(`^/p/${secured.slug}/_a/[^/]+/$`).test(location),
      `HTTP ${play.status} ${location}`,
    )

    const tokenBase = `${INTERNAL_WEB}${location}`
    const token = location.split('/_a/')[1]?.replace(/\/$/, '') ?? ''

    const asset = await fetch(`${tokenBase}assets/pic.png`)
    record(
      '图片在完全不带 Cookie 时可以取到（沙箱页面的真实请求形态）',
      asset.status === 200 && asset.headers.get('content-type') === 'image/png',
      `HTTP ${asset.status} ${asset.headers.get('content-type')}`,
    )

    const doc = await fetch(tokenBase)
    record('令牌地址上的 HTML 仍然要求登录（令牌不是越权链接）', doc.status === 401, `HTTP ${doc.status}`)

    const plainAsset = await fetch(`${INTERNAL_WEB}/p/${secured.slug}/assets/pic.png`)
    record('不带令牌的旧资源地址仍然要求登录', plainAsset.status === 401, `HTTP ${plainAsset.status}`)

    const forgedBase = `${INTERNAL_WEB}/p/${secured.slug}/_a/9999999999.forged/`
    const forged = await fetch(`${forgedBase}assets/pic.png`)
    record('伪造 / 过期令牌被拒绝', forged.status === 403, `HTTP ${forged.status}`)

    const guardOk = await fetch(`${INTERNAL_WEB}/api/guard/asset/${secured.slug}`, {
      headers: { 'x-hmp-token': token },
    })
    record('生产环境 nginx 用的资源鉴权子请求：合法令牌 204', guardOk.status === 204, `HTTP ${guardOk.status}`)

    const guardBad = await fetch(`${INTERNAL_WEB}/api/guard/asset/${secured.slug}`, {
      headers: { 'x-hmp-token': '9999999999.forged' },
    })
    record('资源鉴权子请求：非法令牌 403', guardBad.status === 403, `HTTP ${guardBad.status}`)

    const publicPlay = await fetch(`${INTERNAL_WEB}/api/pages/${probe.slug}/play`, {
      headers: { cookie },
      redirect: 'manual',
    })
    record(
      '公开页面不需要令牌（仍走原地址）',
      publicPlay.status === 302 && (publicPlay.headers.get('location') ?? '') === `/p/${probe.slug}/`,
      `HTTP ${publicPlay.status} ${publicPlay.headers.get('location')}`,
    )

    const cleaned = await cleanupProbePage(cookie, secured.id)
    record('令牌探针已彻底清除', cleaned, `id=${secured.id}`)
  }

  console.log('\n2. 禁止被任何页面内嵌（X-Frame-Options）')
  const headers = await (await fetch(`${INTERNAL_WEB}/p/${probe.slug}/`)).headers
  record(
    '内容响应带 X-Frame-Options: DENY',
    (headers.get('x-frame-options') ?? '').toUpperCase() === 'DENY',
    `实际 ${headers.get('x-frame-options')}`,
  )
  record('内容响应带 nosniff', headers.get('x-content-type-options') === 'nosniff')
  const csp = headers.get('content-security-policy') ?? ''
  record('CSP 含 sandbox 指令', csp.includes('sandbox'), csp.slice(0, 46))
  record(
    'CSP default-src 必须为 none（未显式放行的通道一律拒绝）',
    /default-src\s+'none'/.test(csp),
  )
  record(
    "CSP connect-src 必须为 none（页面不能发起 fetch/XHR/WebSocket 外带数据）",
    /connect-src\s+'none'/.test(csp),
  )
  record(
    'CSP 拒绝 allow-same-origin（内容页不与平台同源）',
    !csp.includes('allow-same-origin'),
  )
  record(
    'CSP 显式放行 script-src',
    /script-src[^;]*'unsafe-inline'/.test(csp),
    (csp.match(/script-src[^;]*/) ?? ['(缺失)'])[0],
  )

  console.log('\n3. 外网站点可见性')
  const externalDom = render(browser, pageDir, 'external', `${EXTERNAL_WEB}/p/${probe.slug}/`)
  const externalProbe = parseProbe(externalDom)
  record(
    '外网可正常打开 public 页面',
    externalProbe?.scriptRan === 'YES',
    `scriptRan=${externalProbe?.scriptRan}`,
  )

  console.log('\n4. 清理')
  const cleaned = await cleanupProbePage(cookie, probe.id)
  record('探针页面已彻底清除', cleaned, `id=${probe.id}`)

  console.log(`\n${'='.repeat(52)}`)
  const passed = results.filter((item) => item.ok).length
  console.log(`结果: ${passed}/${results.length} 通过，${failed} 失败`)
  console.log('='.repeat(52) + '\n')
  process.exit(failed > 0 ? 1 : 0)
}

/**
 * 清理探针页面：下线（published 必须先下线）→ 移入回收站 → 彻底删除。
 * 平台没有 /archive 路由；此前误用导致探针页面每跑一次残留一个。
 */
async function cleanupProbePage(cookie, pageId) {
  await fetch(`${INTERNAL_WEB}/api/manage/pages/${pageId}/unpublish`, { method: 'POST', headers: { cookie } })
  await fetch(`${INTERNAL_WEB}/api/manage/pages/${pageId}/delete`, { method: 'POST', headers: { cookie } })
  await fetch(`${INTERNAL_WEB}/api/manage/pages/${pageId}`, { method: 'DELETE', headers: { cookie } })
  const response = await fetch(`${INTERNAL_WEB}/api/manage/pages/${pageId}`, { headers: { cookie } })
  return response.status === 404
}

main().catch((error) => {
  console.error('\n[verify-preview] 执行失败:', error)
  process.exit(1)
})
