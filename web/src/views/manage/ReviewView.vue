<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { api } from '@/api'
import { useSiteStore } from '@/stores/site'
import VisibilityTag from '@/components/VisibilityTag.vue'
import { VISIBILITY_LABEL, STATUS_LABEL, type PageSummary, type PageStatus } from '@shared/types'

const router = useRouter()
const site = useSiteStore()

type Tab = 'publish' | 'unpublish'

const tab = ref<Tab>('publish')
const loading = ref(false)
const busy = ref(false)
const items = ref<PageSummary[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20

const rejectDialog = ref(false)
const rejectTarget = ref<PageSummary | null>(null)
const rejectNote = ref('')

const isPublishTab = computed(() => tab.value === 'publish')

const summary = computed(() => ({ count: total.value }))

function statusTagType(status: string): string {
  if (status === 'published') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'rejected') return 'danger'
  return 'info'
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const result = isPublishTab.value
      ? await api.managePages({ status: 'pending', page: page.value, pageSize })
      : await api.managePages({ unpublishRequested: 'true', page: page.value, pageSize })
    items.value = result.items
    total.value = result.total
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function switchTab(next: Tab): void {
  tab.value = next
  page.value = 1
  void load()
}

async function approve(item: PageSummary): Promise<void> {
  busy.value = true
  try {
    await api.reviewPage(item.id, 'approve')
    ElMessage.success(`「${item.title}」已发布`)
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function reject(item: PageSummary): Promise<void> {
  const { value } = await ElMessageBox.prompt('请填写驳回原因，会展示给提交人', '驳回页面', {
    confirmButtonText: '确认驳回',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputValidator: (text) => (text && text.trim() ? true : '驳回意见不能为空'),
  }).catch(() => ({ value: '' }))

  if (!value?.trim()) return

  busy.value = true
  try {
    await api.reviewPage(item.id, 'reject', value.trim())
    ElMessage.success('已驳回')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

function openRejectUnpublish(item: PageSummary): void {
  rejectTarget.value = item
  rejectNote.value = ''
  rejectDialog.value = true
}

async function approveUnpublish(item: PageSummary): Promise<void> {
  await ElMessageBox.confirm(
    `确认批准「${item.title}」的下线申请吗？批准后页面会立即下线，且不再对外可见。`,
    '批准下线',
    { type: 'warning', confirmButtonText: '确认下线' },
  )
  busy.value = true
  try {
    await api.approveUnpublish(item.id)
    ElMessage.success('已批准下线，页面已下线')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function rejectUnpublish(): Promise<void> {
  const target = rejectTarget.value
  if (!target) return
  busy.value = true
  try {
    await api.rejectUnpublish(target.id, rejectNote.value.trim() || undefined)
    ElMessage.success('已驳回下线申请，页面保持在线')
    rejectDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await site.load().catch(() => undefined)
  await load()
})
</script>

<template>
  <div class="review">
    <header class="review__head">
      <h2 class="hmp-page-title">审核队列</h2>
      <el-radio-group :model-value="tab" size="small" @change="switchTab($event as Tab)">
        <el-radio-button value="publish">发布审核</el-radio-button>
        <el-radio-button value="unpublish">下线申请</el-radio-button>
      </el-radio-group>
      <el-tag :type="isPublishTab ? 'warning' : 'danger'" effect="dark">
        待处理 {{ summary.count }}
      </el-tag>
    </header>

    <el-alert
      v-if="isPublishTab"
      type="info"
      show-icon
      :closable="false"
      title="发布审核要点"
      description="重点确认：1) 可见性是否符合内容敏感度；2) 页面是否包含账号、口令等敏感信息；3) 内容是否为公司正式对外版本。"
      class="review__alert"
    />
    <el-alert
      v-else
      type="warning"
      show-icon
      :closable="false"
      title="下线申请说明"
      description="这些页面在申请期间仍保持在线。批准后立即下线并从所有入口移除；驳回后页面继续在线，申请人会看到你的处理意见。"
      class="review__alert"
    />

    <el-card v-loading="loading" shadow="never">
      <el-empty
        v-if="!items.length && !loading"
        :description="isPublishTab ? '当前没有待审核的页面' : '当前没有待处理的下线申请'"
      />

      <div v-else class="review__list">
        <div v-for="item in items" :key="item.id" class="review__item">
          <div class="review__item-main">
            <div class="review__item-title">
              <span>{{ item.title }}</span>
              <VisibilityTag :visibility="item.visibility" />
              <el-tag size="small" :type="statusTagType(item.status)" effect="plain">
                {{ STATUS_LABEL[item.status as PageStatus] }}
              </el-tag>
              <el-tag v-if="item.unpublishRequestedAt" size="small" type="warning" effect="dark">
                下线申请中
              </el-tag>
            </div>

            <div class="review__item-meta">
              <span>提交人：{{ item.ownerName ?? '-' }}</span>
              <span>部门：{{ item.departmentName ?? '-' }}</span>
              <span>分类：{{ item.categoryName ?? '未分类' }}</span>
              <span>可见性：{{ VISIBILITY_LABEL[item.visibility] }}</span>
              <span>浏览：{{ item.viewCount }}</span>
              <span>更新于 {{ dayjs(item.updatedAt).format('YYYY-MM-DD HH:mm') }}</span>
            </div>

            <div v-if="item.summary" class="review__item-summary">{{ item.summary }}</div>

            <div v-if="item.unpublishRequestedAt" class="review__item-reason">
              <b>下线原因：</b>{{ item.unpublishReason ?? '-' }}
              <span class="review__item-requester">
                （申请人：{{ item.unpublishRequestedByName ?? '-' }}，
                {{ dayjs(item.unpublishRequestedAt).format('YYYY-MM-DD HH:mm') }}）
              </span>
            </div>
          </div>

          <div class="review__item-actions">
            <el-button size="small" @click="router.push({ name: 'manage-detail', params: { id: item.id } })">
              查看详情
            </el-button>

            <template v-if="isPublishTab">
              <el-button size="small" type="success" :loading="busy" @click="approve(item)">通过</el-button>
              <el-button size="small" type="danger" :loading="busy" @click="reject(item)">驳回</el-button>
            </template>

            <template v-else>
              <el-button size="small" type="danger" :loading="busy" @click="approveUnpublish(item)">
                批准下线
              </el-button>
              <el-button size="small" :loading="busy" @click="openRejectUnpublish(item)">驳回申请</el-button>
            </template>
          </div>
        </div>
      </div>

      <div v-if="total > pageSize" class="review__pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          background
          @current-change="load"
        />
      </div>
    </el-card>

    <el-dialog v-model="rejectDialog" title="驳回下线申请" width="480px">
      <p class="review__dialog-text">
        页面：<strong>{{ rejectTarget?.title }}</strong>
      </p>
      <el-input
        v-model="rejectNote"
        type="textarea"
        :rows="4"
        maxlength="300"
        show-word-limit
        placeholder="请填写处理意见，会展示给申请人，例如：页面仍在被其他部门使用，建议保留"
      />
      <template #footer>
        <el-button @click="rejectDialog = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="rejectUnpublish">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.review__head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}


.review__alert {
  margin-bottom: 14px;
}

.review__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.review__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px;
  border: 1px solid var(--hmp-border);
  border-radius: 10px;
}

.review__item-main {
  min-width: 0;
  flex: 1;
}

.review__item-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 15px;
  flex-wrap: wrap;
}

.review__item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--hmp-muted);
}

.review__item-summary {
  margin-top: 8px;
  font-size: 13px;
  opacity: 0.8;
}

.review__item-reason {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--el-color-warning-light-9);
  border: 1px solid var(--el-color-warning-light-7);
  border-radius: var(--hmp-radius);
  font-size: 13px;
  color: var(--el-color-warning-dark-2);
}

.review__item-requester {
  opacity: 0.8;
  font-size: 12px;
}

.review__item-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.review__dialog-text {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--hmp-muted);
}

.review__pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

@media (max-width: 768px) {
  .review__item {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>