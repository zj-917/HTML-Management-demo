import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CANDIDATES = ['.env', '../.env', 'server/.env']

export function loadEnv(): void {
  for (const candidate of CANDIDATES) {
    const path = resolve(process.cwd(), candidate)
    if (!existsSync(path)) continue
    applyFile(readFileSync(path, 'utf8'))
    return
  }
}

function applyFile(content: string): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    if (!key || process.env[key] !== undefined) continue
    let value = line.slice(separator + 1).trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    if (quoted) value = value.slice(1, -1)
    process.env[key] = value
  }
}

loadEnv()