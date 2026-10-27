#!/usr/bin/env node
/**
 * 收尾验收编排器。
 *
 * 存在的唯一原因：避免把多个耗时命令串成一次无输出的前台调用。
 * 每一步都有实时心跳和完成时间，跑哪一步、卡在哪一步一目了然。
 *
 * 用法：
 *   node scripts/verify.mjs                    # 全量收尾
 *   node scripts/verify.mjs --scope=web        # 只跑前端 typecheck（只改了 web/ 时用）
 *   node scripts/verify.mjs --skip-build        # 跳过构建
 *   node scripts/verify.mjs --no-typecheck      # 跳过类型检查
 *   node scripts/verify.mjs --seed              # 先重置种子数据（会清空本地开发库）
 *   node scripts/verify.mjs --stop-after        # 结束时关掉由本脚本启动的服务
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createConnection } from 'node:net'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const sites = JSON.parse(readFileSync(join(root, 'config/sites.json'), 'utf8'))

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
// 同时支持 --scope=web 与 --scope web 两种写法
const valueOf = (name, fallback) => {
  const inline = argv.find((a) => a.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

const NO_COLOR = Boolean(process.env.NO_COLOR)
const c = (code, s) => (NO_COLOR ? s : `[${code}m${s}[0m`)
const dim = (s) => c('2', s)
const bold = (s) => c('1', s)
const green = (s) => c('32', s)
const red = (s) => c('31', s)
const yellow = (s) => c('33', s)
const cyan = (s) => c('36', s)

const SECONDS = (ms) => `${(ms / 1000).toFixed(1)}s`

/** 静默超过这个时长就打一次心跳，让用户知道进程还活着。 */
const HEARTBEAT_MS = 5000

function probePort(port, timeout = 400) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    const done = (ok) => {
      socket.destroy()
      resolvePort(ok)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

function runStep(step, index, total) {
  return new Promise((resolveStep) => {
    const started = Date.now()
    process.stdout.write(
      `\n${bold(`[${index}/${total}]`)} ${step.name} ${dim(`— ${step.cmd}`)}\n`,
    )

    const child = spawn(step.cmd, {
      cwd: root,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '1' },
    })

    let lastActivity = Date.now()
    const touch = () => {
      lastActivity = Date.now()
    }

    const pipe = (stream, sink) => {
      stream.on('data', (chunk) => {
        touch()
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line.trim()) sink.write(`  ${dim('│')} ${line}\n`)
        }
      })
    }
    pipe(child.stdout, process.stdout)
    pipe(child.stderr, process.stderr)

    const heartbeat = setInterval(() => {
      if (Date.now() - lastActivity < HEARTBEAT_MS) return
      process.stdout.write(`  ${dim(`… 仍在运行 ${SECONDS(Date.now() - started)}`)}\n`)
    }, 1000)

    child.on('error', (err) => {
      clearInterval(heartbeat)
      process.stdout.write(`  ${red('启动失败')}: ${err.message}\n`)
      resolveStep({ ...step, code: 1, ms: Date.now() - started })
    })

    child.on('exit', (code) => {
      clearInterval(heartbeat)
      resolveStep({ ...step, code: code ?? 1, ms: Date.now() - started })
    })
  })
}

async function waitForPorts(ports, label) {
  const started = Date.now()
  process.stdout.write(`${dim(`  … 等待 ${label} 就绪`)}\n`)
  let ticks = 0
  for (;;) {
    const states = await Promise.all(ports.map((p) => probePort(p)))
    if (states.every(Boolean)) {
      process.stdout.write(`  ${green('就绪')} ${dim(SECONDS(Date.now() - started))}\n`)
      return true
    }
    if (Date.now() - started > 90_000) {
      process.stdout.write(`  ${red('超时')} 90s 内未就绪\n`)
      return false
    }
    ticks += 1
    process.stdout.write(dim('.'.padEnd(Math.min(ticks % 5, 4) + 1)))
    await new Promise((r) => setTimeout(r, 1000))
  }
}

const TYPECHECK = {
  all: 'pnpm typecheck',
  server: 'pnpm --filter @hmp/server typecheck',
  web: 'pnpm --filter @hmp/web typecheck',
  none: null,
}

