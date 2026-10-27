#!/usr/bin/env node
/**
 * 只关闭本项目 dev.mjs 拉起的服务。
 *
 * 不要用 `Get-Process node | Stop-Process` —— 那会杀掉机器上所有 node
 * 进程，包括与本项目无关的。这里按命令行精确匹配 dev.mjs。
 */
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const exec = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const LIST = [
  { cmd: 'wmic', args: ['process', 'get', 'ProcessId,CommandLine', '/format:csv'] },
  { cmd: 'powershell', args: ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'] },
]

async function findDevProcesses() {
  for (const { cmd, args } of LIST) {
    try {
      const { stdout } = await exec(cmd, args, { cwd: root, maxBuffer: 8 * 1024 * 1024 })
      const rows = []
      if (cmd === 'powershell') {
        const parsed = JSON.parse(stdout || '[]')
        for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
          if (item?.CommandLine && /scripts[\\/]dev\.mjs/.test(item.CommandLine)) {
            rows.push(Number(item.ProcessId))
          }
        }
      } else {
        for (const line of stdout.split(/\r?\n/)) {
          if (/scripts[\\/]dev\.mjs/.test(line)) {
            const pid = Number(line.trim().split(',').pop())
            if (Number.isFinite(pid)) rows.push(pid)
          }
        }
      }
      if (rows.length) return rows
    } catch {
      // 换下一种方式
    }
  }
  return []
}

/** 查占用某个端口的进程 PID（跨平台，用 netstat）。 */
async function pidsOnPort(port) {
  try {
    const { stdout } = await exec(
      'netstat',
      ['-ano', '-p', 'TCP'],
      { maxBuffer: 8 * 1024 * 1024 },
    )
    const pids = new Set()
    for (const line of stdout.split(/\r?\n/)) {
      if (!new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING`).test(line)) continue
      const pid = Number(line.trim().split(/\s+/).pop())
      if (Number.isFinite(pid)) pids.add(pid)
    }
    return [...pids]
  } catch {
    return []
  }
}

async function main() {
  const sites = JSON.parse(readFileSync(join(root, 'config/sites.json'), 'utf8'))
  const ports = Object.values(sites.ports)

  const pids = await findDevProcesses()
  if (pids.length) {
    console.log(`找到 ${pids.length} 个 dev.mjs 进程，正在关闭…`)
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM')
        console.log(`  已发送 SIGTERM -> ${pid}`)
      } catch (err) {
        console.log(`  关闭 ${pid} 失败: ${err.message}`)
      }
    }
    await new Promise((r) => setTimeout(r, 800))
  } else {
    console.log('没有找到正在运行的 dev.mjs 服务。')
  }

  // dev.mjs 捕获 SIGTERM 后会 kill 子进程，但子进程是 shell:true 派生的，
  // 有时会残留并继续占用端口，导致下次启动 EADDRINUSE 失败。
  // 因此再按端口做一次兜底清理：只针对本项目配置里的端口，不会误杀其他项目。
  let killedByPort = 0
  for (const port of ports) {
    for (const pid of await pidsOnPort(port)) {
      try {
        process.kill(pid, 'SIGKILL')
        killedByPort += 1
        console.log(`  清理残留端口 ${port} -> PID ${pid}`)
      } catch {
        /* 已退出 */
      }
    }
  }

  await new Promise((r) => setTimeout(r, 500))
  const remaining = []
  for (const port of ports) {
    if ((await pidsOnPort(port)).length) remaining.push(port)
  }
  if (remaining.length) {
    console.log(`\n仍有端口被占用: ${remaining.join(', ')}（可能不属于本项目，请手动确认）`)
    process.exit(1)
  }
  console.log(killedByPort ? `完成，另清理了 ${killedByPort} 个残留进程。` : '完成。')
}

main().catch((err) => {
  console.error(`执行失败: ${err?.message ?? err}`)
  process.exit(1)
})
