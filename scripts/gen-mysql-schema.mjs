#!/usr/bin/env node
/**
 * 从 server/prisma/schema.prisma（开发用的 SQLite 版）生成生产用的 MySQL 版 schema。
 *
 * 为什么需要生成而不是维护两份：
 *   Prisma 的 datasource.provider 不能由环境变量切换。手写两份 schema 必然会漂移
 *   —— 改了一边忘了另一边，直到部署当天 `db push` 才炸。
 *   这里以 SQLite 版为唯一事实来源，MySQL 版是纯派生物，进 .gitignore。
 *
 * 为什么还要改字段类型：
 *   Prisma 在 MySQL 上把 `String` 默认映射成 VARCHAR(191)（utf8mb4 下旧索引上限）。
 *   本平台有若干字段明确会超过 191 个字符（复核意见 500 字、下线原因 300 字、
 *   UA 截断到 400 字、审计 detail 是整段 JSON），不显式声明就会被 MySQL 在
 *   写入时截断或报 1406。下面是唯一的清单。
 *
 * 用法：
 *   node scripts/gen-mysql-schema.mjs          # 生成 server/prisma/schema.mysql.prisma
 *   node scripts/gen-mysql-schema.mjs --check  # 生成 + prisma validate + 断言列类型
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const source = join(root, 'server/prisma/schema.prisma')
const target = join(root, 'server/prisma/schema.mysql.prisma')
const prismaCli = join(root, 'server/node_modules/prisma/build/index.js')

/**
 * 会超过 VARCHAR(191) 的字段 → 必须是 TEXT。
 * 依据是 DTO 的长度上限，改 DTO 上限时请同步改这里：
 *   Page.summary / rejectionComment / unpublishReason / unpublishDecisionNote  500/500/300/300
 *   PageVersion.changelog                                                      300
 *   AuditLog.ua（写入时 slice 到 400） / detail（JSON 字符串，长度无上限）
 * Page.title 上限 120，装得下 VARCHAR(191)，故意不加 TEXT（保留可索引能力）。
 */
const TEXT_FIELDS = {
  Page: ['summary', 'rejectionComment', 'unpublishReason', 'unpublishDecisionNote'],
  PageVersion: ['changelog'],
  AuditLog: ['ua', 'detail'],
}

/**
 * 需要指定长度的唯一列。
 * 邮箱按 RFC 最长 254 字符，VARCHAR(191) 会装不下极长地址（MySQL 严格模式直接报错）。
 * MySQL 8 的 DYNAMIC 行格式支持 3072 字节索引，utf8mb4 下 254 字符没问题。
 */
const VARCHAR_FIELDS = {
  User: { email: 254 },
}

const HEADER = `// ⚠️ 本文件由 scripts/gen-mysql-schema.mjs 生成，请勿手工修改。
// 唯一事实来源：server/prisma/schema.prisma（SQLite，开发用）。
// 修改表结构请改源文件后重新生成；验收会跑 --check 防止两边漂移。

`

