#!/usr/bin/env node
/**
 * 用 headless Chrome + CDP 截图，登录后可截取内网页面。
 *
 * 用法：node scripts/screenshot.mjs [输出目录]
 *
 * 为什么不用 --screenshot 直接截：会话是 HttpOnly cookie，
 * 命令行无法注入，必须走 CDP 的 Network.setCookie。
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const outDir = resolve(process.argv[2] ?? join(root, '.screenshots'))
const PORT = 9333

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) {
  console.error('未找到 Chrome/Edge')
  process.exit(1)
}
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

const INTERNAL = 'http://127.0.0.1:5173'

async function login() {
  const res = await fetch(`${INTERNAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@hmp.local', password: 'admin123' }),
  })
  const raw = res.headers.getSetCookie?.().find((c) => c.startsWith('hmp_session='))
  if (!raw) throw new Error(`登录失败 HTTP ${res.status}`)
  return raw.split(';')[0]
}

const cookie = await login()

const chrome = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + join(root, '.chrome-cdp-profile'),
    'about:blank',
  ],
  { stdio: 'ignore', detached: false },
)

process.on('exit', () => chrome.kill())

async function wsUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('CDP 端口未就绪')
}

const url = await wsUrl()
const ws = new WebSocket(url)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('WebSocket 连接失败'))
})

let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const data = JSON.parse(ev.data)
  if (data.id && pending.has(data.id)) {
    const { resolve: r, reject: j } = pending.get(data.id)
    pending.delete(data.id)
    data.error ? j(new Error(JSON.stringify(data.error))) : r(data.result)
  }
}

function send(method, params = {}) {
  msgId += 1
  const id = msgId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`${method} 超时`))
      }
    }, 30_000)
  })
}

await send('Page.enable')
await send('Network.enable')
// 开发服务器上 Vite 会给模块加 ?t= 时间戳做 HMR，浏览器缓存会导致截到旧模块
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})

const [cookieName, cookieValue] = cookie.split('=')
await send('Network.setCookie', {
  name: cookieName,
  value: cookieValue,
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
})

/**
 * 轮询等待页面数据加载完成。
 *
 * 注意：el-empty 在数据到达前就可能存在于 DOM 里，所以不能只看它。
 * 必须连续两次探测到相同状态，才认为页面已经稳定。
 */
async function waitReady(maxMs = 20000) {
  const started = Date.now()
  let last = null
  let stable = 0
  while (Date.now() - started < maxMs) {
    const { result } = await send('Runtime.evaluate', {
      expression: `(() => {
        if (document.querySelector('.el-loading-mask')) return 'loading'
        if (document.querySelectorAll('.el-table__body tr.el-table__row').length > 0) return 'rows'
        if (document.querySelectorAll('.hmp-page-card').length > 0) return 'cards'
        if (document.querySelector('.el-empty')) return 'empty'
        if (document.querySelector('.el-form, .el-descriptions')) return 'form'
        return 'wait'
      })()`,
      returnByValue: true,
    })
    const state = result.value
    if (state === last && state !== 'wait' && state !== 'loading') {
      stable += 1
      if (stable >= 2) break
    } else {
      stable = 0
    }
    last = state
    await new Promise((r) => setTimeout(r, 500))
  }
  // 再给 ECharts / 过渡动画留一拍
  await new Promise((r) => setTimeout(r, 1000))
}

const SHOTS = [
  { name: '01-portal', path: '/' },
  { name: '02-manage-list', path: '/manage/pages' },
  { name: '03-stats', path: '/manage/stats' },
  { name: '04-review', path: '/manage/review' },
  { name: '05-my-pages', path: '/my-pages' },
  { name: '06-settings', path: '/manage/settings' },
  { name: '07-upload', path: '/manage/upload' },
]

console.log(`\n截图输出目录：${outDir}\n`)
for (const shot of SHOTS) {
  try {
    await send('Page.navigate', { url: `${INTERNAL}${shot.path}` })
    await new Promise((r) => setTimeout(r, 1200))
    await waitReady()
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(outDir, `${shot.name}.png`), Buffer.from(data, 'base64'))
    console.log(`  ✓ ${shot.name}.png  ${shot.path}`)
  } catch (err) {
    console.log(`  ✗ ${shot.name}  ${err.message}`)
  }
}

console.log('')
ws.close()
chrome.kill()
process.exit(0)