import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const ESC = String.fromCharCode(27)
const COLORS = {
  api: `${ESC}[36m`,
  web: `${ESC}[35m`,
  content: `${ESC}[33m`,
  reset: `${ESC}[0m`,
}

// 可选：把某个站点只绑在指定网卡上（套接字级隔离，没有 Docker 时用它替代）。
// 例：内网站点只监听内网网卡，公网流量根本到不了 —— 这才是"内网只有内网能连"的
// 硬保证，而不是靠域名或规则。
//   PowerShell: $env:HMP_INTERNAL_BIND='10.34.128.193'; pnpm dev
// 注意：一旦绑定到具体网卡，本机 127.0.0.1:5173 就不再可连，验收脚本(默认走
// 127.0.0.1)会连不上——验收请在默认绑定（不设这两个变量）下跑。
const internalBind = process.env.HMP_INTERNAL_BIND
const externalBind = process.env.HMP_EXTERNAL_BIND

// 资源令牌密钥：API 签发、内容服务器校验，两边必须一致。
// 顺序：进程环境变量 → 仓库根 .env → dev 默认值。
// 必须在这里统一注入，因为 .env 是 Nest 自己读的，内容服务器（纯 node）读不到，
// 两边若取不同的值，静态资源会全部 403。
if (!process.env.CONTENT_TOKEN_SECRET) {
  try {
    const envText = readFileSync(join(root, '.env'), 'utf8')
    const line = envText.split(/\r?\n/).find((item) => item.trim().startsWith('CONTENT_TOKEN_SECRET='))
    if (line) {
      const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
      if (value) process.env.CONTENT_TOKEN_SECRET = value
    }
  } catch {
    // 没有 .env 就走下面的默认值
  }
}
if (!process.env.CONTENT_TOKEN_SECRET) {
  process.env.CONTENT_TOKEN_SECRET = 'hmp-dev-content-token-secret'
}

const tasks = [
  { name: 'api', command: 'pnpm --filter @hmp/server dev' },
  {
    name: 'web',
    command: 'pnpm --filter @hmp/web dev',
    env: { HMP_SITE: 'intranet', ...(internalBind ? { HMP_BIND: internalBind } : {}) },
  },
  {
    name: 'web',
    command: 'pnpm --filter @hmp/web dev',
    env: { HMP_SITE: 'external', ...(externalBind ? { HMP_BIND: externalBind } : {}) },
  },
  { name: 'content', command: 'node scripts/serve-content.mjs --site=intranet' },
  { name: 'content', command: 'node scripts/serve-content.mjs --site=external' },
]

const children = []
let shuttingDown = false

function prefix(name) {
  return `${COLORS[name] ?? ''}[${name}]${COLORS.reset} `
}

for (const task of tasks) {
  const child = spawn(task.command, {
    cwd: root,
    shell: true,
    env: { ...process.env, ...(task.env ?? {}), FORCE_COLOR: '1' },
  })

  const write = (stream) => (chunk) => {
    const text = String(chunk).replace(/\r?\n$/, '')
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) stream.write(`${prefix(task.name)}${line}\n`)
    }
  }

  child.stdout.on('data', write(process.stdout))
  child.stderr.on('data', write(process.stderr))
  child.on('exit', (code) => {
    if (shuttingDown) return
    process.stdout.write(`${prefix(task.name)}exited with code ${code}\n`)
    shutdown(code ?? 1)
  })

  children.push(child)
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const banner = [
  '',
  '  HTML 统一管理平台 - 开发环境',
  '',
  '  内网视角 (需登录)  http://localhost:5173',
  '  外网视角 (匿名)    http://localhost:5174',
  '',
  '  演示账号  admin@hmp.local / admin123      管理员',
  '            admin2@hmp.local / admin2_123   管理员（兼审核）',
  '            sales@hmp.local / sales123      销售部员工（左侧仅 3 项导航）',
  '            finance@hmp.local / finance123  财务部',
  '            hr@hmp.local / hr123            人力资源部',
  '',
  '  Ctrl+C 停止全部服务',
  '',
].join('\n')

process.stdout.write(`${banner}\n`)