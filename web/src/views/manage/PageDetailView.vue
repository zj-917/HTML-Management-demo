<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { api, contentUrl } from '@/api'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'
import VisibilityTag from '@/components/VisibilityTag.vue'
import {
  STATUS_LABEL,
  VISIBILITY_LABEL,
  Visibility,
  type PageStatus,
  type PageVersionItem,
  type Visibility as VisibilityValue,
} from '@shared/types'

const route = useRoute()
const router = useRouter()
const site = useSiteStore()
const auth = useAuthStore()

const loading = ref(false)
const busy = ref(false)
const pageId = computed(() => String(route.params.id ?? ''))
const detail = ref<Awaited<ReturnType<typeof api.managePage>> | null>(null)
const departments = ref<{ id: string; name: string }[]>([])
const rejectDialog = ref(false)
const rejectComment = ref('')
const requestDialog = ref(false)
const requestReason = ref('')
const newVersionFile = ref<File | null>(null)
const newVersionChangelog = ref('')

const editable = ref(false)
const editForm = ref({
  title: '',
  summary: '',
  categoryId: '',
  visibility: '' as VisibilityValue,
  departmentIds: [] as string[],
  tags: [] as string[],
})

const versions = computed<PageVersionItem[]>(() => detail.value?.versions ?? [])
const canReview = computed(() => auth.isAdmin && detail.value?.status === 'pending')
const isAdmin = computed(() => auth.isAdmin)
const canDelete = computed(() =>
  ['draft', 'rejected'].includes(detail.value?.status ?? ''),
)
const needDepartments = computed(() => editForm.value.visibility === Visibility.Dept)

