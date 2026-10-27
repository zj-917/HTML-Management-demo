import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const distAssets = join(root, 'web/dist/assets')

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

function findBrowser() {
  const found = BROWSERS.find((path) => existsSync(path))
  if (!found) throw new Error('未找到 Chrome 或 Edge，无法执行布局校验')
  return found
}

function findBuiltCss() {
  if (!existsSync(distAssets)) {
    throw new Error('未找到 web/dist/assets，请先执行 pnpm --filter @hmp/web build')
  }
  const files = readdirSync(distAssets).filter((name) => /^index-.*\.css$/.test(name))
  if (!files.length) throw new Error('web/dist/assets 下没有 index-*.css')
  return join(distAssets, files.sort().pop())
}

function findScopeHash(css) {
  const match = css.match(/\.sidebar__menu\[data-v-([0-9a-f]+)\]/)
  if (!match) {
    throw new Error('构建产物里找不到 .sidebar__menu 的 scoped 属性，AppShell 样式可能未被打包')
  }
  return match[1]
}

function buildHarness(hash) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="app.css">
<style>body{margin:0;font:12px monospace}
.probe{position:fixed;right:8px;top:8px;background:#fff;padding:10px;border:1px solid #ccc;z-index:99;white-space:pre}</style>
</head>
<body>
<div class="shell shell--sidebar" data-v-${hash}>
  <aside class="sidebar" data-v-${hash} style="width:64px">
    <a class="sidebar__brand sidebar__brand--mini" data-v-${hash}><span class="sidebar__mark" data-v-${hash}>H</span></a>
    <ul class="el-menu sidebar__menu el-menu--collapse" data-v-${hash}>
      <li class="el-menu-item is-active" data-v-${hash}>
        <div class="el-menu-tooltip__trigger"><i class="el-icon" data-v-${hash}><svg width="24" height="24"><rect x="5" y="5" width="14" height="14" fill="#fff"/></svg></i></div>
      </li>
      <li class="el-menu-item" data-v-${hash}>
        <div class="el-menu-tooltip__trigger"><i class="el-icon" data-v-${hash}><svg width="24" height="24"><circle cx="12" cy="12" r="7" fill="#fff"/></svg></i></div>
      </li>
      <li class="el-menu-item" data-v-${hash}>
        <div class="el-menu-tooltip__trigger"><i class="el-icon" data-v-${hash}><svg width="24" height="24"><path d="M12 5 L20 19 L4 19 Z" fill="#fff"/></svg></i></div>
      </li>
    </ul>
    <button class="sidebar__toggle" data-v-${hash}><span>&lt;</span></button>
  </aside>
  <div style="flex:1;padding:16px">main</div>
</div>
<pre class="probe" id="out"></pre>
<script>
  const aside = document.querySelector('.sidebar')
  const center = aside.getBoundingClientRect().left + aside.getBoundingClientRect().width / 2
  const deltas = []
  document.querySelectorAll('.el-menu-tooltip__trigger .el-icon').forEach((icon, i) => {
    const r = icon.getBoundingClientRect()
    deltas.push({ name: 'menu-icon-' + (i + 1), delta: (r.left + r.width / 2) - center })
  })
  for (const sel of ['.sidebar__mark', '.sidebar__toggle']) {
    const el = document.querySelector(sel)
    const r = el.getBoundingClientRect()
    deltas.push({ name: sel.replace(/\\./g, ''), delta: (r.left + r.width / 2) - center })
  }
  document.getElementById('out').textContent = JSON.stringify(deltas)
</script>
</body>
</html>`
}

function measure(browser, pageDir, file) {
  const profile = join(pageDir, 'profile')
  const dom = execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=5000',
      '--dump-dom',
      `file:///${join(pageDir, file).replace(/\\/g, '/')}`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 },
  )
  const match = dom.match(/<pre class="probe" id="out">([\s\S]*?)<\/pre>/)
  if (!match) throw new Error('无法从浏览器输出中读取测量结果')
  return JSON.parse(match[1])
}

function main() {
  const browser = findBrowser()
  const cssPath = findBuiltCss()
  const css = readFileSync(cssPath, 'utf8')
  const hash = findScopeHash(css)

  const pageDir = mkdtempSync(join(tmpdir(), 'hmp-layout-'))
  writeFileSync(join(pageDir, 'app.css'), css, 'utf8')
  writeFileSync(join(pageDir, 'index.html'), buildHarness(hash), 'utf8')

  const deltas = measure(browser, pageDir, 'index.html')
  const sidebarWidth = 64
  const center = sidebarWidth / 2

  console.log('\n侧边导航折叠态图标居中校验')
  console.log(`构建产物: ${cssPath.split(/[\\/]/).pop()}   scope=${hash}`)
  console.log(`轨道宽度 ${sidebarWidth}px，中心线 ${center}px\n`)

  let failed = 0
  for (const item of deltas) {
    const ok = Math.abs(item.delta) < 0.5
    if (!ok) failed += 1
    const sign = item.delta >= 0 ? '偏右' : '偏左'
    console.log(
      `  [${ok ? 'PASS' : 'FAIL'}] ${item.name.padEnd(18)} 偏移 ${item.delta.toFixed(2)}px ${ok ? '' : sign}`,
    )
  }

  console.log('')
  if (failed > 0) {
    console.error(`结果: ${deltas.length - failed}/${deltas.length} 通过，${failed} 项未居中`)
    console.error('提示: 检查 AppShell.vue 中折叠态规则是否用对了 :deep() 位置 ——')
    console.error('      .sidebar__menu.el-menu--collapse :deep(.el-menu-tooltip__trigger)')
    process.exit(1)
  }
  console.log(`结果: ${deltas.length}/${deltas.length} 通过，折叠态全部居中`)
}

main()