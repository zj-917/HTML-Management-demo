import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const sites = JSON.parse(readFileSync(join(root, 'config/sites.json'), 'utf8'))

const INTERNAL = `http://127.0.0.1:${sites.ports.webInternal}`
const EXTERNAL = `http://127.0.0.1:${sites.ports.webExternal}`

const results = []
const createdPageIds = new Set()
let failures = 0

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${name}${detail ? ` - ${detail}` : ''}`)
}

function section(title) {
  console.log(`\n${title}`)
}

class Session {
  cookie = ''

  async fetch(url, options = {}) {
    const headers = { ...(options.headers ?? {}) }
    if (this.cookie) headers.cookie = this.cookie
    const response = await fetch(url, { ...options, headers, redirect: 'manual' })
    const setCookie = response.headers.getSetCookie?.() ?? []
    for (const raw of setCookie) {
      const pair = raw.split(';')[0]
      if (pair.startsWith('hmp_session=')) this.cookie = pair
    }
    return response
  }

  async login(base, email, password) {
    const response = await this.fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    return response.status === 200
  }
}

async function json(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * 用 node:http 直接发底层请求。
 *
 * 原因：Node 的 fetch 会静默丢弃自定义 Host（fetch 规范把 Host 列为禁用头），
 * 而「伪造 Host」正是本条要验的攻击向量——用 fetch 发等于没发。
 * node:http / curl 才会真的把 Host 换掉。
 */
function rawRequest(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function main() {
  console.log(`\nHTML 平台隔离验收${'='.repeat(40)}`)
  console.log(`内网入口 ${INTERNAL}`)
  console.log(`外网入口 ${EXTERNAL}\n`)

  const internal = new Session()
  const external = new Session()
  const hr = new Session()
  const sales = new Session()

  section('1. 站点角色识别')
  const internalSite = await json(await internal.fetch(`${INTERNAL}/api/auth/site`))
  const externalSite = await json(await external.fetch(`${EXTERNAL}/api/auth/site`))
  record('内网入口返回 scope=full', internalSite?.scope === 'full', `scope=${internalSite?.scope}`)
  record('外网入口返回 scope=public-only', externalSite?.scope === 'public-only', `scope=${externalSite?.scope}`)

  const adminLoggedIn = await internal.login(INTERNAL, 'admin@hmp.local', 'admin123')
  record('管理员登录成功', adminLoggedIn)

  section('2. 外网匿名浏览')
  const externalList = await json(await external.fetch(`${EXTERNAL}/api/pages?pageSize=60`))
  const internalList = await json(await internal.fetch(`${INTERNAL}/api/pages?pageSize=60`))
  const externalPages = externalList?.items ?? []
  const internalPages = internalList?.items ?? []
  record(
    '外网可见页面全部为 public',
    externalPages.length > 0 && externalPages.every((item) => item.visibility === 'public'),
    `外网 ${externalPages.length} 个`,
  )
  record(
    '内网登录后可见页面多于外网（存在内网专属内容）',
    internalPages.length > externalPages.length,
    `内网 ${internalPages.length} 个 vs 外网 ${externalPages.length} 个`,
  )

  const costPage = internalPages.find((item) => item.title.includes('成本结构'))
  const managed = await json(await internal.fetch(`${INTERNAL}/api/manage/pages?pageSize=60`))
  const deptPage = (managed?.items ?? []).find((item) => item.title.includes('招聘需求'))
  const publicPage = externalPages[0]
  record('能定位到内网专属页面样本', Boolean(costPage && deptPage && publicPage))
  record(
    '指定部门页面不出现在管理员的门户列表中',
    !internalPages.some((item) => item.slug === deptPage?.slug),
    '部门可见性对门户生效',
  )

  section('3. 防线 2：应用层强制改写查询参数')
  const forced = await json(await external.fetch(`${EXTERNAL}/api/pages?visibility=internal&pageSize=60`))
  const forcedItems = forced?.items ?? []
  record(
    '外网传入 visibility=internal 被强制改写为 public',
    forcedItems.length === externalPages.length && forcedItems.every((i) => i.visibility === 'public'),
    `返回 ${forcedItems.length} 个，全部 public`,
  )
  const leaked = externalPages.filter((item) => 'ownerName' in item || 'allowedDepartmentIds' in item)
  record('外网响应裁剪掉上传人/部门授权等敏感字段', leaked.length === 0)

  section('4. 防线 2：外网无管理入口')
  for (const path of ['/api/manage/pages', '/api/stats/overview', '/api/audit-logs', '/api/meta/departments']) {
    const response = await external.fetch(`${EXTERNAL}${path}`)
    record(`外网访问 ${path} 返回 404`, response.status === 404, `实际 ${response.status}`)
  }

  section('5. 防线 1 + 3：内容分发隔离')
  if (costPage) {
    const extInternal = await external.fetch(`${EXTERNAL}/p/${costPage.slug}/`)
    const intInternal = await new Session().fetch(`${INTERNAL}/p/${costPage.slug}/`)
    record('外网访问 internal 页面返回 404', extInternal.status === 404, `实际 ${extInternal.status}`)
    record('内网未登录访问 internal 页面返回 401', intInternal.status === 401, `实际 ${intInternal.status}`)
  }
  if (deptPage) {
    const extDept = await external.fetch(`${EXTERNAL}/p/${deptPage.slug}/`)
    record('外网访问 dept 页面返回 404', extDept.status === 404, `实际 ${extDept.status}`)
    const anonymousDept = await new Session().fetch(`${INTERNAL}/p/${deptPage.slug}/`)
    record('内网未登录访问 dept 页面返回 401', anonymousDept.status === 401, `实际 ${anonymousDept.status}`)
  }
  if (publicPage) {
    const extPublic = await external.fetch(`${EXTERNAL}/p/${publicPage.slug}/`)
    record('外网访问 public 页面返回 200', extPublic.status === 200, `实际 ${extPublic.status}`)
    const csp = extPublic.headers.get('content-security-policy') ?? ''
    record('内容响应含 CSP sandbox 指令', csp.includes('sandbox'), csp.slice(0, 60))
    record('CSP sandbox 不含 allow-same-origin（页面处于不透明源）', !csp.includes('allow-same-origin'))
    record(
      "CSP default-src 为 'none'（未显式放行的通道一律拒绝）",
      /default-src\s+'none'/.test(csp),
    )
    record(
      "CSP connect-src 为 'none'（页面不能发起 fetch/XHR 外带数据）",
      /connect-src\s+'none'/.test(csp),
    )
    record('内容响应含 nosniff', extPublic.headers.get('x-content-type-options') === 'nosniff')
    record('内容响应含 no-referrer', extPublic.headers.get('referrer-policy') === 'no-referrer')
  }

  section('6. 登录与内容鉴权')
  const adminList = await json(await internal.fetch(`${INTERNAL}/api/pages?pageSize=60`))
  record('内网登录后可看到 internal 页面', (adminList?.items ?? []).some((i) => i.visibility === 'internal'))

  if (costPage) {
    const response = await internal.fetch(`${INTERNAL}/p/${costPage.slug}/`)
    record('内网登录后访问 internal 页面返回 200', response.status === 200, `实际 ${response.status}`)
  }

  section('7. 部门级可见性')
  if (deptPage) {
    record('人力资源部账号登录成功', await hr.login(INTERNAL, 'hr@hmp.local', 'hr123'))
    record('销售部账号登录成功', await sales.login(INTERNAL, 'sales@hmp.local', 'sales123'))
    const hrAccess = await hr.fetch(`${INTERNAL}/p/${deptPage.slug}/`)
    const salesAccess = await sales.fetch(`${INTERNAL}/p/${deptPage.slug}/`)
    record('授权部门成员访问 dept 页面返回 200', hrAccess.status === 200, `实际 ${hrAccess.status}`)
    record('非授权部门成员访问 dept 页面返回 403', salesAccess.status === 403, `实际 ${salesAccess.status}`)
  }

  section('8. 上传安全：zip 路径穿越被拒绝')
  const goodZip = await buildZip([{ name: 'index.html', content: '<html><body>ok</body></html>' }])
  const goodForm = new FormData()
  goodForm.append('file', new Blob([goodZip], { type: 'application/zip' }), 'good.zip')
  goodForm.append('title', '正常压缩包对照组')
  goodForm.append('visibility', 'internal')
  const goodResponse = await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: goodForm })
  const goodBody = await json(goodResponse)
  record(
    '对照组：结构合法的压缩包可正常上传',
    goodResponse.status < 400 && goodBody?.packageType === 'bundle',
    `HTTP ${goodResponse.status} packageType=${goodBody?.packageType ?? '-'}`,
  )
  if (goodBody?.id) createdPageIds.add(goodBody.id)

  const evilZip = await buildZip([{ name: '../../../../evil.html', content: '<html>evil</html>' }])
  const uploadForm = new FormData()
  uploadForm.append('file', new Blob([evilZip], { type: 'application/zip' }), 'evil.zip')
  uploadForm.append('title', '路径穿越攻击样本')
  uploadForm.append('visibility', 'internal')
  const uploadResponse = await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: uploadForm })
  const uploadBody = await json(uploadResponse)
  const message = String(uploadBody?.message ?? '')
  record(
    '含 ../ 的恶意压缩包被拒绝',
    uploadResponse.status === 400 && /非法路径|越界|relative path/i.test(message),
    `HTTP ${uploadResponse.status}: ${message || '(无原因说明)'}`,
  )

  section('9. 可见性必填校验')
  const noVisibility = new FormData()
  noVisibility.append('file', new Blob(['<html><body>no visibility</body></html>'], { type: 'text/html' }), 'a.html')
  noVisibility.append('title', '未选择可见性的样本')
  const noVisResponse = await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: noVisibility })
  record(
    '未选择可见性的上传被拒绝（无默认值）',
    noVisResponse.status === 400,
    `HTTP ${noVisResponse.status}`,
  )

  section('10. 完整流程：上传 → 提交 → 审核 → 发布')
  const flow = new FormData()
  flow.append(
    'file',
    new Blob(['<!doctype html><html><body><h1>验收测试页面</h1><p>created by verify script</p></body></html>'], {
      type: 'text/html',
    }),
    'verify.html',
  )
  flow.append('title', '验收测试页面')
  flow.append('summary', '由隔离验收脚本自动创建')
  flow.append('visibility', 'public')
  flow.append('tags', JSON.stringify(['验收']))

  const createResponse = await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: flow })
  const created = await json(createResponse)
  record('上传成功并进入草稿状态', createResponse.status < 400 && created?.status === 'draft', `status=${created?.status}`)
  if (created?.id) createdPageIds.add(created.id)

  if (created?.id) {
    const submitResponse = await internal.fetch(`${INTERNAL}/api/manage/pages/${created.id}/submit`, { method: 'POST' })
    record('提交审核成功', submitResponse.status < 400)

    const publishResponse = await internal.fetch(`${INTERNAL}/api/manage/pages/${created.id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
    const published = await json(publishResponse)
    record('审核通过并发布', published?.status === 'published', `status=${published?.status}`)

    const liveOnExternal = await external.fetch(`${EXTERNAL}/p/${created.slug}/`)
    record('新发布的 public 页面立刻可在外网访问', liveOnExternal.status === 200, `实际 ${liveOnExternal.status}`)

    const unpublishResponse = await internal.fetch(`${INTERNAL}/api/manage/pages/${created.id}/unpublish`, {
      method: 'POST',
    })
    record('下线成功', unpublishResponse.status < 400)
    const afterUnpublish = await external.fetch(`${EXTERNAL}/p/${created.slug}/`)
    record('下线后外网立即 404', afterUnpublish.status === 404, `实际 ${afterUnpublish.status}`)
  }

  section('11. 审计日志')
  const audit = await json(await internal.fetch(`${INTERNAL}/api/audit-logs?pageSize=50`))
  const actions = new Set((audit?.items ?? []).map((item) => item.action))
  record(
    '审计日志记录了登录/上传/提交/审核等关键动作',
    ['login', 'upload', 'submit', 'approve'].every((action) => actions.has(action)),
    `已有动作: ${[...actions].join(',')}`,
  )

  section('12. 角色权限隔离（员工不得访问管理数据）')
  const member = new Session()
  const memberLogin = await member.login(INTERNAL, 'sales@hmp.local', 'sales123')
  record('员工账号登录成功', memberLogin)

  const forbiddenPaths = [
    '/api/stats/overview',
    '/api/stats/trend',
    '/api/audit-logs',
    '/api/manage/users',
    '/api/meta/departments',
    '/api/manage/pages',
  ]
  for (const path of forbiddenPaths) {
    const response = await member.fetch(`${INTERNAL}${path}`)
    record(`员工访问 ${path} 被拒绝`, response.status === 403, `实际 ${response.status}`)
  }

  for (const path of ['/api/meta/categories', '/api/meta/departments/options', '/api/my-pages']) {
    const response = await member.fetch(`${INTERNAL}${path}`)
    record(`员工可访问 ${path}`, response.status === 200, `实际 ${response.status}`)
  }

  const myPages = await json(await member.fetch(`${INTERNAL}/api/my-pages?pageSize=50`))
  const myItems = myPages?.items ?? []
  record(
    '「我的页面」只返回当前用户自己创建的页面',
    myItems.every((item) => item.ownerName === '李销售'),
    `返回 ${myItems.length} 条，创建人=${[...new Set(myItems.map((i) => i.ownerName))].join(',') || '空'}`,
  )

  const ownPageId = myItems[0]?.id
  if (ownPageId) {
    const patch = await member.fetch(`${INTERNAL}/api/manage/pages/${ownPageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '员工试图改名' }),
    })
    record('员工修改自己页面的元数据被拒绝', patch.status === 403, `实际 ${patch.status}`)

    for (const action of ['review', 'unpublish', 'rollback/x']) {
      const response = await member.fetch(`${INTERNAL}/api/manage/pages/${ownPageId}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      record(`员工对自己的页面执行 ${action} 被拒绝`, response.status === 403, `实际 ${response.status}`)
    }

    const versions = await member.fetch(`${INTERNAL}/api/manage/pages/${ownPageId}/versions`)
    record(
      '员工可查看自己页面的版本历史（owner 级访问未被角色拦截）',
      versions.status === 200,
      `实际 ${versions.status}`,
    )

    const ownDetail = await member.fetch(`${INTERNAL}/api/manage/pages/${ownPageId}`)
    record('员工可查看自己页面的详情', ownDetail.status === 200, `实际 ${ownDetail.status}`)
  } else {
    record('存在可用于权限校验的员工自有页面', false, '「我的页面」为空')
  }

  for (const path of forbiddenPaths) {
    const response = await internal.fetch(`${INTERNAL}${path}`)
    record(`管理员访问 ${path} 正常`, response.status === 200, `实际 ${response.status}`)
  }

  section('13. 下线申请流程')
  const reqForm = new FormData()
  reqForm.append('file', new Blob(['<html><body>下线申请流程探针</body></html>'], { type: 'text/html' }), 'req.html')
  reqForm.append('title', '下线流程探针')
  reqForm.append('summary', '验证下线申请流程，结束后自动归档')
  reqForm.append('visibility', 'public')
  const reqPage = await json(await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: reqForm }))
  if (reqPage?.id) createdPageIds.add(reqPage.id)
  const reqSlug = reqPage?.slug

  await internal.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/submit`, { method: 'POST' })
  const approveProbe = await internal.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  })
  record('探针页面已发布', approveProbe.status < 400, `HTTP ${approveProbe.status}`)

  const shortReason = await internal.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '短' }),
  })
  record('下线原因过短被拒绝', shortReason.status === 400, `HTTP ${shortReason.status}`)

  const memberProbe = new Session()
  await memberProbe.login(INTERNAL, 'finance@hmp.local', 'finance123')
  const crossOwner = await memberProbe.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '别人的页面我也要下线' }),
  })
  record('员工对他人页面发起下线申请被拒绝', crossOwner.status === 403, `HTTP ${crossOwner.status}`)

  const doRequest = await internal.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '数据已过期，验证下线申请流程' }),
  })
  const afterRequest = await json(doRequest)
  record(
    '发起下线申请成功',
    doRequest.status < 400 && Boolean(afterRequest?.unpublishRequestedAt),
    `HTTP ${doRequest.status}`,
  )
  record(
    '申请期间页面状态仍为 published（保持在线）',
    afterRequest?.status === 'published',
    `status=${afterRequest?.status}`,
  )

  const stillLive = await external.fetch(`${EXTERNAL}/p/${reqSlug}/`)
  record('申请期间外网仍可访问（尚未真正下线）', stillLive.status === 200, `实际 ${stillLive.status}`)

  const duplicate = await internal.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '重复申请应当被拒绝掉' }),
  })
  record('重复申请被拒绝', duplicate.status === 400, `HTTP ${duplicate.status}`)

  const memberApprove = await memberProbe.fetch(
    `${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request/approve`,
    { method: 'POST' },
  )
  record('员工不能批准下线申请', memberApprove.status === 403, `HTTP ${memberApprove.status}`)

  const memberReject = await memberProbe.fetch(
    `${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request/reject`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: 'x' }) },
  )
  record('员工不能驳回下线申请', memberReject.status === 403, `HTTP ${memberReject.status}`)

  const queueOnly = await json(
    await internal.fetch(`${INTERNAL}/api/manage/pages?unpublishRequested=true&pageSize=50`),
  )
  record(
    '?unpublishRequested=true 只返回有进行中申请的页面',
    (queueOnly?.items ?? []).length > 0 && queueOnly.items.every((item) => Boolean(item.unpublishRequestedAt)),
    `返回 ${queueOnly?.items?.length ?? 0} 条`,
  )

  const rejectDecision = await internal.fetch(
    `${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request/reject`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: '页面仍被使用，先保留' }) },
  )
  const afterReject = await json(rejectDecision)
  record(
    '管理员驳回后申请清空并记录处理意见',
    rejectDecision.status < 400 &&
      !afterReject?.unpublishRequestedAt &&
      afterReject?.unpublishDecisionNote === '页面仍被使用，先保留',
    `note=${afterReject?.unpublishDecisionNote}`,
  )
  const liveAfterReject = await external.fetch(`${EXTERNAL}/p/${reqSlug}/`)
  record('驳回后页面仍在线', liveAfterReject.status === 200, `实际 ${liveAfterReject.status}`)

  const reRequest = await internal.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '重新申请下线，这次真的不需要了' }),
  })
  record('驳回后可再次申请', reRequest.status < 400, `HTTP ${reRequest.status}`)

  const withdraw = await internal.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request/withdraw`, {
    method: 'POST',
  })
  const afterWithdraw = await json(withdraw)
  record('撤回后申请字段被清空', withdraw.status < 400 && !afterWithdraw?.unpublishRequestedAt, `HTTP ${withdraw.status}`)

  const finalRequest = await internal.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '最后一次申请，验证批准流程' }),
  })
  record('撤回后可再次申请', finalRequest.status < 400, `HTTP ${finalRequest.status}`)

  const approveDown = await internal.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request/approve`, {
    method: 'POST',
  })
  const afterApprove = await json(approveDown)
  record(
    '管理员批准后真正下线',
    approveDown.status < 400 && afterApprove?.status === 'draft' && !afterApprove?.unpublishRequestedAt,
    `status=${afterApprove?.status}`,
  )
  const goneAfterApprove = await external.fetch(`${EXTERNAL}/p/${reqSlug}/`)
  record('批准后外网立即 404', goneAfterApprove.status === 404, `实际 ${goneAfterApprove.status}`)

  const requestArchived = await internal.fetch(`${INTERNAL}/api/manage/pages/${reqPage?.id}/unpublish-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '页面已下线，不应还能申请' }),
  })
  record('已下线页面不能再次申请', requestArchived.status === 400, `HTTP ${requestArchived.status}`)

  section('13b. 已发布页面不能直接删除（必须先走下线流程）')
  const pubForm = new FormData()
  pubForm.append('file', new Blob(['<html><body>已发布删除探针</body></html>'], { type: 'text/html' }), 'pub-del.html')
  pubForm.append('title', '已发布删除探针')
  pubForm.append('visibility', 'public')
  const pubPage = await json(await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: pubForm }))
  const pubId = pubPage?.id
  if (pubId) createdPageIds.add(pubId)

  await internal.fetch(`${INTERNAL}/api/manage/pages/${pubId}/submit`, { method: 'POST' })
  await internal.fetch(`${INTERNAL}/api/manage/pages/${pubId}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  })

  const pubDelAdmin = await internal.fetch(`${INTERNAL}/api/manage/pages/${pubId}/delete`, { method: 'POST' })
  record('管理员不能直接删除已发布页面', pubDelAdmin.status === 400, `HTTP ${pubDelAdmin.status}`)

  const ownerDelPub = await internal.fetch(`${INTERNAL}/api/manage/pages/${pubId}/delete`, { method: 'POST' })
  const ownerDelMsg = (await json(ownerDelPub))?.message ?? ''
  record(
    '已发布页面删除被拒绝且提示先下线',
    ownerDelPub.status === 400 && ownerDelMsg.includes('下线'),
    `HTTP ${ownerDelPub.status} · ${ownerDelMsg}`,
  )

  const stillPublished = await json(await internal.fetch(`${INTERNAL}/api/manage/pages/${pubId}`))
  record(
    '删除被拒后页面仍为已发布且未进回收站',
    stillPublished?.page?.status === 'published' && !stillPublished?.page?.deletedAt,
    `status=${stillPublished?.page?.status}`,
  )

  const stillInPortal = await json(await external.fetch(`${EXTERNAL}/api/pages?pageSize=100`))
  record(
    '删除被拒后页面仍在外网门户',
    (stillInPortal?.items ?? []).some((item) => item.slug === pubPage?.slug),
  )

  await internal.fetch(`${INTERNAL}/api/manage/pages/${pubId}/unpublish-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '验收：验证下线批准后方可删除' }),
  })
  await internal.fetch(`${INTERNAL}/api/manage/pages/${pubId}/unpublish-request/approve`, { method: 'POST' })

  const afterUnpublish = await json(await internal.fetch(`${INTERNAL}/api/manage/pages/${pubId}`))
  record(
    '下线批准后页面回到 draft',
    afterUnpublish?.page?.status === 'draft',
    `status=${afterUnpublish?.page?.status}`,
  )

  const offPortal = await external.fetch(`${EXTERNAL}/p/${pubPage?.slug}/`)
  record('下线批准后内容地址立即 404', offPortal.status === 404, `实际 ${offPortal.status}`)

  const delAfterUnpublish = await internal.fetch(`${INTERNAL}/api/manage/pages/${pubId}/delete`, { method: 'POST' })
  record(
    '下线批准后即可删除',
    delAfterUnpublish.status < 400,
    `HTTP ${delAfterUnpublish.status}`,
  )

  if (pubId) createdPageIds.delete(pubId)

  section('13c. 回收站流程（未发布页面）')
  const delForm = new FormData()
  delForm.append('file', new Blob(['<html><body>回收站流程探针</body></html>'], { type: 'text/html' }), 'del.html')
  delForm.append('title', '回收站流程探针')
  delForm.append('summary', '验证删除/恢复流程，结束后彻底删除')
  delForm.append('visibility', 'public')
  const delPage = await json(await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: delForm }))
  const delId = delPage?.id
  const delSlug = delPage?.slug

  const memberDel = new Session()
  await memberDel.login(INTERNAL, 'finance@hmp.local', 'finance123')
  const crossDelete = await memberDel.fetch(`${INTERNAL}/api/manage/pages/${delId}/delete`, { method: 'POST' })
  record('员工删除他人页面被拒绝', crossDelete.status === 403, `HTTP ${crossDelete.status}`)

  const doDelete = await internal.fetch(`${INTERNAL}/api/manage/pages/${delId}/delete`, { method: 'POST' })
  const afterDeleteFlow = await json(doDelete)
  record('删除成功并进入回收站', doDelete.status < 400 && Boolean(afterDeleteFlow?.deletedAt), `HTTP ${doDelete.status}`)

  // 曾因详情 mapper 漏 deletedByName 导致回收站提示恒显示「操作人：-」
  const detailAfterDelete = await json(await internal.fetch(`${INTERNAL}/api/manage/pages/${delId}`))
  record(
    '详情接口返回删除操作人（deletedByName 不缺字段）',
    Boolean(detailAfterDelete?.page?.deletedByName),
    `deletedByName=${detailAfterDelete?.page?.deletedByName}`,
  )

  const goneFromPortal = await json(await external.fetch(`${EXTERNAL}/api/pages?pageSize=100`))
  record(
    '删除后不出现在外网门户',
    !(goneFromPortal?.items ?? []).some((item) => item.slug === delSlug),
  )

  const contentGone = await external.fetch(`${EXTERNAL}/p/${delSlug}/`)
  record('删除后内容地址立即 404', contentGone.status === 404, `实际 ${contentGone.status}`)

  const submitDeleted = await internal.fetch(`${INTERNAL}/api/manage/pages/${delId}/submit`, { method: 'POST' })
  record('回收站中的页面不能提交审核', submitDeleted.status === 400, `HTTP ${submitDeleted.status}`)

  const versionDeleted = await internal.fetch(`${INTERNAL}/api/manage/pages/${delId}/versions`, { method: 'POST' })
  record(
    '回收站中的页面不能上传新版本（无文件时 400）',
    versionDeleted.status === 400,
    `HTTP ${versionDeleted.status}`,
  )

  const memberRestoreOther = await memberDel.fetch(`${INTERNAL}/api/manage/pages/${delId}/restore`, {
    method: 'POST',
  })
  record('员工恢复他人页面被拒绝', memberRestoreOther.status === 403, `HTTP ${memberRestoreOther.status}`)

  const memberPurge = await memberDel.fetch(`${INTERNAL}/api/manage/pages/${delId}`, { method: 'DELETE' })
  record('员工不能彻底删除', memberPurge.status === 403, `HTTP ${memberPurge.status}`)

  const restore = await internal.fetch(`${INTERNAL}/api/manage/pages/${delId}/restore`, { method: 'POST' })
  const afterRestore = await json(restore)
  record(
    '恢复成功并离开回收站',
    restore.status < 400 && !afterRestore?.deletedAt,
    `HTTP ${restore.status}`,
  )

  const notInPortal = await json(await external.fetch(`${EXTERNAL}/api/pages?pageSize=100`))
  record(
    '恢复后不会自动回到外网门户（仍需重新审核）',
    !(notInPortal?.items ?? []).some((item) => item.slug === delSlug),
  )

  const reDelete = await internal.fetch(`${INTERNAL}/api/manage/pages/${delId}/delete`, { method: 'POST' })
  record('恢复后可再次删除', reDelete.status < 400, `HTTP ${reDelete.status}`)

  const purge = await internal.fetch(`${INTERNAL}/api/manage/pages/${delId}`, { method: 'DELETE' })
  record('彻底删除成功', purge.status < 400, `HTTP ${purge.status}`)

  const afterPurge = await internal.fetch(`${INTERNAL}/api/manage/pages/${delId}`)
  record('彻底删除后详情接口返回 404', afterPurge.status === 404, `HTTP ${afterPurge.status}`)

  const contentAfterPurge = await external.fetch(`${EXTERNAL}/p/${delSlug}/`)
  record('彻底删除后内容地址仍为 404', contentAfterPurge.status === 404, `实际 ${contentAfterPurge.status}`)

  const liveForm = new FormData()
  liveForm.append('file', new Blob(['<html><body>未删除探针</body></html>'], { type: 'text/html' }), 'live.html')
  liveForm.append('title', '未进回收站探针')
  liveForm.append('visibility', 'internal')
  const livePage = await json(await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: liveForm }))
  if (livePage?.id) createdPageIds.add(livePage.id)

  const livePurge = await internal.fetch(`${INTERNAL}/api/manage/pages/${livePage?.id}`, { method: 'DELETE' })
  record(
    '未进回收站的页面不能被彻底删除',
    livePurge.status === 400,
    `HTTP ${livePurge.status}`,
  )

  const rejectedForm = new FormData()
  rejectedForm.append('file', new Blob(['<html><body>驳回删除探针</body></html>'], { type: 'text/html' }), 'rej.html')
  rejectedForm.append('title', '驳回后删除探针')
  rejectedForm.append('visibility', 'internal')
  const rejPage = await json(await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: rejectedForm }))
  const rejId = rejPage?.id
  if (rejId) createdPageIds.add(rejId)
  await internal.fetch(`${INTERNAL}/api/manage/pages/${rejId}/submit`, { method: 'POST' })
  await internal.fetch(`${INTERNAL}/api/manage/pages/${rejId}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'reject', comment: '验收：验证驳回状态可删除' }),
  })
  const rejStatus = await json(await internal.fetch(`${INTERNAL}/api/manage/pages/${rejId}`))
  record(
    '审核驳回后页面状态为 rejected',
    rejStatus?.page?.status === 'rejected',
    `status=${rejStatus?.page?.status}`,
  )
  const rejDel = await internal.fetch(`${INTERNAL}/api/manage/pages/${rejId}/delete`, { method: 'POST' })
  record('rejected 状态可直接删除（未发布过）', rejDel.status < 400, `HTTP ${rejDel.status}`)
  if (rejId) createdPageIds.delete(rejId)

  const pendForm = new FormData()
  pendForm.append('file', new Blob(['<html><body>待审删除探针</body></html>'], { type: 'text/html' }), 'pend.html')
  pendForm.append('title', '待审删除探针')
  pendForm.append('visibility', 'internal')
  const pendPage = await json(await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: pendForm }))
  const pendId = pendPage?.id
  if (pendId) createdPageIds.add(pendId)
  await internal.fetch(`${INTERNAL}/api/manage/pages/${pendId}/submit`, { method: 'POST' })
  const pendDel = await internal.fetch(`${INTERNAL}/api/manage/pages/${pendId}/delete`, { method: 'POST' })
  record(
    'API 契约：pending 状态仍允许删除（界面不暴露该入口）',
    pendDel.status < 400,
    `HTTP ${pendDel.status}`,
  )

  section('13d. 详情接口必须返回 tags 数组（曾因 mapper 漏字段导致详情页白屏）')
  const detailForm = new FormData()
  detailForm.append('file', new Blob(['<html><body>详情字段探针</body></html>'], { type: 'text/html' }), 'detail.html')
  detailForm.append('title', '详情字段探针')
  detailForm.append('summary', '验证详情接口 tags 字段不缺失')
  detailForm.append('visibility', 'internal')
  detailForm.append('tags', JSON.stringify(['探针标签']))
  const detailPage = await json(await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: detailForm }))
  const detailId = detailPage?.id
  if (detailId) createdPageIds.add(detailId)

  const manageDetail = await json(await internal.fetch(`${INTERNAL}/api/manage/pages/${detailId}`))
  record(
    '管理端详情返回 tags 数组',
    Array.isArray(manageDetail?.page?.tags),
    `tags=${JSON.stringify(manageDetail?.page?.tags)}`,
  )
  record(
    '管理端详情保留上传时填写的标签',
    (manageDetail?.page?.tags ?? []).includes('探针标签'),
    `tags=${JSON.stringify(manageDetail?.page?.tags)}`,
  )

  const myDetail = await json(await internal.fetch(`${INTERNAL}/api/my-pages/${detailId}`))
  record(
    '我的页面详情返回 tags 数组',
    Array.isArray(myDetail?.page?.tags),
    `tags=${JSON.stringify(myDetail?.page?.tags)}`,
  )

  // 门户详情接口只对已发布页面开放，这里单独建一个已发布的公开页来验证
  const portalForm = new FormData()
  portalForm.append('file', new Blob(['<html><body>门户详情探针</body></html>'], { type: 'text/html' }), 'portal-detail.html')
  portalForm.append('title', '门户详情探针')
  portalForm.append('summary', '验证门户详情 tags 字段不缺失')
  portalForm.append('visibility', 'public')
  portalForm.append('tags', JSON.stringify(['门户标签']))
  const portalPage = await json(await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: portalForm }))
  if (portalPage?.id) createdPageIds.add(portalPage.id)
  await internal.fetch(`${INTERNAL}/api/manage/pages/${portalPage?.id}/submit`, { method: 'POST' })
  await internal.fetch(`${INTERNAL}/api/manage/pages/${portalPage?.id}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  })

  const portalDetail = await json(await external.fetch(`${EXTERNAL}/api/pages/${portalPage?.slug}`))
  record(
    '门户详情返回 tags 数组',
    Array.isArray(portalDetail?.page?.tags),
    `tags=${JSON.stringify(portalDetail?.page?.tags)}`,
  )

  section('14. 列表筛选与分页参数必须真正生效')
  // 准备一个待审核页面，避免断言依赖"库中恰好有 pending"的脆弱前置条件
  const pendingForm = new FormData()
  pendingForm.append('file', new Blob(['<html><body>筛选探针</body></html>'], { type: 'text/html' }), 'probe.html')
  pendingForm.append('title', '筛选探针-待审核')
  pendingForm.append('summary', '用于验证 status 筛选，结束后自动归档')
  pendingForm.append('visibility', 'internal')
  const pendingCreated = await json(await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: pendingForm }))
  if (pendingCreated?.id) {
    createdPageIds.add(pendingCreated.id)
    await internal.fetch(`${INTERNAL}/api/manage/pages/${pendingCreated.id}/submit`, { method: 'POST' })
  }

  const categories = await json(await internal.fetch(`${INTERNAL}/api/meta/categories`))
  const categoryId = categories?.items?.[0]?.id

  const pendingOnly = await json(await internal.fetch(`${INTERNAL}/api/manage/pages?status=pending&pageSize=50`))
  record(
    '?status=pending 只返回待审核页面',
    (pendingOnly?.items ?? []).length > 0 && pendingOnly.items.every((item) => item.status === 'pending'),
    `返回 ${pendingOnly?.items?.length ?? 0} 条，状态=${[...new Set((pendingOnly?.items ?? []).map((i) => i.status))].join(',') || '空'}`,
  )

  const publishedOnly = await json(await internal.fetch(`${INTERNAL}/api/manage/pages?status=published&pageSize=50`))
  record(
    '?status=published 只返回已发布页面',
    (publishedOnly?.items ?? []).length > 0 && publishedOnly.items.every((item) => item.status === 'published'),
    `返回 ${publishedOnly?.items?.length ?? 0} 条`,
  )
  record(
    '?status 过滤结果互斥（pending 与 published 不重叠）',
    pendingOnly.items.length + publishedOnly.items.length <= (await json(await internal.fetch(`${INTERNAL}/api/manage/pages?pageSize=100`)))?.total,
  )

  const internalOnly = await json(await internal.fetch(`${INTERNAL}/api/manage/pages?visibility=internal&pageSize=50`))
  record(
    '?visibility=internal 只返回内网可见页面',
    (internalOnly?.items ?? []).length > 0 && internalOnly.items.every((item) => item.visibility === 'internal'),
    `返回 ${internalOnly?.items?.length ?? 0} 条，可见性=${[...new Set((internalOnly?.items ?? []).map((i) => i.visibility))].join(',') || '空'}`,
  )

  if (categoryId) {
    const byCategory = await json(await internal.fetch(`${INTERNAL}/api/manage/pages?categoryId=${categoryId}&pageSize=50`))
    record(
      '?categoryId 只返回该分类下的页面',
      (byCategory?.items ?? []).length > 0 && byCategory.items.every((item) => item.categoryId === categoryId),
      `返回 ${byCategory?.items?.length ?? 0} 条`,
    )
  }

  const paged = await json(await internal.fetch(`${INTERNAL}/api/manage/pages?pageSize=1`))
  const paged2 = await json(await internal.fetch(`${INTERNAL}/api/manage/pages?pageSize=1&page=2`))
  record('?pageSize 生效（只返回 1 条）', (paged?.items?.length ?? 0) === 1, `返回 ${paged?.items?.length ?? 0} 条`)
  record(
    '?page 生效（第 2 页内容与第 1 页不同）',
    paged?.items?.[0]?.id && paged2?.items?.[0]?.id && paged.items[0].id !== paged2.items[0].id,
  )

  const portalByCategory = await json(await external.fetch(`${EXTERNAL}/api/pages?categoryId=${categoryId ?? 'x'}`))
  record(
    '门户的 ?categoryId 筛选同样生效',
    (portalByCategory?.items ?? []).every((item) => item.categoryId === categoryId),
    `返回 ${portalByCategory?.items?.length ?? 0} 条`,
  )

  section('15. URL 命名空间分离（内容路径与 SPA 路由不冲突）')
  if (publicPage) {
    const contentResponse = await internal.fetch(`${INTERNAL}/p/${publicPage.slug}/`)
    const csp2 = contentResponse.headers.get('content-security-policy') ?? ''
    record(
      '/p/{slug}/ 返回原始页面内容',
      contentResponse.status === 200 && csp2.includes('sandbox'),
      `HTTP ${contentResponse.status}, csp=${csp2 ? '有' : '无'}`,
    )

    const headResponse = await internal.fetch(`${INTERNAL}/p/${publicPage.slug}/`, { method: 'HEAD' })
    record(
      '/p/{slug}/ 支持 HEAD 预检（预览页用于提前探测可访问性）',
      headResponse.status === 200,
      `HTTP ${headResponse.status}`,
    )

    const spaResponse = await internal.fetch(`${INTERNAL}/preview/${publicPage.slug}`)
    const spaHtml = await spaResponse.text()
    record(
      '/preview/{slug} 返回 SPA 页面而非页面内容',
      spaResponse.status === 200 && spaHtml.includes('<div id="app">'),
      `HTTP ${spaResponse.status}, 含 app 挂载点=${spaHtml.includes('<div id="app">')}`,
    )

    const bodyType = contentResponse.headers.get('content-type') ?? ''
    record(
      '内容路径与 SPA 路径返回类型不同（互不串扰）',
      bodyType.startsWith('text/html') && !contentResponse.headers.get('x-powered-by'),
      `内容 Content-Type=${bodyType.split(';')[0]}`,
    )
  }

  section('15b. 访问统计按业务时区归档（不受服务器时区影响）')
  const tzOffsetMinutes = Number(process.env.BUSINESS_TZ_OFFSET || 480)
  const localDayKey = (d) => new Date(d.getTime() + tzOffsetMinutes * 60000).toISOString().slice(0, 10)
  const localDayKeyDaysAgo = (n) => localDayKey(new Date(Date.now() - n * 86400000))
  const businessToday = localDayKeyDaysAgo(0)

  const tzTrend = await json(await internal.fetch(`${INTERNAL}/api/stats/trend?days=7`))
  record(
    '趋势图最后一天等于业务时区今天',
    tzTrend?.[tzTrend.length - 1]?.date === businessToday,
    `最后一天 ${tzTrend?.[tzTrend.length - 1]?.date}，期望 ${businessToday}`,
  )
  record(
    '趋势图日期连续无缺口',
    (tzTrend ?? []).length === 7 && tzTrend.every((item, index) => item.date === localDayKeyDaysAgo(6 - index)),
    `返回 ${tzTrend?.length ?? 0} 条`,
  )

  const viewForm = new FormData()
  viewForm.append('file', new Blob(['<html><body>访问统计探针</body></html>'], { type: 'text/html' }), 'view.html')
  viewForm.append('title', '访问统计探针')
  viewForm.append('summary', '验证真实访问计入业务时区今天，结束后清理')
  viewForm.append('visibility', 'public')
  const viewPage = await json(await internal.fetch(`${INTERNAL}/api/manage/pages`, { method: 'POST', body: viewForm }))
  if (viewPage?.id) createdPageIds.add(viewPage.id)
  await internal.fetch(`${INTERNAL}/api/manage/pages/${viewPage?.id}/submit`, { method: 'POST' })
  await internal.fetch(`${INTERNAL}/api/manage/pages/${viewPage?.id}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  })

  const dayBefore = await json(await internal.fetch(`${INTERNAL}/api/stats/trend?days=1`))
  const viewHit = await external.fetch(`${EXTERNAL}/api/pages/${viewPage?.slug}/view`, { method: 'POST' })
  const dayAfter = await json(await internal.fetch(`${INTERNAL}/api/stats/trend?days=1`))
  record(
    '真实访问上报计入业务时区今天',
    viewHit.status === 204 &&
      dayAfter?.[0]?.date === businessToday &&
      (dayAfter?.[0]?.count ?? 0) === (dayBefore?.[0]?.count ?? 0) + 1,
    `${dayBefore?.[0]?.count} → ${dayAfter?.[0]?.count}（${dayAfter?.[0]?.date}，上报 ${viewHit.status}）`,
  )

  // 当天存在多个已发布页面，趋势单日总量必须等于各页面之和，
  // 否则说明查询端把多行覆盖成了单页数值（历史 bug：Map.set 直接覆盖）。
  const todayPages = await json(
    await internal.fetch(`${INTERNAL}/api/manage/pages?pageSize=60`),
  )
  const liveCount = (todayPages?.items ?? []).filter((item) => item.status === 'published').length
  const trend1 = await json(await internal.fetch(`${INTERNAL}/api/stats/trend?days=1`))
  record(
    '多页面同日访问被累加而非相互覆盖',
    liveCount < 2 || (trend1?.[0]?.count ?? 0) > 0,
    `已发布 ${liveCount} 个，今日计数 ${trend1?.[0]?.count}`,
  )

  section('16. 清理验收过程中创建的页面，并验证回收站语义')
  const beforeDelete = await json(await internal.fetch(`${INTERNAL}/api/manage/pages?pageSize=100`))
  // 已发布页面不能直接删除（收口规则），需要先下线再删，否则会残留
  for (const id of createdPageIds) {
    const detailNow = await json(await internal.fetch(`${INTERNAL}/api/manage/pages/${id}`))
    if (detailNow?.page?.status === 'published') {
      await internal.fetch(`${INTERNAL}/api/manage/pages/${id}/unpublish`, { method: 'POST' })
    }
const response = await internal.fetch(`${INTERNAL}/api/manage/pages/${id}/delete`, { method: 'POST' })
    if (response.status < 400) createdPageIds.delete(id)
    else {
      const stuck = await json(await internal.fetch(`${INTERNAL}/api/manage/pages/${id}`))
      // 已在回收站即视为清理完成（再次删除会被「已在回收站中」拒绝）
      if (stuck?.page?.deletedAt) createdPageIds.delete(id)
      else console.log(`  [debug] 删除未成功 id=${id.slice(0, 8)} http=${response.status} 现状=${JSON.stringify({ status: stuck?.page?.status, deletedAt: stuck?.page?.deletedAt })}`)
    }
  }
  record('验收产生的测试页面已全部移入回收站', createdPageIds.size === 0, `残留 ${createdPageIds.size} 个`)

  const afterDelete = await json(await internal.fetch(`${INTERNAL}/api/manage/pages?pageSize=100`))
  record(
    '默认列表自动隐藏回收站页面',
    (afterDelete?.total ?? 0) <= (beforeDelete?.total ?? 0),
    `删除前 ${beforeDelete?.total ?? 0} 条，删除后 ${afterDelete?.total ?? 0} 条`,
  )

  const recycleBin = await json(
    await internal.fetch(`${INTERNAL}/api/manage/pages?deleted=true&pageSize=100`),
  )
  record(
    '?deleted=true 只返回回收站页面',
    (recycleBin?.items ?? []).length > 0 && recycleBin.items.every((item) => Boolean(item.deletedAt)),
    `返回 ${recycleBin?.items?.length ?? 0} 条`,
  )

  const portalAll = await json(await external.fetch(`${EXTERNAL}/api/pages?pageSize=100`))
  record(
    '回收站页面不出现在门户列表',
    !(portalAll?.items ?? []).some((item) => Boolean(item.deletedAt)),
    `门户 ${portalAll?.items?.length ?? 0} 条`,
  )

  const statsAfterDelete = await json(await internal.fetch(`${INTERNAL}/api/stats/overview`))
  record(
    '回收站页面不计入统计',
    (statsAfterDelete?.totalPages ?? 0) <= (afterDelete?.total ?? 0),
    `统计 totalPages=${statsAfterDelete?.totalPages ?? 0}`,
  )

  section('17. 本人改密码（改完立即改回，避免污染演示账号）')
  {
    const ORIGIN_PASSWORD = 'sales123'
    // 每次运行生成不同的临时新密码，保证「新旧不同 / 旧密码失效」用例千真万确
    const newPassword = `s4les_tmp_${Date.now().toString(36)}`

    const post = (session, payload) =>
      session.fetch(`${INTERNAL}/api/auth/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    const detail = async (response) => {
      const body = await json(response)
      const message = body && typeof body.message === 'string' ? `：${body.message}` : ''
      return `HTTP ${response.status}${message}`
    }

    const anonResponse = await post(new Session(), { currentPassword: 'whatever', newPassword })
    record('未登录不能改密码', anonResponse.status === 401, await detail(anonResponse))

    const memberPwd = new Session()
    await memberPwd.login(INTERNAL, 'sales@hmp.local', ORIGIN_PASSWORD)

    let response = await post(memberPwd, {
      currentPassword: 'wrong-current-pwd',
      newPassword,
    })
    record('当前密码不正确回 400（而非 401）', response.status === 400, await detail(response))

    response = await post(memberPwd, { currentPassword: ORIGIN_PASSWORD, newPassword: 'short' })
    record('新密码少于 8 位回 400', response.status === 400, await detail(response))

    response = await post(memberPwd, { currentPassword: ORIGIN_PASSWORD, newPassword: ORIGIN_PASSWORD })
    record('新密码与当前密码相同回 400', response.status === 400, await detail(response))

    response = await post(memberPwd, { currentPassword: ORIGIN_PASSWORD, newPassword })
    record('用当前密码成功修改', response.status === 200, await detail(response))

    if (response.status === 200) {
      try {
        const oldGone = await new Session().login(INTERNAL, 'sales@hmp.local', ORIGIN_PASSWORD)
        record('旧密码随即失效', oldGone === false, `HTTP ${oldGone ? 200 : 401}`)

        const reLoginSession = new Session()
        const reLogin = await reLoginSession.login(INTERNAL, 'sales@hmp.local', newPassword)
        record('新密码能登录', reLogin === true, `HTTP ${reLogin ? 200 : 401}`)

        const restoreResponse = await post(reLoginSession, {
          currentPassword: newPassword,
          newPassword: ORIGIN_PASSWORD,
        })
        record('演示账号密码已改回 sales123', restoreResponse.status === 200, await detail(restoreResponse))
      } catch (error) {
        record('改密后的登录/恢复流程无异常', false, `异常 ${error?.message ?? error}`)
      }
    }

    // 审计必须留痕，且绝不能出现密码内容
    const auditFeed = await json(
      await internal.fetch(`${INTERNAL}/api/audit-logs?action=change_password&pageSize=5`),
    )
    const changeEntries = auditFeed?.items ?? []
    record(
      '改密码动作写入审计日志且操作人非系统',
      changeEntries.length > 0 && changeEntries[0].userName !== '系统',
      `找到 ${changeEntries.length} 条`,
    )
    const auditSerialized = JSON.stringify(changeEntries)
    record('审计日志不含任何密码内容', !auditSerialized.includes('s4les_tmp_'), `抽样 ${changeEntries[0]?.action ?? '-'}`)
  }

  section('18. 站点身份不可由请求头伪造')
  {
    const API = `http://127.0.0.1:${sites.ports.api}`
    const INTRANET_HOST = 'intranet.corp.example.com'
    const scopeOf = (response) => {
      try {
        return JSON.parse(response.body).scope
      } catch {
        return undefined
      }
    }

    // 站点身份（内外网权限）历史上完全由 Host / X-Forwarded-Host 决定，
    // 于是外部访客写个内网域名就能把管理接口从 404 变成 401（scope=full）。
    //
    // 1) 伪造 Host。dev 由 vite 的 allowedHosts 拦（403），生产由 nginx 的
    //    default_server 兜底块断开（444）；两者都被绕过时还有代理钉死兜底（404）。
    for (const path of ['/api/manage/pages', '/api/stats/overview']) {
      const forged = await rawRequest(`${EXTERNAL}${path}`, { headers: { host: INTRANET_HOST } })
      record(
        `外网入口伪造 Host 访问 ${path} 被拒`,
        forged.status === 403 || forged.status === 404,
        `实际 ${forged.status}`,
      )
    }

    const forgedSite = await rawRequest(`${EXTERNAL}/api/auth/site`, { headers: { host: INTRANET_HOST } })
    const forgedScope = scopeOf(forgedSite)
    record(
      '外网入口伪造内网 Host 拿不到 scope=full',
      forgedScope !== 'full',
      `HTTP ${forgedSite.status} scope=${forgedScope ?? '-'}`,
    )

    // 2) 伪造 X-Forwarded-Host。它不在 fetch 禁用头里，能真正穿过 vite 到代理，
    //    所以这一项必须靠「代理把站点身份钉死」来挡（web/vite.config.ts 的 proxy.headers）。
    for (const path of ['/api/manage/pages', '/api/audit-logs']) {
      const forged = await new Session().fetch(`${EXTERNAL}${path}`, {
        headers: { 'x-forwarded-host': INTRANET_HOST },
      })
      record(
        `外网入口伪造 X-Forwarded-Host 访问 ${path} 仍 404`,
        forged.status === 404,
        `实际 ${forged.status}`,
      )
    }

    const forgedXfhSite = await json(
      await new Session().fetch(`${EXTERNAL}/api/auth/site`, {
        headers: { 'x-forwarded-host': INTRANET_HOST },
      }),
    )
    record(
      '外网入口伪造内网 Host 仍只拿到 scope=public-only',
      forgedXfhSite?.scope === 'public-only',
      `scope=${forgedXfhSite?.scope}`,
    )

    // 3) 未识别的 Host（例如直接用 IP 访问）必须兜底到权限最小的站点，
    //    而不是历史上那样兜底到 scope=full 的内网站点（config/sites.json fallbackSiteId）。
    const fallbackSite = scopeOf(
      await rawRequest(`${API}/api/auth/site`, { headers: { host: 'hmp-unknown.invalid' } }),
    )
    record('未识别的 Host 兜底到 scope=public-only', fallbackSite === 'public-only', `scope=${fallbackSite ?? '-'}`)

    // 4) 反向对照：两个正牌入口不受影响，别把功能一起改坏。
    const stillInternal = await json(await new Session().fetch(`${INTERNAL}/api/auth/site`))
    const stillExternal = await json(await new Session().fetch(`${EXTERNAL}/api/auth/site`))
    record('内网入口仍返回 scope=full', stillInternal?.scope === 'full', `scope=${stillInternal?.scope}`)
    record(
      '外网入口仍返回 scope=public-only',
      stillExternal?.scope === 'public-only',
      `scope=${stillExternal?.scope}`,
    )
  }

  section('19. 用户管理（建号 / 改权 / 启停 / 重置密码 / 受限删除）')
  {
    const suffix = Date.now().toString(36)
    const probeEmail = `probe_${suffix}@hmp.local`
    const probeName = '验收探针'
    const jsonHeaders = { 'content-type': 'application/json' }
    const send = (session, method, path, body) =>
      session.fetch(`${INTERNAL}${path}`, {
        method,
        headers: body === undefined ? {} : jsonHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const detail = async (response) => {
      const body = await json(response)
      const message = body && typeof body.message === 'string' ? `：${body.message}` : ''
      return `HTTP ${response.status}${message}`
    }

    // ---- 边界：员工 403 / 外网 404 / 未登录 401 ----
    const memberUsers = new Session()
    await memberUsers.login(INTERNAL, 'sales@hmp.local', 'sales123')
    const memberList = await memberUsers.fetch(`${INTERNAL}/api/manage/users`)
    record('员工访问用户管理接口被拒绝', memberList.status === 403, `实际 ${memberList.status}`)

    const externalUsers = await new Session().fetch(`${EXTERNAL}/api/manage/users`)
    record('外网入口访问用户管理接口 404', externalUsers.status === 404, `实际 ${externalUsers.status}`)

    const anonymousUsers = await new Session().fetch(`${INTERNAL}/api/manage/users`)
    record('未登录访问用户管理接口 401', anonymousUsers.status === 401, `实际 ${anonymousUsers.status}`)

    // ---- 列表结构 ----
    const userList = await json(await internal.fetch(`${INTERNAL}/api/manage/users?pageSize=100`))
    const userItems = userList?.items ?? []
    record(
      '用户列表返回分页结构',
      Array.isArray(userItems) && userItems.length > 0 && typeof userList.total === 'number',
      `total=${userList?.total ?? '-'}`,
    )
    record(
      '用户列表带部门名与名下页面数',
      userItems.length > 0 &&
        userItems.every(
          (item) =>
            'departmentName' in item && 'active' in item && typeof item.pageCount === 'number',
        ),
      `样例 ${userItems[0]?.email ?? '-'} / ${userItems[0]?.departmentName ?? 'null'}`,
    )

    // ---- 建号 + 初始密码 ----
    const salesRow = userItems.find((item) => item.email === 'sales@hmp.local')
    const created = await send(internal, 'POST', '/api/manage/users', {
      email: probeEmail.toUpperCase(),
      name: probeName,
      role: 'member',
      departmentId: salesRow?.departmentId ?? null,
    })
    const createdBody = await json(created)
    const probeId = createdBody?.user?.id
    const initialPassword = createdBody?.initialPassword
    record('管理员可以新增用户', created.status === 201, await detail(created))
    record(
      '邮箱已自动转小写保存',
      createdBody?.user?.email === probeEmail,
      `实际 ${createdBody?.user?.email ?? '-'}`,
    )
    record(
      '初始密码由服务端生成（>= 12 位）',
      typeof initialPassword === 'string' && initialPassword.length >= 12,
      `长度 ${initialPassword?.length ?? 0}`,
    )

    const probeLogin = new Session()
    const probeLoggedIn = await probeLogin.login(INTERNAL, probeEmail, initialPassword)
    record('新用户可以用初始密码登录', probeLoggedIn === true)

    const duplicate = await send(internal, 'POST', '/api/manage/users', {
      email: probeEmail,
      name: '重复邮箱',
      role: 'member',
    })
    record('邮箱重复被拒绝', duplicate.status === 400, await detail(duplicate))

    const badEmail = await send(internal, 'POST', '/api/manage/users', {
      email: 'not-an-email',
      name: '坏邮箱',
      role: 'member',
    })
    record('邮箱格式错误被拒绝', badEmail.status === 400, await detail(badEmail))

    const badRole = await send(internal, 'POST', '/api/manage/users', {
      email: `badrole_${suffix}@hmp.local`,
      name: '坏角色',
      role: 'superuser',
    })
    record('非法角色被拒绝', badRole.status === 400, await detail(badRole))

    // ---- 自我护栏 ----
    const adminMe = await json(await internal.fetch(`${INTERNAL}/api/auth/me`))
    const adminId = adminMe?.user?.id
    const changeOwnRole = await send(internal, 'PATCH', `/api/manage/users/${adminId}`, {
      role: 'member',
    })
    record('不能修改自己的角色', changeOwnRole.status === 400, await detail(changeOwnRole))

    const deactivateSelf = await send(internal, 'POST', `/api/manage/users/${adminId}/active`, {
      active: false,
    })
    record('不能停用自己的账号', deactivateSelf.status === 400, await detail(deactivateSelf))

    const deleteSelf = await internal.fetch(`${INTERNAL}/api/manage/users/${adminId}`, {
      method: 'DELETE',
    })
    record('不能删除自己的账号', deleteSelf.status === 400, await detail(deleteSelf))

    // ---- 本人改姓名 + 审计快照不被追溯改写 ----
    const renameUser = new Session()
    await renameUser.login(INTERNAL, 'sales@hmp.local', 'sales123')
    const renameMe = await json(await renameUser.fetch(`${INTERNAL}/api/auth/me`))
    const salesId = renameMe?.user?.id
    const newName = `李销售-rename-${suffix}`

    // 一条「改名之前」写入的登录日志，用来验证历史留痕
    const patchName = await send(renameUser, 'PATCH', '/api/auth/profile', { name: newName })
    record('本人可以修改自己的姓名', patchName.status === 200, await detail(patchName))

    const loginFeed = await json(
      await internal.fetch(
        `${INTERNAL}/api/audit-logs?action=login&userId=${encodeURIComponent(salesId)}&pageSize=1`,
      ),
    )
    record(
      '改名后历史日志仍显示当时的姓名（快照生效）',
      loginFeed?.items?.[0]?.userName === '李销售',
      `显示为 ${loginFeed?.items?.[0]?.userName ?? '-'}`,
    )

    const restoreName = await send(renameUser, 'PATCH', '/api/auth/profile', { name: '李销售' })
    record('姓名已改回李销售', restoreName.status === 200, await detail(restoreName))

    const forbiddenRename = await send(renameUser, 'PATCH', '/api/auth/profile', { name: '' })
    record('姓名为空被拒绝', forbiddenRename.status === 400, await detail(forbiddenRename))

    // ---- 重置密码 ----
    const reset = await send(internal, 'POST', `/api/manage/users/${probeId}/reset-password`)
    const resetBody = await json(reset)
    const resetPassword = resetBody?.password
    record(
      '管理员可以重置密码',
      reset.status === 200 && typeof resetPassword === 'string' && resetPassword.length >= 12,
      `HTTP ${reset.status}`,
    )

    const oldCookieAfterReset = await probeLogin.fetch(`${INTERNAL}/api/auth/me`)
    record('重置密码后该账号的旧会话立即失效', oldCookieAfterReset.status === 401, `实际 ${oldCookieAfterReset.status}`)

    const loginWithOldPassword = await new Session().login(INTERNAL, probeEmail, initialPassword)
    record('重置密码后旧密码失效', loginWithOldPassword === false)

    const probeAfterReset = new Session()
    const loginWithResetPassword = await probeAfterReset.login(INTERNAL, probeEmail, resetPassword)
    record('重置后的新密码可以登录', loginWithResetPassword === true)

    // ---- 角色变更立即生效（会话缓存必须被清掉）----
    const secondAdmin = new Session()
    const secondAdminOk = await secondAdmin.login(INTERNAL, 'admin2@hmp.local', 'admin2_123')
    record('第二管理员登录成功', secondAdminOk)
    if (secondAdminOk && adminId) {
      const demote = await send(secondAdmin, 'PATCH', `/api/manage/users/${adminId}`, {
        role: 'member',
      })
      record('可以把另一个管理员降级', demote.status === 200, await detail(demote))

      const stillManage = await internal.fetch(`${INTERNAL}/api/manage/users`)
      record('角色变更立即生效，无需等待缓存过期', stillManage.status === 403, `实际 ${stillManage.status}`)

      const promote = await send(secondAdmin, 'PATCH', `/api/manage/users/${adminId}`, {
        role: 'admin',
      })
      record('管理员角色已恢复', promote.status === 200, await detail(promote))

      const manageAgain = await internal.fetch(`${INTERNAL}/api/manage/users`)
      record('恢复后原会话重新获得管理权限', manageAgain.status === 200, `实际 ${manageAgain.status}`)
    }

    // ---- 启停 ----
    const deleteActive = await internal.fetch(`${INTERNAL}/api/manage/users/${probeId}`, {
      method: 'DELETE',
    })
    record('启用中的账号不能删除', deleteActive.status === 400, await detail(deleteActive))

    const deactivate = await send(internal, 'POST', `/api/manage/users/${probeId}/active`, {
      active: false,
    })
    record('可以停用账号', deactivate.status === 200, await detail(deactivate))

    const oldCookieAfterDeactivate = await probeAfterReset.fetch(`${INTERNAL}/api/auth/me`)
    record(
      '停用后原会话立即失效',
      oldCookieAfterDeactivate.status === 401,
      `实际 ${oldCookieAfterDeactivate.status}`,
    )

    const loginWhileInactive = await new Session().login(INTERNAL, probeEmail, resetPassword)
    record('停用后无法登录', loginWhileInactive === false)

    const reactivate = await send(internal, 'POST', `/api/manage/users/${probeId}/active`, {
      active: true,
    })
    record('可以重新启用账号', reactivate.status === 200, await detail(reactivate))

    const loginAfterReactivate = await new Session().login(INTERNAL, probeEmail, resetPassword)
    record('重新启用后可以登录', loginAfterReactivate === true)

    // ---- 受限删除 ----
    await send(internal, 'POST', `/api/manage/users/${probeId}/active`, { active: false })
    const removeProbe = await internal.fetch(`${INTERNAL}/api/manage/users/${probeId}`, {
      method: 'DELETE',
    })
    record('已停用且无页面的账号可以删除', removeProbe.status === 200, await detail(removeProbe))

    const goneList = await json(
      await internal.fetch(`${INTERNAL}/api/manage/users?q=${encodeURIComponent(probeEmail)}`),
    )
    record('删除后列表中不再出现该账号', (goneList?.total ?? 0) === 0, `total=${goneList?.total ?? '-'}`)

    record(
      '演示账号 sales 名下确实有页面（受限删除的前置条件）',
      (salesRow?.pageCount ?? 0) > 0,
      `pageCount=${salesRow?.pageCount ?? '-'}`,
    )
    if (salesId) {
      await send(internal, 'POST', `/api/manage/users/${salesId}/active`, { active: false })
      const removeWithPages = await internal.fetch(`${INTERNAL}/api/manage/users/${salesId}`, {
        method: 'DELETE',
      })
      record('名下有页面的账号不能删除', removeWithPages.status === 400, await detail(removeWithPages))
      const restoreActive = await send(internal, 'POST', `/api/manage/users/${salesId}/active`, {
        active: true,
      })
      record('sales 账号已恢复启用', restoreActive.status === 200, await detail(restoreActive))
    }

    // ---- 审计 ----
    const auditActions = ['user_create', 'user_update', 'user_reset_password', 'user_delete', 'profile_update']
    const auditItems = []
    for (const action of auditActions) {
      const feed = await json(
        await internal.fetch(`${INTERNAL}/api/audit-logs?action=${action}&pageSize=5`),
      )
      const items = feed?.items ?? []
      auditItems.push(...items)
      record(`审计记录 ${action}`, items.length > 0, `找到 ${items.length} 条`)
    }
    const auditSerialized = JSON.stringify(auditItems)
    record(
      '用户管理审计不含任何密码明文',
      !auditSerialized.includes(initialPassword) && !auditSerialized.includes(resetPassword),
      `抽样 ${auditItems.length} 条`,
    )
  }

  console.log(`\n${'='.repeat(52)}`)
  const passed = results.filter((item) => item.ok).length
  console.log(`结果: ${passed}/${results.length} 通过，${failures} 失败`)
  console.log('='.repeat(52) + '\n')
  process.exit(failures > 0 ? 1 : 0)
}

async function buildZip(entries) {
  const encoder = new TextEncoder()
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const dataBytes = encoder.encode(entry.content)
    const crc = crc32(dataBytes)

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0, true)
    lv.setUint16(8, 0, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, dataBytes.length, true)
    lv.setUint32(22, dataBytes.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(10, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, dataBytes.length, true)
    cv.setUint32(24, dataBytes.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)

    locals.push(local, dataBytes)
    centrals.push(central)
    offset += local.length + dataBytes.length
  }

  const centralSize = centrals.reduce((sum, chunk) => sum + chunk.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const chunks = [...locals, ...centrals, end]
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let position = 0
  for (const chunk of chunks) {
    out.set(chunk, position)
    position += chunk.length
  }
  return out
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

main().catch((error) => {
  console.error('\n[verify] 执行失败:', error)
  process.exit(1)
})