async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await api.managePage(pageId.value)
    detail.value = result
    editForm.value = {
      title: result.title,
      summary: result.summary ?? '',
      categoryId: result.categoryId ?? '',
      visibility: result.visibility,
      departmentIds: [...result.allowedDepartmentIds],
      tags: [...(result.tags ?? [])],
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function startEdit(): void {
  editable.value = true
}

function cancelEdit(): void {
  editable.value = false
  void load()
}

async function saveMeta(): Promise<void> {
  if (needDepartments.value && editForm.value.departmentIds.length === 0) {
    ElMessage.warning('选择「指定部门可见」时必须至少勾选一个部门')
    return
  }
  busy.value = true
  try {
    await api.updatePage(pageId.value, {
      title: editForm.value.title.trim(),
      summary: editForm.value.summary.trim(),
      categoryId: editForm.value.categoryId || undefined,
      visibility: editForm.value.visibility,
      departmentIds: JSON.stringify(needDepartments.value ? editForm.value.departmentIds : []),
      tags: JSON.stringify(editForm.value.tags),
    })
    ElMessage.success('已保存')
    editable.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    busy.value = false
  }
}

async function submitReview(): Promise<void> {
  busy.value = true
  try {
    await api.submitPage(pageId.value)
    ElMessage.success('已提交审核')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function approve(): Promise<void> {
  busy.value = true
  try {
    await api.reviewPage(pageId.value, 'approve')
    ElMessage.success('审核通过，页面已发布')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function reject(): Promise<void> {
  if (!rejectComment.value.trim()) {
    ElMessage.warning('请填写驳回意见')
    return
  }
  busy.value = true
  try {
    await api.reviewPage(pageId.value, 'reject', rejectComment.value.trim())
    ElMessage.success('已驳回')
    rejectDialog.value = false
    rejectComment.value = ''
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function unpublish(): Promise<void> {
  await ElMessageBox.confirm('下线后页面立即从门户移除，需要重新提交审核才能再次发布。', '确认下线', {
    type: 'warning',
  })
  busy.value = true
  try {
    await api.unpublishPage(pageId.value)
    ElMessage.success('已下线')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

function pickVersionFile(event: Event): void {
  const input = event.target as HTMLInputElement
  newVersionFile.value = input.files?.[0] ?? null
}

async function uploadVersion(): Promise<void> {
  if (!newVersionFile.value) {
    ElMessage.warning('请选择新版本文件')
    return
  }
  busy.value = true
  try {
    const payload = new FormData()
    payload.append('file', newVersionFile.value)
    payload.append('changelog', newVersionChangelog.value.trim())
    await api.addVersion(pageId.value, payload)
    ElMessage.success('新版本已上传，页面回到草稿状态，请重新提交审核')
    newVersionFile.value = null
    newVersionChangelog.value = ''
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '上传失败')
  } finally {
    busy.value = false
  }
}

async function rollback(version: PageVersionItem): Promise<void> {
  await ElMessageBox.confirm(
    `确认把线上内容回滚到 v${version.versionNo} 吗？`,
    '版本回滚',
    { type: 'warning', confirmButtonText: '确认回滚' },
  )
  busy.value = true
  try {
    await api.rollbackPage(pageId.value, version.id)
    ElMessage.success('已回滚')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function copyLink(): Promise<void> {
  if (!detail.value) return
  const url = `${window.location.origin}${contentUrl(detail.value.slug)}`
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success('链接已复制')
  } catch {
    ElMessage.warning('复制失败，请手动复制地址')
  }
}

function openPage(): void {
  if (!detail.value) return
  window.open(contentUrl(detail.value.slug), '_blank', 'noopener')
}

function openRequestDialog(): void {
  requestReason.value = ''
  requestDialog.value = true
}

async function submitRequest(): Promise<void> {
  if (!detail.value) return
  if (requestReason.value.trim().length < 5) {
    ElMessage.warning('请填写至少 5 个字的下线原因，便于管理员判断')
    return
  }
  busy.value = true
  try {
    await api.requestUnpublish(detail.value.id, requestReason.value.trim())
    ElMessage.success('下线申请已提交，页面在管理员批准前仍会保持在线')
    requestDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '提交失败')
  } finally {
    busy.value = false
  }
}

async function withdrawRequest(): Promise<void> {
  if (!detail.value) return
  await ElMessageBox.confirm('撤回后下线申请将作废，页面继续保持在线。确认撤回？', '撤回下线申请', {
    type: 'warning',
  })
  busy.value = true
  try {
    await api.withdrawUnpublish(detail.value.id)
    ElMessage.success('已撤回下线申请')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function removePage(): Promise<void> {
  if (!detail.value) return
  await ElMessageBox.confirm(
    `确认删除「${detail.value.title}」吗？删除后页面将从列表中移除，可在回收站恢复，30 天后自动彻底删除。`,
    '删除确认',
    { type: 'warning', confirmButtonText: '移到回收站', cancelButtonText: '取消' },
  )
  busy.value = true
  try {
    await api.deletePage(detail.value.id)
    ElMessage.success('已移到回收站')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function restorePage(): Promise<void> {
  if (!detail.value) return
  busy.value = true
  try {
    await api.restorePage(detail.value.id)
    ElMessage.success('已从回收站恢复')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '恢复失败')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await site.load().catch(() => undefined)
  departments.value = await api.departmentOptions().catch(() => [])
  await load()
})
</script>

<template>
  <div v-loading="loading" class="detail">
    <header class="detail__head">
      <el-button text @click="router.back()">
        <el-icon><ArrowLeft /></el-icon>
        返回
      </el-button>
      <div class="detail__head-main">
        <h2 class="detail__title">{{ detail?.title ?? '页面详情' }}</h2>
        <div class="detail__tags">
          <VisibilityTag v-if="detail" :visibility="detail.visibility" />
          <el-tag v-if="detail" size="small" effect="plain">
            {{ STATUS_LABEL[detail.status as PageStatus] }}
          </el-tag>
          <el-tag v-if="detail?.unpublishRequestedAt" size="small" type="warning" effect="dark">
            下线申请中
          </el-tag>
          <el-tag size="small" effect="plain" type="info">/{{ detail?.slug }}</el-tag>
        </div>
      </div>
      <div class="detail__actions">
        <el-button
          v-if="detail?.status === 'published'"
          size="small"
          type="success"
          @click="openPage"
        >
          打开页面
        </el-button>
        <el-button v-if="detail?.status === 'published'" size="small" @click="copyLink">
          复制链接
        </el-button>
        <el-button           v-if="!detail?.deletedAt && isAdmin && !editable" size="small" @click="startEdit">编辑信息</el-button>
        <el-button
          v-if="!detail?.deletedAt && detail && ['draft', 'rejected'].includes(detail.status)"
          type="primary"
          size="small"
          :loading="busy"
          @click="submitReview"
        >
          提交审核
        </el-button>
        <el-button v-if="canReview" type="success" size="small" :loading="busy" @click="approve">
          通过并发布
        </el-button>
        <el-button v-if="canReview" type="danger" size="small" @click="rejectDialog = true">
          驳回
        </el-button>
        <el-button
          v-if="!detail?.deletedAt && isAdmin && detail?.status === 'published'"
          size="small"
          :loading="busy"
          @click="unpublish"
        >
          下线
        </el-button>
        <el-button
          v-if="!detail?.deletedAt && detail?.status === 'published' && !detail?.unpublishRequestedAt"
          type="danger"
          size="small"
          @click="openRequestDialog"
        >
          申请下线
        </el-button>
        <el-button
          v-else-if="detail?.unpublishRequestedAt"
          size="small"
          :loading="busy"
          @click="withdrawRequest"
        >
          撤回下线申请
        </el-button>
        <el-button
          v-if="!detail?.deletedAt && canDelete"
          type="danger"
          size="small"
          plain
          @click="removePage"
        >
          删除
        </el-button>
        <el-button
          v-if="detail?.deletedAt"
          type="success"
          size="small"
          :loading="busy"
          @click="restorePage"
        >
          从回收站恢复
        </el-button>
        <el-tag v-if="!isAdmin" class="detail__readonly" type="info" size="small" effect="plain">
          只读视图：修改可见性与下线需联系管理员
        </el-tag>
      </div>
    </header>

    <el-alert
      v-if="detail?.deletedAt"
      type="info"
      show-icon
      :closable="false"
      class="detail__alert"
      title="该页面在回收站中"
      :description="`已于 ${dayjs(detail.deletedAt).format('YYYY-MM-DD HH:mm')} 删除（操作人：${detail.deletedByName ?? '-'}），当前不对任何人可见，30 天后自动彻底删除。`"
    />

    <el-alert
      v-if="detail?.unpublishRequestedAt"
      type="warning"
      show-icon
      :closable="false"
      class="detail__alert"
      title="该页面有一条进行中的下线申请"
      :description="`申请原因：${detail.unpublishReason ?? '-'}${isAdmin ? '（可在上方批准或驳回）' : '（等待管理员处理，页面在此期间仍保持在线）'}`"
    />

    <el-alert
      v-else-if="detail?.unpublishDecisionNote"
      type="error"
      show-icon
      :closable="false"
      class="detail__alert"
      title="下线申请已被驳回"
      :description="detail.unpublishDecisionNote"
    />

    <el-alert
      v-if="detail?.rejectionComment"
      type="error"
      show-icon
      :closable="false"
      class="detail__alert"
      title="审核未通过"
      :description="detail.rejectionComment"
    />

    <div class="detail__grid">
      <el-card shadow="never">
        <template #header><span class="card-title">基本信息</span></template>

        <el-form v-if="editable" label-position="top">
          <el-form-item label="页面标题" required>
            <el-input v-model="editForm.title" maxlength="120" />
          </el-form-item>
          <el-form-item label="页面描述">
            <el-input v-model="editForm.summary" type="textarea" :rows="3" maxlength="500" />
          </el-form-item>
          <el-form-item label="业务分类">
            <el-select v-model="editForm.categoryId" clearable placeholder="未分类">
              <el-option v-for="item in site.categories" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="可见性" required>
            <el-select v-model="editForm.visibility">
              <el-option
                v-for="(label, value) in VISIBILITY_LABEL"
                :key="value"
                :label="label"
                :value="value"
              />
            </el-select>
            <div class="field-tip">修改已发布页面的可见性会立即下线并回到待审核，防止绕过审核直接外发。</div>
          </el-form-item>
          <el-form-item v-if="needDepartments" label="可见部门" required>
            <el-checkbox-group v-model="editForm.departmentIds">
              <el-checkbox v-for="item in departments" :key="item.id" :value="item.id" border>
                {{ item.name }}
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="标签">
            <el-select v-model="editForm.tags" multiple filterable allow-create default-first-option>
              <el-option v-for="tag in site.tags" :key="tag.id" :label="tag.name" :value="tag.name" />
            </el-select>
          </el-form-item>
          <div class="detail__form-actions">
            <el-button @click="cancelEdit">取消</el-button>
            <el-button type="primary" :loading="busy" @click="saveMeta">保存</el-button>
          </div>
        </el-form>

        <el-descriptions v-else :column="2" border>
          <el-descriptions-item label="标题">{{ detail?.title }}</el-descriptions-item>
          <el-descriptions-item label="Slug">{{ detail?.slug }}</el-descriptions-item>
          <el-descriptions-item label="描述" :span="2">{{ detail?.summary ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="可见性">
            {{ detail ? VISIBILITY_LABEL[detail.visibility] : '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="分类">{{ detail?.categoryName ?? '未分类' }}</el-descriptions-item>
          <el-descriptions-item label="创建人">{{ detail?.ownerName ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="归属部门">{{ detail?.departmentName ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="可见部门" :span="2">
            <template v-if="detail?.visibility === 'dept'">
              {{ detail.allowedDepartmentNames.join('、') || '未配置' }}
            </template>
            <template v-else>-</template>
          </el-descriptions-item>
          <el-descriptions-item label="标签" :span="2">
            <el-tag v-for="tag in detail?.tags ?? []" :key="tag" size="small" effect="plain" class="tag-chip">
              #{{ tag }}
            </el-tag>
            <span v-if="!(detail?.tags ?? []).length">-</span>
          </el-descriptions-item>
          <el-descriptions-item label="包类型">
            {{ detail?.packageType === 'bundle' ? 'ZIP 资源包' : '单文件 HTML' }}
          </el-descriptions-item>
          <el-descriptions-item label="入口文件">{{ detail?.entryFile }}</el-descriptions-item>
          <el-descriptions-item label="发布时间">
            {{ detail?.publishedAt ? dayjs(detail.publishedAt).format('YYYY-MM-DD HH:mm') : '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="更新时间">
            {{ detail ? dayjs(detail.updatedAt).format('YYYY-MM-DD HH:mm') : '-' }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never">
        <template #header><span class="card-title">版本历史</span></template>

        <el-upload
          v-if="detail && !detail.deletedAt"
          :auto-upload="false"
          :show-file-list="false"
          :limit="1"
          accept=".html,.htm,.zip"
          class="version-upload"
          @change="pickVersionFile"
        >
          <el-button size="small" plain>选择新版本文件</el-button>
        </el-upload>

        <div v-if="newVersionFile" class="version-upload__row">
          <el-input v-model="newVersionChangelog" size="small" placeholder="版本说明，例如：修正数据口径" />
          <el-button size="small" type="primary" :loading="busy" @click="uploadVersion">上传新版本</el-button>
        </div>
        <div v-if="newVersionFile" class="version-upload__name">{{ newVersionFile.name }}</div>

        <el-timeline class="version-timeline">
          <el-timeline-item
            v-for="version in versions"
            :key="version.id"
            :timestamp="dayjs(version.createdAt).format('YYYY-MM-DD HH:mm')"
            :type="version.isCurrent ? 'primary' : 'info'"
            placement="top"
          >
            <div class="version">
              <div class="version__head">
                <strong>v{{ version.versionNo }}</strong>
                <el-tag v-if="version.isCurrent" size="small" type="primary">当前</el-tag>
                <el-tag size="small" type="success" effect="plain">
                  {{ (version.sizeBytes / 1024).toFixed(1) }} KB
                </el-tag>
              </div>
              <div class="version__note">{{ version.changelog ?? '无版本说明' }}</div>
              <el-button
                v-if="isAdmin && !version.isCurrent"
                link
                type="warning"
                size="small"
                @click="rollback(version)"
              >
                回滚到此版本
              </el-button>
            </div>
          </el-timeline-item>
        </el-timeline>
      </el-card>
    </div>

    <el-dialog v-model="requestDialog" title="申请下线" width="480px">
      <el-alert
        type="warning"
        show-icon
        :closable="false"
        title="提交后页面仍会继续在线"
        description="下线需要管理员批准后才会生效。如果内容需要立即下线，请直接联系管理员强制下线。"
        class="detail__dialog-alert"
      />
      <el-input
        v-model="requestReason"
        type="textarea"
        :rows="4"
        maxlength="300"
        show-word-limit
        placeholder="请说明下线原因，例如：数据已过期 / 改由新页面替代 / 包含不再适用内容"
      />
      <template #footer>
        <el-button @click="requestDialog = false">取消</el-button>
        <el-button type="danger" :loading="busy" @click="submitRequest">提交申请</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="rejectDialog" title="驳回页面" width="480px">
      <el-input v-model="rejectComment" type="textarea" :rows="4" placeholder="请填写驳回原因，会展示给提交人" />
      <template #footer>
        <el-button @click="rejectDialog = false">取消</el-button>
        <el-button type="danger" :loading="busy" @click="reject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.detail__head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.detail__head-main {
  flex: 1;
  min-width: 0;
}

.detail__title {
  margin: 0;
  font-size: 19px;
}

.detail__tags {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.detail__dialog-alert {
  margin-bottom: 12px;
}

.detail__readonly {
  align-self: center;
}

.detail__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.detail__alert {
  margin-bottom: 14px;
}

.detail__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: 14px;
  align-items: start;
}


.detail__form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.field-tip {
  margin-top: 6px;
  font-size: 12px;
  color: var(--hmp-muted);
  line-height: 1.6;
}

.tag-chip {
  margin-right: 6px;
}

.version-upload {
  margin-bottom: 8px;
}

.version-upload__row {
  display: flex;
  gap: 8px;
}

.version-upload__name {
  margin-top: 6px;
  font-size: 12px;
  color: var(--hmp-muted);
}

.version-timeline {
  margin-top: 16px;
  padding-left: 2px;
}

.version__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version__note {
  color: var(--hmp-muted);
  font-size: 13px;
  margin: 4px 0;
}

@media (max-width: 960px) {
  .detail__grid {
    grid-template-columns: 1fr;
  }
}
</style>