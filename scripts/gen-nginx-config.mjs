import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const sites = JSON.parse(readFileSync(join(root, 'config/sites.json'), 'utf8'))
const headers = JSON.parse(readFileSync(join(root, 'config/security-headers.json'), 'utf8'))
const outputDir = join(root, 'deploy/nginx/generated')

function headerBlock(source, indent = '        ') {
  return Object.entries(source)
    .map(([key, value]) => `${indent}add_header ${key} "${value}" always;`)
    .join('\n')
}

function serverNames(hosts) {
  return hosts.join(' ')
}

const contentUpstream = 'api:3000'

function internalConf() {
  const intranet = sites.prodHosts.intranet
  const admin = sites.prodHosts.admin

  return `# 由 scripts/gen-nginx-config.mjs 生成，请勿手工修改
# 站点: intranet / admin  -  作用: 内网门户 + 管理后台 + 内网用户 HTML

upstream hmp_api {
    server ${contentUpstream};
    keepalive 16;
}

# Host 不匹配下面任何 server_name 时，绝不能落到第一个 server 块（历史上就是
# 内网站点）。这种请求一律直接断开：未知 Host / 直接用 IP 访问不应拿到任何站点。
server {
    listen 80 default_server;
    server_name _;
    return 444;
}

server {
    listen 80;
    server_name ${serverNames([intranet, admin])};

    client_max_body_size 200m;

    add_header X-HMP-Site "intranet" always;

    # ---- 管理 API ----
    # 关键：Host / X-Forwarded-Host 都写死成本站点的域名，【不要】用 $host 透传。
    # $host 来自客户端请求头，而服务端的站点判定（内外网权限）就看这个值——
    # 透传等于让外部访客用「Host: intranet.xxx」冒充内网，拿到 scope=full。
    location /api/ {
        proxy_pass http://hmp_api;
        proxy_http_version 1.1;
        proxy_set_header Host ${intranet};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host ${intranet};
        proxy_read_timeout 120s;
    }

    # ---- 用户 HTML 鉴权子请求 ----
    # 调用 API 判断当前会话能否访问该 slug。
    # 204/2xx 放行, 401 需登录, 403 无权限, 404 不存在。
    location = /_hmp_guard {
        internal;
        proxy_pass http://hmp_api/api/guard/content/$hmp_slug;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Host ${intranet};
        proxy_set_header Cookie $http_cookie;
        proxy_set_header X-Forwarded-Host ${intranet};
        proxy_set_header X-Real-IP $remote_addr;
    }

    # ---- 静态资源令牌校验子请求 ----
    # CSP sandbox（不透明源）下，页面的图片/字体/视频请求不会带 SameSite=Lax
    # 的登录 Cookie。这类请求只校验 URL 里的令牌，不再要求会话。
    # HTML 不走这里（见下面三个 location），否则令牌就成了可转发的越权链接。
    location = /_hmp_asset_guard {
        internal;
        proxy_pass http://hmp_api/api/guard/asset/$hmp_slug;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Host ${intranet};
        proxy_set_header Cookie $http_cookie;
        proxy_set_header X-HMP-Token $hmp_token;
        proxy_set_header X-Forwarded-Host ${intranet};
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 入口文档：/p/slug/_a/token[/] —— 仍要登录
    location ~ ^/p/(?<hmp_slug>[A-Za-z0-9_-]+)/_a/(?<hmp_token>[A-Za-z0-9_.-]+)/?$ {
        auth_request /_hmp_guard;
        root /srv;
        try_files
            "/public/$hmp_slug/index.html"
            "/internal/$hmp_slug/index.html"
            "/dept/$hmp_slug/index.html"
            =404;

${headerBlock(headers.content)}
    }

    # 包内其它 HTML 页面 —— 仍要登录
    location ~ ^/p/(?<hmp_slug>[A-Za-z0-9_-]+)/_a/(?<hmp_token>[A-Za-z0-9_.-]+)/(?<hmp_rest>.*\\.html?)$ {
        auth_request /_hmp_guard;
        root /srv;
        try_files
            "/public/$hmp_slug/$hmp_rest"
            "/internal/$hmp_slug/$hmp_rest"
            "/dept/$hmp_slug/$hmp_rest"
            =404;

${headerBlock(headers.content)}
    }

    # 子目录（/…/_a/token/sub/）可能落到 sub/index.html，等同文档
    location ~ ^/p/(?<hmp_slug>[A-Za-z0-9_-]+)/_a/(?<hmp_token>[A-Za-z0-9_.-]+)/(?<hmp_rest>.*/)$ {
        auth_request /_hmp_guard;
        root /srv;
        try_files
            "/public/$hmp_slug/$hmp_rest"
            "/internal/$hmp_slug/$hmp_rest"
            "/dept/$hmp_slug/$hmp_rest"
            =404;

${headerBlock(headers.content)}
    }

    # 真正的静态资源：令牌即通行证
    location ~ ^/p/(?<hmp_slug>[A-Za-z0-9_-]+)/_a/(?<hmp_token>[A-Za-z0-9_.-]+)/(?<hmp_rest>.*)$ {
        auth_request /_hmp_asset_guard;
        root /srv;
        try_files
            "/public/$hmp_slug/$hmp_rest"
            "/internal/$hmp_slug/$hmp_rest"
            "/dept/$hmp_slug/$hmp_rest"
            =404;

${headerBlock(headers.content)}
    }

    location ~ ^/p/(?<hmp_slug>[A-Za-z0-9_-]+)/(?<hmp_rest>.*)$ {
        auth_request /_hmp_guard;
        root /srv;

        # 依次尝试 public / internal / dept 三个发布目录。
        # 任何一个目录命中即返回; 都不存在则 404。
        try_files
            "/public/$hmp_slug/$hmp_rest"
            "/internal/$hmp_slug/$hmp_rest"
            "/dept/$hmp_slug/$hmp_rest"
            =404;

        # 注意：这里不能写 types { ... }。location 级的 types 会【整体替换】
        # http 级 include 的 mime.types（nginx 官方文档：空 types {} 可让整个
        # location 全部落到 default_type），一旦覆盖，css/js/图片/视频统统
        # 变成 application/octet-stream，再叠 nosniff 浏览器一律拒载。
        # mime.types 全量映射 + index.html 由 http 级映射兜底即可。

${headerBlock(headers.content)}
    }

    location = /p {
        return 404;
    }

    # ---- 门户 / 管理后台 (SPA) ----
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";

${headerBlock(headers.web)}
    }

    location ~* \.(js|css|woff2?|ttf|png|jpg|jpeg|gif|svg|ico)$ {
        root /usr/share/nginx/html;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
`
}

