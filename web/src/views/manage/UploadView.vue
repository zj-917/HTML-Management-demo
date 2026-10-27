<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api'
import { useSiteStore } from '@/stores/site'
import { Visibility, VISIBILITY_LABEL, type Visibility as VisibilityValue } from '@shared/types'

const router = useRouter()
const site = useSiteStore()

const submitting = ref(false)
const departments = ref<{ id: string; name: string }[]>([])
const file = ref<File | null>(null)
const fileKind = ref<'none' | 'single' | 'zip'>('none')
// 单文件 HTML 里引用的本地资源（相对路径）。这些文件不会随 HTML 一起上传，
// 提交前必须明确提示，否则用户只会在页面打开后看到一片 404。
const localRefs = ref<string[]>([])
const MAX_SCAN_BYTES = 20 * 1024 * 1024

const form = ref({
  title: '',
  summary: '',
  categoryId: '',
  visibility: '' as VisibilityValue | '',
  departmentIds: [] as string[],
  tags: [] as string[],
  changelog: '',
})

const visibilityOptions = computed(() =>
  (Object.keys(VISIBILITY_LABEL) as VisibilityValue[]).map((value) => ({
    value,
    label: VISIBILITY_LABEL[value],
  })),
)

const needDepartments = computed(() => form.value.visibility === Visibility.Dept)

const accept = computed(() => (fileKind.value === 'zip' ? '.zip' : '.html,.htm'))

/**
 * 收集 HTML 中指向本地文件的相对引用。
 * 只关心会导致「页面打开后资源 404」的那几类：src / poster / srcset /
 * <link href> / CSS url()。带 scheme（http:、data:、blob:、mailto:…）、
 * 协议相对（//）、纯锚点/查询、根路径（/…）都不算。
 */
function collectLocalRefs(html: string): string[] {
  const refs = new Set<string>()
  const push = (raw?: string): void => {
    const value = raw?.trim()
    if (!value) return
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(value)) return
    if (value.startsWith('/')) return
    const clean = value.split('#')[0].split('?')[0]
    if (clean) refs.add(clean)
  }

  for (const match of html.matchAll(/<[^>]+\s(?:src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    push(match[1] ?? match[2] ?? match[3])
  }
  for (const match of html.matchAll(/<link\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    push(match[1] ?? match[2] ?? match[3])
  }
  for (const match of html.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi)) {
    push(match[1] ?? match[2] ?? match[3])
  }
  for (const match of html.matchAll(/\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const part of (match[1] ?? match[2] ?? '').split(',')) push(part.trim().split(/\s+/)[0])
  }

  return [...refs]
}

async function pickFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0] ?? null
  if (!picked) return

  if (picked.size > 100 * 1024 * 1024) {
    ElMessage.error('文件不能超过 100 MB')
    input.value = ''
    return
  }

  file.value = picked
  fileKind.value = picked.name.toLowerCase().endsWith('.zip') ? 'zip' : 'single'
  localRefs.value = []

  if (fileKind.value === 'single') {
    const base = picked.name.replace(/\.html?$/i, '')
    if (!form.value.title) form.value.title = base

    if (picked.size <= MAX_SCAN_BYTES) {
      const text = await picked.text().catch(() => '')
      localRefs.value = text ? collectLocalRefs(text) : []
    }
  }
}

function clearFile(): void {
  file.value = null
  fileKind.value = 'none'
  localRefs.value = []
}

async function loadDepartments(): Promise<void> {
  departments.value = await api.departmentOptions().catch(() => [])
}

function validate(): string | null {
  if (!file.value) return '请选择要上传的 HTML 文件或 ZIP 压缩包'
  if (!form.value.title.trim()) return '请填写页面标题'
  if (!form.value.visibility) return '请选择可见性，该项没有默认值，必须显式选择'
  if (needDepartments.value && form.value.departmentIds.length === 0) {
    return '选择「指定部门可见」时必须至少勾选一个部门'
  }
  return null
}

async function submit(): Promise<void> {
  const problem = validate()
  if (problem) {
    ElMessage.warning(problem)
    return
  }
  if (!file.value) return

  // 单文件上传只保存 HTML 本身。若它引用了本地资源，先让用户确认，
  // 避免上传后才发现图片/样式全部 404。
  if (fileKind.value === 'single' && localRefs.value.length > 0) {
    const preview = localRefs.value.slice(0, 5).join('、')
    const more = localRefs.value.length > 5 ? ` 等 ${localRefs.value.length} 个` : ''
    try {
      await ElMessageBox.confirm(
        `这个 HTML 引用了本地文件：${preview}${more}。单文件上传只会保存 HTML 本身，` +
          '这些文件不会被上传，打开页面时它们会 404（图片/样式不显示）。' +
          '建议把 HTML 和资源文件夹一起压缩成 ZIP 再上传。',
        '检测到未上传的本地资源',
        { type: 'warning', confirmButtonText: '仍然上传', cancelButtonText: '取消，改用 ZIP' },
      )
    } catch {
      return
    }
  }

  submitting.value = true
  try {
    const payload = new FormData()
    payload.append('file', file.value)
    payload.append('title', form.value.title.trim())
    payload.append('summary', form.value.summary.trim())
    payload.append('visibility', form.value.visibility)
    if (form.value.categoryId) payload.append('categoryId', form.value.categoryId)
    if (form.value.changelog.trim()) payload.append('changelog', form.value.changelog.trim())
    if (form.value.tags.length) payload.append('tags', JSON.stringify(form.value.tags))
    if (needDepartments.value) payload.append('departmentIds', JSON.stringify(form.value.departmentIds))

    const created = await api.createPage(payload)
    ElMessage.success('上传成功，页面当前为草稿状态，提交审核后才会对外可见')
    await router.push({ name: 'manage-detail', params: { id: created.id } })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '上传失败')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await site.load().catch(() => undefined)
  await loadDepartments()
})
</script>