function transform(schema) {
  const withProvider = schema.replace(
    /(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"sqlite"/,
    '$1"mysql"',
  )
  if (withProvider === schema) {
    throw new Error('未找到 datasource.provider = "sqlite"，schema.prisma 结构可能变了')
  }

  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g
  const out = withProvider.replace(modelRe, (block, model, body) => {
    const texts = TEXT_FIELDS[model] ?? []
    const varchars = VARCHAR_FIELDS[model] ?? {}
    if (!texts.length && !Object.keys(varchars).length) return block

    const lines = body.split('\n').map((line) => {
      const match = line.match(/^(\s*)(\w+)(\s+)String(\??)(.*)$/)
      if (!match) return line
      const [, indent, field, spacing, optional, rest] = match
      if (texts.includes(field)) {
        if (rest.includes('@db.')) throw new Error(`${model}.${field} 已声明 @db.，清单重复`)
        return `${indent}${field}${spacing}String${optional}${rest} @db.Text`
      }
      if (varchars[field]) {
        if (rest.includes('@db.')) throw new Error(`${model}.${field} 已声明 @db.，清单重复`)
        return `${indent}${field}${spacing}String${optional}${rest} @db.VarChar(${varchars[field]})`
      }
      return line
    })

    // 断言每个清单字段都真的改到了，防止 schema 改名后清单静默失效
    const changed = lines.join('\n')
    for (const field of texts) {
      if (!new RegExp(`^\\s*${field}\\s+String\\??[^\\n]*@db\\.Text`, 'm').test(changed)) {
        throw new Error(`TEXT_FIELDS 里的 ${model}.${field} 在 schema 中不存在或类型不是 String`)
      }
    }
    for (const [field, size] of Object.entries(varchars)) {
      if (!new RegExp(`^\\s*${field}\\s+String\\??[^\\n]*@db\\.VarChar\\(${size}\\)`, 'm').test(changed)) {
        throw new Error(`VARCHAR_FIELDS 里的 ${model}.${field} 在 schema 中不存在或类型不是 String`)
      }
    }

    return `model ${model} {${changed}\n}`
  })

  return HEADER + out
}

function runPrisma(args, label) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: join(root, 'server'),
    encoding: 'utf8',
    env: {
      ...process.env,
      // validate / migrate diff 不连库，但 Prisma 仍要求 DATABASE_URL 存在
      DATABASE_URL: process.env.DATABASE_URL ?? 'mysql://hmp:hmp@127.0.0.1:3306/hmp',
    },
  })
  if (result.status !== 0) {
    console.error(`[schema-mysql] ${label} 失败`)
    console.error(result.stdout)
    console.error(result.stderr)
    process.exit(1)
  }
  return result.stdout
}

function main() {
  const check = process.argv.includes('--check')

  if (!existsSync(source)) throw new Error(`找不到源 schema：${source}`)
  if (!existsSync(prismaCli)) {
    throw new Error(`找不到 Prisma CLI：${prismaCli}（先执行 pnpm install）`)
  }

  const generated = transform(readFileSync(source, 'utf8'))
  writeFileSync(target, generated, 'utf8')
  console.log(`[schema-mysql] 已生成 server/prisma/schema.mysql.prisma`)

  if (!check) return

  runPrisma(['validate', '--schema=prisma/schema.mysql.prisma'], 'prisma validate')
  const sql = runPrisma(
    [
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema-datamodel',
      'prisma/schema.mysql.prisma',
      '--script',
    ],
    'prisma migrate diff',
  )

  if (!/CREATE TABLE\s+`Page`/.test(sql)) {
    throw new Error('migrate diff 未包含 Page 表，生成结果异常')
  }

  const problems = []
  for (const [model, fields] of Object.entries(TEXT_FIELDS)) {
    if (!sql.includes(`CREATE TABLE \`${model}\``)) {
      problems.push(`缺少表 ${model}`)
      continue
    }
    for (const field of fields) {
      if (!new RegExp(`\`${field}\`\\s+TEXT`, 'i').test(sql)) {
        problems.push(`${model}.${field} 未生成 TEXT 列`)
      }
    }
  }
  for (const [model, fields] of Object.entries(VARCHAR_FIELDS)) {
    for (const [field, size] of Object.entries(fields)) {
      if (!new RegExp(`\`${field}\`\\s+VARCHAR\\(${size}\\)`, 'i').test(sql)) {
        problems.push(`${model}.${field} 未生成 VARCHAR(${size})`)
      }
    }
  }
  // Prisma 不显式写 ENGINE（MySQL 默认即 InnoDB），但字符集必须显式确认，
  // 否则中文/emoji 会按 latin1 或 utf8mb3 存，出现乱码或写入失败。
  if (!/DEFAULT CHARACTER SET utf8mb4/i.test(sql)) problems.push('建表语句未使用 utf8mb4')

  if (problems.length) {
    console.error('[schema-mysql] 校验失败：')
    for (const item of problems) console.error(`  - ${item}`)
    process.exit(1)
  }

  const textCount = Object.values(TEXT_FIELDS).reduce((n, fields) => n + fields.length, 0)
  console.log(`[schema-mysql] 校验通过：provider=mysql，${textCount} 个 TEXT 列，列类型与清单一致`)
}

try {
  main()
} catch (error) {
  console.error(`[schema-mysql] ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
