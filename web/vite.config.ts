import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const here = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(here, '..')

function loadSites() {
  const path = resolve(rootDir, 'config/sites.json')
  if (!existsSync(path)) throw new Error(`config/sites.json not found at ${path}`)
  return JSON.parse(readFileSync(path, 'utf8')) as {
    ports: Record<string, number>
    prodHosts: Record<string, string>
  }
}

const sites = loadSites()
const site = process.env.HMP_SITE === 'external' ? 'external' : 'intranet'
const isExternal = site === 'external'
const webPort = isExternal ? sites.ports.webExternal : sites.ports.webInternal
const contentPort = isExternal ? sites.ports.contentExternal : sites.ports.contentInternal
const apiTarget = `http://127.0.0.1:${sites.ports.api}`
const contentTarget = `http://127.0.0.1:${contentPort}`

// dev 下站点身份必须由「连的哪个端口」决定，而不是客户端可以随便写的 Host 头。
// 5173 恒为内网、5174 恒为外网；代理转发时把 Host 钉死成本实例自己的入口，
// 于是访问 5174 时即便伪造 `Host: intranet.*`（或 X-Forwarded-Host）也只能拿到
// 外网站点。这与生产 nginx 里 `proxy_set_header Host <站点域名>` 是同一条防线。
const devSiteHost = `127.0.0.1:${webPort}`

// 需要做套接字级隔离时（把内网站点只绑在内网网卡上）设 HMP_BIND，
// 例如 HMP_BIND=10.34.128.193；不设则维持 host:true（监听所有网卡）。
const bindHost = process.env.HMP_BIND ?? true

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(here, 'src'),
      '@shared': resolve(rootDir, 'shared'),
    },
  },
  server: {
    host: bindHost,
    port: webPort,
    strictPort: true,
    fs: { allow: [rootDir] },
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
        headers: { host: devSiteHost, 'x-forwarded-host': devSiteHost },
      },
      '/p/': {
        target: contentTarget,
        changeOrigin: false,
        headers: { host: devSiteHost, 'x-forwarded-host': devSiteHost },
      },
    },
  },
  preview: {
    host: bindHost,
    port: webPort,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})