<template>
  <div class="upload">
    <header class="upload__head">
      <h2 class="hmp-page-title">上传 HTML 页面</h2>
      <p class="upload__hint">
        支持单文件 HTML（CSS/JS/图片必须内联，不能引用本地文件）或 ZIP 压缩包（根目录或唯一的顶层文件夹内需有 index.html）。压缩包会经过安全校验。
      </p>
    </header>

    <el-card shadow="never">
      <el-form label-position="top" class="upload__form">
        <el-form-item label="页面文件" required>
          <div class="upload__file">
            <input
              class="upload__file-input"
              type="file"
              :accept="accept"
              @change="pickFile"
            />
            <div v-if="file" class="upload__file-picked">
              <el-icon class="upload__file-icon"><CircleCheckFilled /></el-icon>
              <span class="upload__file-name">{{ file.name }}</span>
              <span class="upload__file-size">{{ (file.size / 1024).toFixed(1) }} KB</span>
              <el-button link type="danger" @click="clearFile">移除</el-button>
            </div>
            <div v-else class="upload__file-hint">
              点击选择{{ fileKind === 'zip' ? 'ZIP 压缩包' : 'HTML 文件' }}，或直接拖拽到此处
            </div>
          </div>
          <el-alert
            v-if="fileKind === 'single' && localRefs.length > 0"
            type="warning"
            :closable="false"
            show-icon
            class="upload__alert"
            :title="`这个 HTML 引用了 ${localRefs.length} 个本地文件，单文件上传不会包含它们`"
            :description="`${localRefs.slice(0, 3).join('、')}${localRefs.length > 3 ? ' 等' : ''}——打开页面时这些资源会 404。请把 HTML 和资源文件夹一起压缩成 ZIP 再上传。`"
          />
        </el-form-item>

        <div class="upload__grid">
          <el-form-item label="页面标题" required>
            <el-input v-model="form.title" maxlength="120" show-word-limit placeholder="例如：2026 年 Q1 销售战报" />
          </el-form-item>

          <el-form-item label="业务分类">
            <el-select v-model="form.categoryId" placeholder="选择分类（可稍后修改）" clearable>
              <el-option v-for="item in site.categories" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
          </el-form-item>
        </div>

        <el-form-item label="页面描述">
          <el-input
            v-model="form.summary"
            type="textarea"
            :rows="2"
            maxlength="500"
            show-word-limit
            placeholder="一句话说明这个页面是做什么的，方便其他人搜索到"
          />
        </el-form-item>

        <el-form-item label="可见性" required>
          <el-radio-group v-model="form.visibility" class="upload__visibility">
            <el-radio v-for="option in visibilityOptions" :key="option.value" :value="option.value" border>
              {{ option.label }}
            </el-radio>
          </el-radio-group>
          <div class="upload__visibility-tip">
            <template v-if="form.visibility === 'public'">
              外网访客可以访问。审核通过后页面会出现在公网门户。
            </template>
            <template v-else-if="form.visibility === 'internal'">
              仅内网登录用户可见，外网即使拿到链接也会 404。
            </template>
            <template v-else-if="form.visibility === 'dept'">
              仅所选部门的登录用户可见，需要在下方勾选部门。
            </template>
            <template v-else>该项没有默认值，必须显式选择，避免误设为公开。</template>
          </div>
        </el-form-item>

        <el-form-item v-if="needDepartments" label="可见部门" required>
          <el-checkbox-group v-model="form.departmentIds" class="upload__departments">
            <el-checkbox v-for="item in departments" :key="item.id" :value="item.id" border>
              {{ item.name }}
            </el-checkbox>
          </el-checkbox-group>
          <el-alert
            v-if="departments.length === 0"
            type="warning"
            :closable="false"
            show-icon
            title="还没有维护部门，请先到「基础配置」添加部门"
            class="upload__alert"
          />
        </el-form-item>

        <el-form-item label="标签">
          <el-select
            v-model="form.tags"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="回车创建新标签，或从已有标签中选择"
          >
            <el-option v-for="tag in site.tags" :key="tag.id" :label="tag.name" :value="tag.name" />
          </el-select>
        </el-form-item>

        <el-form-item label="版本说明">
          <el-input v-model="form.changelog" maxlength="300" placeholder="例如：首次上传" />
        </el-form-item>

        <div class="upload__actions">
          <el-button @click="router.push({ name: 'manage-pages' })">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="submit">上传并保存为草稿</el-button>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.upload__head {
  margin-bottom: 14px;
}


.upload__hint {
  margin: 6px 0 0;
  color: var(--hmp-muted);
  font-size: 13px;
}

.upload__form {
  max-width: 820px;
}

.upload__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}

.upload__file {
  position: relative;
  border: 1px dashed var(--hmp-border);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  background: var(--hmp-surface-raised);
  width: 100%;
}

.upload__file-icon {
  color: var(--hmp-success);
}

.upload__file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.upload__file-hint {
  color: var(--hmp-muted);
  font-size: 13px;
}

.upload__file-picked {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 14px;
}

.upload__file-name {
  font-weight: 600;
}

.upload__file-size {
  color: var(--hmp-muted);
  font-size: 12px;
}

.upload__visibility {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.upload__visibility-tip {
  margin-top: 8px;
  font-size: 12px;
  color: var(--hmp-muted);
  line-height: 1.6;
}

.upload__departments {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.upload__alert {
  margin-top: 10px;
}

.upload__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 768px) {
  .upload__grid {
    grid-template-columns: 1fr;
  }
}
</style>