async function main() {
  const scope = valueOf('--scope', 'all')
  const typecheckCmd = TYPECHECK[scope]
  if (typecheckCmd === undefined) {
    console.error(`未知 --scope: ${scope}（可选 all/server/web/none）`)
    process.exit(2)
  }

  const steps = []
  if (!has('--no-typecheck') && typecheckCmd) {
    steps.push({ name: `类型检查（${scope}）`, cmd: typecheckCmd, group: 'typecheck' })
  }
  // 生产 MySQL schema 是派生物，最容易被忘记重新生成。
  // 只改 web/ 时不必跑；改 server/ 或 shared/ 时必须跑。
  if (!has('--no-typecheck') && (scope === 'all' || scope === 'server')) {
    steps.push({
      name: '生产 schema 一致性',
      cmd: 'node scripts/gen-mysql-schema.mjs --check',
      group: 'schema',
    })
  }
  if (!has('--skip-build')) {
    steps.push({ name: '构建', cmd: 'pnpm build', group: 'build' })
  }
  if (has('--seed')) {
    steps.push({ name: '重置种子数据', cmd: 'pnpm db:seed', group: 'seed', optional: true })
  }
  steps.push(
    { name: '隔离验收', cmd: 'node scripts/verify-isolation.mjs', group: 'verify' },
    { name: '预览验收', cmd: 'node scripts/verify-preview.mjs', group: 'verify' },
    { name: '布局验收', cmd: 'node scripts/verify-layout.mjs', group: 'verify' },
    { name: '样式基座', cmd: 'node scripts/verify-styles.mjs', group: 'verify' },
  )

  console.log(`\n${bold('HTML 平台收尾验收')} ${dim(`(${steps.length} 步)`)}`)
  if (has('--seed')) {
    console.log(yellow('  注意：--seed 会清空并重建本地开发数据库'))
  }

  const apiPort = sites.ports.api
  const webPorts = [sites.ports.webInternal, sites.ports.webExternal]
  // 内容服务也必须就绪，否则验收里的 /p/{slug}/ 断言会拿到 503 而不是 404。
  const contentPorts = [sites.ports.contentInternal, sites.ports.contentExternal]
  const allPorts = [apiPort, ...webPorts, ...contentPorts]
  const needServer = steps.some((s) => s.group === 'verify')

  let startedServer = false
  if (needServer) {
    const ready = await Promise.all(allPorts.map((p) => probePort(p)))
    if (ready.every(Boolean)) {
      console.log(`\n${green('服务已在运行')} ${dim(`(api ${apiPort}, web ${webPorts.join('/')}, content ${contentPorts.join('/')})，复用`)}`)
    } else {
      console.log(`\n${yellow('服务未运行，正在启动')}`)
      const child = spawn('node', ['scripts/dev.mjs'], {
        cwd: root,
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      child.unref()
      startedServer = true
      if (!(await waitForPorts(allPorts, `api ${apiPort} / web ${webPorts.join('/')} / content ${contentPorts.join('/')}`))) {
        console.log(red('\n服务启动超时，终止。'))
        process.exit(1)
      }
    }
  }

  const results = []
  for (const [i, step] of steps.entries()) {
    const result = await runStep(step, i + 1, steps.length)
    results.push(result)
    const mark = result.code === 0 ? green('OK') : red('FAIL')
    process.stdout.write(`  ${mark} ${dim(SECONDS(result.ms))}\n`)
    if (result.code !== 0) {
      console.log(`\n${red(bold('中断'))} 「${step.name}」未通过，后续步骤已跳过。\n`)
      break
    }
  }

  const passed = results.filter((r) => r.code === 0).length
  const failed = results.find((r) => r.code !== 0)
  const totalMs = results.reduce((sum, r) => sum + r.ms, 0)

  console.log(`\n${bold('汇总')}`)
  for (const r of results) {
    const mark = r.code === 0 ? green(' ✓ ') : red(' ✗ ')
    console.log(`  ${mark} ${r.name.padEnd(24, ' ')} ${dim(SECONDS(r.ms))}`)
  }
  console.log(
    `\n  ${passed}/${results.length} 步通过 · 累计耗时 ${dim(SECONDS(totalMs))}\n`,
  )

  if (startedServer && !has('--stop-after')) {
    console.log(dim('  服务仍在运行（本次由脚本启动）。要关闭：node scripts/dev-stop.mjs\n'))
  }

  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(red(`\n编排器异常: ${err?.stack ?? err}\n`))
  process.exit(1)
})