function externalConf() {
  const external = sites.prodHosts.external

  return `# 由 scripts/gen-nginx-config.mjs 生成，请勿手工修改
# 站点: www  -  作用: 外网门户 + 仅外网公开的用户 HTML
#
# 核心安全设计:
#   本容器的数据挂载只有 ./data/public, internal/ 与 dept/ 目录在容器内
#   根本不存在。私有页面不是"被规则拦住", 而是"文件不在这里"。
#   即使内外网共用同一网络、外网流量直接打到本机, 也拿不到内网内容。

upstream hmp_api {
    server ${contentUpstream};
    keepalive 16;
}

# Host 不匹配 www 时直接断开（见 nginx-internal.conf 内同名说明）。
server {
    listen 80 default_server;
    server_name _;
    return 444;
}

server {
    listen 80;
    server_name ${external};

    # 与内网站点/应用层上限(MAX_UPLOAD_BYTES 默认 100MB)对齐；
    # 之前只有 10m，带图片/视频的大包在外网入口会被 nginx 直接 413。
    client_max_body_size 200m;

    add_header X-HMP-Site "external" always;

    # Host / X-Forwarded-Host 写死成本站点域名，不透传客户端值，
    # 否则外部访客可用「Host: intranet.xxx」冒充内网拿到管理接口。
    location /api/ {
        proxy_pass http://hmp_api;
        proxy_http_version 1.1;
        proxy_set_header Host ${external};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host ${external};
        proxy_read_timeout 30s;
    }

    # 外网无需登录, 内容按 slug 直接取用。宿主目录已挂载 public 内容。
    location ~ ^/p/(?<hmp_slug>[A-Za-z0-9_-]+)/(?<hmp_rest>.*)$ {
        root /srv;
        try_files "/$hmp_slug/$hmp_rest" =404;

        # 注意：这里不能写 types { ... }。location 级的 types 会【整体替换】
        # http 级 include 的 mime.types（nginx 官方文档：空 types {} 可让整个
        # location 全部落到 default_type），一旦覆盖，css/js/图片/视频统统
        # 变成 application/octet-stream，再叠 nosniff 浏览器一律拒载。
        # mime.types 全量映射 + index.html 由 http 级映射兜底即可。

${headerBlock(headers.content)}
    }

    location = /p {
        return 404;
    }

    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";

${headerBlock(headers.web)}
    }

    location ~* \.(js|css|woff2?|ttf|png|jpg|jpeg|gif|svg|ico)$ {
        root /usr/share/nginx/html;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
`
}

mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, 'nginx-internal.conf'), internalConf(), 'utf8')
writeFileSync(join(outputDir, 'nginx-external.conf'), externalConf(), 'utf8')

console.log('[nginx] generated:')
console.log(`  ${join(outputDir, 'nginx-internal.conf')}`)
console.log(`  ${join(outputDir, 'nginx-external.conf')}`)
console.log('  输出目录已被 .gitignore 忽略：域名改了要重新生成，不要把生成物提交进仓库。')
console.log(`  intranet hosts: ${sites.prodHosts.intranet}, ${sites.prodHosts.admin}`)
console.log(`  external host:  ${sites.prodHosts.external}`)
console.log('[nginx] 部署前请把 config/sites.json 的 prodHosts 改成你们的真实域名。')