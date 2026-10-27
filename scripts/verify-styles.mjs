#!/usr/bin/env node
/**
 * 样式基座守卫。
 *
 * 规则：所有颜色只能在 styles/main.css 的 :root 中定义，
 * 组件样式一律用 var(--hmp-*) 或 var(--el-*) 引用。
 *
 * 为什么需要它：本次改造前全仓有 31 处绕过 token 的硬编码色，
 * 其中 AppShell + TrendChart 占 68%。没有这条断言，过几个月一定长回来。
 *
 * 允许的例外：
 * - main.css 的 :root 区块（token 定义本身）
 * - token() 的兜底默认值（TrendChart 运行时读取 CSS 变量失败时使用）
 * - transparent / currentColor / inherit
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const srcDir = join(root, 'web/src')

const HEX = /#[0-9a-fA-F]{3,8}\b/g
const RGB_FN = /\brgba?\s*\(/g

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(vue|css|ts)$/.test(entry)) yield full
  }
}

/** 去掉块注释与行注释，但保留行号（用空格替换，避免行数错位）。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)))
}

/** main.css 允许在 :root 里定义 token，其余位置仍受约束。 */
function blankRootBlocks(text) {
  const out = []
  let depth = 0
  let inRoot = false
  for (const line of text.split('\n')) {
    if (!inRoot && /:root\s*\{/.test(line)) inRoot = true
    if (inRoot) {
      out.push('')
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
      if (depth <= 0) inRoot = false
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/** 取出 .vue 里 <style> 块的内容；.css 返回全文；.ts 返回空。 */
function styleSections(file, source) {
  if (file.endsWith('.css')) {
    const body = isTokenDefinition(file) ? blankRootBlocks(source) : source
    return body.split('\n').map((text, i) => ({ line: i + 1, text }))
  }
  if (file.endsWith('.ts')) return []
  const out = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let match
  while ((match = re.exec(source)) !== null) {
    const startLine = source.slice(0, match.index).split('\n').length
    match[1].split('\n').forEach((line, i) => out.push({ line: startLine + i + 1, text: line }))
  }
  return out
}

function isTokenDefinition(file) {
  return file.endsWith(join('styles', 'main.css'))
}

/** token('--x', '#abc') 这类运行时兜底值不算违规。 */
function isTokenFallback(text) {
  return /token\(\s*'--[^']+'\s*,\s*'#[0-9a-fA-F]{3,8}'\s*\)/.test(text)
}

const violations = []

for (const file of walk(srcDir)) {
  const rel = relative(root, file)
  const source = stripComments(readFileSync(file, 'utf8'))

  for (const { line, text } of styleSections(file, source)) {
    if (isTokenFallback(text)) continue
    HEX.lastIndex = 0
    RGB_FN.lastIndex = 0
    const hexHits = text.match(HEX) ?? []
    const rgbHits = text.match(RGB_FN) ?? []
    if (hexHits.length || rgbHits.length) {
      violations.push(`${rel}:${line}  ${text.trim()}  [${[...hexHits, ...rgbHits].join(', ')}]`)
    }
  }
}

const bar = '='.repeat(52)
console.log(`\n样式基座守卫${bar.slice(4)}`)
console.log('规则：颜色只能在 web/src/styles/main.css 的 :root 中定义')

if (violations.length === 0) {
  console.log(`\n[通过] 未发现绕过 token 的硬编码颜色\n${bar}\n`)
  process.exit(0)
}

console.log('')
for (const v of violations) console.log(`  ${v}`)
console.log(`\n[失败] 共 ${violations.length} 处硬编码颜色`)
console.log('修复方式：把颜色提取为 main.css :root 中的 token，再用 var(--hmp-*) 引用')
console.log(bar + '\n')
process.exit(1)